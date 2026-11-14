import { Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/**
 * 标签筛选：单按钮 + 浮层，不额外占用一行。
 * tags 由调用方按“当前显示范围”过滤后传入（与内容同一套分级隐藏规则）。
 * scope 用于把筛选状态按分类隔离：在图片里选的标签不会影响漫画/视频。
 */
export default function TagFilterControl({ tags, scope }: { tags: string[]; scope: string }) {
  const tagFilter = useAppStore((state) => state.tagFilters[scope] ?? EMPTY);
  const toggleTagFilter = useAppStore((state) => state.toggleTagFilter);
  const clearTagFilter = useAppStore((state) => state.clearTagFilter);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");

  const shown = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    if (!word) {
      return tags;
    }
    return tags.filter((tag) => tag.toLowerCase().includes(word));
  }, [tags, keyword]);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="按标签筛选（每个分类独立）"
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
          <div className="glass-panel absolute right-0 top-full z-50 mt-2 w-[320px] rounded-[18px] p-3">
            <div className="flex items-center gap-2">
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={`搜索标签（共 ${tags.length} 个）`}
                className="min-w-0 flex-1 rounded-full border border-white/16 bg-black/30 px-3 py-1.5 text-[11px] text-white outline-none placeholder:text-white/30 focus:border-sky-300/50"
              />
              {tagFilter.length > 0 ? (
                <button
                  type="button"
                  onClick={() => clearTagFilter(scope)}
                  className="shrink-0 rounded-full border border-rose-300/35 bg-rose-300/12 px-2.5 py-1.5 text-[11px] text-rose-100 transition hover:bg-rose-300/22"
                >
                  清除
                </button>
              ) : null}
            </div>

            <div className="mt-2 max-h-[260px] overflow-y-auto pr-1">
              {shown.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-white/35">没有匹配的标签</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {shown.map((tag) => {
                    const active = tagFilter.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagFilter(scope, tag)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition",
                          active
                            ? "border-sky-300/55 bg-sky-300/22 text-sky-50"
                            : "border-white/14 bg-white/6 text-white/62 hover:bg-white/14 hover:text-white/90",
                        )}
                      >
                        {tag}
                        {active ? <X className="h-2.5 w-2.5" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-white/30">
              选中多个标签表示「同时包含」。筛选只作用于当前分类。
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

const EMPTY: string[] = [];
