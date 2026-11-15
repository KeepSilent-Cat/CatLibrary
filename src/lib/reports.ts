import {useAppStore} from "@/store/useAppStore";
import {remapMediaPath} from "./media-paths";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { CategoryKey } from "@/data/library";

/** 报道里的块类型：标题、正文、引用、图片、视频、音乐、分割线 */
export type ReportBlockType = "h1" | "h2" | "text" | "quote" | "image" | "video" | "audio" | "divider";

export type BlockAlign = "left" | "center" | "right";

/** 块级样式：颜色与对齐（不填就跟随整篇设置） */
export interface BlockStyle {
  color?: string;
  align?: BlockAlign;
}

/** 从素材库里挑来的媒体：记住来源分类与条目，path 已是可直接用的 asset URL */
export interface ReportMediaRef {
  category: CategoryKey | "report";
  itemId: string;
  path: string;
  title: string;
}

export interface ReportBlock {
  id: string;
  type: ReportBlockType;
  text?: string;
  caption?: string;
  media?: ReportMediaRef;
  style?: BlockStyle;
}

/** 整篇排版宽度 */
export type ReportWidth = "narrow" | "medium" | "wide";

export interface Report {
  id: string;
  title: string;
  subtitle?: string;
  blocks: ReportBlock[];
  createdAt: number;
  updatedAt: number;
  width?: ReportWidth;
  /** 全文字体颜色（块级设置优先） */
  color?: string;
}

/** 报道自带素材（导入的文件夹里每个文件一条） */
export interface ReportAsset {
  name: string;
  relativePath: string;
  path: string;
  kind: "image" | "video" | "audio" | "text" | "other";
  size: number;
}

export const BLOCK_LABELS: Record<ReportBlockType, string> = {
  h1: "大标题",
  h2: "小标题",
  text: "正文",
  quote: "引用",
  image: "图片",
  video: "视频",
  audio: "音乐",
  divider: "分割线",
};

/** 添加块菜单里按这个顺序展示 */
export const BLOCK_ORDER: ReportBlockType[] = [
  "h1",
  "h2",
  "text",
  "quote",
  "image",
  "video",
  "audio",
  "divider",
];

export const WIDTH_CLASS: Record<ReportWidth, string> = {
  narrow: "max-w-2xl",
  medium: "max-w-3xl",
  wide: "max-w-5xl",
};

export const WIDTH_LABELS: Record<ReportWidth, string> = {
  narrow: "窄",
  medium: "中",
  wide: "宽",
};

/** 常用的几档文字颜色，避免每次都去调色板 */
export const COLOR_PRESETS = [
  { label: "默认", value: "" },
  { label: "白", value: "#f8fafc" },
  { label: "灰", value: "#cbd5e1" },
  { label: "暖白", value: "#fde8d0" },
  { label: "天蓝", value: "#7dd3fc" },
  { label: "薄荷", value: "#99f6e4" },
  { label: "樱粉", value: "#f9a8d4" },
  { label: "浅紫", value: "#c4b5fd" },
  { label: "金黄", value: "#fcd34d" },
];

function rid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlock(type: ReportBlockType): ReportBlock {
  const id = rid();
  switch (type) {
    case "h1":
      return { id, type, text: "" };
    case "h2":
      return { id, type, text: "" };
    case "text":
      return { id, type, text: "" };
    case "quote":
      return { id, type, text: "" };
    default:
      return { id, type };
  }
}

export function createReport(): Report {
  const now = Date.now();
  return {
    id: rid(),
    title: "",
    subtitle: "",
    blocks: [createBlock("h1"), createBlock("text")],
    createdAt: now,
    updatedAt: now,
    width: "medium",
    color: "",
  };
}

