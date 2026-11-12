import { create } from "zustand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronDown, ChevronUp, GripHorizontal, Play, X } from "lucide-react";
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
  const session = useMusicSession();
  const albumKey = props.albumId ?? props.title;
  const ownsPlayer = !session.props || session.albumId === albumKey;
  useLayoutEffect(() => {
    if (!ownsPlayer) return;
    const element = dock.current;
    useMusicSession.getState().attach(element);
    return () => {
      if (useMusicSession.getState().dock === element) {
        moveHost(floatingDock);
        useMusicSession.getState().attach(null);
      }
    };
  }, [ownsPlayer]);
  useEffect(() => {
    if (ownsPlayer && !props.loadingTracks && props.tracks.length) set(props, props.rating, albumKey);
  }, [props.tracks, props.coverImage, props.title, props.subtitle, props.summary, props.sourceCount, props.loadingTracks, props.rating, props.albumId, ownsPlayer, set]);
  return <div className="flex h-full min-h-[420px] flex-col">
    {props.loadingTracks && <p className="p-5 text-sm text-white/55">正在读取专辑…</p>}
    {!props.loadingTracks && !props.tracks.length && <p className="p-5 text-sm text-white/55">此专辑暂无可播放的曲目。</p>}
    {!ownsPlayer && <div className="rounded-[30px] border border-white/15 bg-black/15 p-7">
      <div className="flex items-center gap-5">{props.coverImage && <img src={props.coverImage} alt="" className="h-24 w-24 rounded-2xl object-cover"/>}<div><h2 className="text-xl font-semibold">{props.title}</h2><p className="mt-2 text-xs text-white/55">正在继续播放「{session.props?.title}」，浏览此专辑不会打断音乐。</p></div></div>
      <button disabled={props.loadingTracks || !props.tracks.length} onClick={() => set({...props, autoPlay: true}, props.rating, albumKey)} className="mt-6 inline-flex items-center gap-2 rounded-full border border-sky-100/25 bg-white/10 px-5 py-3 text-sm hover:bg-white/20"><Play size={15}/>切换到此专辑播放</button>
      <ul className="mt-6 space-y-2 text-sm text-white/60">{props.tracks.map(track => <li key={track.path} className="rounded-xl bg-white/5 px-4 py-3">{track.name}</li>)}</ul>
    </div>}
    <div ref={dock} aria-label="音乐详情播放器" className={ownsPlayer ? "min-h-0 flex-1" : "hidden"} />
  </div>;
}

export default function PersistentMusic() {
  const { props, rating, dock, albumId, stop } = useMusicSession();
  const filter = useAppStore(state => state.ratingFilter);
  const [host] = useState(() => { const element = document.createElement("div"); element.className = "h-full w-full"; return element; });
  const float = useRef<HTMLDivElement>(null);
  const inline = !!dock;
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState<{x:number;y:number}|null>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const constrain = (x:number,y:number) => {
    const rect = panel.current?.getBoundingClientRect();
    return {x:Math.max(8,Math.min(x,innerWidth-(rect?.width ?? 280)-8)),y:Math.max(8,Math.min(y,innerHeight-(rect?.height ?? 160)-8))};
  };
  useEffect(() => {
    const fit = () => setPosition(p => p ? constrain(p.x,p.y) : p);
    window.addEventListener('resize',fit);return () => window.removeEventListener('resize',fit);
  }, []);
  useLayoutEffect(() => {setPosition(p => p ? constrain(p.x,p.y) : p);},[collapsed,inline]);
  useLayoutEffect(() => {
    sharedHost = host;
    return () => { if (sharedHost === host) { sharedHost = null; floatingDock = null; } };
  }, [host]);
  useLayoutEffect(() => { floatingDock = float.current; if (props) moveHost(dock ?? float.current); }, [dock, props]);
  useEffect(() => { if (rating > filter) stop(); }, [filter, rating, stop]);
  if (!props || rating > filter) return null;
  return <>
    <section ref={panel} style={position ? {left:position.x,top:position.y,right:'auto',bottom:'auto'} : undefined} hidden={inline} aria-label="悬浮音乐播放器" className={`glass-window fixed bottom-6 right-6 z-[60] ${collapsed?'w-[250px]':'w-[390px]'} max-w-[calc(100vw-40px)] overflow-hidden rounded-[26px] border-white/25 bg-[rgba(40,34,51,0.86)] text-white shadow-[0_20px_70px_rgba(15,10,30,0.35)] backdrop-blur-2xl`}>
      <header className="flex touch-none select-none items-center justify-between gap-2 border-b border-white/10 px-4 py-3" onPointerDown={e => {
        if(e.button!==0 || (e.target as HTMLElement).closest('button,a')) return;
        const rect=panel.current!.getBoundingClientRect();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e => {const d=drag.current;if(d?.id===e.pointerId)setPosition(constrain(d.left+e.clientX-d.x,d.top+e.clientY-d.y));}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-white/55"><GripHorizontal size={15} className="cursor-grab"/><a className="truncate hover:text-white" href={albumId ? `#/music/${encodeURIComponent(albumId)}` : "#/music"}>{collapsed?props.title:<><ArrowUpRight size={12} className="mr-1 inline"/>返回专辑</>}</a></span>
        <span className="flex shrink-0 items-center gap-1"><button aria-label={collapsed?'展开音乐播放器':'收起音乐播放器'} onClick={()=>setCollapsed(v=>!v)} className="rounded-full p-1 text-white/55 hover:bg-white/10">{collapsed?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button><button aria-label="停止并关闭音乐" onClick={stop} className="rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white"><X size={15}/></button></span>
      </header>
      <div ref={float} hidden={collapsed && !inline} />
    </section>
    {createPortal(<MusicPlayer key={albumId} {...props} compact={!inline} />, host)}
  </>;
}
