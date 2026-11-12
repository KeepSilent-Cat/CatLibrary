import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LibraryItem } from "@/data/library";

export default function RandomShowcase({ items }: { items: LibraryItem[] }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(() => Math.floor(Math.random() * Math.max(1, items.length)));
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (paused || hovered || focused || items.length < 2) return;
    const timer = setInterval(() => {
      if (!document.hidden) setIndex(current => {
        const next = Math.floor(Math.random() * (items.length - 1));
        return next >= current % items.length ? next + 1 : next;
      });
    }, 7000);
    return () => clearInterval(timer);
  }, [paused, hovered, focused, items.length]);
  const item = items[index % items.length];
  if (!item) return null;
  const step = (direction: number) => setIndex(current => (current + direction + items.length) % items.length);
  const arrow = "absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/24 bg-white/10 text-white/80 shadow-lg backdrop-blur-xl transition hover:bg-white/25 hover:text-white disabled:opacity-25";
  return (
    <section className="relative mt-6 overflow-hidden rounded-[28px] border border-white/20 bg-black/12"
      aria-label="随机馆藏轮播" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
      <button className={`${arrow} left-4`} aria-label="上一个馆藏" disabled={items.length < 2} onClick={() => step(-1)}><ChevronLeft size={20} /></button>
      <button className="flex min-h-56 w-full items-center gap-7 px-20 py-6 text-left" onClick={() => navigate(`/${item.category}/${item.id}`)}>
        {item.coverImage && <img key={`${item.category}/${item.id}`} src={item.coverImage} className="h-48 w-1/2 rounded-2xl object-contain" alt={item.title} />}
        <span className="min-w-0 flex-1"><small className="text-xs tracking-wider text-white/50">随手翻翻</small><h2 className="mt-3 text-xl font-semibold">{item.altName || item.title}</h2><p className="mt-3 text-xs leading-6 text-white/55">从你的藏馆里，偶遇一点喜欢。<br />点击进入 · 每 7 秒随机切换</p></span>
      </button>
      <button className={`${arrow} right-4`} aria-label="下一个馆藏" disabled={items.length < 2} onClick={() => step(1)}><ChevronRight size={20} /></button>
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-3 text-[11px] text-white/45"><span>只展示当前显示范围内的内容</span><button className="inline-flex items-center gap-1.5 text-white/65 transition hover:text-white" onClick={() => setPaused(!paused)}>{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? "继续轮播" : "暂停轮播"}</button></div>
    </section>
  );
}