/** 兼容手写/旧数据：补齐缺失字段，避免编辑器读到 undefined 崩掉 */
function normalizeReport(raw: unknown): Report | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<Report>;
  const blocks = Array.isArray(value.blocks)
    ? value.blocks
        .filter((block): block is ReportBlock => Boolean(block) && typeof block === "object")
        .map((block) => ({
          id: typeof block.id === "string" && block.id ? block.id : rid(),
          type: (BLOCK_ORDER as string[]).includes(block.type) ? block.type : "text",
          text: typeof block.text === "string" ? block.text : "",
          caption: typeof block.caption === "string" ? block.caption : undefined,
          media: block.media && typeof block.media === "object" ? block.media : undefined,
          style: block.style && typeof block.style === "object" ? block.style : undefined,
        }))
    : [];

  const width = value.width === "narrow" || value.width === "wide" ? value.width : "medium";

  return {
    id: typeof value.id === "string" && value.id ? value.id : rid(),
    title: typeof value.title === "string" ? value.title : "",
    subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
    blocks,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    width,
    color: typeof value.color === "string" ? value.color : "",
  };
}

export async function loadReports(resourceRoot: string): Promise<Report[]> {
  const raw = await invoke<unknown[]>("list_reports", { resourceRoot });
  return (raw ?? [])
    .map(normalizeReport)
    .map(report=>{if(!report)return null;const state=useAppStore.getState();return {...report,blocks:report.blocks.map(block=>{if(!block.media)return block;const path=remapMediaPath(block.media.path,resourceRoot,state.resourceRootHistory,state.movedMediaPaths);return path===block.media.path?block:{...block,media:{...block.media,path:convertFileSrc(path)}};})};})
    .filter((report): report is Report => report !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveReport(resourceRoot: string, report: Report): Promise<void> {
  await invoke("save_report", { resourceRoot, report });
}

export async function deleteReport(resourceRoot: string, reportId: string): Promise<void> {
  await invoke("delete_report", { resourceRoot, reportId });
}

export async function listReportAssets(resourceRoot: string, reportId: string): Promise<ReportAsset[]> {
  const assets = await invoke<ReportAsset[]>("list_report_assets", { resourceRoot, reportId });
  return assets ?? [];
}

/** 把本地文件夹导入报道自带仓库，返回导入根目录与本批文件 */
export async function importReportFolder(
  resourceRoot: string,
  reportId: string,
  folderPath: string,
): Promise<{ root: string; assets: ReportAsset[] }> {
  return invoke("import_report_folder", { resourceRoot, reportId, folderPath });
}

/** 报道里显示用的名字（没标题时给个占位） */
export function reportTitle(report: Report): string {
  return report.title.trim() || "未命名报道";
}

export function assetUrl(asset: ReportAsset): string {
  return convertFileSrc(asset.path);
}

/** 归一化相对路径，便于 md 里的图片引用与导入清单对齐 */
function normalizeRelative(path: string): string {
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function dirOfRelative(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

/** 去掉 markdown 的行内标记，留下纯文本 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * 把准备好的 markdown 正文转成块序列。
 *
 * 图片引用（![](图片/01.jpg)）会用 assets 里的相对路径反查，命中就生成图片块；
 * 找不到的引用直接跳过，不打断整篇导入。
 */
export function blocksFromMarkdown(
  markdown: string,
  assets: ReportAsset[],
  markdownRelativePath: string,
): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const assetMap = new Map(assets.map((asset) => [normalizeRelative(asset.relativePath), asset]));
  const baseDir = dirOfRelative(markdownRelativePath);

  const resolveImage = (ref: string): ReportAsset | undefined => {
    const cleaned = decodeURIComponent(ref.trim().replace(/^\.\//, ""));
    const candidate = normalizeRelative(baseDir ? `${baseDir}/${cleaned}` : cleaned);
    return assetMap.get(candidate) ?? assetMap.get(normalizeRelative(cleaned));
  };

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  // 记录正文里已经引用过的素材，剩下的批量导入时补到末尾
  const usedAssets = new Set<string>();
  const MEDIA_EXT = /\.(mp4|mkv|mov|webm|m4v|ts|m2ts|mp3|flac|wav|m4a|ogg|opus)$/i;

  const resolveMedia = (ref: string): ReportAsset | undefined => {
    const cleaned = decodeURIComponent(ref.trim().replace(/^\.\//, "").replace(/\*\*/g, ""));
    const candidate = normalizeRelative(baseDir ? `${baseDir}/${cleaned}` : cleaned);
    return assetMap.get(candidate) ?? assetMap.get(normalizeRelative(cleaned));
  };

  const pushMediaBlock = (asset: ReportAsset, type: "image" | "video" | "audio") => {
    usedAssets.add(normalizeRelative(asset.relativePath));
    blocks.push({
      id: rid(),
      type,
      media: {
        category: "report",
        itemId: asset.relativePath,
        path: assetUrl(asset),
        title: asset.name,
      },
    });
  };

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text) {
      blocks.push({ id: rid(), type: "text", text });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const imageMatch = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      const asset = resolveImage(imageMatch[1]);
      if (asset) {
        // 用图片语法引用视频/音频时，按真实类型出块，避免变成一个加载不出来的 <img>
        pushMediaBlock(
          asset,
          asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : "image",
        );
      }
      continue;
    }

    // 「**视频**：视频/01.mp4」这种写法，或者干脆一行只写了媒体相对路径
    const mediaMatch = line.match(
      /^(?:\*\*(?:视频|音频|语音|录像)\*\*\s*[：:]\s*)?(.+?\.(?:mp4|mkv|mov|webm|m4v|ts|m2ts|mp3|flac|wav|m4a|ogg|opus))$/i,
    );
    if (mediaMatch) {
      const asset = resolveMedia(mediaMatch[1]);
      if (asset && (asset.kind === "video" || asset.kind === "audio")) {
        flushParagraph();
        pushMediaBlock(asset, asset.kind === "video" ? "video" : "audio");
        continue;
      }
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      blocks.push({ id: rid(), type: "divider" });
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ id: rid(), type: "h2", text: stripInlineMarkdown(line.slice(4)) });
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ id: rid(), type: "h2", text: stripInlineMarkdown(line.slice(3)) });
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ id: rid(), type: "h1", text: stripInlineMarkdown(line.slice(2)) });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      blocks.push({ id: rid(), type: "quote", text: stripInlineMarkdown(line.replace(/^>\s?/, "")) });
      continue;
    }

    paragraph.push(stripInlineMarkdown(line));
  }

  flushParagraph();
  return blocks;
}

