use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  env, fs,
  io::Write,
  path::{Path, PathBuf},
  sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
  },
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif"];
/// 列表卡片缩略图的最长边（像素）。卡片只有几百像素宽，列表页改加载这个尺寸，
/// 避免放大窗口/全屏时几十张卡片同时解码原始大图造成的卡顿。
const THUMBNAIL_MAX_SIZE: u32 = 480;
/// 缩略图磁盘缓存目录名（放在应用数据目录，不污染用户的素材库）
const THUMBNAIL_DIR_NAME: &str = "thumbnails";
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm", "wmv", "m4v"];
const GAME_FILE_EXTENSIONS: &[&str] = &["exe", "apk", "zip", "rar", "7z", "001", "iso"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma"];
/// 小说可导入的文件：纯文本为主，epub 只做列出（不解析）
const NOVEL_EXTENSIONS: &[&str] = &["txt", "md", "markdown", "epub"];
const PREFERRED_GAME_IMAGE_NAMES: &[&str] = &["cover", "poster", "title", "icon", "presplash_background"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySourceEntry {
  name: String,
  path: String,
  relative_path: String,
  is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryItemPayload {
  id: String,
  title: String,
  /// 艺名/译名（用户自行翻译的展示名，无则为 None）
  alt_name: Option<String>,
  category: String,
  summary: String,
  relative_path: String,
  cover_type: String,
  cover_path: Option<String>,
  /// 列表用封面缩略图路径；为空表示前端应回退到 cover_path（缩略图生成失败/原图已足够小）
  cover_thumb_path: Option<String>,
  preview_path: Option<String>,
  preview_image_paths: Vec<String>,
  source_count: usize,
  modified_at: u64,
  source_entries: Vec<LibrarySourceEntry>,
  /// 内容分级：0=全年龄 1=擦边R15 2=18+（旧数据由 adult 转换）
  rating: u8,
  /// 用户自定义标签（跨分类筛选）
  tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryIndexPayload {
  images: Vec<LibraryItemPayload>,
  videos: Vec<LibraryItemPayload>,
  games: Vec<LibraryItemPayload>,
  comics: Vec<LibraryItemPayload>,
  screenshots: Vec<LibraryItemPayload>,
  music: Vec<LibraryItemPayload>,
  live2d: Vec<LibraryItemPayload>,
  novels: Vec<LibraryItemPayload>,
}

#[derive(Debug, Default, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryMetadataEntry {
  title: Option<String>,
  summary: Option<String>,
  /// 敏感内容标记（旧字段，兼容历史数据：true=18+）
  adult: Option<bool>,
  /// 内容分级：0=全年龄 1=擦边R15 2=18+；优先于 adult
  rating: Option<u8>,
  /// 用户自定义标签（分类/筛选用，空/缺省表示无标签）
  tags: Option<Vec<String>>,
  /// 艺名/译名：用户自行翻译的展示名（原名保留在 title，艺名有值时优先展示）
  alt_name: Option<String>,
  /// 游戏启动程序路径（手动绑定后记录，启动游戏时优先于自动探测）
  launch_path: Option<String>,
}

/// 从 metadata 解析内容分级：rating 优先，adult 兜底（true→2）
fn rating_of(entry: &LibraryMetadataEntry) -> u8 {
  if let Some(rating) = entry.rating {
    return rating.min(2);
  }
  if entry.adult.unwrap_or(false) {
    2
  } else {
    0
  }
}

/// 规范化标签：去首尾空白、丢弃空串、去重（保持输入顺序）
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
  let mut result: Vec<String> = Vec::new();
  for tag in tags {
    let trimmed = tag.trim().to_string();
    if trimmed.is_empty() {
      continue;
    }
    if !result.iter().any(|existing| existing == &trimmed) {
      result.push(trimmed);
    }
  }
  result
}

/// 从 metadata 读取标签列表
fn tags_of(entry: &LibraryMetadataEntry) -> Vec<String> {
  entry.tags.clone().unwrap_or_default()
}

/// 运行期把资源根目录加入 asset 协议白名单。
///
/// tauri.conf.json 里的 assetProtocol.scope 只放行最小范围（应用数据目录），
/// 素材库位置由用户在设置里自由指定，所以必须在真正扫描时按需授权。
/// 用 canonicalize 后的路径，避免盘符大小写/短路径与前端传入的写法不一致导致匹配失败。
fn allow_asset_root(app: &AppHandle, root: &Path) {
  let scope = app.asset_protocol_scope();
  let resolved = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());

  if let Err(error) = scope.allow_directory(&resolved, true) {
    eprintln!("授权素材目录失败（{}）：{error}", resolved.display());
  }
  if resolved != root {
    let _ = scope.allow_directory(root, true);
  }
}

#[tauri::command]
fn scan_library(app: AppHandle, resource_root: String) -> Result<LibraryIndexPayload, String> {
  let root = PathBuf::from(resource_root);
  if !root.exists() {
    return Ok(LibraryIndexPayload {
      images: Vec::new(),
      videos: Vec::new(),
      games: Vec::new(),
      comics: Vec::new(),
      screenshots: Vec::new(),
      music: Vec::new(),
      live2d: Vec::new(),
      novels: Vec::new(),
    });
  }

  // 卡片、封面、漫画页、音频都要通过 asset 协议读取，扫描前先授权该目录
  allow_asset_root(&app, &root);

  let metadata = load_library_metadata(&app, &root)?;

  let mut index = LibraryIndexPayload {
    images: scan_category(&root, "images", &metadata)?,
    videos: scan_category(&root, "videos", &metadata)?,
    games: scan_category(&root, "games", &metadata)?,
    comics: scan_category(&root, "comics", &metadata)?,
    screenshots: scan_category(&root, "screenshots", &metadata)?,
    music: scan_category(&root, "music", &metadata)?,
    live2d: scan_category(&root, "live2d", &metadata)?,
    novels: scan_category(&root, "novels", &metadata)?,
  };

  attach_cover_thumbnails(&app, &mut index);

  Ok(index)
}

/// 计算缩略图缓存键：源文件绝对路径 + 修改时间 + 文件大小。
/// 三者任一变化都会生成新键，旧缓存自动失效（不做主动清理，重启后按新键重建）。
fn thumbnail_cache_key(path: &Path) -> String {
  let mut bytes = path.to_string_lossy().as_bytes().to_vec();
  if let Ok(metadata) = fs::metadata(path) {
    if let Ok(modified) = metadata.modified() {
      if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
        bytes.extend_from_slice(&duration.as_secs().to_le_bytes());
      }
    }
    bytes.extend_from_slice(&metadata.len().to_le_bytes());
  }

  // FNV-1a 64bit：稳定且无需额外依赖，跨进程/跨版本结果一致
  let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
  for byte in bytes {
    hash ^= byte as u64;
    hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
  }

  format!("{hash:016x}")
}

/// 该扩展名的图片是否可能带透明通道（决定缩略图编码成 PNG 还是 JPEG）
fn may_have_alpha(path: &Path) -> bool {
  path
    .extension()
    .and_then(|value| value.to_str())
    .map(|extension| {
      matches!(
        extension.to_ascii_lowercase().as_str(),
        "png" | "gif" | "webp"
      )
    })
    .unwrap_or(false)
}

/// 缩略图里是否真的存在不透明以外的像素。
/// 很多 .png 其实是全不透明的照片，这种没必要付 PNG 的体积代价，可以安全地压成 JPEG。
fn has_transparent_pixels(image: &image::DynamicImage) -> bool {
  if !image.color().has_alpha() {
    return false;
  }

  image.to_rgba8().pixels().any(|pixel| pixel.0[3] < 255)
}

/// 生成（或命中缓存）一张封面缩略图，返回可直接交给前端加载的路径。
/// 任何失败都返回 None，由调用方回退到原图，保证不会因为缩略图问题丢失封面。
fn ensure_cover_thumbnail(cache_dir: &Path, source: &Path) -> Option<PathBuf> {
  if !source.is_file() {
    return None;
  }

  // 原图本来就比缩略图还小就直接复用，省掉一次无意义的重编码
  let (width, height) = image::image_dimensions(source).ok()?;
  if width.max(height) <= THUMBNAIL_MAX_SIZE {
    return Some(source.to_path_buf());
  }

  let key = thumbnail_cache_key(source);
  // 编码格式要解码后才知道（取决于是否真有透明像素），所以两种后缀都查一遍
  for extension in ["jpg", "png"] {
    let candidate = cache_dir.join(format!("{key}.{extension}"));
    if candidate.is_file() {
      return Some(candidate);
    }
  }

  let decoded = image::open(source).ok()?;
  let thumbnail = decoded.thumbnail(THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE);

  // 只有确实带透明像素时才保留 PNG，其余一律 JPEG：
  // 同尺寸下 PNG 缩略图约为 JPEG 的 5 倍体积，解码也更慢，列表页没必要付这个成本。
  let keep_alpha = may_have_alpha(source) && has_transparent_pixels(&thumbnail);
  let extension = if keep_alpha { "png" } else { "jpg" };
  let target = cache_dir.join(format!("{key}.{extension}"));

  // 先写临时文件再改名：多线程同时生成同一张图时，避免前端读到只写了一半的文件
  let temp = cache_dir.join(format!("{key}.{}.tmp", std::process::id()));
  let encoded = if keep_alpha {
    thumbnail.save_with_format(&temp, image::ImageFormat::Png).is_ok()
  } else {
    match fs::File::create(&temp) {
      Ok(mut file) => {
        // JPEG 不支持透明通道，统一转成 RGB 再编码，避免编码器拒绝 RGBA 输入
        let rgb = thumbnail.to_rgb8();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, 82);
        encoder.encode_image(&rgb).is_ok()
      }
      Err(_) => false,
    }
  };

  if !encoded {
    let _ = fs::remove_file(&temp);
    return None;
  }

  if fs::rename(&temp, &target).is_err() {
    let _ = fs::remove_file(&temp);
    // Windows 下 rename 不会覆盖已存在的文件：若另一个线程刚好写好了同一张，直接复用它
    return target.is_file().then_some(target);
  }

  Some(target)
}

/// 为整库卡片的封面生成缩略图（有界并发），写回 `cover_thumb_path`。
/// 只在扫描结束后统一做一次，避免在遍历目录时同步阻塞。
fn attach_cover_thumbnails(app: &AppHandle, index: &mut LibraryIndexPayload) {
  let Ok(cache_dir) = app
    .path()
    .app_data_dir()
    .map(|directory| directory.join(THUMBNAIL_DIR_NAME))
  else {
    return;
  };

  if fs::create_dir_all(&cache_dir).is_err() {
    return;
  }

  // 顺序固定，保证 job 下标能映射回具体条目
  let mut lists: Vec<&mut Vec<LibraryItemPayload>> = vec![
    &mut index.images,
    &mut index.videos,
    &mut index.games,
    &mut index.comics,
    &mut index.screenshots,
    &mut index.music,
    &mut index.live2d,
  ];

  let mut jobs: Vec<(usize, usize, PathBuf)> = Vec::new();
  for (list_index, items) in lists.iter().enumerate() {
    for (item_index, item) in items.iter().enumerate() {
      let Some(cover) = item.cover_path.as_ref() else {
        continue;
      };
      jobs.push((list_index, item_index, PathBuf::from(cover)));
    }
  }

  if jobs.is_empty() {
    return;
  }

  let results: Mutex<Vec<(usize, Option<PathBuf>)>> = Mutex::new(Vec::with_capacity(jobs.len()));
  let cursor = AtomicUsize::new(0);
  let worker_count = std::thread::available_parallelism()
    .map(|value| value.get())
    .unwrap_or(4)
    .clamp(1, 8);

  std::thread::scope(|scope| {
    for _ in 0..worker_count {
      scope.spawn(|| loop {
        let job_index = cursor.fetch_add(1, Ordering::Relaxed);
        let Some((_, _, source)) = jobs.get(job_index) else {
          break;
        };

        let thumbnail = ensure_cover_thumbnail(&cache_dir, source);
        results.lock().unwrap().push((job_index, thumbnail));
      });
    }
  });

  let Ok(results) = results.into_inner() else {
    return;
  };

  for (job_index, thumbnail) in results {
    let Some((list_index, item_index, source)) = jobs.get(job_index) else {
      continue;
    };
    let Some(thumbnail) = thumbnail else {
      continue;
    };
    // 原图本身已足够小时 ensure 会原样返回它，此时保持字段为空让前端直接复用 cover_path
    if thumbnail == *source {
      continue;
    }

    lists[*list_index][*item_index].cover_thumb_path = Some(path_to_string(thumbnail));
  }
}

