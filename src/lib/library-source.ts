import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CategoryKey,
  ContentRating,
  CoverType,
  LibraryItem,
  LibrarySourceEntry,
} from "@/data/library";

interface RawLibraryItem {
  id: string;
  title: string;
  altName?: string;
  category: CategoryKey;
  summary: string;
  relativePath: string;
  coverType: CoverType;
  coverPath?: string;
  coverThumbPath?: string;
  previewPath?: string;
  previewImagePaths: string[];
  sourceCount: number;
  modifiedAt: number;
  sourceEntries: LibrarySourceEntry[];
  rating: number;
  tags?: string[];
}

interface RawLibraryIndex {
  images: RawLibraryItem[];
  videos: RawLibraryItem[];
  games: RawLibraryItem[];
  comics: RawLibraryItem[];
  screenshots: RawLibraryItem[];
  music: RawLibraryItem[];
  live2d: RawLibraryItem[];
  novels: RawLibraryItem[];
}

export interface LibraryIndex {
  images: LibraryItem[];
  videos: LibraryItem[];
  games: LibraryItem[];
  comics: LibraryItem[];
  screenshots: LibraryItem[];
  music: LibraryItem[];
  live2d: LibraryItem[];
  novels: LibraryItem[];
}

const emptyIndex: LibraryIndex = {
  images: [],
  videos: [],
  games: [],
  comics: [],
  screenshots: [],
  music: [],
  live2d: [],
  novels: [],
};

const cache = new Map<string, Promise<LibraryIndex>>();
const LOCAL_METADATA_STORAGE_KEY = "cat_library_metadata";

interface LocalMetadataEntry {
  title?: string;
  summary?: string;
  tags?: string[];
  altName?: string;
}

type LocalMetadataStore = Record<string, LocalMetadataEntry>;

function normalizeInvokeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return new Error(error.message);
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return new Error(message);
    }

    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(fallback);
    }
  }

  return new Error(fallback);
}

function getLocalMetadataEntryKey(resourceRoot: string, category: CategoryKey, itemId: string) {
  return `${resourceRoot}::${category}/${itemId}`;
}

function readLocalMetadataStore(): LocalMetadataStore {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_METADATA_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as LocalMetadataStore;
  } catch {
    return {};
  }
}

function writeLocalMetadataStore(store: LocalMetadataStore) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LOCAL_METADATA_STORAGE_KEY, JSON.stringify(store));
}

function saveLocalMetadata(
  resourceRoot: string,
  category: CategoryKey,
  itemId: string,
  title: string,
  summary: string,
  tags: string[] = [],
  altName?: string,
) {
  const store = readLocalMetadataStore();
  store[getLocalMetadataEntryKey(resourceRoot, category, itemId)] = {
    title: title.trim() || undefined,
    summary: summary.trim() || undefined,
    tags: tags.length > 0 ? tags : undefined,
    altName: altName?.trim() || undefined,
  };
  writeLocalMetadataStore(store);
}

function applyLocalMetadata(resourceRoot: string, items: LibraryItem[]) {
  const store = readLocalMetadataStore();

  return items.map((item) => {
    const localMetadata = store[getLocalMetadataEntryKey(resourceRoot, item.category, item.id)];
    if (!localMetadata) {
      return item;
    }

    return {
      ...item,
      title: localMetadata.title ?? item.title,
      summary: localMetadata.summary ?? item.summary,
      tags: localMetadata.tags ?? item.tags,
      altName: localMetadata.altName ?? item.altName,
    };
  });
}

function toPreviewUrl(filePath?: string) {
  if (!filePath) {
    return undefined;
  }

  return isTauri() ? convertFileSrc(filePath) : filePath;
}

