import { create } from 'zustand';
import { useEffect } from 'react';
import MusicPlayer, { type MusicPlayerProps } from './MusicPlayer';
import { useAppStore } from '@/store/useAppStore';
interface Session {
    props: MusicPlayerProps | null;
    expanded: boolean;
    rating: number;
    set: (props: MusicPlayerProps, rating: number) => void;
    expand: (value: boolean) => void;
    stop: () => void;
}
const useMusicSession = create<Session>(set => ({ props: null, expanded: false, rating: 2, set: (props, rating) => set({ props, rating }), expand: expanded => set({ expanded }), stop: () => set({ props: null }) }));
export function MusicSession(props: MusicPlayerProps & {
    rating: number;
}) { const set = useMusicSession(s => s.set); const expand = useMusicSession(s => s.expand); useEffect(() => { if (!props.loadingTracks && props.tracks.length)
    set(props, props.rating); }, [props.tracks, props.coverImage, props.title, props.loadingTracks, props.rating, set]); return <button className="rounded-2xl border border-white/20 p-6" onClick={() => expand(true)}>打开音乐播放器 · 离开此页仍会播放</button>; }
export default function PersistentMusic() { const { props, expanded, rating, expand, stop } = useMusicSession(); const filter = useAppStore(s => s.ratingFilter); useEffect(() => { if (rating > filter)
    stop(); }, [filter, rating, stop]); if (!props || rating > filter)
    return null; return <section aria-label="持续音乐播放器" className={expanded ? 'fixed inset-16 z-[60] flex flex-col rounded-3xl bg-slate-950 p-4 shadow-2xl' : 'fixed bottom-5 right-5 z-[60] w-80 rounded-3xl bg-slate-950/95 p-3 shadow-2xl'}><header className="mb-2 flex justify-between gap-3 text-xs"><button onClick={() => expand(!expanded)}>{expanded ? '收起为悬浮播放器' : '展开播放器'}</button><button onClick={stop}>停止并关闭</button></header><div className="min-h-0 flex-1"><MusicPlayer {...props} compact={!expanded}/></div></section>; }