/** 批量建报道的结果项（后端已把素材复制进报道仓库并解析好正文） */
export interface BatchReportSource {
  reportId: string;
  title: string;
  markdown: string | null;
  markdownRelativePath: string;
  root: string;
  assets: ReportAsset[];
}

/** 把一个父目录下的每个子文件夹各自建成一篇报道 */
export async function batchCreateReportsFromFolders(
  resourceRoot: string,
  parentFolder: string,
): Promise<BatchReportSource[]> {
  const result = await invoke<BatchReportSource[]>("batch_create_reports_from_folders", {
    resourceRoot,
    parentFolder,
  });
  return result ?? [];
}

/** 用批量导入的结果生成一篇完整报道（含正文块） */
export function reportFromBatchSource(source: BatchReportSource): Report {
  const now = Date.now();
  const blocks = source.markdown
    ? blocksFromMarkdown(source.markdown, source.assets, source.markdownRelativePath)
    : [];

  // 正文里没引用到的视频/音频/图片补在末尾，避免「文件夹里有但报道里看不到」
  const referenced = new Set(
    blocks
      .map((block) => block.media?.itemId)
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeRelative(value)),
  );
  const leftovers = source.assets
    .filter((asset) => !referenced.has(normalizeRelative(asset.relativePath)))
    .filter((asset) => asset.kind === "video" || asset.kind === "audio" || asset.kind === "image")
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  for (const asset of leftovers) {
    blocks.push({
      id: rid(),
      type: asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : "image",
      media: {
        category: "report",
        itemId: asset.relativePath,
        path: assetUrl(asset),
        title: asset.name,
      },
    });
  }

  return {
    id: source.reportId,
    title: source.title,
    subtitle: "",
    blocks:
      blocks.length > 0
        ? blocks
        : [
            { id: rid(), type: "h1", text: source.title },
            { id: rid(), type: "text", text: "" },
          ],
    createdAt: now,
    updatedAt: now,
    width: "medium",
    color: "",
  };
}

/** 读取某篇报道自带的正文 markdown（用于重建内容块） */
export async function readReportMarkdown(
  resourceRoot: string,
  reportId: string,
): Promise<{ text: string; relativePath: string } | null> {
  const result = await invoke<{ text: string; relativePath: string } | null>("read_report_markdown", {
    resourceRoot,
    reportId,
  });
  return result ?? null;
}
