import { FileText, ImageIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { categoryMeta, type CategoryKey } from "@/data/library";
import type { LibraryIndex } from "@/lib/library-source";
import type { Report } from "@/lib/reports";
import { cn } from "@/lib/utils";

export type BoardPickPayload =
  | { kind: "item"; category: CategoryKey; itemId: string }
  | { kind: "report"; reportId: string };

function reportCover(report: Report): string | undefined {
  const block = report.blocks.find((entry) => entry.type === "image" && entry.media?.path);
  return block?.media?.path;
}

export default function BoardAddPicker({
  open,
  index,
  reports,
  onClose,
  onPick,
}: {
  open: boolean;
  index: LibraryIndex | null;
  reports: Report[];
  onClose: () => void;
  onPick: (payload: BoardPickPayload) => void;
}) {
  const [source, setSource] = useState<"library" | "reports">("library");
  const [category, setCategory] = useState<CategoryKey>("images");
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFocusedItemId(null);
      setSource("library");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const items = index ? index[category] : [];
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
            <h3 className="mt-0.5 text-base font-semibold text-white">选择要放到画板的内容</h3>
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

        <div className="mb-3 flex shrink-0 items-center gap-1 self-start rounded-full border border-white/14 bg-white/7 p-1">
          <button
            type="button"
            onClick={() => setSource("library")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs transition",
              source === "library" ? "bg-sky-300/22 text-sky-100" : "text-white/62 hover:text-white/88",
            )}
          >
            素材库
          </button>
          <button
            type="button"
            onClick={() => setSource("reports")}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs transition",
              source === "reports" ? "bg-amber-300/22 text-amber-100" : "text-white/62 hover:text-white/88",
            )}
          >
            报道
          </button>
        </div>

        {source === "reports" ? (
          reports.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-16 text-sm text-white/50">
              还没有报道，先去「报道」里建一篇。
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
              {reports.map((report) => {
                const cover = reportCover(report);
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => {
                      onPick({ kind: "report", reportId: report.id });
                      onClose();
                    }}
                    className="overflow-hidden rounded-[16px] border border-white/12 bg-white/6 text-left transition hover:border-amber-300/45 hover:bg-white/10"
                  >
                    {cover ? (
                      <img src={cover} alt="" loading="lazy" className="h-24 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 w-full items-center justify-center bg-black/30">
                        <FileText className="h-6 w-6 text-white/28" />
                      </div>
                    )}
                    <span className="block truncate px-2 py-1.5 text-xs text-white/78">
                      {report.title.trim() || "未命名报道"}
                    </span>
                    <span className="block px-2 pb-1.5 text-[10px] text-white/40">
                      {report.blocks.length} 个块
                    </span>
                  </button>
                );
              })}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-white/50">
            该分类下暂无内容
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col">
              <div className="mb-2 flex shrink-0 flex-wrap gap-1">
                {categoryMeta.map((meta) => (
                  <button
                    key={meta.key}
                    type="button"
                    onClick={() => setCategory(meta.key)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] transition",
                      category === meta.key
                        ? "bg-sky-300/20 text-sky-100"
                        : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white/85",
                    )}
                  >
                    {meta.title}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/24">
                          {item.coverImage ? (
                            <img
                              src={item.coverThumb ?? item.coverImage}
                              alt={item.title}
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <ImageIcon className="h-6 w-6 text-white/28" />
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
                    onPick({ kind: "item", category, itemId: focusedItem.id });
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