/// 解析启动时的资源根目录：现有值有效则沿用，否则回退到可移植目录
/// （exe 同级的 library），保证换电脑/换盘符后仍能定位素材库。
#[tauri::command]
fn resolve_initial_resource_root(app: AppHandle, current: String) -> Result<String, String> {
  if !current.trim().is_empty() && Path::new(&current).exists() {
    allow_asset_root(&app, Path::new(&current));
    return Ok(current);
  }

  let exe = env::current_exe().map_err(|error| error.to_string())?;
  let dir = exe
    .parent()
    .ok_or_else(|| "无法定位程序所在目录".to_string())?;

  let fallback = dir.join("library");
  allow_asset_root(&app, &fallback);
  Ok(fallback.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_library_metadata(
  app: AppHandle,
  resource_root: String,
  category: String,
  item_id: String,
  title: String,
  summary: String,
  alt_name: String,
  _adult: Option<bool>,
  rating: Option<u8>,
  tags: Option<Vec<String>>,
) -> Result<(), String> {
  let root = PathBuf::from(resource_root);
  let mut metadata = load_library_metadata(&app, &root)?;
  let key = format!("{category}/{item_id}");
  let rating = rating.map(|value| value.min(2));
  let tags = tags.map(normalize_tags);

  metadata.insert(
    key,
    LibraryMetadataEntry {
      title: normalize_metadata_value(title),
      summary: normalize_metadata_value(summary),
      // 同步写旧字段，保证旧版本/其他读取路径一致
      adult: Some(rating.unwrap_or(0) >= 2),
      rating,
      tags,
      alt_name: normalize_metadata_value(alt_name),
      launch_path: None,
    },
  );

  write_library_metadata(&app, &root, &metadata)
}

/// 拖拽添加：把拖入的文件/文件夹复制到素材库对应分类下。
/// 分组文件夹按分类前缀+序号顺序命名（videos→video_N、images→img_N、games→game_N）；
/// display_name 作为展示名单独写入 metadata（只影响卡片标题，不影响文件夹名）。
#[tauri::command]
fn add_library_items(
  app: AppHandle,
  resource_root: String,
  category: String,
  drop_paths: Vec<String>,
  display_name: Option<String>,
) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let category_dir = root.join(&category);
  fs::create_dir_all(&category_dir).map_err(|error| error.to_string())?;

  let display_name = display_name
    .as_deref()
    .map(str::trim)
    .filter(|name| !name.is_empty())
    .map(str::to_string);

  let group_dir = next_sequential_group_dir(&category_dir, &category);

  // 所有拖入项合并进这一个分组
  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

  for path in &drop_paths {
    let source = PathBuf::from(path);
    if !source.exists() {
      continue;
    }

    if source.is_dir() {
      copy_dir_contents(&source, &source_dir).map_err(|error| error.to_string())?;
    } else if let Some(file_name) = source.file_name() {
      fs::copy(&source, source_dir.join(file_name)).map_err(|error| error.to_string())?;
    }
  }

  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();

  // 展示名写入 metadata，与文件夹名解耦
  if let Some(display_name) = display_name {
    let mut metadata = load_library_metadata(&app, &root)?;
    metadata.insert(
      format!("{category}/{group_id}"),
      LibraryMetadataEntry {
        title: Some(display_name),
        summary: None,
        adult: None,
        rating: None,
        tags: None,
        alt_name: None,
        launch_path: None,
      },
    );
    write_library_metadata(&app, &root, &metadata)?;
  }

  Ok(vec![group_id])
}

/// 添加漫画章节：把拖入的 zip/文件夹/图片解压归入某本漫画的某个章节。
/// 目录结构：comics/comic_N/source/chXX/（comic_N = 一本漫画，chXX = 第几章）
/// - target_group_id 为 None 时新建一本漫画（comic_N），否则加入已有漫画
/// - zip/rar/7z 用系统 bsdtar（tar.exe）解压，非压缩包直接复制
/// - display_name 作为漫画标题写入 metadata（仅新建时）
#[tauri::command]
fn add_comic_chapter(
  app: AppHandle,
  resource_root: String,
  drop_paths: Vec<String>,
  chapter_number: u32,
  target_group_id: Option<String>,
  display_name: Option<String>,
) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let comics_dir = root.join("comics");
  fs::create_dir_all(&comics_dir).map_err(|error| error.to_string())?;

  // 确定目标漫画组：已有则复用，否则新建 comic_N
  let group_dir = if let Some(group_id) = target_group_id.as_deref() {
    let existing = comics_dir.join(group_id);
    if !existing.is_dir() {
      return Err(format!("目标漫画不存在：{group_id}"));
    }
    existing
  } else {
    let created = next_sequential_group_dir(&comics_dir, "comics");
    fs::create_dir_all(&created).map_err(|error| error.to_string())?;
    created
  };

  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

  // 章节目录：chXX（两位数字，超出自动增长）
  let chapter_dir_name = format!("ch{chapter_number:02}");
  let chapter_dir = source_dir.join(&chapter_dir_name);
  if chapter_dir.exists() {
    return Err(format!("该漫画已存在章节 {chapter_dir_name}"));
  }
  fs::create_dir_all(&chapter_dir).map_err(|error| error.to_string())?;

  for path in &drop_paths {
    let source = PathBuf::from(path);
    if !source.exists() {
      continue;
    }

    if source.is_file() && is_archive(&source) {
      extract_archive(&source, &chapter_dir)?;
    } else if source.is_dir() {
      copy_dir_contents(&source, &chapter_dir).map_err(|error| error.to_string())?;
    } else if let Some(file_name) = source.file_name() {
      fs::copy(&source, chapter_dir.join(file_name)).map_err(|error| error.to_string())?;
    }
  }

  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();

  // 新建漫画时写入展示名；加入已有漫画不改标题
  if target_group_id.is_none() {
    if let Some(display_name) = display_name
      .as_deref()
      .map(str::trim)
      .filter(|name| !name.is_empty())
    {
      let mut metadata = load_library_metadata(&app, &root)?;
      metadata.insert(
        format!("comics/{group_id}"),
        LibraryMetadataEntry {
          title: Some(display_name.to_string()),
          summary: None,
          adult: None,
          rating: None,
          tags: None,
          alt_name: None,
          launch_path: None,
        },
      );
      write_library_metadata(&app, &root, &metadata)?;
    }
  }

  Ok(vec![group_id])
}

fn is_archive(path: &Path) -> bool {
  path.extension()
    .and_then(|value| value.to_str())
    .map(|extension| {
      let lowercase = extension.to_ascii_lowercase();
      matches!(lowercase.as_str(), "zip" | "rar" | "7z" | "cbz" | "cbr" | "cb7")
    })
    .unwrap_or(false)
}

/// 用系统 bsdtar 解压压缩包到目标目录（Windows 自带 tar.exe，支持 zip/rar/7z）
fn extract_archive(archive: &Path, target_dir: &Path) -> Result<(), String> {
  let status = std::process::Command::new("tar")
    .arg("-xf")
    .arg(archive)
    .arg("-C")
    .arg(target_dir)
    .status()
    .map_err(|error| format!("调用解压程序失败：{error}"))?;

  if !status.success() {
    return Err(format!("解压失败：{}", archive.display()));
  }

  Ok(())
}

/// 漫画阅读器：返回某本漫画的章节列表与每章的图片路径（自然排序）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComicChapterPayload {
  name: String,
  images: Vec<String>,
  /// 与原图一一对应的翻译页路径（无翻译则为 None）
  translated_images: Vec<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComicPagesPayload {
  group_id: String,
  title: String,
  alt_name: Option<String>,
  summary: Option<String>,
  rating: u8,
  tags: Vec<String>,
  chapters: Vec<ComicChapterPayload>,
}

#[tauri::command]
fn scan_comic_pages(
  app: AppHandle,
  resource_root: String,
  group_id: String,
) -> Result<ComicPagesPayload, String> {
  let root = PathBuf::from(&resource_root);
  let group_dir = root.join("comics").join(&group_id);
  if !group_dir.is_dir() {
    return Err(format!("漫画不存在：{group_id}"));
  }

  let metadata = load_library_metadata(&app, &root)?;
  let metadata_entry = metadata
    .get(&format!("comics/{group_id}"))
    .cloned()
    .unwrap_or_default();

  let source_dir = group_dir.join("source");
  let translated_root = group_dir.join("translated");
  let mut chapters = Vec::new();
  if source_dir.is_dir() {
    let mut chapter_dirs = read_directories_sorted(&source_dir)?;
    chapter_dirs.sort_by(|left, right| natural_compare_paths(left, right));

    for chapter_dir in chapter_dirs {
      let name = chapter_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
      let mut images = collect_matching_files(&chapter_dir, IMAGE_EXTENSIONS, 6);
      images.sort_by(|left, right| natural_compare_paths(left, right));
      if images.is_empty() {
        continue;
      }
      // 翻译页：与原图同名的 .png，位于 translated/<章>/ 下，与原图一一对应
      let translated_dir = translated_root.join(&name);
      let mut translated_images = Vec::with_capacity(images.len());
      for image in &images {
        let stem = image.file_stem().and_then(|value| value.to_str()).unwrap_or_default();
        let candidate = translated_dir.join(format!("{stem}.png"));
        translated_images.push(if candidate.is_file() {
          Some(path_to_string(candidate))
        } else {
          None
        });
      }
      chapters.push(ComicChapterPayload {
        name,
        images: images.into_iter().map(path_to_string).collect(),
        translated_images,
      });
    }
  }

  Ok(ComicPagesPayload {
    group_id: group_id.clone(),
    title: metadata_entry.title.clone().unwrap_or_else(|| group_id.clone()),
    alt_name: metadata_entry.alt_name.clone(),
    summary: metadata_entry.summary.clone(),
    rating: rating_of(&metadata_entry),
    tags: tags_of(&metadata_entry),
    chapters,
  })
}

/// 图片阅读器：把某个非漫画分类（images 等）的 source 目录当成单个“章节”返回
#[tauri::command]
fn scan_image_pages(
  app: AppHandle,
  resource_root: String,
  category: String,
  group_id: String,
) -> Result<ComicPagesPayload, String> {
  let root = PathBuf::from(&resource_root);
  let group_dir = root.join(&category).join(&group_id);
  if !group_dir.is_dir() {
    return Err(format!("条目不存在：{group_id}"));
  }

  let metadata = load_library_metadata(&app, &root)?;
  let metadata_entry = metadata
    .get(&format!("{category}/{group_id}"))
    .cloned()
    .unwrap_or_default();

  let source_dir = group_dir.join("source");
  let mut images = if source_dir.is_dir() {
    collect_matching_files(&source_dir, IMAGE_EXTENSIONS, 6)
  } else {
    Vec::new()
  };
  images.sort_by(|left, right| natural_compare_paths(left, right));

  let translated_images = vec![None; images.len()];
  let chapters = vec![ComicChapterPayload {
    name: group_id.clone(),
    images: images.into_iter().map(path_to_string).collect(),
    translated_images,
  }];

  Ok(ComicPagesPayload {
    group_id: group_id.clone(),
    title: metadata_entry.title.clone().unwrap_or_else(|| group_id.clone()),
    alt_name: metadata_entry.alt_name.clone(),
    summary: metadata_entry.summary.clone(),
    rating: rating_of(&metadata_entry),
    tags: tags_of(&metadata_entry),
    chapters,
  })
}

/// 读取任意文件为 base64（翻译编辑器用：前端 canvas 合成需要原图像素，直接用 data URL 避免画布污染）
#[tauri::command]
fn read_image_base64(path: String) -> Result<String, String> {
  let bytes = fs::read(&path).map_err(|error| format!("读取文件失败：{path}（{error}）"))?;
  Ok(encode_base64(&bytes))
}

