import { create } from "zustand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import MusicPlayer, { type MusicPlayerProps } from "./MusicPlayer";
import { useAppStore } from "@/store/useAppStore";

interface Session {
  props: MusicPlayerProps | null;
  rating: number;
  albumId: string;
  dock: HTMLElement | null;
  set: (props: MusicPlayerProps, rating: number, albumId: string) => void;
  attach: (dock: HTMLElement | null) => void;
  stop: () => void;
}
const useMusicSession = create<Session>(set => ({
  props: null, rating: 2, albumId: "", dock: null,
  set: (props, rating, albumId) => set({ props, rating, albumId }),
  attach: dock => set({ dock }),
  stop: () => set({ props: null }),
}));
let sharedHost: HTMLDivElement | null = null;
let floatingDock: HTMLDivElement | null = null;

/** Portal容器始终相同；只移动其DOM位置，保留audio与播放状态。 */
function moveHost(target: HTMLElement | null) {
  const host = sharedHost;
  if (!host || !target || host.parentElement === target) return;
  const audio = host.querySelector("audio");
  const wasPlaying = !!audio && !audio.paused;
  const parent = target as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
  if (parent.moveBefore && host.isConnected && parent.isConnected) parent.moveBefore(host, null);
  else parent.appendChild(host);
  if (wasPlaying && audio) requestAnimationFrame(() => { if (audio.isConnected && audio.paused) void audio.play().catch(() => {}); });
}

export function MusicSession(props: MusicPlayerProps & { rating: number; albumId?: string }) {
  const dock = useRef<HTMLDivElement>(null);
  const set = useMusicSession(state => state.set);
  useLayoutEffect(() => {
    const element = dock.current;
    useMusicSession.getState().attach(element);
    return () => {
      if (useMusicSession.getState().dock === element) {
        moveHost(floatingDock);
        useMusicSession.getState().attach(null);
      }
    };
  }, []);
  useEffect(() => {
    if (!props.loadingTracks && props.tracks.length) set(props, props.rating, props.albumId ?? "");
  }, [props.tracks, props.coverImage, props.title, props.subtitle, props.summary, props.sourceCount, props.loadingTracks, props.rating, props.albumId, set]);
  return <div className="flex h-full min-h-[420px] flex-col">
    {props.loadingTracks && <p className="p-5 text-sm text-white/55">正在读取专辑…</p>}
    {!props.loadingTracks && !props.tracks.length && <p className="p-5 text-sm text-white/55">此专辑暂无可播放的曲目。</p>}
    <div ref={dock} aria-label="音乐详情播放器" className="min-h-0 flex-1" />
  </div>;
}

export default function PersistentMusic() {
  const { props, rating, dock, albumId, stop } = useMusicSession();
  const filter = useAppStore(state => state.ratingFilter);
  const [host] = useState(() => { const element = document.createElement("div"); element.className = "h-full w-full"; return element; });
  const float = useRef<HTMLDivElement>(null);
  const inline = !!dock;
  useLayoutEffect(() => {
    sharedHost = host;
    return () => { if (sharedHost === host) { sharedHost = null; floatingDock = null; } };
  }, [host]);
  useLayoutEffect(() => { floatingDock = float.current; if (props) moveHost(dock ?? float.current); }, [dock, props]);
  useEffect(() => { if (rating > filter) stop(); }, [filter, rating, stop]);
  if (!props || rating > filter) return null;
  return <>
    <section hidden={inline} aria-label="悬浮音乐播放器" className="glass-window fixed bottom-6 right-6 z-[60] w-[390px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[26px] border-white/25 bg-[rgba(40,34,51,0.86)] text-white shadow-[0_20px_70px_rgba(15,10,30,0.35)] backdrop-blur-2xl">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3"><a className="inline-flex items-center gap-1.5 text-[11px] text-white/55 transition hover:text-white" href={albumId ? `#/music/${encodeURIComponent(albumId)}` : "#/music"}><ArrowUpRight size={13} />返回专辑</a><button aria-label="停止并关闭音乐" onClick={stop} className="rounded-full p-1 text-white/45 transition hover:bg-white/10 hover:text-white"><X size={15} /></button></header>
      <div ref={float} />
    </section>
    {createPortal(<MusicPlayer {...props} compact={!inline} />, host)}
  </>;
}
