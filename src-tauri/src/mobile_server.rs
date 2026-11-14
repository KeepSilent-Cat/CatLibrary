//! 手机访问：在内网起一个只读 HTTP 服务，让手机浏览器直接翻库。
//!
//! 安全设计（默认最保守）：
//! - 只监听本机内网 IPv4，绝不绑 0.0.0.0 / 公网
//! - 必须带正确 token 才能访问，token 每次启动重新生成
//! - 只读：没有写接口，不能删除 / 重命名任何东西
//! - 不做目录列表遍历：只能按「分类 + 合集 id」取内容，路径做越界校验
//! - 不写访问日志

use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
  has_extension, load_library_metadata, rating_of, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS,
};

const MAX_THUMB: u32 = 560;

/// 列出合集 source/ 下的文件（按名字排序，保证手机端顺序稳定）
fn list_source_files(dir: &Path) -> Vec<PathBuf> {
  let Ok(entries) = fs::read_dir(dir) else {
    return Vec::new();
  };
  let mut files: Vec<PathBuf> = entries
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.is_file())
    .collect();
  files.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
  files
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAccessInfo {
  /// 首选地址（默认路由网卡）
  pub url: String,
  /// 所有可用地址：换热点 / 插网线 / USB 转发时挑能用的那个
  pub urls: Vec<String>,
  pub token: String,
  pub port: u16,
}

struct Running {
  stop: Arc<AtomicBool>,
  info: MobileAccessInfo,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<Running>> {
  RUNNING.get_or_init(|| Mutex::new(None))
}

/// 取本机内网 IPv4：用一个不会真正发包的 UDP connect 让系统选出口网卡。
fn lan_ip() -> Option<Ipv4Addr> {
  let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
  socket.connect("223.5.5.5:80").ok()?;
  match socket.local_addr().ok()?.ip() {
    IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
    _ => None,
  }
}

/// 列出本机其它可用的内网 IPv4（解析 ipconfig，避免额外依赖）
fn other_ipv4_addresses(primary: Ipv4Addr) -> Vec<Ipv4Addr> {
  let Ok(output) = std::process::Command::new("ipconfig").output() else {
    return Vec::new();
  };
  let text = String::from_utf8_lossy(&output.stdout);
  let mut found: Vec<Ipv4Addr> = Vec::new();
  for token in text.split(|ch: char| !(ch.is_ascii_digit() || ch == '.')) {
    let trimmed = token.trim_matches('.');
    if trimmed.is_empty() || trimmed.matches('.').count() != 3 {
      continue;
    }
    let Ok(ip) = trimmed.parse::<Ipv4Addr>() else { continue };
    if ip.is_loopback() || ip.is_unspecified() || ip.is_link_local() || ip == primary {
      continue;
    }
    if found.contains(&ip) {
      continue;
    }
    found.push(ip);
  }
  found
}

fn make_token() -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|value| value.as_nanos())
    .unwrap_or_default();
  let seed = format!("{nanos}-{}-{}", std::process::id(), nanos % 9973);
  let digest = Sha256::digest(seed.as_bytes());
  digest[..16].iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn start(app: tauri::AppHandle, resource_root: String) -> Result<MobileAccessInfo, String> {
  let mut guard = running().lock().map_err(|_| "手机访问状态异常".to_string())?;
  if let Some(current) = guard.as_ref() {
    return Ok(current.info.clone());
  }

  let root = PathBuf::from(&resource_root);
  if !root.is_dir() {
    return Err("素材库目录不存在，先在设置里选择资源库".into());
  }

  let ip = lan_ip().unwrap_or(Ipv4Addr::LOCALHOST);
  // 绑定所有网卡：换 WiFi / 连手机热点 / 插网线 / USB 转发都能直接连通，
  // 不需要每次重新开启；没有公网 IP 时外部依然进不来，且所有请求都要 token。
  let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0))
    .map_err(|error| format!("启动服务失败：{error}"))?;
  let port = listener.local_addr().map_err(|error| error.to_string())?.port();
  let token = make_token();
  let stop = Arc::new(AtomicBool::new(false));

  let mut urls = vec![format!("http://{ip}:{port}/?t={token}")];
  for candidate in other_ipv4_addresses(ip) {
    urls.push(format!("http://{candidate}:{port}/?t={token}"));
  }
  let info = MobileAccessInfo {
    url: urls[0].clone(),
    urls,
    token: token.clone(),
    port,
  };

  let stop_flag = stop.clone();
  let shared_root = root.clone();
  let shared_token = token.clone();
  let app_handle = app.clone();
  thread::spawn(move || {
    for incoming in listener.incoming() {
      if stop_flag.load(Ordering::Relaxed) {
        break;
      }
      let Ok(stream) = incoming else { continue };
      let root = shared_root.clone();
      let token = shared_token.clone();
      let app = app_handle.clone();
      let app_for_thread = Some(app.clone());
      thread::spawn(move || {
        let _ = handle_connection(stream, &root, &token, app_for_thread.as_ref());
      });
    }
  });

  *guard = Some(Running { stop, info: info.clone() });
  Ok(info)
}