/// 删除某一页的翻译图，整页恢复为原图（reader 的“翻译”模式会回退到原图）
#[tauri::command]
fn delete_comic_translation(
  resource_root: String,
  group_id: String,
  chapter_name: String,
  page_name: String,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let stem = Path::new(&page_name)
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("page");
  let path = root
    .join("comics")
    .join(&group_id)
    .join("translated")
    .join(&chapter_name)
    .join(format!("{stem}.png"));
  if path.is_file() {
    fs::remove_file(&path).map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// 保存某一页的翻译版（前端 canvas 合成后的整页 PNG）。
/// 存到 comics/<group_id>/translated/<chapter_name>/<page_stem>.png，与原图同名、不覆盖原图。
#[tauri::command]
fn save_comic_translation(
  resource_root: String,
  group_id: String,
  chapter_name: String,
  page_name: String,
  image_data: String,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let translated_dir = root
    .join("comics")
    .join(&group_id)
    .join("translated")
    .join(&chapter_name);
  fs::create_dir_all(&translated_dir).map_err(|error| error.to_string())?;

  // page_name 是原图文件名（如 00001.jpg），取 stem 作翻译版文件名，固定 .png
  let stem = Path::new(&page_name)
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("page")
    .to_string();
  let bytes = decode_base64(&image_data)?;
  fs::write(translated_dir.join(format!("{stem}.png")), bytes).map_err(|error| error.to_string())?;

  Ok(())
}

/// 重命名漫画章节文件夹（用于章节号填错后修正）：chXX → chYY
#[tauri::command]
fn rename_comic_chapter(
  resource_root: String,
  group_id: String,
  chapter_name: String,
  new_chapter_number: u32,
) -> Result<(), String> {
  if new_chapter_number == 0 || new_chapter_number > 9999 {
    return Err(format!("无效章节号：{new_chapter_number}"));
  }
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("comics").join(&group_id).join("source");
  if !source_dir.is_dir() {
    return Err(format!("漫画不存在：{group_id}"));
  }
  let from = source_dir.join(&chapter_name);
  if !from.is_dir() {
    return Err(format!("章节不存在：{chapter_name}"));
  }
  let new_name = format!("ch{new_chapter_number:02}");
  let to = source_dir.join(&new_name);
  if to.exists() {
    return Err(format!("章节 {new_name} 已存在，无法覆盖"));
  }
  fs::rename(&from, &to).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterRenameRequest {
  chapter_name: String,
  new_chapter_number: u32,
}

/// 批量调整章节号：支持链式/环式交换（3换5、5换3 或 3换5、5换2 同时提交）。
/// 冲突时自动用临时名中转，真冲突（目标存在且本轮不移走）才报错。
#[tauri::command]
fn reorder_comic_chapters(
  resource_root: String,
  group_id: String,
  changes: Vec<ChapterRenameRequest>,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("comics").join(&group_id).join("source");
  if !source_dir.is_dir() {
    return Err(format!("漫画不存在：{group_id}"));
  }

  // 收集实际需要改名的操作 (from, to_name)
  let mut ops: Vec<(PathBuf, String)> = Vec::new();
  for change in &changes {
    let Some(current_number) = chapter_number_from_name(&change.chapter_name) else {
      continue; // 非 chXX 格式不支持改号
    };
    let new_number = change.new_chapter_number;
    if new_number == 0 || new_number > 9999 {
      return Err(format!("无效章节号：{new_number}"));
    }
    if new_number == current_number {
      continue;
    }
    let from = source_dir.join(&change.chapter_name);
    if !from.is_dir() {
      return Err(format!("章节不存在：{}", change.chapter_name));
    }
    ops.push((from, format!("ch{new_number:02}")));
  }
  if ops.is_empty() {
    return Ok(());
  }

  // 静态冲突检测：目标已存在 且 不是本轮要移走的源 → 真冲突
  let sources: std::collections::HashSet<String> = ops
    .iter()
    .filter_map(|(from, _)| from.file_name().map(|name| name.to_string_lossy().to_string()))
    .collect();
  for (_, to_name) in &ops {
    if source_dir.join(to_name).exists() && !sources.contains(to_name) {
      return Err(format!("章节 {to_name} 已存在，无法覆盖"));
    }
  }

  // 贪心执行：目标空闲就移；全部卡住（成环）则把第一个源临时改名腾出
  let mut pending = ops;
  let mut swap_index = 0usize;
  let max_rounds = pending.len() * 3 + 8;
  let mut rounds = 0;
  while !pending.is_empty() {
    rounds += 1;
    if rounds > max_rounds {
      return Err("章节号调整冲突无法自动解决，请分步修改".to_string());
    }
    let mut progressed = false;
    let mut index = 0;
    while index < pending.len() {
      let (from, to_name) = &pending[index];
      let to = source_dir.join(to_name);
      if !to.exists() {
        fs::rename(from, &to).map_err(|error| error.to_string())?;
        pending.remove(index);
        progressed = true;
      } else {
        index += 1;
      }
    }
    if pending.is_empty() {
      break;
    }
    if !progressed {
      // 环：把第一个操作的源移到临时名，腾出位置后重试
      let (from, to_name) = pending.remove(0);
      loop {
        let tmp_name = format!(".catlib_swap_{swap_index}");
        swap_index += 1;
        let tmp = source_dir.join(&tmp_name);
        if !tmp.exists() {
          fs::rename(&from, &tmp).map_err(|error| error.to_string())?;
          pending.push((tmp, to_name));
          break;
        }
      }
    }
  }
  Ok(())
}

fn chapter_number_from_name(name: &str) -> Option<u32> {
  name
    .to_ascii_lowercase()
    .strip_prefix("ch")
    .and_then(|rest| rest.parse::<u32>().ok())
}

/// 把某本漫画的一个章节移出，成为一本独立的新漫画（用于误放进来的章节）。
/// 返回新漫画的 group id。
#[tauri::command]
fn extract_comic_chapter(
  app: AppHandle,
  resource_root: String,
  group_id: String,
  chapter_name: String,
  display_name: Option<String>,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let comics_dir = root.join("comics");
  let source_dir = comics_dir.join(&group_id).join("source");
  if !source_dir.is_dir() {
    return Err(format!("漫画不存在：{group_id}"));
  }
  let chapter_dir = source_dir.join(&chapter_name);
  if !chapter_dir.is_dir() {
    return Err(format!("章节不存在：{chapter_name}"));
  }

  let new_group_dir = next_sequential_group_dir(&comics_dir, "comics");
  let new_source_dir = new_group_dir.join("source");
  fs::create_dir_all(&new_source_dir).map_err(|error| error.to_string())?;

  fs::rename(&chapter_dir, new_source_dir.join(&chapter_name)).map_err(|error| error.to_string())?;

  let new_group_id = new_group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();

  // 标题：优先 display_name，否则沿用原漫画标题
  let mut metadata = load_library_metadata(&app, &root)?;
  let fallback_title = metadata
    .get(&format!("comics/{group_id}"))
    .and_then(|entry| entry.title.clone())
    .unwrap_or_else(|| new_group_id.clone());
  let title = display_name
    .as_deref()
    .map(str::trim)
    .filter(|name| !name.is_empty())
    .map(str::to_string)
    .unwrap_or(fallback_title);
  metadata.insert(
    format!("comics/{new_group_id}"),
    LibraryMetadataEntry {
      title: Some(title),
      summary: None,
      adult: None,
      rating: None,
      tags: None,
      alt_name: None,
      launch_path: None,
    },
  );
  write_library_metadata(&app, &root, &metadata)?;

  Ok(new_group_id)
}

/// 删除漫画的某一章（整个章节文件夹，不可恢复）
#[tauri::command]
fn delete_comic_chapter(
  resource_root: String,
  group_id: String,
  chapter_name: String,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("comics").join(&group_id).join("source");
  if !source_dir.is_dir() {
    return Err(format!("漫画不存在：{group_id}"));
  }
  let chapter_dir = source_dir.join(&chapter_name);
  if !chapter_dir.is_dir() {
    return Err(format!("章节不存在：{chapter_name}"));
  }
  fs::remove_dir_all(&chapter_dir).map_err(|error| error.to_string())
}

/// 删除某个分类下的整个条目（文件夹 + metadata），不可恢复
#[tauri::command]
fn delete_library_item(
  app: AppHandle,
  resource_root: String,
  category: String,
  item_id: String,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let item_dir = root.join(&category).join(&item_id);
  if !item_dir.exists() {
    return Err(format!("条目不存在：{item_id}"));
  }
  fs::remove_dir_all(&item_dir).map_err(|error| error.to_string())?;
  let mut metadata = load_library_metadata(&app, &root)?;
  metadata.remove(&format!("{category}/{item_id}"));
  write_library_metadata(&app, &root, &metadata)
}

/// 游戏封面图输入（前端文件选择后 base64 上传）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverImageInput {
  name: String,
  data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicTrackPayload {
  name: String,
  path: String,
  relative_path: String,
  bucket: String,
  format: String,
}

/// 打开某个游戏条目的 source 目录（资源管理器）
#[tauri::command]
fn open_game_folder(resource_root: String, group_id: String) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let group_dir = root.join("games").join(&group_id);
  let source_dir = group_dir.join("source");
  let target = if source_dir.is_dir() { source_dir } else { group_dir };
  if !target.exists() {
    return Err(format!("目录不存在：{}", target.display()));
  }
  open_in_explorer(&target)
}

/// 目录是否为空（不存在也算空）
fn is_dir_empty(path: &Path) -> bool {
  fs::read_dir(path)
    .map(|mut entries| entries.next().is_none())
    .unwrap_or(true)
}

/// 新建游戏：优先按序号打开已有的空 game_N（source 为空），没有才新建并打开。
/// 返回 group_id。
#[tauri::command]
fn create_game_group(resource_root: String) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let games_dir = root.join("games");
  fs::create_dir_all(&games_dir).map_err(|error| error.to_string())?;

  // 1. 优先找已有的空分组，按序号从小到大打开第一个
  let mut empty_groups: Vec<(usize, PathBuf)> = Vec::new();
  if let Ok(entries) = fs::read_dir(&games_dir) {
    for entry in entries {
      let entry = match entry {
        Ok(entry) => entry,
        Err(_) => continue,
      };
      let path = entry.path();
      if !path.is_dir() {
        continue;
      }
      let name = entry.file_name().to_string_lossy().to_string();
      if !name.starts_with("game_") {
        continue;
      }
      let number_str = &name[5..];
      let number = match number_str.parse::<usize>() {
        Ok(number) => number,
        Err(_) => continue,
      };
      let source_dir = path.join("source");
      if !source_dir.exists() || is_dir_empty(&source_dir) {
        empty_groups.push((number, path));
      }
    }
  }

  if !empty_groups.is_empty() {
    empty_groups.sort_by(|left, right| left.0.cmp(&right.0));
    let group_path = empty_groups[0].1.clone();
    let source_dir = group_path.join("source");
    fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;
    open_in_explorer(&source_dir)?;
    let group_id = group_path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or_default()
      .to_string();
    return Ok(group_id);
  }

  // 2. 没有空的，新建
  let group_dir = next_sequential_group_dir(&games_dir, "games");
  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;
  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();
  open_in_explorer(&source_dir)?;
  Ok(group_id)
}

/// 用资源管理器打开目录（Windows）
fn open_in_explorer(path: &Path) -> Result<(), String> {
  #[cfg(windows)]
  {
    std::process::Command::new("explorer")
      .arg(path)
      .spawn()
      .map_err(|error| format!("打开文件夹失败：{error}"))?;
    Ok(())
  }
  #[cfg(not(windows))]
  {
    let _ = path;
    Err("当前平台不支持打开文件夹".to_string())
  }
}

/// 启动游戏：多情况分发。
/// - 网页游戏（html/htm）→ 默认浏览器打开
/// - .exe → 启动后尝试嵌入应用窗口（embed=true 且 Windows），失败回退独立窗口
/// - 其他 → 独立启动
#[tauri::command]
fn launch_game(
  app: AppHandle,
  resource_root: String,
  group_id: String,
  embed: bool,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let group_dir = root.join("games").join(&group_id);
  if !group_dir.is_dir() {
    return Err(format!("游戏不存在：{group_id}"));
  }

  // 1. 确定启动目标：metadata 绑定路径优先，否则自动探测
  let mut target: Option<PathBuf> = None;
  let metadata = load_library_metadata(&app, &root)?;
  if let Some(entry) = metadata.get(&format!("games/{group_id}")) {
    if let Some(path) = entry.launch_path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
      let bound = PathBuf::from(path);
      if bound.is_file() {
        target = Some(bound);
      }
    }
  }
  let target = match target {
    Some(path) => path,
    None => {
      let source_dir = group_dir.join("source");
      match collect_game_launchers(&source_dir).first() {
        Some(exe) => exe.clone(),
        None => return Err("未找到可执行文件（.exe），请手动绑定启动程序".to_string()),
      }
    }
  };

  // 2. 网页游戏：用默认浏览器打开
  if is_web_game(&target) {
    open_web_game(&target)?;
    return Ok(format!("已在浏览器打开：{}", target.display()));
  }

  // 3. 启动进程
  let child = launch_executable_spawn(&target)?;
  let pid = child.id();

  // 4. 尝试嵌入（Windows + 开关开启），失败回退独立窗口
  #[cfg(windows)]
  if embed {
    match embed_game_window(&app, pid) {
      Ok(()) => return Ok(format!("已启动并嵌入：{}", target.display())),
      Err(_) => return Ok(format!("已启动（独立窗口）：{}", target.display())),
    }
  }

  Ok(format!("已启动：{}", target.display()))
}

/// 手动绑定游戏的启动程序路径，写入 metadata
#[tauri::command]
fn bind_game_executable(
  app: AppHandle,
  resource_root: String,
  group_id: String,
  executable_path: String,
) -> Result<(), String> {
  let trimmed = executable_path.trim();
  let root = PathBuf::from(&resource_root);
  let mut metadata = load_library_metadata(&app, &root)?;
  let key = format!("games/{group_id}");
  let mut entry = metadata.get(&key).cloned().unwrap_or_default();
  if trimmed.is_empty() {
    // 传空路径 = 解绑，恢复自动探测
    entry.launch_path = None;
  } else {
    let bound = PathBuf::from(trimmed);
    if !bound.is_file() {
      return Err(format!("文件不存在：{trimmed}"));
    }
    entry.launch_path = Some(trimmed.to_string());
  }
  metadata.insert(key, entry);
  write_library_metadata(&app, &root, &metadata)
}

