import { CornerDownLeft, FileText, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { categoryMeta, type CategoryKey, type LibraryItem } from "@/data/library";
import { filterLibraryIndex, loadLibraryIndex, type LibraryIndex } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";

/**
 * 全局搜索：跨所有分类搜标题、艺名、标签、简介。
 * 只搜「当前分级可见」的内容，和列表页的过滤规则保持一致。
 */
export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActiveIndex(0);
    setError(null);
    setLoading(true);
    let cancelled = false;

    loadLibraryIndex(resourceRoot)
      .then((result) => {
        if (!cancelled) {
          setIndex(result);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取素材库失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      cancelled = true;
    };
  }, [open, resourceRoot]);

  const results = useMemo(() => {
    if (!index) {
      return [] as Array<{ item: LibraryItem; category: CategoryKey }>;
    }
    const words = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) {
      return [];
    }

    const visible = filterLibraryIndex(index, ratingFilter);
    const hits: Array<{ item: LibraryItem; category: CategoryKey }> = [];
    for (const meta of categoryMeta) {
      for (const item of visible[meta.key]) {
        const haystack = [item.title, item.altName ?? "", item.summary, ...item.tags]
          .join(" ")
          .toLowerCase();
        if (words.every((word) => haystack.includes(word))) {
          hits.push({ item, category: meta.key });
        }
      }
    }
    return hits;
  }, [index, query, ratingFilter]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const openResult = (result: { item: LibraryItem; category: CategoryKey }) => {
    navigate(`/${result.category}/${result.item.id}`);
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="glass-panel flex max-h-[70vh] w-[680px] max-w-full flex-col overflow-hidden rounded-[22px]">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-white/45" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
              }
              if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                openResult(results[activeIndex]);
              }
            }}
            placeholder="搜标题、艺名、标签…（空格分隔多个关键词）"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/14 bg-white/6 p-1.5 text-white/60 transition hover:bg-white/14"
            title="关闭（Esc）"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/55">
              <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
              正在读取素材库…
            </div>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-rose-200">{error}</p>
          ) : query.trim() === "" ? (
            <p className="px-3 py-8 text-center text-xs leading-6 text-white/35">
              输入关键词开始搜索：标题、艺名、标签、简介都能匹配。
              <br />
              例如「黑丝」「cosplay」「绿色系」，多个词用空格分开表示同时满足。
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-white/45">没有找到匹配的内容。</p>
          ) : (
            <div className="space-y-0.5">
              {results.map((result, position) => {
                const meta = categoryMeta.find((entry) => entry.key === result.category);
                const cover = result.item.coverThumb ?? result.item.coverImage;
                const active = position === activeIndex;
                return (
                  <button
                    key={`${result.category}/${result.item.id}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(position)}
                    onClick={() => openResult(result)}
                    className={`flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition ${
                      active ? "bg-sky-300/16" : "hover:bg-white/8"
                    }`}
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-[8px] object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-black/30">
                        <FileText className="h-4 w-4 text-white/25" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{result.item.altName ?? result.item.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-white/40">
                        {meta?.title}
                        {result.item.tags.length > 0 ? ` · ${result.item.tags.slice(0, 4).join(" / ")}` : ""}
                      </p>
                    </div>
                    {active ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/16 bg-white/8 px-2 py-0.5 text-[10px] text-white/60">
                        <CornerDownLeft className="h-3 w-3" />
                        打开
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-white/35">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>{query.trim() ? `命中 ${results.length} 条` : ""}</span>
        </div>
      </div>
    </div>
  );
}
