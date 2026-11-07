import { ArrowLeft, ImageIcon, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "@/data/library";

interface ImageCoverPickerProps {
  open: boolean;
  loading: boolean;
  items: LibraryItem[];
  onClose: () => void;
  onPick: (imageUrl: string) => void;
}

function getImageCandidates(item: LibraryItem | undefined): string[] {
  if (!item) {
    return [];
  }

  const candidates = [...item.previewImages];
  if (item.coverImage && !candidates.includes(item.coverImage)) {
    candidates.unshift(item.coverImage);
  }

  return [...new Set(candidates)];
}

function displayTitle(item: LibraryItem): string {
  return item.altName ?? item.title;
}

export default function ImageCoverPicker({
  open,
  loading,
  items,
  onClose,
  onPick,
}: ImageCoverPickerProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedGroupId(null);
      setSelectedImageUrl(null);
      setFocusedItemId(null);
    }
  }, [open]);

  const selectedGroup = useMemo(
    () => items.find((item) => item.id === selectedGroupId),
    [items, selectedGroupId],
  );
  const selectedImages = useMemo(() => getImageCandidates(selectedGroup), [selectedGroup]);
  const focusedItem = useMemo(
    () => items.find((item) => item.id === focusedItemId) ?? items[0],
    [focusedItemId, items],
  );
  const focusedItemImages = useMemo(() => getImageCandidates(focusedItem), [focusedItem]);

  useEffect(() => {
    setSelectedImageUrl(selectedImages[0] ?? null);
  }, [selectedGroupId, selectedImages]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFocusedItemId((current) => {
      if (current && items.some((item) => item.id === current)) {
        return current;
      }
      return items[0]?.id ?? null;
    });
  }, [items, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/58 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="glass-panel flex max-h-[84vh] w-[980px] max-w-[94vw] flex-col rounded-[28px] p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Music Cover</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {selectedGroup ? "选择这组里的具体图片" : "从图片库选择封面"}
            </h3>
            <p className="mt-1 text-sm text-white/58">
              {selectedGroup
                ? `${displayTitle(selectedGroup)}`
                : "先选一个图片条目，再从里面挑具体哪一张图作为音乐封面"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/14 bg-white/8 text-white/72 transition hover:bg-white/14 hover:text-white"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {selectedGroup ? (
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedGroupId(null);
                setSelectedImageUrl(null);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-sm text-white/76 transition hover:bg-white/14"
            >
              <ArrowLeft className="h-4 w-4" />
              返回图片条目
            </button>
            <span className="text-xs text-white/45">{selectedImages.length} 张可选图片</span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-3 text-sm text-white/56">
            <Loader2 className="h-5 w-5 animate-spin" />
            正在读取图片库...
          </div>
        ) : selectedGroup ? (
          selectedImages.length > 0 ? (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="space-y-2">
                  {selectedImages.map((imageUrl, index) => {
                    const selected = imageUrl === selectedImageUrl;
                    return (
                      <button
                        key={`${selectedGroup.id}-${imageUrl}`}
                        type="button"
                        onClick={() => setSelectedImageUrl(imageUrl)}
                        className={`flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-left transition ${
                          selected
                            ? "bg-sky-300/14 text-white"
                            : "bg-white/6 text-white/72 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px] bg-black/24">
                          <img
                            src={imageUrl}
                            alt={`${displayTitle(selectedGroup)}-${index + 1}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">第 {index + 1} 张</p>
                          <p className="mt-1 text-xs text-white/46">
                            {selected ? "当前预览" : "点击查看大图"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-[24px] bg-white/6 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{displayTitle(selectedGroup)}</p>
                    <p className="mt-1 text-xs text-white/46">
                      {selectedImageUrl ? "右侧展示原图预览，确认后再设置为封面" : "请选择一张图片"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectedImageUrl && onPick(selectedImageUrl)}
                    disabled={!selectedImageUrl}
                    className="inline-flex items-center rounded-full bg-sky-300/18 px-4 py-2 text-sm text-sky-50 transition hover:bg-sky-300/28 disabled:opacity-50"
                  >
                    设为封面
                  </button>
                </div>

                <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[22px] bg-black/28 p-3">
                  {selectedImageUrl ? (
                    <img
                      src={selectedImageUrl}
                      alt={displayTitle(selectedGroup)}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="text-sm text-white/46">请选择左侧缩略图</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-white/50">
              这个图片条目里暂时没有可选图片
            </div>
          )
        ) : items.length > 0 ? (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="space-y-2">
                {items.map((item) => {
                  const selected = item.id === focusedItem?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFocusedItemId(item.id)}
                      className={`flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-left transition ${
                        selected
                          ? "bg-sky-300/14 text-white"
                          : "bg-white/6 text-white/72 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-black/24">
                        {item.coverImage ? (
                          <img
                            src={item.coverThumb ?? item.coverImage}
                            alt={displayTitle(item)}
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-white/28" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{displayTitle(item)}</p>
                        <p className="mt-1 text-xs text-white/45">{getImageCandidates(item).length} 张图</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-col rounded-[24px] bg-white/6 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">
                    {focusedItem ? displayTitle(focusedItem) : "请选择图片条目"}
                  </p>
                  <p className="mt-1 text-xs text-white/46">
                    {focusedItem
                      ? "右侧只预览这一组，确认后再进入选具体图片"
                      : "左侧选择一个图片条目"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => focusedItem && setSelectedGroupId(focusedItem.id)}
                  disabled={!focusedItem}
                  className="inline-flex items-center rounded-full bg-sky-300/18 px-4 py-2 text-sm text-sky-50 transition hover:bg-sky-300/28 disabled:opacity-50"
                >
                  进入这组
                </button>
              </div>

              <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[22px] bg-black/28 p-3">
                {focusedItemImages[0] ? (
                  <img
                    src={focusedItemImages[0]}
                    alt={focusedItem ? displayTitle(focusedItem) : "图片预览"}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="text-sm text-white/46">这个条目里还没有可预览图片</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-white/50">
            图片库里还没有可选内容
          </div>
        )}
      </div>
    </div>
  );
}
