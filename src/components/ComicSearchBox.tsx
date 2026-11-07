import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import type { LibraryItem } from "@/data/library";
import { cn } from "@/lib/utils";

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

interface ComicSearchBoxProps {
  /** 整个漫画库的条目（不做分页/筛选，确保全库可搜） */
  items: LibraryItem[];
  onSelect: (item: LibraryItem) => void;
}

const MAX_RESULTS = 20;

/**
 * 漫画库搜索：按展示名（含艺名/译名）或 ID（如 comic_3）匹配，
 * 选中结果直接跳转到该漫画的阅读页。
 */
export default function ComicSearchBox({ items, onSelect }: ComicSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const key = query.trim().toLowerCase();
    if (key === "") {
      return [];
    }

    // 命中打分：ID 精确 > ID 前缀 > ID 包含 > 名称包含，越小越靠前
    const scored: Array<{ item: LibraryItem; score: number }> = [];
    for (const item of items) {
      const id = item.id.toLowerCase();
      const name = item.title.toLowerCase();
      const alt = (item.altName ?? "").toLowerCase();
      let score = -1;
      if (id === key) {
        score = 0;
      } else if (id.startsWith(key)) {
        score = 1;
      } else if (id.includes(key)) {
        score = 2;
      } else if (name.includes(key) || alt.includes(key)) {
        score = 3;
      }
      if (score >= 0) {
        scored.push({ item, score });
      }
    }

    return scored
      .sort((left, right) => left.score - right.score || naturalCompare(left.item.id, right.item.id))
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.item);
  }, [items, query]);

  // 结果变化时把高亮收回到第一项
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // 点击组件外部时收起结果面板
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const commit = (item: LibraryItem) => {
    onSelect(item);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      return;
    }
    if (results.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(results[Math.min(activeIndex, results.length - 1)]);
    }
  };

  const showResults = open && query.trim() !== "";

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 transition focus-within:border-sky-300/50">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/45" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="搜索漫画名或 ID（comic_3）"
          className="w-56 bg-transparent text-xs text-white outline-none placeholder:text-white/32"
        />
        {query !== "" ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            title="清空"
            className="shrink-0 text-white/45 transition hover:text-white/85"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {showResults ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-80 w-80 overflow-y-auto rounded-[14px] border border-white/14 bg-[#1c1020]/95 p-1.5 shadow-2xl backdrop-blur-md">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-white/45">没有匹配的漫画</p>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition",
                  index === activeIndex ? "bg-sky-300/18" : "hover:bg-white/8",
                )}
              >
                <span className="h-10 w-8 shrink-0 overflow-hidden rounded-[6px] bg-white/8">
                  {(item.coverThumb ?? item.coverImage) ? (
                    <img
                      src={item.coverThumb ?? item.coverImage}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-white/90">
                    {item.altName ?? item.title}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-sky-200/70">{item.id}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
