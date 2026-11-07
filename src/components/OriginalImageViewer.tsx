import { Maximize2, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface OriginalImageViewerProps {
  open: boolean;
  /** 原图地址（必须传原图，不要传缩略图） */
  src?: string;
  title?: string;
  onClose: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 12;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * 全屏原图查看器：铺满窗口显示未经压缩的原图，支持滚轮缩放、拖拽平移、
 * 一键 1:1（按原始像素显示）与适应屏幕。ESC 关闭。
 */
export default function OriginalImageViewer({
  open,
  src,
  title,
  onClose,
}: OriginalImageViewerProps) {
  // 1 表示“适应屏幕”，大于 1 为放大；实际像素比由 1:1 按钮按原图尺寸换算
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 每次打开或换图都回到适应屏幕，避免沿用上一张的缩放位置
  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open, src, reset]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        setScale((current) => clampScale(current * 1.25));
      } else if (event.key === "-") {
        setScale((current) => clampScale(current / 1.25));
      } else if (event.key === "0") {
        reset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, reset]);

  // React 的 onWheel 是被动监听，无法阻止页面滚动，这里手动挂非被动监听
  useEffect(() => {
    const element = containerRef.current;
    if (!open || !element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale((current) => clampScale(current * Math.exp(-event.deltaY * 0.0015)));
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [open]);

  if (!open || !src) {
    return null;
  }

  // 1:1 = 让图片按原始像素显示：原图宽 / 当前布局宽（offsetWidth 不含 transform）
  const showActualSize = () => {
    const image = imageRef.current;
    if (!image || !image.offsetWidth) {
      setScale(1);
      return;
    }
    setScale(clampScale(image.naturalWidth / image.offsetWidth));
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      // 挂到 body 后 DOM 上已经脱离卡片，但 React 事件仍会沿组件树冒泡到卡片，
      // 必须在这里截断，否则关闭/点击会被卡片当成“单/双击”从而打开详情页。
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed inset-0 z-[100] flex flex-col bg-black/94 backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white/90">{title ?? "原图"}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-white/42">
            原图
            {natural ? ` · ${natural.width} × ${natural.height}` : ""}
            {` · ${Math.round(scale * 100)}%`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title="缩小"
            onClick={() => setScale((current) => clampScale(current / 1.25))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/16 bg-white/6 text-white/76 transition hover:bg-white/14 hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="放大"
            onClick={() => setScale((current) => clampScale(current * 1.25))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/16 bg-white/6 text-white/76 transition hover:bg-white/14 hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="按原始像素显示（1:1）"
            onClick={showActualSize}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/16 bg-white/6 px-3 text-xs text-white/76 transition hover:bg-white/14 hover:text-white"
          >
            <Scan className="h-3.5 w-3.5" />
            1:1
          </button>
          <button
            type="button"
            title="适应屏幕（0）"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/16 bg-white/6 px-3 text-xs text-white/76 transition hover:bg-white/14 hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            适应
          </button>
          <button
            type="button"
            title="关闭（ESC）"
            onClick={onClose}
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/18 bg-white/8 text-white/76 transition hover:bg-white/16 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={showActualSize}
        className={cn(
          "relative min-h-0 flex-1 touch-none select-none overflow-hidden",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <img
          ref={imageRef}
          src={src}
          alt={title ?? ""}
          draggable={false}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={{
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
          }}
          className="pointer-events-none absolute left-1/2 top-1/2 max-h-full max-w-full object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}
