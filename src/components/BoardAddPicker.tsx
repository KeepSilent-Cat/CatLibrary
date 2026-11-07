import { ImageIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { categoryMeta, type CategoryKey } from "@/data/library";
import type { LibraryIndex } from "@/lib/library-source";
import { cn } from "@/lib/utils";

export default function BoardAddPicker({
  open,
  index,
  onClose,
  onPick,
}: {
  open: boolean;
  index: LibraryIndex | null;
  onClose: () => void;
  onPick: (category: CategoryKey, itemId: string) => void;
}) {
  const [category, setCategory] = useState<CategoryKey>("images");
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFocusedItemId(null);
    }
  }, [open]);

  if (!open || !index) {
    return null;
  }

  const items = index[category];
  // 切换分类后，旧的聚焦项可能不属于当前分类，这里自动回退到第一项
  const focusedItem = items.find((item) => item.id === focusedItemId) ?? items[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="glass-panel flex max-h-[80vh] w-[880px] max-w-[94vw] flex-col rounded-[24px] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/48">Add to board</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">选择要放到画板的素材</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/14 bg-white/6 p-2 text-white/70 transition hover:bg-white/14"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex shrink-0 items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
          {categoryMeta.map((meta) => (
            <button
              key={meta.key}
              type="button"
              onClick={() => setCategory(meta.key)}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 text-xs transition",
                category === meta.key
                  ? "bg-sky-300/22 text-sky-100"
                  : "text-white/62 hover:text-white/88",
              )}
            >
              {meta.title}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-white/50">
            该分类下暂无内容
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="space-y-2">
                {items.map((item) => {
                  const selected = item.id === focusedItem?.id;
                  return (
                    <button
                      key={`${category}/${item.id}`}
                      type="button"
                      onClick={() => setFocusedItemId(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-left transition",
                        selected
                          ? "bg-sky-300/14 text-white"
                          : "bg-white/6 text-white/72 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-black/24">
                        {item.coverImage ? (
                          <img
                            src={item.coverThumb ?? item.coverImage}
                            alt={item.title}
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="h-7 w-7 text-white/28" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="mt-1 text-xs text-white/45">{item.sourceCount} 项</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-col rounded-[22px] bg-white/6 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {focusedItem ? focusedItem.title : "请选择素材"}
                  </p>
                  <p className="mt-1 text-xs text-white/46">
                    {focusedItem ? `共 ${focusedItem.sourceCount} 项内容` : "左侧选择一个条目"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!focusedItem) {
                      return;
                    }
                    onPick(category, focusedItem.id);
                    onClose();
                  }}
                  disabled={!focusedItem}
                  className="inline-flex shrink-0 items-center rounded-full bg-sky-300/18 px-4 py-2 text-sm text-sky-50 transition hover:bg-sky-300/28 disabled:opacity-50"
                >
                  添加到画板
                </button>
              </div>

              <div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[20px] bg-black/28 p-3">
                {focusedItem?.coverImage ? (
                  <img
                    src={focusedItem.coverImage}
                    alt={focusedItem.title}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="text-sm text-white/46">这个条目里还没有可预览内容</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
