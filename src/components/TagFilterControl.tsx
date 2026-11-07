import { Tag } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/**
 * 标签筛选：单按钮 + 浮层，不额外占用一行。
 * tags 由调用方按“当前显示范围”过滤后传入（与内容同一套分级隐藏规则）。
 */
export default function TagFilterControl({ tags }: { tags: string[] }) {
  const tagFilter = useAppStore((state) => state.tagFilter);
  const toggleTagFilter = useAppStore((state) => state.toggleTagFilter);
  const clearTagFilter = useAppStore((state) => state.clearTagFilter);
  const [open, setOpen] = useState(false);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="按标签筛选"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
          tagFilter.length > 0
            ? "border-sky-300/45 bg-sky-300/20 text-sky-50"
            : "border-white/16 bg-white/8 text-white/76 hover:bg-white/16",
        )}
      >
        <Tag className="h-3.5 w-3.5" />
        标签
        {tagFilter.length > 0 ? `（${tagFilter.length}）` : ""}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[16px] border border-white/14 bg-slate-900/95 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.18em] text-white/48">
                按标签筛选
              </span>
              {tagFilter.length > 0 ? (
                <button
                  type="button"
                  onClick={clearTagFilter}
                  className="text-[11px] text-white/60 transition hover:text-white"
                >
                  清除（{tagFilter.length}）
                </button>
              ) : null}
            </div>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
              {tags.map((tag) => {
                const active = tagFilter.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTagFilter(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      active
                        ? "border-sky-300/45 bg-sky-300/20 text-sky-50"
                        : "border-white/14 bg-white/6 text-white/70 hover:bg-white/14",
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-white/35">
              多选时需同时包含所选标签；被分级隐藏的内容，其独有标签也不显示
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