/// 列出游戏 source 目录下所有 .exe（手动绑定时的候选）
#[tauri::command]
fn find_game_executables(resource_root: String, group_id: String) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("games").join(&group_id).join("source");
  if !source_dir.is_dir() {
    return Ok(Vec::new());
  }
  Ok(collect_game_launchers(&source_dir).into_iter().map(path_to_string).collect())
}

/// 列出游戏封面（cover）目录下的所有图片
#[tauri::command]
fn list_game_covers(resource_root: String, group_id: String) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("games").join(&group_id).join("cover");
  if !cover_dir.is_dir() {
    return Ok(Vec::new());
  }
  let mut images = collect_matching_files(&cover_dir, IMAGE_EXTENSIONS, 3);
  images.sort_by(|left, right| natural_compare_paths(left, right));
  Ok(images.into_iter().map(path_to_string).collect())
}

/// 添加游戏封面图（base64），写入 cover 目录，返回更新后的封面列表
#[tauri::command]
fn add_game_covers(
  resource_root: String,
  group_id: String,
  images: Vec<CoverImageInput>,
) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("games").join(&group_id).join("cover");
  fs::create_dir_all(&cover_dir).map_err(|error| error.to_string())?;

  for image in &images {
    let bytes = decode_base64(&image.data)?;
    let name = sanitize_file_name(&image.name);
    let file_name = format!("{}_{}", now_timestamp(), name);
    fs::write(cover_dir.join(&file_name), bytes).map_err(|error| error.to_string())?;
  }

  list_game_covers(resource_root, group_id)
}

/// 删除某张游戏封面图，返回更新后的封面列表
#[tauri::command]
fn delete_game_cover(
  resource_root: String,
  group_id: String,
  image_path: String,
) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("games").join(&group_id).join("cover");
  let file_name = Path::new(&image_path)
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default();
  let target = cover_dir.join(file_name);
  if target.is_file() {
    fs::remove_file(&target).map_err(|error| error.to_string())?;
  }
  list_game_covers(resource_root, group_id)
}

#[tauri::command]
fn list_music_tracks(resource_root: String, group_id: String) -> Result<Vec<MusicTrackPayload>, String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("music").join(&group_id).join("source");
  let mut tracks = Vec::new();
  collect_music_tracks(&source_dir, &source_dir, &mut tracks)?;
  Ok(tracks)
}

#[tauri::command]
fn set_music_cover(
  resource_root: String,
  group_id: String,
  image: CoverImageInput,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("music").join(&group_id).join("cover");
  fs::create_dir_all(&cover_dir).map_err(|error| error.to_string())?;
  clear_cover_dir_images(&cover_dir)?;

  let bytes = decode_base64(&image.data)?;
  let file_name = format!("cover_{}_{}", now_timestamp(), sanitize_file_name(&image.name));
  let cover_path = cover_dir.join(file_name);
  fs::write(&cover_path, bytes).map_err(|error| error.to_string())?;
  Ok(path_to_string(cover_path))
}

#[tauri::command]
fn delete_music_cover(resource_root: String, group_id: String) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("music").join(&group_id).join("cover");
  if !cover_dir.exists() {
    return Ok(());
  }
  clear_cover_dir_images(&cover_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoTrackPayload {
  name: String,
  path: String,
  relative_path: String,
}

/// 递归收集视频文件（自然排序），把一个视频条目当成「多集 / 多集选集」来播放
fn collect_video_tracks(
  source_dir: &Path,
  current_dir: &Path,
  out: &mut Vec<VideoTrackPayload>,
) -> Result<(), String> {
  if !current_dir.is_dir() {
    return Ok(());
  }

  let mut entries = fs::read_dir(current_dir)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort_by(|left, right| natural_compare_paths(left, right));

  for entry in entries {
    if entry.is_dir() {
      collect_video_tracks(source_dir, &entry, out)?;
      continue;
    }

    if !entry.is_file() || !has_extension(&entry, VIDEO_EXTENSIONS) {
      continue;
    }

    let relative = entry
      .strip_prefix(source_dir)
      .unwrap_or(&entry)
      .to_string_lossy()
      .replace('\\', "/");

    out.push(VideoTrackPayload {
      name: entry
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default(),
      path: path_to_string(entry),
      relative_path: relative,
    });
  }

  Ok(())
}

/// 列出一个视频条目 source 目录下的全部视频文件（按剧集/集数自然排序）
#[tauri::command]
fn list_video_tracks(resource_root: String, group_id: String) -> Result<Vec<VideoTrackPayload>, String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("videos").join(&group_id).join("source");
  let mut tracks = Vec::new();
  collect_video_tracks(&source_dir, &source_dir, &mut tracks)?;
  Ok(tracks)
}

/// 给视频条目设置封面（从图片库挑一张，写入 cover/）
#[tauri::command]
fn set_video_cover(
  resource_root: String,
  group_id: String,
  image: CoverImageInput,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("videos").join(&group_id).join("cover");
  fs::create_dir_all(&cover_dir).map_err(|error| error.to_string())?;
  clear_cover_dir_images(&cover_dir)?;

  let bytes = decode_base64(&image.data)?;
  let file_name = format!("cover_{}_{}", now_timestamp(), sanitize_file_name(&image.name));
  let cover_path = cover_dir.join(file_name);
  fs::write(&cover_path, bytes).map_err(|error| error.to_string())?;
  Ok(path_to_string(cover_path))
}

