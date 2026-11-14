import { ArrowRight, ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { categoryMeta, type LibraryItem } from "@/data/library";

const ROTATE_MS = 7000;
const THUMB_COUNT = 6;

/** 首页「探索队列」：Steam 商店风格的整幅大图 + 侧栏信息 + 底部缩略图队列 */
export default function RandomShowcase({ items }: { items: LibraryItem[] }) {
  const navigate = useNavigate();
  const listKey = items.map((item) => `${item.category}/${item.id}`).join("|");
  const [cursor, setCursor] = useState(() => ({ key: listKey, index: 0 }));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const count = items.length;
  const index = cursor.key === listKey ? cursor.index % Math.max(1, count) : 0;

  useEffect(() => {
    if (count < 2) {
      return;
    }
    if (hovered || focused || document.hidden) {
      return;
    }
    const timer = window.setInterval(() => {
      setCursor((current) => ({
        key: listKey,
        index: (current.key === listKey ? current.index + 1 : 1) % count,
      }));
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [count, hovered, focused, listKey]);

  const item = items[index];
  const meta = useMemo(
    () => categoryMeta.find((entry) => entry.key === item?.category),
    [item?.category],
  );

  const go = (next: number) => {
    if (count < 2) {
      return;
    }
    setCursor({ key: listKey, index: ((next % count) + count) % count });
  };

  // 底部缩略图队列：从当前项往后取若干个，形成「接下来要看什么」的感觉
  const queue = useMemo(() => {
    if (count === 0) {
      return [] as Array<{ item: LibraryItem; position: number }>;
    }
    const size = Math.min(THUMB_COUNT, count);
    return Array.from({ length: size }, (_, offset) => ({
      item: items[(index + offset) % count],
      position: (index + offset) % count,
    }));
  }, [items, index, count]);

  if (!item) {
    return null;
  }

  const cover = item.coverImage ?? item.coverThumb;
  const arrow =
    "absolute top-[38%] z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/45 text-white/85 opacity-0 backdrop-blur-md transition hover:bg-black/70 hover:text-white group-hover:opacity-100 disabled:hidden";

  return (
    <section
      aria-label="探索队列"
      className="group relative mt-6 overflow-hidden rounded-[26px] border border-white/12 bg-black/30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      {/* 背景：封面模糊铺底 + 左侧渐隐，保证文字可读 */}
      {cover ? (
        <img
          key={`${item.category}/${item.id}-bg`}
          src={cover}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-[3px]"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(56,32,74,0.9),rgba(18,16,28,0.95))]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,9,16,0.96)_0%,rgba(10,9,16,0.78)_42%,rgba(10,9,16,0.32)_72%,rgba(10,9,16,0.18)_100%)]" />

      <button
        type="button"
        aria-label="上一个馆藏"
        disabled={count < 2}
        onClick={() => go(index - 1)}
        className={`${arrow} left-3`}
      >
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        aria-label="下一个馆藏"
        disabled={count < 2}
        onClick={() => go(index + 1)}
        className={`${arrow} right-3`}
      >
        <ChevronRight size={20} />
      </button>

      <div className="relative grid gap-5 p-6 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-sky-300/35 bg-sky-300/15 px-2.5 py-0.5 text-[10px] tracking-wide text-sky-100">
              {meta?.title ?? "馆藏"}
            </span>
            {item.rating > 0 ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  item.rating === 2
                    ? "border-rose-300/40 bg-rose-950/60 text-rose-200"
                    : "border-amber-300/40 bg-amber-950/60 text-amber-200"
                }`}
              >
                {item.rating === 2 ? "18+" : "R15"}
              </span>
            ) : null}
          </div>

          <h2 className="mt-2.5 line-clamp-1 text-[22px] font-semibold leading-tight text-white">
            {item.altName ?? item.title}
          </h2>
          {item.altName ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-white/40">{item.title}</p>
          ) : null}
          <p className="mt-2 line-clamp-2 max-w-[46ch] text-xs leading-6 text-white/55">
            {item.summary}
          </p>

          {item.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/14 bg-white/8 px-2 py-0.5 text-[10px] text-white/60"
                >
                  {tag}
                </span>
              ))}
              {item.tags.length > 5 ? (
                <span className="text-[10px] text-white/30">+{item.tags.length - 5}</span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/${item.category}/${item.id}`)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/92 px-4 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
            >
              查看详情
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={count < 2}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/18 bg-white/8 px-3.5 py-1.5 text-xs text-white/75 transition hover:bg-white/16 disabled:opacity-40"
            >
              <Shuffle className="h-3.5 w-3.5" />
              换一个
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(`/${item.category}/${item.id}`)}
          className="hidden overflow-hidden rounded-[16px] border border-white/18 shadow-[0_18px_50px_rgba(0,0,0,0.45)] transition hover:border-white/35 sm:block"
          aria-label={`打开 ${item.altName ?? item.title}`}
        >
          {cover ? (
            <img
              key={`${item.category}/${item.id}-card`}
              src={cover}
              alt={item.title}
              className="h-[190px] w-full object-cover"
            />
          ) : (
            <div className="grid h-[190px] w-full place-items-center bg-black/40 text-xs text-white/35">
              暂无封面
            </div>
          )}
        </button>
      </div>

      {/* 底部缩略图队列 */}
      {count > 1 ? (
        <div className="relative border-t border-white/10 bg-black/35 px-5 py-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            {queue.map(({ item: queued, position }) => {
              const active = position === index;
              const thumb = queued.coverImage ?? queued.coverThumb;
              return (
                <button
                  key={`${queued.category}/${queued.id}`}
                  type="button"
                  onClick={() => go(position)}
                  title={queued.altName ?? queued.title}
                  className={`relative h-11 w-20 shrink-0 overflow-hidden rounded-[8px] border transition ${
                    active
                      ? "border-sky-300/80 shadow-[0_0_0_2px_rgba(125,211,252,0.35)]"
                      : "border-white/12 opacity-60 hover:opacity-100"
                  }`}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-white/6 text-[9px] text-white/35">
                      无封面
                    </span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-white/25">
              {index + 1} / {count}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