function mapItem(item: RawLibraryItem): LibraryItem {
  return {
    id: item.id,
    title: item.title,
    altName: item.altName ?? undefined,
    category: item.category,
    summary: item.summary,
    relativePath: item.relativePath,
    coverType: item.coverType,
    coverImage: toPreviewUrl(item.coverPath),
    coverThumb: toPreviewUrl(item.coverThumbPath),
    previewMedia: toPreviewUrl(item.previewPath),
    previewImages: item.previewImagePaths.map((path) => toPreviewUrl(path)).filter(Boolean) as string[],
    sourceCount: item.sourceCount,
    modifiedAt: item.modifiedAt,
    sourceEntries: item.sourceEntries,
    rating: Math.min(Math.max(item.rating ?? 2, 0), 2) as ContentRating,
    tags: item.tags ?? [],
  };
}

async function loadLibraryIndexInternal(resourceRoot: string): Promise<LibraryIndex> {
  if (!isTauri()) {
    return emptyIndex;
  }

  let result: RawLibraryIndex;
  try {
    result = await invoke<RawLibraryIndex>("scan_library", {
      resourceRoot,
    });
  } catch (error) {
    throw normalizeInvokeError(error, "读取素材目录失败");
  }

  return {
    images: applyLocalMetadata(resourceRoot, result.images.map(mapItem)),
    videos: applyLocalMetadata(resourceRoot, result.videos.map(mapItem)),
    games: applyLocalMetadata(resourceRoot, result.games.map(mapItem)),
    comics: applyLocalMetadata(resourceRoot, result.comics.map(mapItem)),
    screenshots: applyLocalMetadata(resourceRoot, result.screenshots.map(mapItem)),
    music: applyLocalMetadata(resourceRoot, result.music.map(mapItem)),
    live2d: applyLocalMetadata(resourceRoot, result.live2d.map(mapItem)),
    novels: applyLocalMetadata(resourceRoot, result.novels.map(mapItem)),
  };
}

export async function loadLibraryIndex(resourceRoot: string) {
  if (!cache.has(resourceRoot)) {
    cache.set(
      resourceRoot,
      loadLibraryIndexInternal(resourceRoot).catch((error) => {
        cache.delete(resourceRoot);
        throw error;
      }),
    );
  }

  return cache.get(resourceRoot)!;
}

export async function saveLibraryMetadata(
  resourceRoot: string,
  category: CategoryKey,
  itemId: string,
  title: string,
  summary: string,
  rating?: ContentRating,
  tags: string[] = [],
  altName?: string,
) {
  if (!isTauri()) {
    saveLocalMetadata(resourceRoot, category, itemId, title, summary, tags, altName);
    return;
  }

  let localSaveError: Error | null = null;
  try {
    saveLocalMetadata(resourceRoot, category, itemId, title, summary, tags, altName);
  } catch (error) {
    localSaveError = normalizeInvokeError(error, "本地保存失败");
  }

  try {
    await invoke("save_library_metadata", {
      resourceRoot,
      category,
      itemId,
      title,
      summary,
      altName,
      // 同步旧字段，保证旧版本兼容
      adult: rating !== undefined ? rating >= 2 : undefined,
      rating,
      tags,
    });
  } catch (error) {
    if (localSaveError) {
      throw new Error(
        `${normalizeInvokeError(error, "保存失败").message} | ${localSaveError.message}`,
      );
    }
  }

  clearLibraryIndexCache(resourceRoot);
}

/**
 * 按内容分级过滤整个索引。
 *
 * 所有会列出馆藏的入口（分类页、收藏、画板添加、封面/背景选择器、搜索结果、
 * 详情页的同分类列表）都必须过这一层，否则被标记的内容会从别的入口漏出来。
 * ratingFilter：0=仅全年龄 1=含擦边R15 2=全部
 */
export function filterLibraryIndex(index: LibraryIndex, ratingFilter: number): LibraryIndex {
  const keep = (items: LibraryItem[]) => items.filter((item) => item.rating <= ratingFilter);

  return {
    images: keep(index.images),
    videos: keep(index.videos),
    games: keep(index.games),
    comics: keep(index.comics),
    screenshots: keep(index.screenshots),
    music: keep(index.music),
    live2d: keep(index.live2d),
    novels: keep(index.novels),
  };
}

export function clearLibraryIndexCache(resourceRoot?: string) {
  if (resourceRoot) {
    cache.delete(resourceRoot);
    return;
  }

  cache.clear();
}