#[tauri::command]
fn delete_video_cover(resource_root: String, group_id: String) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("videos").join(&group_id).join("cover");
  if !cover_dir.exists() {
    return Ok(());
  }
  clear_cover_dir_images(&cover_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NovelChapterPayload {
  name: String,
  path: String,
  relative_path: String,
  size: u64,
}

/// 递归收集小说文本文件（自然排序），一个条目下可以有多个章节文件
fn collect_novel_files(
  source_dir: &Path,
  current_dir: &Path,
  out: &mut Vec<NovelChapterPayload>,
) -> Result<(), String> {
  if !current_dir.is_dir() {
    return Ok(());
  }

  let mut entries = fs::read_dir(current_dir)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort_by(|left, right| natural_compare_paths(left, right));

  for entry in entries {
    if entry.is_dir() {
      collect_novel_files(source_dir, &entry, out)?;
      continue;
    }

    if !entry.is_file() || !has_extension(&entry, NOVEL_EXTENSIONS) {
      continue;
    }

    let relative = entry
      .strip_prefix(source_dir)
      .unwrap_or(&entry)
      .to_string_lossy()
      .replace('\\', "/");
    let size = fs::metadata(&entry).map(|meta| meta.len()).unwrap_or(0);

    out.push(NovelChapterPayload {
      name: entry
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default(),
      path: path_to_string(entry),
      relative_path: relative,
      size,
    });
  }

  Ok(())
}

#[tauri::command]
fn list_novel_chapters(
  resource_root: String,
  group_id: String,
) -> Result<Vec<NovelChapterPayload>, String> {
  let root = PathBuf::from(&resource_root);
  let source_dir = root.join("novels").join(&group_id).join("source");
  let mut chapters = Vec::new();
  collect_novel_files(&source_dir, &source_dir, &mut chapters)?;
  Ok(chapters)
}

/// 读取小说正文：优先 UTF-8，失败则按 GB18030（兼容 GBK/GB2312）解码。
/// 单次上限 8MB，避免误拖入超大文件把界面卡死。
#[tauri::command]
fn read_novel_text(path: String) -> Result<String, String> {
  const MAX_BYTES: u64 = 8 * 1024 * 1024;

  let file_path = PathBuf::from(&path);
  if !file_path.is_file() {
    return Err("文件不存在".to_string());
  }
  if !has_extension(&file_path, NOVEL_EXTENSIONS) {
    return Err("不是支持的文本格式".to_string());
  }

  let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
  if metadata.len() > MAX_BYTES {
    return Err("文件超过 8MB，暂不支持在应用内直接阅读".to_string());
  }

  let bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
  Ok(decode_text_bytes(&bytes))
}

/// 文本解码：识别 BOM，其次尝试 UTF-8，最后回退 GB18030。
fn decode_text_bytes(bytes: &[u8]) -> String {
  if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
    return String::from_utf8_lossy(&bytes[3..]).into_owned();
  }
  if bytes.starts_with(&[0xFF, 0xFE]) {
    let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
    return text.into_owned();
  }
  if bytes.starts_with(&[0xFE, 0xFF]) {
    let (text, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
    return text.into_owned();
  }

  match std::str::from_utf8(bytes) {
    Ok(text) => text.to_string(),
    Err(_) => {
      let (text, _, _) = encoding_rs::GB18030.decode(bytes);
      text.into_owned()
    }
  }
}

/// 启动可执行文件（工作目录设为其所在目录，很多游戏依赖此），返回子进程句柄
fn launch_executable_spawn(path: &Path) -> Result<std::process::Child, String> {
  let working_dir = path.parent().unwrap_or_else(|| Path::new("."));
  std::process::Command::new(path)
    .current_dir(working_dir)
    .spawn()
    .map_err(|error| format!("启动失败：{}（{error}）", path.display()))
}

/// 判断是否为网页游戏（html 文件）
fn is_web_game(path: &Path) -> bool {
  path
    .extension()
    .and_then(|value| value.to_str())
    .map(|extension| {
      let lower = extension.to_ascii_lowercase();
      lower == "html" || lower == "htm"
    })
    .unwrap_or(false)
}

/// 用默认浏览器打开网页游戏
fn open_web_game(path: &Path) -> Result<(), String> {
  #[cfg(windows)]
  {
    std::process::Command::new("cmd")
      .arg("/C")
      .arg("start")
      .arg("")
      .arg(path)
      .spawn()
      .map_err(|error| format!("打开网页游戏失败：{error}"))?;
    Ok(())
  }
  #[cfg(not(windows))]
  {
    let _ = path;
    Err("当前平台不支持打开网页游戏".to_string())
  }
}

/// 尝试把游戏进程的主窗口嵌入到应用窗口（Windows SetParent）。
/// 失败返回 Err——此时游戏已在独立窗口运行，由调用方回退，不算启动失败。
#[cfg(windows)]
fn embed_game_window(app: &AppHandle, pid: u32) -> Result<(), String> {
  use winapi::shared::windef::{HWND, RECT};
  use winapi::um::winuser::{GetClientRect, GetWindowRect, SWP_SHOWWINDOW, SetParent, SetWindowPos};

  // 1. 应用主窗口句柄
  let main_hwnd = app
    .get_webview_window("main")
    .and_then(|window| window.hwnd().ok())
    .map(|hwnd| hwnd.0 as HWND)
    .ok_or_else(|| "获取应用窗口失败".to_string())?;

  // 2. 轮询等待游戏主窗口出现（最多 15 秒）
  let game_hwnd = wait_for_process_window(pid, main_hwnd, 15000)?;

  unsafe {
    // 3. 记录游戏窗口原始大小（SetParent 前仍是屏幕坐标）
    let mut game_rect: RECT = std::mem::zeroed();
    GetWindowRect(game_hwnd, &mut game_rect);
    let game_w = game_rect.right - game_rect.left;
    let game_h = game_rect.bottom - game_rect.top;

    // 4. 收养为子窗口（保留标题栏和边框，用户可拖动标题栏、拖边框调整大小）
    SetParent(game_hwnd, main_hwnd);

    // 5. 居中显示，保持原始大小（不拉伸、不裁切）
    let mut client: RECT = std::mem::zeroed();
    GetClientRect(main_hwnd, &mut client);
    let client_w = client.right - client.left;
    let client_h = client.bottom - client.top;
    let x = ((client_w - game_w) / 2).max(0);
    let y = ((client_h - game_h) / 2).max(0);
    SetWindowPos(game_hwnd, std::ptr::null_mut(), x, y, game_w, game_h, SWP_SHOWWINDOW);
  }

  Ok(())
}

#[cfg(windows)]
struct FindWindowContext {
  pid: u32,
  self_hwnd: winapi::shared::windef::HWND,
  best: winapi::shared::windef::HWND,
  best_area: i64,
}

#[cfg(windows)]
unsafe extern "system" fn enum_game_windows(
  hwnd: winapi::shared::windef::HWND,
  lparam: winapi::shared::minwindef::LPARAM,
) -> winapi::shared::minwindef::BOOL {
  use winapi::shared::windef::RECT;
  use winapi::um::winuser::{
    GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
  };

  let ctx = &mut *(lparam as *mut FindWindowContext);

  let mut window_pid: u32 = 0;
  GetWindowThreadProcessId(hwnd, &mut window_pid);
  if window_pid != ctx.pid || hwnd == ctx.self_hwnd {
    return 1;
  }
  if IsWindowVisible(hwnd) == 0 {
    return 1;
  }
  // 排除无标题的工具窗口（启动器/控制台等也可能有标题，交给面积筛选）
  if GetWindowTextLengthW(hwnd) == 0 {
    return 1;
  }

  let mut rect: RECT = std::mem::zeroed();
  if GetWindowRect(hwnd, &mut rect) == 0 {
    return 1;
  }
  let area = ((rect.right - rect.left) as i64) * ((rect.bottom - rect.top) as i64);
  if area > ctx.best_area {
    ctx.best_area = area;
    ctx.best = hwnd;
  }
  1
}

#[cfg(windows)]
fn find_process_main_window(
  pid: u32,
  self_hwnd: winapi::shared::windef::HWND,
) -> Option<winapi::shared::windef::HWND> {
  use winapi::um::winuser::EnumWindows;

  let mut ctx = FindWindowContext {
    pid,
    self_hwnd,
    best: std::ptr::null_mut(),
    best_area: 0,
  };

  unsafe {
    EnumWindows(
      Some(enum_game_windows),
      &mut ctx as *mut FindWindowContext as winapi::shared::minwindef::LPARAM,
    );
  }

  if ctx.best.is_null() {
    None
  } else {
    Some(ctx.best)
  }
}

#[cfg(windows)]
fn wait_for_process_window(
  pid: u32,
  self_hwnd: winapi::shared::windef::HWND,
  timeout_ms: u64,
) -> Result<winapi::shared::windef::HWND, String> {
  let start = std::time::Instant::now();
  loop {
    if let Some(hwnd) = find_process_main_window(pid, self_hwnd) {
      return Ok(hwnd);
    }
    if start.elapsed().as_millis() as u64 >= timeout_ms {
      return Err("等待游戏窗口超时".to_string());
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
  }
}

/// 清洗文件名：去掉路径分隔符等危险字符
fn sanitize_file_name(name: &str) -> String {
  let cleaned = name
    .chars()
    .map(|ch| {
      if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
        '_'
      } else {
        ch
      }
    })
    .collect::<String>();
  let trimmed = cleaned.trim();
  if trimmed.is_empty() {
    "image.png".to_string()
  } else {
    trimmed.to_string()
  }
}

/// 明显不是游戏启动器的 exe 名字提示（卸载器/升级器/运行库/崩溃处理器等）
const NON_GAME_EXE_HINTS: &[&str] = &[
  "uninstall",
  "unins",
  "update",
  "updater",
  "setup",
  "crash",
  "redist",
  "dxsetup",
  "webview",
  "installer",
  "remove",
  "repair",
];

/// 收集游戏 source 目录（含少量子目录）里的可执行文件，排除干扰项
fn collect_game_launchers(source_dir: &Path) -> Vec<PathBuf> {
  let mut exes = collect_matching_files(source_dir, &["exe"], 3);
  exes.retain(|path| {
    let name = path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or_default()
      .to_ascii_lowercase();
    !NON_GAME_EXE_HINTS.iter().any(|hint| name.contains(hint))
  });
  exes
}

/// 游戏启动信息：当前绑定的路径 + 自动探测的候选
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameLaunchInfo {
  launch_path: Option<String>,
  candidates: Vec<String>,
  source_dir: String,
}

#[tauri::command]
fn get_game_launch(
  app: AppHandle,
  resource_root: String,
  group_id: String,
) -> Result<GameLaunchInfo, String> {
  let root = PathBuf::from(&resource_root);
  let group_dir = root.join("games").join(&group_id);
  if !group_dir.is_dir() {
    return Err(format!("游戏不存在：{group_id}"));
  }
  let metadata = load_library_metadata(&app, &root)?;
  let launch_path = metadata
    .get(&format!("games/{group_id}"))
    .and_then(|entry| entry.launch_path.clone());
  let source_dir = group_dir.join("source");
  let source_dir_path = path_to_string(source_dir.clone());
  let candidates = collect_game_launchers(&source_dir)
    .into_iter()
    .map(path_to_string)
    .collect();
  Ok(GameLaunchInfo {
    launch_path,
    candidates,
    source_dir: source_dir_path,
  })
}


/// 保存漫画某一页到截图库：复制到 library/screenshots/shot_N/source/，返回新 group id
#[tauri::command]
fn save_page_snapshot(
  app: AppHandle,
  resource_root: String,
  source_path: String,
  display_name: Option<String>,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let source = PathBuf::from(&source_path);
  if !source.is_file() {
    return Err(format!("文件不存在：{source_path}"));
  }

  let screenshots_dir = root.join("screenshots");
  let group_dir = next_sequential_group_dir(&screenshots_dir, "screenshots");
  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

  let file_name = source
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("page.png");
  fs::copy(&source, source_dir.join(file_name)).map_err(|error| error.to_string())?;

  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();

  // 标题：优先 display_name（如“漫画名 第X章 P3”），否则用文件名
  let title = display_name
    .as_deref()
    .map(str::trim)
    .filter(|name| !name.is_empty())
    .map(str::to_string)
    .unwrap_or_else(|| file_name.to_string());
  let mut metadata = load_library_metadata(&app, &root)?;
  metadata.insert(
    format!("screenshots/{group_id}"),
    LibraryMetadataEntry {
      title: Some(title),
      summary: None,
      adult: None,
      rating: None,
      tags: None,
      alt_name: None,
      launch_path: None,
    },
  );
  write_library_metadata(&app, &root, &metadata)?;

  Ok(group_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCapturePayload {
  left: i32,
  top: i32,
  width: i32,
  height: i32,
  image_base64: String,
}

/// 即时系统截屏（GDI BitBlt，~50ms）：返回虚拟屏幕区域 + RGBA PNG base64。
/// 前端在保存瞬间调用——此时选区遮罩已临时隐藏，截到的画面干净。
#[tauri::command]
fn capture_screen_instant() -> Result<ScreenCapturePayload, String> {
  let (left, top, width, height, pixels) = capture_screen_pixels()?;
  let png = encode_png_rgba(width as u32, height as u32, &pixels)?;
  Ok(ScreenCapturePayload {
    left,
    top,
    width,
    height,
    image_base64: encode_base64(&png),
  })
}

/// GDI 抓取虚拟屏幕（含多显示器）像素，返回 (left, top, width, height, BGRA→RGBA)
fn capture_screen_pixels() -> Result<(i32, i32, i32, i32, Vec<u8>), String> {
  #[cfg(windows)]
  unsafe {
    use winapi::ctypes::c_void;
    use winapi::shared::windef::HGDIOBJ;
    use winapi::um::wingdi::{
      BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
      SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use winapi::um::winuser::{
      GetDC, GetSystemMetrics, ReleaseDC, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
      SM_YVIRTUALSCREEN,
    };

    let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if width <= 0 || height <= 0 {
      return Err("无法获取屏幕尺寸".to_string());
    }

    let screen_dc = GetDC(std::ptr::null_mut());
    if screen_dc.is_null() {
      return Err("获取屏幕设备上下文失败".to_string());
    }
    let mem_dc = CreateCompatibleDC(screen_dc);
    if mem_dc.is_null() {
      let _ = ReleaseDC(std::ptr::null_mut(), screen_dc);
      return Err("创建内存设备上下文失败".to_string());
    }
    let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
    if bitmap.is_null() {
      let _ = DeleteDC(mem_dc);
      let _ = ReleaseDC(std::ptr::null_mut(), screen_dc);
      return Err("创建位图失败".to_string());
    }
    let old_bitmap = SelectObject(mem_dc, bitmap as HGDIOBJ);
    BitBlt(mem_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY);

    let mut info: BITMAPINFO = std::mem::zeroed();
    info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height; // top-down
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let copied = GetDIBits(
      mem_dc,
      bitmap,
      0,
      height as u32,
      pixels.as_mut_ptr() as *mut c_void,
      &mut info,
      DIB_RGB_COLORS,
    );

    let _ = SelectObject(mem_dc, old_bitmap);
    let _ = DeleteObject(bitmap as HGDIOBJ);
    let _ = DeleteDC(mem_dc);
    let _ = ReleaseDC(std::ptr::null_mut(), screen_dc);

    if copied == 0 {
      return Err("读取屏幕像素失败".to_string());
    }
    // BGRA → RGBA，并强制 alpha=255（防止半透明窗口/遮罩残留导致截图发灰）
    for chunk in pixels.chunks_exact_mut(4) {
      chunk.swap(0, 2);
      chunk[3] = 255;
    }
    Ok((left, top, width, height, pixels))
  }

  #[cfg(not(windows))]
  {
    Err("当前平台不支持即时截屏".to_string())
  }
}

/// 手写 PNG 编码（8-bit RGBA）：签名 + IHDR + IDAT(zlib) + IEND，零图片库依赖
fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
  use std::io::Write;
  if width == 0 || height == 0 {
    return Err("截图尺寸无效".to_string());
  }
  let expected = width as usize * height as usize * 4;
  if rgba.len() < expected {
    return Err("截图像素数据不完整".to_string());
  }

  let mut output = Vec::with_capacity(expected / 2 + 1024);
  output.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  let mut ihdr = Vec::with_capacity(13);
  ihdr.extend_from_slice(&width.to_be_bytes());
  ihdr.extend_from_slice(&height.to_be_bytes());
  ihdr.push(8); // bit depth
  ihdr.push(6); // color type: RGBA
  ihdr.extend_from_slice(&[0, 0, 0]); // compression / filter / interlace
  push_png_chunk(&mut output, b"IHDR", &ihdr);

  // IDAT：每行前加 filter byte 0
  let mut raw = Vec::with_capacity(height as usize * (1 + width as usize * 4));
  for row in rgba.chunks_exact(width as usize * 4).take(height as usize) {
    raw.push(0);
    raw.extend_from_slice(row);
  }
  let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
  encoder
    .write_all(&raw)
    .map_err(|error| format!("压缩截图失败：{error}"))?;
  let compressed = encoder
    .finish()
    .map_err(|error| format!("压缩截图失败：{error}"))?;
  push_png_chunk(&mut output, b"IDAT", &compressed);

  push_png_chunk(&mut output, b"IEND", &[]);
  Ok(output)
}

fn push_png_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
  output.extend_from_slice(&(data.len() as u32).to_be_bytes());
  output.extend_from_slice(kind);
  output.extend_from_slice(data);
  let mut crc_input = Vec::with_capacity(4 + data.len());
  crc_input.extend_from_slice(kind);
  crc_input.extend_from_slice(data);
  output.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
  let mut crc = 0xFFFF_FFFFu32;
  for &byte in data {
    crc ^= byte as u32;
    for _ in 0..8 {
      crc = if crc & 1 != 0 {
        (crc >> 1) ^ 0xEDB8_8320
      } else {
        crc >> 1
      };
    }
  }
  !crc
}

/// 保存选区裁剪后的截图（base64 PNG）到截图库，并删除临时截屏文件
#[tauri::command]
fn save_crop_screenshot(
  app: AppHandle,
  resource_root: String,
  temp_path: String,
  image_data: String,
  display_name: Option<String>,
) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let screenshots_dir = root.join("screenshots");
  let group_dir = next_sequential_group_dir(&screenshots_dir, "screenshots");
  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;

  let bytes = decode_base64(&image_data)?;
  let file_name = format!("crop_{}.png", now_timestamp());
  fs::write(source_dir.join(&file_name), bytes).map_err(|error| error.to_string())?;

  // 清理临时截屏（旧版 PowerShell 截屏遗留，防残留）
  let tmp = PathBuf::from(&temp_path);
  if !temp_path.is_empty() && tmp.exists() {
    let _ = fs::remove_file(&tmp);
  }

  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();

  let title = display_name
    .as_deref()
    .map(str::trim)
    .filter(|name| !name.is_empty())
    .map(str::to_string)
    .unwrap_or_else(|| file_name.clone());
  let mut metadata = load_library_metadata(&app, &root)?;
  metadata.insert(
    format!("screenshots/{group_id}"),
    LibraryMetadataEntry {
      title: Some(title),
      summary: None,
      adult: None,
      rating: None,
      tags: None,
      alt_name: None,
      launch_path: None,
    },
  );
  write_library_metadata(&app, &root, &metadata)?;

  Ok(group_id)
}

/// 取消截图时清理临时截屏文件（旧版 PowerShell 截屏遗留，前端不再调用，保留兼容）
#[tauri::command]
fn remove_temp_screenshot(temp_path: String) -> Result<(), String> {
  let tmp = PathBuf::from(&temp_path);
  if !temp_path.is_empty() && tmp.exists() {
    fs::remove_file(&tmp).map_err(|error| error.to_string())?;
  }
  Ok(())
}

fn now_timestamp() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0)
}

/// 阻止/恢复系统息屏与睡眠（自动播放看漫画时防止电脑待机）
#[tauri::command]
fn set_keep_awake(enabled: bool) -> Result<(), String> {
  #[cfg(windows)]
  unsafe {
    use winapi::um::winbase::SetThreadExecutionState;
    // winbase.h 常量（winapi crate 未导出，自行定义）
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;
    let flags = if enabled {
      ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
      ES_CONTINUOUS
    };
    SetThreadExecutionState(flags);
  }
  Ok(())
}

