import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LibraryItem } from '@/data/library';
export default function RandomShowcase({ items }: {
    items: LibraryItem[];
}) { const navigate = useNavigate(); const [index, setIndex] = useState(() => Math.floor(Math.random() * Math.max(1, items.length))), [paused, setPaused] = useState(false); const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false); useEffect(() => { if (paused || hovered || focused || items.length < 2)
    return; const timer = setInterval(() => { if (!document.hidden)
    setIndex(current => { const next = Math.floor(Math.random() * (items.length - 1)); return next >= current % items.length ? next + 1 : next; }); }, 7000); return () => clearInterval(timer); }, [paused,hovered,focused, items.length]); const item = items[index % items.length]; if (!item)
    return null; return <section className="relative mt-6 overflow-hidden rounded-3xl border border-white/20 bg-black/20" aria-label="随机馆藏轮播" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget))
    setFocused(false); }}><button className="flex w-full items-center gap-6 p-5 text-left" onClick={() => navigate('/' + item.category + '/' + item.id)}>{item.coverImage && <img key={item.id} src={item.coverImage} className="h-48 w-1/2 object-contain" alt={item.title}/>}<span><small>随手翻翻 · 每7秒随机切换</small><h2 className="mt-3 text-lg">{item.altName || item.title}</h2><p className="mt-2 text-xs text-white/50">只展示当前显示范围内的内容 · 点击进入</p></span></button><button className="absolute bottom-3 right-4 rounded-full border border-white/20 px-3 py-1 text-xs" onClick={() => setPaused(!paused)}>{paused ? '继续轮播' : '暂停轮播'}</button></section>; }
