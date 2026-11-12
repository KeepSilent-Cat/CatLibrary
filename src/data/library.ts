export type CategoryKey = "images" | "videos" | "games" | "comics" | "screenshots" | "music" | "live2d" | "novels";

export type CoverType = "image" | "video" | "fallback";
export type SortMode = "default" | "time_desc" | "name_asc";
export type PreviewMode = "hover" | "auto" | "off";
export type ImagePreviewBehavior = "loop" | "stop_end";
export type VideoPreviewBehavior = "loop_30" | "stop_30" | "full";
export type VideoSoundMode = "all" | "hover" | "selected";
export type VideoFitMode = "cover" | "contain";

/** 内容分级：0=全年龄 1=擦边R15 2=18+（添加时默认18+） */
export type ContentRating = 0 | 1 | 2;

export const RATING_OPTIONS: Array<{
  value: ContentRating;
  label: string;
  short: string;
  description: string;
}> = [
  {
    value: 0,
    label: "全年龄",
    short: "",
    description: "所有年龄可看，需明确标记为此项",
  },
  {
    value: 1,
    label: "擦边 · R15",
    short: "R15",
    description: "轻微擦边内容，默认在列表中隐藏",
  },
  {
    value: 2,
    label: "成人 · 18+",
    short: "18+",
    description: "新增内容默认此项，仅解锁后显示",
  },
];

export function ratingLabel(rating: ContentRating): string {
  return RATING_OPTIONS.find((option) => option.value === rating)?.label ?? "全年龄";
}

export interface LibrarySourceEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
}

export interface LibraryItem {
  id: string;
  title: string;
  /** 艺名/译名（用户自行翻译的展示名，有值时优先展示） */
  altName?: string;
  category: CategoryKey;
  summary: string;
  relativePath: string;
  coverType: CoverType;
  coverImage?: string;
  /** 列表卡片用封面缩略图（后端生成）；为空时回退到 coverImage 原图 */
  coverThumb?: string;
  previewMedia?: string;
  previewImages: string[];
  sourceCount: number;
  modifiedAt: number;
  sourceEntries: LibrarySourceEntry[];
  /** 内容分级：0=全年龄 1=擦边R15 2=18+ */
  rating: ContentRating;
  /** 用户自定义标签（跨分类筛选） */
  tags: string[];
}

export interface CategoryMeta {
  key: CategoryKey;
  title: string;
  description: string;
}

export const categoryMeta: CategoryMeta[] = [
  {
    key: "images",
    title: "图片",
    description: "浏览已归档的图片资源，保持目录可回溯。",
  },
  {
    key: "videos",
    title: "视频",
    description: "按卡片流查看视频封面与路径状态。",
  },
  {
    key: "games",
    title: "游戏",
    description: "保留启动资源与整理目录的入口索引。",
  },
  {
    key: "comics",
    title: "漫画",
    description: "按章节归档与阅读漫画，支持压缩包导入。",
  },
  {
    key: "screenshots",
    title: "截图",
    description: "阅读时保存下来的喜欢画面，随时回看。",
  },
  {
    key: "music",
    title: "音乐",
    description: "按专辑/歌单归档音频，内置播放器。",
  },
  {
    key: "live2d",
    title: "Live2D",
    description: "Live2D 角色模型仓库（建设中）。",
  },
  {
    key: "novels",
    title: "小说",
    description: "按书归档文本，内置阅读器，支持多章节。",
  },
];