/// 极简 base64 解码（PNG 数据用，零依赖）
fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let value_of = |byte: u8| -> Option<u32> {
    TABLE
      .iter()
      .position(|&candidate| candidate == byte)
      .map(|index| index as u32)
  };

  let mut output = Vec::with_capacity(data.len() * 3 / 4);
  let mut buffer = 0u32;
  let mut bits = 0u32;
  for &byte in data.as_bytes() {
    if byte == b'=' {
      break;
    }
    let Some(value) = value_of(byte) else {
      continue; // 忽略空白/换行
    };
    buffer = (buffer << 6) | value;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      output.push((buffer >> bits) as u8);
    }
  }
  if output.is_empty() {
    return Err("截图数据为空".to_string());
  }
  Ok(output)
}

/// 极简 base64 编码（零依赖）
fn encode_base64(data: &[u8]) -> String {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut output = String::with_capacity(data.len().div_ceil(3) * 4);
  for chunk in data.chunks(3) {
    let b0 = chunk[0] as u32;
    let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
    let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
    let value = (b0 << 16) | (b1 << 8) | b2;
    output.push(TABLE[(value >> 18) as usize & 63] as char);
    output.push(TABLE[(value >> 12) as usize & 63] as char);
    output.push(if chunk.len() > 1 {
      TABLE[(value >> 6) as usize & 63] as char
    } else {
      '='
    });
    output.push(if chunk.len() > 2 {
      TABLE[value as usize & 63] as char
    } else {
      '='
    });
  }
  output
}

/// 按分类前缀+序号生成下一个分组文件夹：videos→video_N、images→img_N、games→game_N。
/// 解析现有文件夹名里的最大序号 +1，序号被占用（竞态）则继续递增。
fn next_sequential_group_dir(category_dir: &Path, category: &str) -> PathBuf {
  let prefix = match category {
    "videos" => "video",
    "images" => "img",
    "games" => "game",
    "comics" => "comic",
    "music" => "music",
    "live2d" => "live2d",
    "novels" => "novel",
    _ => "group",
  };

  // 收集已用序号，从 1 开始找第一个空洞——删除后留下的空位可被后续添加复用
  let mut used = Vec::new();
  if let Ok(entries) = fs::read_dir(category_dir) {
    for entry in entries.flatten() {
      let name = entry.file_name().to_string_lossy().to_string();
      let Some(number_str) = name.strip_prefix(prefix).and_then(|rest| rest.strip_prefix('_')) else {
        continue;
      };
      if let Ok(number) = number_str.parse::<usize>() {
        used.push(number);
      }
    }
  }

  let mut number = 1usize;
  while used.contains(&number) {
    number += 1;
  }
  category_dir.join(format!("{prefix}_{number}"))
}

fn copy_dir_contents(source: &Path, target: &Path) -> std::io::Result<()> {
  for entry in fs::read_dir(source)? {
    let entry = entry?;
    let from = entry.path();
    let to = target.join(entry.file_name());

    if from.is_dir() {
      fs::create_dir_all(&to)?;
      copy_dir_contents(&from, &to)?;
    } else {
      fs::copy(&from, &to)?;
    }
  }

  Ok(())
}

fn scan_category(
  root: &Path,
  category: &str,
  metadata: &HashMap<String, LibraryMetadataEntry>,
) -> Result<Vec<LibraryItemPayload>, String> {
  let category_dir = root.join(category);
  if !category_dir.is_dir() {
    return Ok(Vec::new());
  }

  let mut group_dirs = read_directories_sorted(&category_dir)?;
  group_dirs.sort_by(|left, right| {
    natural_compare_paths(left, right)
  });

  group_dirs
    .into_iter()
    .map(|group_dir| scan_group(root, category, &group_dir, metadata))
    .collect()
}

fn scan_group(
  root: &Path,
  category: &str,
  group_dir: &Path,
  metadata: &HashMap<String, LibraryMetadataEntry>,
) -> Result<LibraryItemPayload, String> {
  let source_dir = group_dir.join("source");
  let cover_dir = group_dir.join("cover");
  let source_entries = read_source_entries(root, &source_dir)?;
  let relative_path = to_relative_path(root, group_dir);
  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or(category)
    .to_string();
  let metadata_key = format!("{category}/{group_id}");
  let metadata_entry = metadata.get(&metadata_key).cloned().unwrap_or_default();

  let cover_path = find_cover_path(category, &cover_dir, &source_dir);
  let preview_path = find_preview_path(category, &source_dir, cover_path.clone());
  let preview_image_paths = find_preview_image_paths(category, &cover_dir, &source_dir, cover_path.as_ref());
  let cover_type = if category == "videos" && cover_path.is_none() && preview_path.is_some() {
    "video".to_string()
  } else if cover_path.is_some() {
    "image".to_string()
  } else {
    "fallback".to_string()
  };

  let source_count = count_primary_items(category, &source_dir)?;
  let summary = metadata_entry
    .summary
    .clone()
    .unwrap_or_else(|| summarize_group(category, source_count));
  let title = metadata_entry.title.clone().unwrap_or_else(|| group_id.clone());
  let alt_name = metadata_entry.alt_name.clone();
  let modified_at = read_modified_timestamp(group_dir);
  let rating = rating_of(&metadata_entry);
  let tags = tags_of(&metadata_entry);

  Ok(LibraryItemPayload {
    id: group_id,
    title,
    alt_name,
    category: category.to_string(),
    summary,
    relative_path,
    cover_type,
    cover_path: cover_path.map(path_to_string),
    // 缩略图在整库扫描完成后统一并发生成（见 attach_cover_thumbnails）
    cover_thumb_path: None,
    preview_path: preview_path.map(path_to_string),
    preview_image_paths: preview_image_paths.into_iter().map(path_to_string).collect(),
    source_count,
    modified_at,
    source_entries,
    rating,
    tags,
  })
}

fn load_library_metadata(app: &AppHandle, root: &Path) -> Result<HashMap<String, LibraryMetadataEntry>, String> {
  for metadata_file in metadata_file_candidates(app, root) {
    if !metadata_file.exists() {
      continue;
    }

    match fs::read_to_string(&metadata_file) {
      Ok(content) => {
        return serde_json::from_str::<HashMap<String, LibraryMetadataEntry>>(&content)
          .map_err(|error| error.to_string())
      }
      Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => continue,
      Err(error) => return Err(error.to_string()),
    }
  }

  Ok(HashMap::new())
}

fn write_library_metadata(
  app: &AppHandle,
  root: &Path,
  metadata: &HashMap<String, LibraryMetadataEntry>,
) -> Result<(), String> {
  let content = serde_json::to_string_pretty(metadata).map_err(|error| error.to_string())?;

  let candidates = metadata_file_candidates(app, root);
  let mut errors = Vec::new();

  for metadata_file in candidates {
    match write_metadata_file(&metadata_file, &content) {
      Ok(()) => return Ok(()),
      Err(error) => errors.push(format!("{} => {}", metadata_file.display(), error)),
    }
  }

  if errors.is_empty() {
    Err("保存失败".to_string())
  } else {
    Err(format!("保存失败：{}", errors.join(" | ")))
  }
}

fn metadata_file_candidates(app: &AppHandle, root: &Path) -> Vec<PathBuf> {
  let mut paths = vec![metadata_file_path(root)];

  if let Some(appdata) = env::var_os("APPDATA") {
    paths.push(PathBuf::from(appdata).join("com.zerocat.catlibrary").join("library-metadata.json"));
  }

  if let Ok(app_data_dir) = app.path().app_data_dir() {
    paths.push(app_data_dir.join("library-metadata.json"));
  }

  paths.dedup();
  paths
}

fn write_metadata_file(path: &Path, content: &str) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }

  fs::write(path, content).map_err(|error| error.to_string())
}

fn metadata_file_path(root: &Path) -> PathBuf {
  root
    .parent()
    .unwrap_or(root)
    .join("data")
    .join("metadata.json")
}

fn normalize_metadata_value(value: String) -> Option<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}

fn read_directories_sorted(path: &Path) -> Result<Vec<PathBuf>, String> {
  let mut entries = fs::read_dir(path)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .filter(|path| path.is_dir())
    .collect::<Vec<_>>();

  entries.sort();
  Ok(entries)
}

fn natural_compare_paths(left: &Path, right: &Path) -> std::cmp::Ordering {
  let left_name = left.file_name().and_then(|value| value.to_str()).unwrap_or_default();
  let right_name = right.file_name().and_then(|value| value.to_str()).unwrap_or_default();
  natural_compare(left_name, right_name)
}

fn natural_compare(left: &str, right: &str) -> std::cmp::Ordering {
  let left_chars = left.chars().collect::<Vec<_>>();
  let right_chars = right.chars().collect::<Vec<_>>();
  let mut left_index = 0;
  let mut right_index = 0;

  while left_index < left_chars.len() && right_index < right_chars.len() {
    let left_char = left_chars[left_index];
    let right_char = right_chars[right_index];

    if left_char.is_ascii_digit() && right_char.is_ascii_digit() {
      let left_start = left_index;
      let right_start = right_index;

      while left_index < left_chars.len() && left_chars[left_index].is_ascii_digit() {
        left_index += 1;
      }

      while right_index < right_chars.len() && right_chars[right_index].is_ascii_digit() {
        right_index += 1;
      }

      let left_number = left_chars[left_start..left_index]
        .iter()
        .collect::<String>()
        .parse::<u64>()
        .unwrap_or(0);
      let right_number = right_chars[right_start..right_index]
        .iter()
        .collect::<String>()
        .parse::<u64>()
        .unwrap_or(0);

      match left_number.cmp(&right_number) {
        std::cmp::Ordering::Equal => continue,
        other => return other,
      }
    }

    match left_char.to_ascii_lowercase().cmp(&right_char.to_ascii_lowercase()) {
      std::cmp::Ordering::Equal => {
        left_index += 1;
        right_index += 1;
      }
      other => return other,
    }
  }

  left_chars.len().cmp(&right_chars.len())
}

fn read_source_entries(root: &Path, source_dir: &Path) -> Result<Vec<LibrarySourceEntry>, String> {
  if !source_dir.is_dir() {
    return Ok(Vec::new());
  }

  let mut entries = fs::read_dir(source_dir)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .collect::<Vec<_>>();

  entries.sort_by(|left, right| natural_compare_paths(&left.path(), &right.path()));

  Ok(entries
    .into_iter()
    .map(|entry| LibrarySourceEntry {
      name: entry.file_name().to_string_lossy().to_string(),
      path: path_to_string(entry.path()),
      relative_path: to_relative_path(root, &entry.path()),
      is_directory: entry.path().is_dir(),
    })
    .collect())
}

fn collect_music_tracks(
  source_dir: &Path,
  current_dir: &Path,
  out: &mut Vec<MusicTrackPayload>,
) -> Result<(), String> {
  if !current_dir.is_dir() {
    return Ok(());
  }

  let mut entries = fs::read_dir(current_dir)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort_by(|left, right| natural_compare_paths(left, right));

  for entry in entries {
    if entry.is_dir() {
      collect_music_tracks(source_dir, &entry, out)?;
      continue;
    }

    if !entry.is_file() || !has_extension(&entry, AUDIO_EXTENSIONS) {
      continue;
    }

    let relative = entry
      .strip_prefix(source_dir)
      .unwrap_or(&entry)
      .to_string_lossy()
      .replace('\\', "/");
    let extension = entry
      .extension()
      .and_then(|value| value.to_str())
      .unwrap_or("")
      .to_ascii_uppercase();
    let bucket = music_bucket_from_relative_path(&relative, &extension);
    let name = entry
      .file_stem()
      .and_then(|value| value.to_str())
      .unwrap_or_else(|| {
        entry
          .file_name()
          .and_then(|value| value.to_str())
          .unwrap_or("unknown")
      })
      .to_string();

    out.push(MusicTrackPayload {
      name,
      path: path_to_string(entry),
      relative_path: relative,
      bucket,
      format: extension,
    });
  }

  Ok(())
}

fn music_bucket_from_relative_path(relative_path: &str, extension: &str) -> String {
  let normalized = relative_path.replace('\\', "/");
  let mut parts = normalized.split('/').filter(|part| !part.is_empty());
  let top_level = parts.next();
  let has_nested = parts.next().is_some();

  match (top_level, has_nested) {
    (Some(first), true) => normalize_music_bucket_label(first),
    _ => {
      if extension.is_empty() {
        "根目录".to_string()
      } else {
        extension.to_string()
      }
    }
  }
}

fn normalize_music_bucket_label(raw: &str) -> String {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return "根目录".to_string();
  }

  if trimmed
    .chars()
    .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
  {
    return trimmed.replace('_', " ").replace('-', " ").to_ascii_uppercase();
  }

  trimmed.to_string()
}

