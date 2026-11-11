import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ImageIcon, Loader2, Music, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "@/data/library";
import { filterLibraryIndex, loadLibraryIndex } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";
import { assetUrl, listReportAssets, type ReportAsset, type ReportMediaRef } from "@/lib/reports";

interface ReportMediaPickerProps {
  open: boolean;
  kind: "image" | "video" | "audio";
  reportId?: string;
  onClose: () => void;
  onPick: (media: ReportMediaRef) => void;
}

interface VideoTrack {
  name: string;
  path: string;
  relativePath: string;
}

interface MusicTrack {
  name: string;
  path: string;
  title?: string;
}

interface MediaEntry {
  path: string;
  label: string;
}

const KIND_META = {
  image: { category: "images" as const, title: "选择图片" },
  video: { category: "videos" as const, title: "选择视频" },
  audio: { category: "music" as const, title: "选择音乐" },
};

function displayTitle(item: LibraryItem): string {
  return item.altName ?? item.title;
}

export default function ReportMediaPicker({ open, kind, reportId, onClose, onPick }: ReportMediaPickerProps) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"library" | "own">("library");
  const [ownAssets, setOwnAssets] = useState<ReportAsset[]>([]);
  const [loadingOwn, setLoadingOwn] = useState(false);

  const meta = KIND_META[kind];

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setEntries([]);
      setError(null);
      setSource("library");
      setOwnAssets([]);
      return;
    }

    let cancelled = false;
    setLoadingItems(true);
    setError(null);
    setSelected(null);
    setEntries([]);

    loadLibraryIndex(resourceRoot)
      .then((index) => {
        if (!cancelled) {
          setItems(filterLibraryIndex(index, ratingFilter)[meta.category]);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setItems([]);
          setError(currentError instanceof Error ? currentError.message : "读取素材库失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingItems(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, resourceRoot, ratingFilter, meta.category]);

  // 选定条目后再拉具体的媒体文件
  useEffect(() => {
    if (!open || !selected) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    setLoadingEntries(true);
    setError(null);

    const load = async () => {
      if (kind === "image") {
        const list = [...selected.previewImages];
        if (selected.coverImage && !list.includes(selected.coverImage)) {
          list.unshift(selected.coverImage);
        }
        return [...new Set(list)].map((url, index) => ({
          path: url,
          label: `图片 ${index + 1}`,
        }));
      }

      if (kind === "video") {
        const tracks = await invoke<VideoTrack[]>("list_video_tracks", {
          resourceRoot,
          groupId: selected.id,
        });
        return (tracks ?? []).map((track, index) => ({
          path: convertFileSrc(track.path),
          label: `第 ${index + 1} 集 · ${track.name}`,
        }));
      }

      const tracks = await invoke<MusicTrack[]>("list_music_tracks", {
        resourceRoot,
        groupId: selected.id,
      });
      return (tracks ?? []).map((track, index) => ({
        path: convertFileSrc(track.path),
        label: `${index + 1}. ${track.title ?? track.name}`,
      }));
    };

    load()
      .then((result) => {
        if (!cancelled) {
          setEntries(result);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setEntries([]);
          setError(currentError instanceof Error ? currentError.message : "读取媒体文件失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingEntries(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selected, kind, resourceRoot]);

  const heading = useMemo(
    () => (selected ? displayTitle(selected) : meta.title),
    [selected, meta.title],
  );

  // 「本报道素材」：导入到这篇报道自带仓库里的文件
  const ownEntries = useMemo(() => {
    const wanted = kind === "image" ? "image" : kind === "video" ? "video" : "audio";
    return ownAssets.filter((asset) => asset.kind === wanted);
  }, [ownAssets, kind]);

  useEffect(() => {
    if (!open || source !== "own" || !reportId) {
      return;
    }
    let cancelled = false;
    setLoadingOwn(true);
    listReportAssets(resourceRoot, reportId)
      .then((list) => {
        if (!cancelled) {
          setOwnAssets(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwnAssets([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOwn(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, source, reportId, resourceRoot]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="glass-panel flex max-h-[86vh] w-[720px] max-w-[94vw] flex-col rounded-[24px] p-5">
        <div className="mb-3 flex shrink-0 items-center gap-2">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/16"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              返回
            </button>
          ) : null}
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-white">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/14 bg-white/6 p-2 text-white/70 transition hover:bg-white/14"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {reportId ? (
          <div className="mb-3 flex shrink-0 items-center gap-1 self-start rounded-full border border-white/14 bg-white/6 p-1">
            <button
              type="button"
              onClick={() => {
                setSource("library");
                setSelected(null);
              }}
              className={`rounded-full px-3 py-1 text-xs transition ${
                source === "library" ? "bg-sky-300/22 text-sky-100" : "text-white/60 hover:text-white/85"
              }`}
            >
              素材库
            </button>
            <button
              type="button"
              onClick={() => {
                setSource("own");
                setSelected(null);
              }}
              className={`rounded-full px-3 py-1 text-xs transition ${
                source === "own" ? "bg-amber-300/22 text-amber-100" : "text-white/60 hover:text-white/85"
              }`}
            >
              本报道素材
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mb-2 rounded-[10px] border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {source === "own" ? (
            loadingOwn ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
                正在读取本报道素材…
              </div>
            ) : ownEntries.length === 0 ? (
              <p className="py-10 text-center text-sm text-white/50">
                这篇报道还没有导入自己的素材。用编辑器里的「导入文件夹」把准备好的目录搬进来。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ownEntries.map((asset) => (
                  <button
                    key={asset.path}
                    type="button"
                    title={asset.relativePath}
                    onClick={() =>
                      onPick({
                        category: "report",
                        itemId: asset.relativePath,
                        path: assetUrl(asset),
                        title: asset.name,
                      })
                    }
                    className="overflow-hidden rounded-[12px] border border-white/12 bg-white/6 text-left transition hover:border-amber-300/45 hover:bg-white/10"
                  >
                    {asset.kind === "image" ? (
                      <img src={assetUrl(asset)} alt="" loading="lazy" className="h-24 w-full object-cover" />
                    ) : asset.kind === "video" ? (
                      <video src={assetUrl(asset)} muted preload="metadata" className="h-24 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 w-full items-center justify-center bg-black/30 text-white/40">
                        <Music className="h-6 w-6" />
                      </div>
                    )}
                    <span className="block truncate px-2 py-1.5 text-[11px] text-white/70">{asset.name}</span>
                  </button>
                ))}
              </div>
            )
          ) : !selected ? (
            loadingItems ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
                正在读取素材库…
              </div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-white/50">
                库里还没有可用的{meta.title.replace("选择", "")}（或都被分级过滤隐藏了）。
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {items.map((item) => {
                  const cover = item.coverThumb ?? item.coverImage;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected(item)}
                      className="overflow-hidden rounded-[14px] border border-white/12 bg-white/6 text-left transition hover:border-sky-300/45 hover:bg-white/10"
                    >
                      {cover ? (
                        <img src={cover} alt="" loading="lazy" className="h-24 w-full object-cover" />
                      ) : (
                        <div className="flex h-24 w-full items-center justify-center bg-black/30 text-white/30">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                      <span className="block truncate px-2 py-1.5 text-xs text-white/75">
                        {displayTitle(item)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : loadingEntries ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
              正在读取媒体文件…
            </div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/50">这个条目里没有可用的媒体文件。</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() =>
                    onPick({
                      category: meta.category,
                      itemId: selected.id,
                      path: entry.path,
                      title: displayTitle(selected),
                    })
                  }
                  className="overflow-hidden rounded-[12px] border border-white/12 bg-white/6 text-left transition hover:border-sky-300/45 hover:bg-white/10"
                >
                  {kind === "image" ? (
                    <img src={entry.path} alt="" loading="lazy" className="h-24 w-full object-cover" />
                  ) : kind === "video" ? (
                    <video src={entry.path} muted preload="metadata" className="h-24 w-full object-cover" />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center bg-black/30 text-white/40">
                      <Music className="h-6 w-6" />
                    </div>
                  )}
                  <span className="block truncate px-2 py-1.5 text-[11px] text-white/70">{entry.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
