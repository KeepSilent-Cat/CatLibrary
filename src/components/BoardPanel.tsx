import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  ImageIcon,
  BookOpen,
  BookText,
  Camera,
  Music,
  Pause,
  Play,
  PlaySquare,
  Sparkles,
  Type,
  Newspaper,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { categoryMeta, type CategoryKey, type LibraryItem } from "@/data/library";
import type { BoardPanel as BoardPanelData, BoardTextStyle } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-white/40">{text}</div>
  );
}

/* ---------- 视频面板 ---------- */
function BoardVideo({ item }: { item: LibraryItem }) {
  if (!item.previewMedia) {
    return <EmptyHint text="该视频组没有可预览的媒体" />;
  }
  return (
    <video
      src={item.previewMedia}
      controls
      autoPlay
      muted
      playsInline
      className="h-full w-full bg-black object-contain"
    />
  );
}

/* ---------- 图片 / 截图 面板（轮播 + 自动播放） ---------- */
function BoardCarousel({ item }: { item: LibraryItem }) {
  const frames =
    item.previewImages.length > 0
      ? item.previewImages
      : item.coverImage
        ? [item.coverImage]
        : [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || frames.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % frames.length);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  useEffect(() => {
    setIndex(0);
  }, [item.id]);

  if (frames.length === 0) {
    return <EmptyHint text="没有可展示的图片" />;
  }

  return (
    <div className="relative h-full w-full bg-black/40">
      <img src={frames[index]} alt={item.title} className="h-full w-full object-contain" />
      {frames.length > 1 ? (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-white/90 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setIndex((current) => (current - 1 + frames.length) % frames.length)}
            className="rounded-full p-1 transition hover:bg-white/20"
            title="上一张"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="rounded-full p-1 transition hover:bg-white/20"
            title={playing ? "暂停自动播放" : "自动播放"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setIndex((current) => (current + 1) % frames.length)}
            className="rounded-full p-1 transition hover:bg-white/20"
            title="下一张"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="px-1 text-[11px] tabular-nums">
            {index + 1} / {frames.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 游戏面板（封面 + 简介） ---------- */
function BoardGame({ item }: { item: LibraryItem }) {
  return (
    <div className="h-full w-full overflow-y-auto">
      {item.coverImage ? (
        <img src={item.coverImage} alt={item.title} className="w-full object-contain" />
      ) : null}
      {item.summary ? (
        <div className="p-3 text-sm leading-6 text-white/78">{item.summary}</div>
      ) : null}
    </div>
  );
}

/* ---------- 漫画面板（章节 + 自动滚屏） ---------- */
interface ComicChapter {
  name: string;
  images: string[];
}

function BoardComic({ resourceRoot, groupId }: { resourceRoot: string; groupId: string }) {
  const [chapters, setChapters] = useState<ComicChapter[]>([]);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<{ chapters: ComicChapter[] }>("scan_comic_pages", { resourceRoot, groupId })
      .then((result) => {
        if (!cancelled) {
          setChapters(result.chapters);
          setActive(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChapters([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceRoot, groupId]);

  // 自动滚屏：rAF 按速度滚到底后停在底部（手动滚会暂停）
  useEffect(() => {
    if (!playing) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const el = scrollRef.current;
      if (el && el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
        el.scrollTop += speed * dt;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  // 切章回顶
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [active]);

  if (loading) {
    return <EmptyHint text="读取漫画…" />;
  }
  if (chapters.length === 0) {
    return <EmptyHint text="这本漫画没有可读章节" />;
  }

  const current = chapters[Math.min(active, chapters.length - 1)];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1.5">
        <select
          value={active}
          onChange={(event) => setActive(Number(event.target.value))}
          className="min-w-0 flex-1 rounded-[8px] border border-white/14 bg-black/25 px-2 py-1 text-xs text-white outline-none focus:border-sky-300/50"
        >
          {chapters.map((chapter, index) => (
            <option key={chapter.name} value={index} className="bg-slate-900 text-white">
              {chapter.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition",
            playing
              ? "border-sky-300/45 bg-sky-300/20 text-sky-50"
              : "border-white/14 bg-white/6 text-white/70 hover:bg-white/14",
          )}
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? "暂停" : "自动滚屏"}
        </button>
        <input
          type="range"
          min={100}
          max={1200}
          step={100}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          className="w-16"
          title={`速度 ${speed}px/s`}
        />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-black/30">
        {current.images.map((path) => (
          <img key={path} src={convertFileSrc(path)} alt="" loading="lazy" className="w-full" />
        ))}
      </div>
    </div>
  );
}

/* ---------- 面板框架 ---------- */
const categoryIcon: Record<CategoryKey, typeof ImageIcon> = {
  images: ImageIcon,
  videos: PlaySquare,
  games: Gamepad2,
  comics: BookOpen,
  screenshots: Camera,
  music: Music,
  live2d: Sparkles,
  novels: BookText,
};

/* ---------- 文字面板 ---------- */
function TextPanelBody({
  panel,
  onChange,
  onStyleChange,
}: {
  panel: BoardPanelData;
  onChange: (value: string) => void;
  onStyleChange: (style: BoardTextStyle) => void;
}) {
  const textClass =
    panel.textStyle === "title"
      ? "text-xl font-bold leading-snug"
      : panel.textStyle === "subtitle"
        ? "text-base font-semibold leading-snug"
        : "text-xs leading-5";

  return (
    <div className="flex h-full flex-col">
      <textarea
        value={panel.text ?? ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="写点标题 / 注释…"
        className={`min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-white/90 outline-none placeholder:text-white/25 ${textClass}`}
      />
      <div className="flex shrink-0 items-center gap-1 border-t border-white/8 px-2 py-1">
        {(
          [
            ["title", "标题"],
            ["subtitle", "小标题"],
            ["caption", "注释"],
          ] as Array<[BoardTextStyle, string]>
        ).map(([style, text]) => (
          <button
            key={style}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onStyleChange(style)}
            className={`rounded-full px-2 py-0.5 text-[10px] transition ${
              (panel.textStyle ?? "caption") === style
                ? "bg-sky-300/22 text-sky-100"
                : "text-white/45 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 报道面板 ---------- */
function ReportPanelBody({
  report,
  onOpen,
}: {
  report?: { id: string; title: string; cover?: string; blockCount?: number };
  onOpen: () => void;
}) {
  if (!report) {
    return <EmptyHint text="该报道已不存在" />;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col gap-2 p-3 text-left transition hover:bg-white/6"
    >
      {report.cover ? (
        <img src={report.cover} alt="" className="h-24 w-full rounded-[10px] object-cover" />
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-[10px] bg-black/30">
          <Newspaper className="h-6 w-6 text-white/30" />
        </div>
      )}
      <span className="w-full truncate text-sm font-medium text-white">{report.title || "未命名报道"}</span>
      <span className="text-[11px] text-white/45">{report.blockCount ?? 0} 个块 · 点击打开</span>
    </button>
  );
}

export default function BoardPanel({
  panel,
  item,
  report,
  resourceRoot,
  onRemove,
  onMove,
  onResize,
  onTextChange,
  onTextStyleChange,
  onOpenReport,
}: {
  panel: BoardPanelData;
  item: LibraryItem | undefined;
  report?: { id: string; title: string; subtitle?: string; blocks: unknown[]; cover?: string };
  resourceRoot: string;
  onRemove: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onTextChange: (id: string, text: string) => void;
  onTextStyleChange: (id: string, style: BoardTextStyle) => void;
  onOpenReport: (id: string) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; ow: number; oh: number } | null>(null);
  const isText = panel.kind === "text";
  const isReport = panel.kind === "report";
  const Icon = isText ? Type : isReport ? Newspaper : (categoryIcon[panel.category as CategoryKey] ?? ImageIcon);
  const label = isText ? "文字" : isReport ? "报道" : (categoryMeta.find((meta) => meta.key === panel.category)?.title ?? panel.category ?? "");

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, ox: panel.x, oy: panel.y };
  };
  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    onMove(panel.id, drag.ox + (event.clientX - drag.startX), drag.oy + (event.clientY - drag.startY));
  };
  const onHeaderPointerUp = () => {
    dragRef.current = null;
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizeRef.current = { startX: event.clientX, startY: event.clientY, ow: panel.w, oh: panel.h };
  };
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) {
      return;
    }
    onResize(
      panel.id,
      Math.max(220, resize.ow + (event.clientX - resize.startX)),
      Math.max(160, resize.oh + (event.clientY - resize.startY)),
    );
  };
  const onResizePointerUp = () => {
    resizeRef.current = null;
  };

  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-[16px] border border-white/16 bg-slate-900/90 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
      style={{ left: panel.x, top: panel.y, width: panel.w, height: panel.h }}
    >
      <div
        className="flex shrink-0 cursor-move items-center gap-2 border-b border-white/10 bg-white/6 px-3 py-2"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/50" />
        <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/86">
          {isText
            ? panel.textStyle === "title"
              ? "标题"
              : panel.textStyle === "subtitle"
                ? "小标题"
                : "注释"
            : isReport
              ? (report?.title ?? "报道已删除")
              : (item?.title ?? "已失效的素材")}
        </span>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRemove(panel.id)}
          className="rounded-full p-1 text-white/60 transition hover:bg-white/14 hover:text-white"
          title="移除面板"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {isText ? (
          <TextPanelBody
            panel={panel}
            onChange={(value) => onTextChange(panel.id, value)}
            onStyleChange={(style) => onTextStyleChange(panel.id, style)}
          />
        ) : isReport ? (
          <ReportPanelBody
            report={
              report
                ? {
                    id: report.id,
                    title: report.title,
                    cover: report.cover,
                    blockCount: report.blocks.length,
                  }
                : undefined
            }
            onOpen={() => panel.itemId && onOpenReport(panel.itemId)}
          />
        ) : !item ? (
          <EmptyHint text="该素材已不存在" />
        ) : panel.category === "videos" ? (
          <BoardVideo item={item} />
        ) : panel.category === "comics" ? (
          <BoardComic resourceRoot={resourceRoot} groupId={item.id} />
        ) : panel.category === "games" ? (
          <BoardGame item={item} />
        ) : (
          <BoardCarousel item={item} />
        )}
      </div>

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        title="拖拽调整大小"
      >
        <div className="absolute bottom-1 right-1 h-2 w-2 rounded-[2px] border-b-2 border-r-2 border-white/30" />
      </div>
    </div>
  );
}
