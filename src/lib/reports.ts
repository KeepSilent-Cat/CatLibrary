import { invoke } from "@tauri-apps/api/core";
import type { CategoryKey } from "@/data/library";

/** 报道里的块类型：标题、正文、引用、图片、视频、音乐、分割线 */
export type ReportBlockType = "h1" | "h2" | "text" | "quote" | "image" | "video" | "audio" | "divider";

/** 从素材库里挑来的媒体：记住来源分类与条目，路径是具体文件 */
export interface ReportMediaRef {
  category: CategoryKey;
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
}

export interface Report {
  id: string;
  title: string;
  subtitle?: string;
  blocks: ReportBlock[];
  createdAt: number;
  updatedAt: number;
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
        }))
    : [];

  return {
    id: typeof value.id === "string" && value.id ? value.id : rid(),
    title: typeof value.title === "string" ? value.title : "",
    subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
    blocks,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
}

export async function loadReports(resourceRoot: string): Promise<Report[]> {
  const raw = await invoke<unknown[]>("load_reports", { resourceRoot });
  return (raw ?? []).map(normalizeReport).filter((report): report is Report => report !== null);
}

export async function saveReports(resourceRoot: string, reports: Report[]): Promise<void> {
  await invoke("save_reports", { resourceRoot, reports });
}

/** 报道里显示用的名字（没标题时给个占位） */
export function reportTitle(report: Report): string {
  return report.title.trim() || "未命名报道";
}