pub fn stop() {
  if let Ok(mut guard) = running().lock() {
    if let Some(current) = guard.take() {
      current.stop.store(true, Ordering::Relaxed);
    }
  }
}

pub fn status() -> Option<MobileAccessInfo> {
  running()
    .lock()
    .ok()
    .and_then(|guard| guard.as_ref().map(|current| current.info.clone()))
}

/* ---------------- Tauri 命令 ---------------- */

#[tauri::command]
pub fn start_mobile_access(
  app: tauri::AppHandle,
  resource_root: String,
) -> Result<MobileAccessInfo, String> {
  start(app, resource_root)
}

#[tauri::command]
pub fn stop_mobile_access() {
  stop();
}

#[tauri::command]
pub fn mobile_access_status() -> Option<MobileAccessInfo> {
  status()
}

/* ---------------- HTTP ---------------- */

struct Request {
  path: String,
  query: Vec<(String, String)>,
  range: Option<(u64, Option<u64>)>,
}

fn handle_connection(
  mut stream: TcpStream,
  root: &Path,
  token: &str,
  app: Option<&tauri::AppHandle>,
) -> std::io::Result<()> {
  stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).ok();
  stream.set_write_timeout(Some(std::time::Duration::from_secs(30))).ok();

  let mut reader = BufReader::new(stream.try_clone()?);
  let mut line = String::new();
  if reader.read_line(&mut line)? == 0 {
    return Ok(());
  }
  let mut parts = line.split_whitespace();
  let method = parts.next().unwrap_or_default().to_string();
  let target = parts.next().unwrap_or_default().to_string();
  if method != "GET" && method != "HEAD" {
    return respond_text(&mut stream, 405, "只支持只读访问");
  }

  let mut range = None;
  loop {
    let mut header = String::new();
    if reader.read_line(&mut header)? == 0 {
      break;
    }
    let trimmed = header.trim_end();
    if trimmed.is_empty() {
      break;
    }
    if let Some(value) = trimmed.strip_prefix("Range:") {
      range = parse_range(value.trim());
    } else if let Some(value) = trimmed.strip_prefix("range:") {
      range = parse_range(value.trim());
    }
  }

  let (path, query) = split_target(&target);
  let request = Request { path, query, range };

  if request.path == "/" || request.path == "/index.html" {
    let html = include_str!("../mobile/index.html");
    return respond_bytes(&mut stream, 200, "text/html; charset=utf-8", html.as_bytes(), None);
  }

  let given = query_value(&request.query, "t").unwrap_or_default();
  if !constant_eq(&given, token) {
    return respond_text(&mut stream, 401, "token 无效，请重新扫码或在电脑上重新启动手机访问");
  }

  match request.path.as_str() {
    "/ping" => respond_bytes(&mut stream, 200, "text/plain; charset=utf-8", b"ok", None),
    "/api/index" => match app.ok_or("服务未就绪".to_string()).and_then(|handle| build_index(root, handle)) {
      Ok(json) => respond_bytes(
        &mut stream,
        200,
        "application/json; charset=utf-8",
        json.as_bytes(),
        None,
      ),
      Err(error) => respond_text(&mut stream, 500, &error),
    },
    "/api/cover" => match serve_cover(root, &request.query) {
      Ok(bytes) => respond_bytes(&mut stream, 200, "image/jpeg", &bytes, None),
      Err(error) => respond_text(&mut stream, 404, &error),
    },
    "/api/list" => match build_file_list(root, &request.query) {
      Ok(json) => respond_bytes(
        &mut stream,
        200,
        "application/json; charset=utf-8",
        json.as_bytes(),
        None,
      ),
      Err(error) => respond_text(&mut stream, 400, &error),
    },
    "/media" => serve_media(&mut stream, root, &request),
    _ => respond_text(&mut stream, 404, "not found"),
  }
}

fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
  let value = value.strip_prefix("bytes=")?;
  let (start, end) = value.split_once('-')?;
  let start = start.trim().parse::<u64>().ok()?;
  let end = end.trim().parse::<u64>().ok();
  Some((start, end))
}

fn split_target(target: &str) -> (String, Vec<(String, String)>) {
  match target.split_once('?') {
    Some((path, query)) => (percent_decode(path), parse_query(query)),
    None => (percent_decode(target), Vec::new()),
  }
}

fn parse_query(raw: &str) -> Vec<(String, String)> {
  raw
    .split('&')
    .filter(|pair| !pair.is_empty())
    .map(|pair| match pair.split_once('=') {
      Some((key, value)) => (percent_decode(key), percent_decode(value)),
      None => (percent_decode(pair), String::new()),
    })
    .collect()
}

fn percent_decode(value: &str) -> String {
  let bytes = value.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut index = 0;
  while index < bytes.len() {
    match bytes[index] {
      b'%' if index + 2 < bytes.len() => {
        let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
        match u8::from_str_radix(hex, 16) {
          Ok(byte) => {
            out.push(byte);
            index += 3;
          }
          Err(_) => {
            out.push(bytes[index]);
            index += 1;
          }
        }
      }
      b'+' => {
        out.push(b' ');
        index += 1;
      }
      byte => {
        out.push(byte);
        index += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).to_string()
}

fn query_value(query: &[(String, String)], key: &str) -> Option<String> {
  query
    .iter()
    .find(|(name, _)| name == key)
    .map(|(_, value)| value.clone())
}

fn constant_eq(left: &str, right: &str) -> bool {
  if left.len() != right.len() {
    return false;
  }
  left
    .bytes()
    .zip(right.bytes())
    .fold(0u8, |acc, (a, b)| acc | (a ^ b))
    == 0
}

fn respond_text(stream: &mut TcpStream, status: u16, message: &str) -> std::io::Result<()> {
  respond_bytes(
    stream,
    status,
    "text/plain; charset=utf-8",
    message.as_bytes(),
    None,
  )
}

fn respond_bytes(
  stream: &mut TcpStream,
  status: u16,
  content_type: &str,
  body: &[u8],
  extra: Option<String>,
) -> std::io::Result<()> {
  let mut head = format!(
    "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
    status_text(status),
    body.len()
  );
  if let Some(extra) = extra {
    head.push_str(&extra);
  }
  head.push_str("\r\n");
  stream.write_all(head.as_bytes())?;
  stream.write_all(body)?;
  stream.flush()
}

fn status_text(status: u16) -> &'static str {
  match status {
    200 => "OK",
    206 => "Partial Content",
    400 => "Bad Request",
    401 => "Unauthorized",
    404 => "Not Found",
    405 => "Method Not Allowed",
    _ => "Error",
  }
}

/* ---------------- 业务 ---------------- */

fn category_files(root: &Path, category: &str, item_id: &str) -> Vec<PathBuf> {
  let dir = match category {
    "images" | "screenshots" => root.join(category).join(item_id).join("source"),
    "videos" => root.join(category).join(item_id).join("source"),
    _ => root.join(category).join(item_id).join("source"),
  };
  list_source_files(&dir)
}

fn pick_cover(root: &Path, category: &str, item_id: &str) -> Option<PathBuf> {
  let cover_dir = root.join(category).join(item_id).join("cover");
  if let Ok(entries) = fs::read_dir(&cover_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.is_file() && has_extension(&path, IMAGE_EXTENSIONS) {
        return Some(path);
      }
    }
  }
  category_files(root, category, item_id)
    .into_iter()
    .find(|path| has_extension(path, IMAGE_EXTENSIONS))
}

fn thumb_cache_dir(root: &Path) -> PathBuf {
  let mut hasher = Sha256::new();
  hasher.update(root.to_string_lossy().as_bytes());
  let key: String = hasher.finalize()[..8].iter().map(|byte| format!("{byte:02x}")).collect();
  std::env::temp_dir().join("catlibrary-mobile").join(key)
}