fn clear_cover_dir_images(cover_dir: &Path) -> Result<(), String> {
  let images = collect_matching_files(cover_dir, IMAGE_EXTENSIONS, 3);
  for image in images {
    if image.is_file() {
      fs::remove_file(&image).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

fn count_primary_items(category: &str, source_dir: &Path) -> Result<usize, String> {
  if !source_dir.is_dir() {
    return Ok(0);
  }

  // 漫画：统计章节数（source 下的子目录 = 章），而不是图片数
  if category == "comics" {
    let count = fs::read_dir(source_dir)
      .map_err(|error| error.to_string())?
      .filter_map(|entry| entry.ok())
      .map(|entry| entry.path())
      .filter(|path| path.is_dir())
      .count();
    return Ok(count);
  }

  // live2d：统计 psd 画稿数 + 模型数
  if category == "live2d" {
    let mut psd_files = Vec::new();
    let mut model_files = Vec::new();
    collect_psd_files(&source_dir.join("psd"), &mut psd_files)?;
    collect_model3_files(&source_dir.join("model"), &mut model_files)?;
    return Ok(psd_files.len() + model_files.len());
  }

  let extensions = match category {
    "images" => IMAGE_EXTENSIONS,
    "videos" => VIDEO_EXTENSIONS,
    "games" => GAME_FILE_EXTENSIONS,
    "screenshots" => IMAGE_EXTENSIONS,
    "music" => AUDIO_EXTENSIONS,
    "novels" => NOVEL_EXTENSIONS,
    _ => &[],
  };

  if category == "music" {
    return Ok(collect_matching_files(source_dir, AUDIO_EXTENSIONS, 8).len());
  }

  // 小说：章节可能放在子目录里，递归统计文本文件
  if category == "novels" {
    return Ok(collect_matching_files(source_dir, NOVEL_EXTENSIONS, 8).len());
  }

  let count = fs::read_dir(source_dir)
    .map_err(|error| error.to_string())?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .filter(|path| {
      if category == "games" {
        path.is_dir() || has_extension(path, extensions)
      } else {
        path.is_file() && has_extension(path, extensions)
      }
    })
    .count();

  Ok(count)
}

fn summarize_group(category: &str, source_count: usize) -> String {
  match category {
    "images" => format!("{source_count} 张图片"),
    "videos" => format!("{source_count} 个视频"),
    "games" => format!("{source_count} 个条目"),
    "comics" => format!("{source_count} 章"),
    "screenshots" => format!("{source_count} 张截图"),
    "music" => format!("{source_count} 首曲目"),
    "live2d" => format!("{source_count} 项素材"),
    "novels" => format!("{source_count} 章"),
    _ => format!("{source_count} 项内容"),
  }
}

fn find_cover_path(category: &str, cover_dir: &Path, source_dir: &Path) -> Option<PathBuf> {
  find_first_matching_file(cover_dir, IMAGE_EXTENSIONS, 2).or_else(|| match category {
    "images" | "screenshots" => find_first_matching_file(source_dir, IMAGE_EXTENSIONS, 2),
    "games" => find_game_cover_in_source(source_dir),
    // 漫画：第一章的第一张图作为封面
    "comics" => find_first_comic_chapter_cover(source_dir),
    _ => None,
  })
}

/// 漫画封面：取第一章（自然排序第一个章节目录）里的第一张图片
fn find_first_comic_chapter_cover(source_dir: &Path) -> Option<PathBuf> {
  let mut chapters = read_directories_sorted(source_dir).ok()?;
  chapters.sort_by(|left, right| natural_compare_paths(left, right));
  for chapter in chapters {
    if let Some(image) = find_first_matching_file(&chapter, IMAGE_EXTENSIONS, 4) {
      return Some(image);
    }
  }
  None
}

fn find_preview_path(category: &str, source_dir: &Path, cover_path: Option<PathBuf>) -> Option<PathBuf> {
  match category {
    "videos" => find_first_matching_file(source_dir, VIDEO_EXTENSIONS, 2).or(cover_path),
    _ => cover_path,
  }
}

fn find_preview_image_paths(
  category: &str,
  cover_dir: &Path,
  source_dir: &Path,
  cover_path: Option<&PathBuf>,
) -> Vec<PathBuf> {
  // 漫画：每一章的第一张图作为轮播预览帧
  if category == "comics" {
    let mut chapters = read_directories_sorted(source_dir).ok().unwrap_or_default();
    chapters.sort_by(|left, right| natural_compare_paths(left, right));
    let mut images = Vec::new();
    for chapter in chapters {
      if let Some(image) = find_first_matching_file(&chapter, IMAGE_EXTENSIONS, 4) {
        images.push(image);
      }
    }
    if let Some(cover) = cover_path {
      images.retain(|path| path != cover);
      images.insert(0, cover.clone());
    }
    return images;
  }

  // 游戏：轮播 cover 目录里的所有图片（用户自选封面/预览）
  if category == "games" {
    return collect_matching_files(cover_dir, IMAGE_EXTENSIONS, 3);
  }

  if category != "images" && category != "screenshots" {
    return Vec::new();
  }

  let mut images = collect_matching_files(source_dir, IMAGE_EXTENSIONS, 2);
  if let Some(cover) = cover_path {
    images.retain(|path| path != cover);
    images.insert(0, cover.clone());
  }
  images
}

fn find_game_cover_in_source(source_dir: &Path) -> Option<PathBuf> {
  find_preferred_named_image(source_dir, 4).or_else(|| find_first_matching_file(source_dir, IMAGE_EXTENSIONS, 3))
}

fn find_preferred_named_image(path: &Path, max_depth: usize) -> Option<PathBuf> {
  if !path.is_dir() {
    return None;
  }

  let mut entries = fs::read_dir(path)
    .ok()?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort();

  for entry in &entries {
    if entry.is_file()
      && has_extension(entry, IMAGE_EXTENSIONS)
      && entry
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|name| {
          let lowercase = name.to_ascii_lowercase();
          PREFERRED_GAME_IMAGE_NAMES
            .iter()
            .any(|preferred| lowercase.contains(preferred))
        })
        .unwrap_or(false)
    {
      return Some(entry.clone());
    }
  }

  if max_depth == 0 {
    return None;
  }

  for entry in entries {
    if entry.is_dir() {
      if let Some(found) = find_preferred_named_image(&entry, max_depth.saturating_sub(1)) {
        return Some(found);
      }
    }
  }

  None
}

fn find_first_matching_file(path: &Path, extensions: &[&str], max_depth: usize) -> Option<PathBuf> {
  if !path.is_dir() {
    return None;
  }

  let mut entries = fs::read_dir(path)
    .ok()?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort();

  for entry in &entries {
    if entry.is_file() && has_extension(entry, extensions) {
      return Some(entry.clone());
    }
  }

  if max_depth == 0 {
    return None;
  }

  for entry in entries {
    if entry.is_dir() {
      if let Some(found) = find_first_matching_file(&entry, extensions, max_depth.saturating_sub(1)) {
        return Some(found);
      }
    }
  }

  None
}

fn collect_matching_files(path: &Path, extensions: &[&str], max_depth: usize) -> Vec<PathBuf> {
  if !path.is_dir() {
    return Vec::new();
  }

  let mut entries = fs::read_dir(path)
    .ok()
    .into_iter()
    .flat_map(|iter| iter.filter_map(|entry| entry.ok()))
    .map(|entry| entry.path())
    .collect::<Vec<_>>();
  entries.sort_by(|left, right| natural_compare_paths(left, right));

  let mut results = Vec::new();

  for entry in &entries {
    if entry.is_file() && has_extension(entry, extensions) {
      results.push(entry.clone());
    }
  }

  if max_depth == 0 {
    return results;
  }

  for entry in entries {
    if entry.is_dir() {
      results.extend(collect_matching_files(&entry, extensions, max_depth.saturating_sub(1)));
    }
  }

  results
}

fn read_modified_timestamp(path: &Path) -> u64 {
  fs::metadata(path)
    .ok()
    .and_then(|metadata| metadata.modified().ok())
    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|duration| duration.as_secs())
    .unwrap_or(0)
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
  path
    .extension()
    .and_then(|value| value.to_str())
    .map(|extension| {
      let lowercase = extension.to_ascii_lowercase();
      extensions.iter().any(|candidate| lowercase == *candidate)
    })
    .unwrap_or(false)
}

fn to_relative_path(root: &Path, path: &Path) -> String {
  path
    .strip_prefix(root)
    .unwrap_or(path)
    .to_string_lossy()
    .replace('\\', "/")
}

fn path_to_string(path: PathBuf) -> String {
  path.to_string_lossy().to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Live2dSources {
  model3: Vec<String>,
  psd: Vec<String>,
  /// 分层 PNG 骨架（非 Cubism）：source/rig/manifest.json 存在时给出其路径
  rig: Vec<String>,
}

/// 扫描 live2d 分组的 psd/ 与 model/ 两个槽，找出可预览的 psd 与 model3.json 路径。
#[tauri::command]
fn list_live2d_sources(resource_root: String, item_id: String) -> Result<Live2dSources, String> {
  let root = PathBuf::from(resource_root);
  let source_dir = root.join("live2d").join(&item_id).join("source");
  let mut model3 = Vec::new();
  let mut psd = Vec::new();
  collect_psd_files(&source_dir.join("psd"), &mut psd)?;
  collect_model3_files(&source_dir.join("model"), &mut model3)?;
  model3.sort();
  psd.sort();

  let mut rig = Vec::new();
  let rig_manifest = source_dir.join("rig").join("manifest.json");
  if rig_manifest.is_file() {
    rig.push(path_to_string(rig_manifest));
  }

  Ok(Live2dSources { model3, psd, rig })
}

/// 新建 live2d 角色：创建 live2d_N/source/psd 与 source/model 两个空槽。
#[tauri::command]
fn create_live2d_group(resource_root: String) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let live2d_dir = root.join("live2d");
  fs::create_dir_all(&live2d_dir).map_err(|error| error.to_string())?;
  let group_dir = next_sequential_group_dir(&live2d_dir, "live2d");
  fs::create_dir_all(group_dir.join("source").join("psd")).map_err(|error| error.to_string())?;
  fs::create_dir_all(group_dir.join("source").join("model")).map_err(|error| error.to_string())?;
  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();
  Ok(group_id)
}

/// 添加 psd 画稿到 live2d 角色的 psd 槽。
#[tauri::command]
fn add_live2d_psd(
  resource_root: String,
  group_id: String,
  psd_paths: Vec<String>,
) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&resource_root);
  let psd_dir = root.join("live2d").join(&group_id).join("source").join("psd");
  fs::create_dir_all(&psd_dir).map_err(|error| error.to_string())?;
  let mut added = Vec::new();
  for path_str in &psd_paths {
    let src = PathBuf::from(path_str);
    if !src.is_file() {
      continue;
    }
    let file_name = match src.file_name() {
      Some(name) => name,
      None => continue,
    };
    let target = psd_dir.join(file_name);
    fs::copy(&src, &target).map_err(|error| error.to_string())?;
    added.push(path_to_string(target));
  }
  Ok(added)
}

/// 添加模型：把模型目录（或 model3.json 所在目录）内容复制到 model 槽。
#[tauri::command]
fn add_live2d_model(resource_root: String, group_id: String, model_path: String) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let model_dir = root.join("live2d").join(&group_id).join("source").join("model");
  fs::create_dir_all(&model_dir).map_err(|error| error.to_string())?;
  let src = PathBuf::from(&model_path);
  let src_dir = if src.is_dir() {
    src
  } else {
    match src.parent() {
      Some(parent) => parent.to_path_buf(),
      None => return Err("无法确定模型目录".to_string()),
    }
  };
  copy_dir_contents(&src_dir, &model_dir).map_err(|error| error.to_string())?;
  Ok(())
}

/// 删除 live2d 角色 psd 槽里的一个画稿文件。
#[tauri::command]
fn remove_live2d_psd(
  resource_root: String,
  group_id: String,
  psd_path: String,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let psd_dir = root.join("live2d").join(&group_id).join("source").join("psd");
  let target = PathBuf::from(&psd_path);
  if !target.starts_with(&psd_dir) {
    return Err("目标文件不在该角色的 PSD 槽内，已取消删除".to_string());
  }
  if target.is_file() {
    fs::remove_file(&target).map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// 删除 live2d 角色的整个模型槽（runtime 模型目录）。
#[tauri::command]
fn remove_live2d_model(resource_root: String, group_id: String) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let model_dir = root.join("live2d").join(&group_id).join("source").join("model");
  if model_dir.is_dir() {
    fs::remove_dir_all(&model_dir).map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// 保存 Live2D 角色封面（前端合成好的 PNG 字节）。
#[tauri::command]
fn save_live2d_cover(
  resource_root: String,
  group_id: String,
  png_data: Vec<u8>,
) -> Result<(), String> {
  let root = PathBuf::from(&resource_root);
  let cover_dir = root.join("live2d").join(&group_id).join("cover");
  fs::create_dir_all(&cover_dir).map_err(|error| error.to_string())?;
  let cover_path = cover_dir.join("cover.png");
  fs::write(&cover_path, png_data).map_err(|error| error.to_string())?;
  Ok(())
}

/// 把背景图 PNG 字节保存为图片分类的一个新分组（备份应用背景）。
#[tauri::command]
fn add_wallpaper_to_images(resource_root: String, png_data: Vec<u8>) -> Result<String, String> {
  let root = PathBuf::from(&resource_root);
  let images_dir = root.join("images");
  fs::create_dir_all(&images_dir).map_err(|error| error.to_string())?;
  let group_dir = next_sequential_group_dir(&images_dir, "images");
  let source_dir = group_dir.join("source");
  fs::create_dir_all(&source_dir).map_err(|error| error.to_string())?;
  fs::write(source_dir.join("wallpaper.png"), png_data).map_err(|error| error.to_string())?;
  let group_id = group_dir
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or_default()
    .to_string();
  Ok(group_id)
}

fn collect_psd_files(dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
  if !dir.is_dir() {
    return Ok(());
  }
  let entries = fs::read_dir(dir).map_err(|error| error.to_string())?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      collect_psd_files(&path, out)?;
      continue;
    }
    let is_psd = path
      .extension()
      .and_then(|value| value.to_str())
      .map(|extension| extension.eq_ignore_ascii_case("psd"))
      .unwrap_or(false);
    if is_psd {
      out.push(path_to_string(path));
    }
  }
  Ok(())
}

fn collect_model3_files(dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
  if !dir.is_dir() {
    return Ok(());
  }
  let entries = fs::read_dir(dir).map_err(|error| error.to_string())?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      collect_model3_files(&path, out)?;
      continue;
    }
    let name = path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or("")
      .to_ascii_lowercase();
    if name.ends_with(".model3.json") {
      out.push(path_to_string(path));
    }
  }
  Ok(())
}

