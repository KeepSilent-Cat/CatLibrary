import { useAppStore } from '@/store/useAppStore';
import type { ContentRating } from '@/data/library';
export function ExtraFavorite({ kind, id }: {
    kind: 'board' | 'reports';
    id: string;
}) { const ids = useAppStore(s => s.favoriteIds), toggle = useAppStore(s => s.toggleFavorite); const on = ids.includes(kind + '/' + id); return <button aria-label={on ? '取消收藏' : '加入收藏'} className="rounded-full border border-white/20 px-3 py-1 text-xs" onClick={e => { e.stopPropagation(); toggle(kind, id); }}>{on ? '★ 已收藏' : '☆ 收藏'}</button>; }
export function ExtraRating({ kind, id }: {
    kind: 'board' | 'reports';
    id: string;
}) { const ratings = useAppStore(s => s.extraRatings), set = useAppStore(s => s.setExtraRating), filter = useAppStore(s => s.ratingFilter); if (filter !== 2)
    return null; return <select aria-label="内容分级" className="rounded bg-slate-800 px-2 py-1 text-xs" value={ratings[kind + '/' + id] ?? 2} onChange={e => set(kind + '/' + id, Number(e.target.value) as ContentRating)}><option value="0">全年龄</option><option value="1">R15</option><option value="2">18+</option></select>; }