fn serve_cover(root: &Path, query: &[(String, String)]) -> Result<Vec<u8>, String> {
  let category = query_value(query, "c").ok_or("缺少分类")?;
  let item_id = query_value(query, "id").ok_or("缺少合集")?;
  let source = pick_cover(root, &category, &item_id).ok_or("没有可用的封面")?;

  let modified = fs::metadata(&source)
    .and_then(|meta| meta.modified())
    .map(|time| {
      time
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
    })
    .unwrap_or_default();
  let mut hasher = Sha256::new();
  hasher.update(source.to_string_lossy().as_bytes());
  hasher.update(modified.to_le_bytes());
  let cache_key: String = hasher.finalize()[..12].iter().map(|byte| format!("{byte:02x}")).collect();
  let cache_dir = thumb_cache_dir(root);
  let cache_path = cache_dir.join(format!("{cache_key}.jpg"));

  if let Ok(bytes) = fs::read(&cache_path) {
    return Ok(bytes);
  }

  let image = image::open(&source).map_err(|error| error.to_string())?;
  let thumb = image.thumbnail(MAX_THUMB, MAX_THUMB).to_rgb8();
  let mut buffer = std::io::Cursor::new(Vec::new());
  let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 78);
  encoder
    .encode(thumb.as_raw(), thumb.width(), thumb.height(), image::ExtendedColorType::Rgb8)
    .map_err(|error| error.to_string())?;
  let bytes = buffer.into_inner();
  let _ = fs::create_dir_all(&cache_dir);
  let _ = fs::write(&cache_path, &bytes);
  Ok(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileItem {
  key: String,
  category: String,
  id: String,
  title: String,
  rating: u8,
  count: usize,
  tags: Vec<String>,
  has_video: bool,
}

fn build_index(root: &Path, app: &tauri::AppHandle) -> Result<String, String> {
  let metadata = load_library_metadata(app, root)?;
  let mut items: Vec<MobileItem> = Vec::new();

  for category in ["screenshots", "images", "videos"] {
    let dir = root.join(category);
    let Ok(entries) = fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      let path = entry.path();
      if !path.is_dir() {
        continue;
      }
      let Some(id) = path.file_name().and_then(|name| name.to_str()).map(str::to_string) else {
        continue;
      };
      let key = format!("{category}/{id}");
      let entry_meta = metadata.get(&key);
      let title = entry_meta
        .and_then(|value| value.title.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| id.clone());
      let rating = entry_meta.map(rating_of).unwrap_or(0);
      let tags = entry_meta.and_then(|value| value.tags.clone()).unwrap_or_default();
      let files = category_files(root, category, &id);
      let has_video = files.iter().any(|file| has_extension(file, VIDEO_EXTENSIONS));
      if files.is_empty() {
        continue;
      }
      items.push(MobileItem {
        key,
        category: category.to_string(),
        id,
        title,
        rating,
        count: files.len(),
        tags,
        has_video,
      });
    }
  }

  serde_json::to_string(&items).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileFile {
  index: usize,
  name: String,
  is_video: bool,
}

fn build_file_list(root: &Path, query: &[(String, String)]) -> Result<String, String> {
  let category = query_value(query, "c").ok_or("缺少分类")?;
  let item_id = query_value(query, "id").ok_or("缺少合集")?;
  let files = category_files(root, &category, &item_id);
  if files.is_empty() {
    return Err("这个合集没有可读文件".into());
  }
  let listed: Vec<MobileFile> = files
    .iter()
    .enumerate()
    .map(|(index, path)| MobileFile {
      index,
      name: path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string(),
      is_video: has_extension(path, VIDEO_EXTENSIONS),
    })
    .collect();
  serde_json::to_string(&listed).map_err(|error| error.to_string())
}

fn serve_media(
  stream: &mut TcpStream,
  root: &Path,
  request: &Request,
) -> std::io::Result<()> {
  let category = query_value(&request.query, "c").unwrap_or_default();
  let item_id = query_value(&request.query, "id").unwrap_or_default();
  let index: usize = query_value(&request.query, "n")
    .and_then(|value| value.parse().ok())
    .unwrap_or(0);

  let files = category_files(root, &category, &item_id);
  let Some(path) = files.get(index).cloned() else {
    return respond_text(stream, 404, "文件不存在");
  };
  let Ok(mut file) = fs::File::open(&path) else {
    return respond_text(stream, 404, "文件打不开");
  };
  let total = file.metadata().map(|meta| meta.len()).unwrap_or(0);
  let content_type = mime_for(&path);

  let (start, end) = match request.range {
    Some((start, Some(end))) => {
      let start = start.min(total.saturating_sub(1));
      let end = end.min(total.saturating_sub(1));
      (start, end)
    }
    Some((start, None)) => (start.min(total.saturating_sub(1)), total.saturating_sub(1)),
    None => (0, total.saturating_sub(1)),
  };

  let length = end.saturating_sub(start) + 1;
  let partial = request.range.is_some();
  let status = if partial { 206 } else { 200 };

  let mut head = format!(
    "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n",
    status_text(status)
  );
  if partial {
    head.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
  }
  head.push_str("\r\n");
  stream.write_all(head.as_bytes())?;

  file.seek(SeekFrom::Start(start))?;
  let mut remaining = length;
  let mut buffer = vec![0u8; 64 * 1024];
  while remaining > 0 {
    let want = remaining.min(buffer.len() as u64) as usize;
    let read = file.read(&mut buffer[..want])?;
    if read == 0 {
      break;
    }
    stream.write_all(&buffer[..read])?;
    remaining -= read as u64;
  }
  stream.flush()
}

fn mime_for(path: &Path) -> &'static str {
  match path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase()
    .as_str()
  {
    "mp4" => "video/mp4",
    "webm" => "video/webm",
    "mkv" => "video/x-matroska",
    "mov" => "video/quicktime",
    "m4v" => "video/x-m4v",
    "ts" => "video/mp2t",
    "png" => "image/png",
    "webp" => "image/webp",
    "gif" => "image/gif",
    "bmp" => "image/bmp",
    _ => "image/jpeg",
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};

  fn spawn_server(root: PathBuf, token: &str) -> (SocketAddr, Arc<AtomicBool>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let token = token.to_string();
    thread::spawn(move || {
      for incoming in listener.incoming() {
        if stop_flag.load(Ordering::Relaxed) {
          break;
        }
        let Ok(stream) = incoming else { continue };
        let root = root.clone();
        let token = token.clone();
        thread::spawn(move || {
          let _ = handle_connection(stream, &root, &token, None);
        });
      }
    });
    (addr, stop)
  }

  fn raw_request(addr: SocketAddr, path: &str, extra: &str) -> (u16, String, Vec<u8>) {
    let mut stream = TcpStream::connect(addr).expect("connect");
    let request = format!("GET {path} HTTP/1.1\r\nHost: test\r\n{extra}\r\n");
    stream.write_all(request.as_bytes()).expect("write");
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).expect("read");
    let text = String::from_utf8_lossy(&buffer).to_string();
    let status = text
      .lines()
      .next()
      .and_then(|line| line.split_whitespace().nth(1))
      .and_then(|code| code.parse::<u16>().ok())
      .unwrap_or(0);
    let split = buffer
      .windows(4)
      .position(|window| window == b"\r\n\r\n")
      .map(|index| index + 4)
      .unwrap_or(buffer.len());
    let headers = String::from_utf8_lossy(&buffer[..split]).to_string();
    (status, headers, buffer[split..].to_vec())
  }

  fn temp_root() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("catlib-mobile-test-{}", std::process::id()));
    let source = dir.join("images").join("img_1").join("source");
    fs::create_dir_all(&source).expect("mkdir");
    fs::write(source.join("a.jpg"), vec![7u8; 100]).expect("write");
    dir
  }

  #[test]
  fn serves_mobile_page_without_token() {
    let root = temp_root();
    let (addr, stop) = spawn_server(root, "secret");
    let (status, headers, body) = raw_request(addr, "/", "");
    stop.store(true, Ordering::Relaxed);
    assert_eq!(status, 200);
    assert!(headers.contains("text/html"));
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("CatLibrary"));
    assert!(html.contains("/api/index"));
  }

  #[test]
  fn rejects_bad_token() {
    let root = temp_root();
    let (addr, stop) = spawn_server(root, "secret");
    let (status, _, body) = raw_request(addr, "/api/list?t=wrong&c=images&id=img_1", "");
    stop.store(true, Ordering::Relaxed);
    assert_eq!(status, 401);
    assert!(String::from_utf8_lossy(&body).contains("token"));
  }

  #[test]
  fn accepts_range_requests_for_media() {
    let root = temp_root();
    let (addr, stop) = spawn_server(root, "secret");
    let (status, headers, body) = raw_request(
      addr,
      "/media?t=secret&c=images&id=img_1&n=0",
      "Range: bytes=10-19\r\n",
    );
    stop.store(true, Ordering::Relaxed);
    assert_eq!(status, 206);
    assert!(headers.contains("Content-Range: bytes 10-19/100"));
    assert_eq!(body.len(), 10);
    assert!(headers.contains("Accept-Ranges: bytes"));
  }
}