/// 弹一个原生错误框。
/// 桌面端双击启动时没有控制台，窗口又可能根本没建出来，这是唯一还能让用户看到原因的办法。
#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
  use std::ffi::OsStr;
  use std::iter::once;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_OK};

  let wide = |text: &str| -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(once(0)).collect()
  };

  let title_wide = wide(title);
  let message_wide = wide(message);

  unsafe {
    MessageBoxW(
      std::ptr::null_mut(),
      message_wide.as_ptr(),
      title_wide.as_ptr(),
      MB_OK | MB_ICONERROR,
    );
  }
}

#[cfg(not(windows))]
fn show_error_dialog(title: &str, message: &str) {
  eprintln!("{title}: {message}");
}

/// 单实例保护：用命名互斥体判断是否已有实例在跑。
///
/// 不加这个的话，重复启动会去抢 WebView2 的用户数据目录，拿不到就报
/// `ERROR_BUSY（请求的资源在使用中）`，而且失败的那个实例不会退出，
/// 会一直占着目录，导致之后每次启动都打不开。
#[cfg(windows)]
fn other_instance_running() -> bool {
  use std::ffi::OsStr;
  use std::iter::once;
  use std::os::windows::ffi::OsStrExt;
  use winapi::um::errhandlingapi::GetLastError;
  use winapi::um::synchapi::CreateMutexW;

  /// ERROR_ALREADY_EXISTS：CreateMutexW 发现同名互斥体已存在时设置的错误码
  const ERROR_ALREADY_EXISTS: u32 = 183;

  let name: Vec<u16> = OsStr::new("Local\\com.zerocat.catlibrary.instance")
    .encode_wide()
    .chain(once(0))
    .collect();

  unsafe {
    // 句柄故意不释放：它要在整个进程生命周期内保持存在
    let handle = CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr());
    if handle.is_null() {
      return false;
    }
    GetLastError() == ERROR_ALREADY_EXISTS
  }
}

#[cfg(not(windows))]
fn other_instance_running() -> bool {
  false
}

/// 启动环境诊断。
///
/// WebView2 必须能启动它自己的子进程（msedgewebview2.exe）。
/// 如果本进程被放进带限制的 Job 对象，或者安全策略禁止创建子进程，
/// WebView2 会以 `ERROR_BUSY` 失败——所以先把这两件事记进日志。
#[cfg(windows)]
fn log_process_environment() {
  match std::process::Command::new("cmd.exe")
    .args(["/c", "exit"])
    .spawn()
  {
    Ok(mut child) => {
      let _ = child.wait();
      log_startup("[diag] 子进程创建：成功");
    }
    Err(error) => log_startup(&format!("[diag] 子进程创建：失败 {error}")),
  }
}

#[cfg(not(windows))]
fn log_process_environment() {}

/// 启动日志路径：%LOCALAPPDATA%\CatLibrary\startup.log
///
/// 桌面端双击启动时没有控制台，panic 信息会直接丢掉。这个日志是出问题时唯一的线索。
fn startup_log_path() -> PathBuf {
  let base = env::var_os("LOCALAPPDATA")
    .map(PathBuf::from)
    .unwrap_or_else(env::temp_dir);
  let dir = base.join("CatLibrary");
  let _ = fs::create_dir_all(&dir);
  dir.join("startup.log")
}

fn log_startup(message: &str) {
  let line = format!("[{}] {}\n", now_timestamp(), message);
  if let Ok(mut file) = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(startup_log_path())
  {
    let _ = file.write_all(line.as_bytes());
  }
}

/// 把 log crate 的输出（wry、tauri、WebView2 的报错都在这里）接到启动日志上。
struct StartupFileLogger;

impl log::Log for StartupFileLogger {
  fn enabled(&self, _metadata: &log::Metadata) -> bool {
    true
  }

  fn log(&self, record: &log::Record) {
    log_startup(&format!(
      "{} [{}] {}",
      record.level(),
      record.target(),
      record.args()
    ));
  }

  fn flush(&self) {}
}

static STARTUP_LOGGER: StartupFileLogger = StartupFileLogger;

/// 安装 panic 钩子：把 panic 位置、消息与调用栈写进启动日志。
fn install_startup_logging() {
  log_startup(&format!("=== 进程启动 pid={} ===", std::process::id()));

  let _ = log::set_logger(&STARTUP_LOGGER);
  log::set_max_level(log::LevelFilter::Trace);
  log::info!("[lib] 日志系统已接入");

  std::panic::set_hook(Box::new(|info| {
    let location = info
      .location()
      .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
      .unwrap_or_else(|| "unknown".to_string());
    let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
      (*text).to_string()
    } else if let Some(text) = info.payload().downcast_ref::<String>() {
      text.clone()
    } else {
      "未知 panic 载荷".to_string()
    };
    log_startup(&format!("PANIC {location}: {payload}"));
    log_startup(&format!(
      "backtrace:\n{}",
      std::backtrace::Backtrace::force_capture()
    ));
  }));
}

/// 创建主窗口。
///
/// 保留图形渲染兜底；使用独立、稳定的用户数据目录隔离旧缓存。
fn build_main_window<M: tauri::Manager<tauri::Wry>>(
  manager: &M,
  data_directory: PathBuf,
) -> tauri::Result<tauri::WebviewWindow<tauri::Wry>> {
  WebviewWindowBuilder::new(manager, "main", WebviewUrl::App("index.html".into()))
    .title("Cat Library")
    .inner_size(1440.0, 900.0)
    .min_inner_size(1200.0, 760.0)
    .decorations(false)
    .resizable(true)
    .shadow(false)
    // 透明窗口在 Windows 上会禁用文件拖放（wry 合成模式无子窗口可挂 OLE 拖放目标），
    // 而应用本身有不透明背景图，去掉透明视觉无差异
    .transparent(false)
    .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI --ignore-gpu-blocklist --enable-unsafe-swiftshader --enable-gpu-rasterization")
    .data_directory(data_directory)
    .build()
}

/// 新版隔离浏览器缓存，只在首次创建前迁移本地持久化数据。
/// 原目录保留不动；迁移失败中止启动，避免静默丢失收藏和设置。
fn prepare_webview_data_dir(app_data: &Path) -> std::io::Result<PathBuf> {
  let target = app_data.join("webview-data-v3");
  let marker = target.join("catlibrary-storage-migrated");
  if !marker.exists() {
    let legacy = app_data.join("webview-data").join("EBWebView").join("Default");
    let destination = target.join("EBWebView").join("Default");
    fs::create_dir_all(&destination)?;
    for name in ["Local Storage", "IndexedDB"] {
      let source = legacy.join(name);
      if source.is_dir() {
        fs::create_dir_all(destination.join(name))?;
        copy_dir_contents(&source, &destination.join(name))
          .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
      }
    }
    fs::write(&marker, b"CatLibrary 0.1.1 storage migration complete")?;
    log_startup("已迁移收藏与设置，旧浏览器数据原样保留");
  }
  Ok(target)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  install_startup_logging();
  log_startup("run(): 开始初始化");
  log_process_environment();


  if other_instance_running() {
    log_startup("run(): 检测到已有实例，本次启动退出");
    show_error_dialog(
      "Cat Library 已在运行",
      "已经有一个 Cat Library 在运行了（它可能没有显示窗口）。\n\n\
       请打开任务管理器，结束所有 cat_library.exe 进程，然后再启动。",
    );
    std::process::exit(0);
  }

  let result = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      scan_library,
      resolve_initial_resource_root,
      save_library_metadata,
      add_library_items,
      add_comic_chapter,
      scan_comic_pages,
      scan_image_pages,
      read_image_base64,
      save_comic_translation,
      delete_comic_translation,
      rename_comic_chapter,
      reorder_comic_chapters,
      extract_comic_chapter,
      delete_comic_chapter,
      delete_library_item,
      save_page_snapshot,
      capture_screen_instant,
      save_crop_screenshot,
      remove_temp_screenshot,
      set_keep_awake,
      open_game_folder,
      create_game_group,
      launch_game,
      bind_game_executable,
      get_game_launch,
      find_game_executables,
      list_game_covers,
      add_game_covers,
      delete_game_cover,
      list_music_tracks,
      set_music_cover,
      delete_music_cover,
      list_video_tracks,
      set_video_cover,
      delete_video_cover,
      list_novel_chapters,
      read_novel_text,
      list_live2d_sources,
      create_live2d_group,
      add_live2d_psd,
      add_live2d_model,
      remove_live2d_psd,
      remove_live2d_model,
      save_live2d_cover,
      add_wallpaper_to_images
    ])
    .setup(|app| {
      log_startup("setup(): 开始");

      let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| env::current_dir().unwrap_or_default());

      let runtime_root = prepare_webview_data_dir(&app_data)?;
      fs::create_dir_all(&runtime_root)?;
      log_startup(&format!("setup(): WebView 数据目录 = {}", runtime_root.display()));

      build_main_window(app, runtime_root).map_err(|error| {
        log_startup(&format!("setup(): 创建窗口失败：{error}"));
        error
      })?;

      log_startup("setup(): 主窗口创建完成");

      // 健康检查：WebView2 创建失败时 Tauri 只写一条 log 就继续跑，
      // 窗口会永远停在 visible=false，用户只看到“闪一下”。
      // 这里主动发现并明确告知，同时退出，避免又留下一个占着数据目录的幽灵进程。
      let watch_handle = app.handle().clone();
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let Some(window) = watch_handle.get_webview_window("main") else {
          log_startup("[health] 主窗口已不存在");
          return;
        };
        match window.url() {
          Ok(url) => log_startup(&format!("[health] 页面地址 = {url}")),
          Err(error) => {
            log_startup(&format!("[health] WebView 创建失败：{error}"));
            show_error_dialog(
              "Cat Library 启动失败",
              "窗口的浏览器内核（WebView2）没能创建成功，界面无法显示。\n\n\
               本次启动的具体原因已写入：\n%LOCALAPPDATA%\\CatLibrary\\startup.log\n\n\
               可以先试：重启电脑后再次启动；如果仍然失败，请把上面那个日志文件发给开发者。",
            );
            std::process::exit(1);
          }
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!());

  match result {
    Ok(()) => log_startup("run(): 事件循环正常结束"),
    Err(error) => log_startup(&format!("run(): 事件循环返回错误：{error}")),
  }
}
#[cfg(test)]
mod startup_profile_tests {
  use super::*;
  #[test]
  fn migrates_storage_once_without_copying_cache_or_mutating_legacy() {
    let root = PathBuf::from("D:/CatLibrary-update-test").join(format!("migration-test-{}-{}", std::process::id(), now_timestamp()));
    let legacy = root.join("webview-data/EBWebView/Default");
    fs::create_dir_all(legacy.join("Local Storage/leveldb")).unwrap();
    fs::create_dir_all(legacy.join("Cache")).unwrap();
    fs::write(legacy.join("Local Storage/leveldb/settings"), b"saved-settings").unwrap();
    fs::write(legacy.join("Cache/old"), b"old-cache").unwrap();
    let target = prepare_webview_data_dir(&root).unwrap();
    let settings = target.join("EBWebView/Default/Local Storage/leveldb/settings");
    assert_eq!(fs::read(&settings).unwrap(), b"saved-settings");
    assert!(!target.join("EBWebView/Default/Cache").exists());
    fs::write(&settings, b"new-settings").unwrap();
    assert_eq!(prepare_webview_data_dir(&root).unwrap(), target);
    assert_eq!(fs::read(&settings).unwrap(), b"new-settings");
    assert_eq!(fs::read(legacy.join("Local Storage/leveldb/settings")).unwrap(), b"saved-settings");
    fs::remove_dir_all(root).unwrap();
  }
}
