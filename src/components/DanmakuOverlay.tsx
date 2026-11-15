import { useEffect, useRef } from "react";

export type DanmakuItem = {
  time: number;
  mode: number;
  size: number;
  color: string;
  text: string;
};

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  items: DanmakuItem[];
  enabled: boolean;
  opacity: number;
  fontSize: number;
  speed: number;
  /** 弹幕占用画面高度的比例（0.25~1），默认只用上部三分之一 */
  area?: number;
};

/**
 * 弹幕层：完全基于 video.currentTime 做时钟，暂停/拖动都会跟着走。
 * 用 requestAnimationFrame 手动定位，才能做到暂停即静止、拖动即重排。
 */
export default function DanmakuOverlay({ videoRef, items, enabled, opacity, fontSize, speed, area = 0.34 }: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const video = videoRef.current;
    if (!layer || !video) {
      return;
    }
    layer.replaceChildren();
    if (!enabled || items.length === 0) {
      return;
    }

    const rowHeight = Math.round(fontSize * 1.75);
    let rows = 1;
    const laneFree: number[] = [];

    type Active = {
      node: HTMLSpanElement;
      startTime: number;
      duration: number;
      width: number;
      lane: number;
      scroll: boolean;
    };
    const active: Active[] = [];
    let pointer = 0;
    let lastTime = -1;

    const measure = () => {
      // 只在上部这块区域里排弹幕，避免铺满整屏挡画面
      const usable = Math.max(rowHeight, layer.clientHeight * Math.min(1, Math.max(0.2, area)));
      rows = Math.max(1, Math.min(16, Math.floor(usable / rowHeight)));
      laneFree.length = 0;
      for (let index = 0; index < rows; index += 1) {
        laneFree.push(0);
      }
    };
    measure();

    const clearance = { width: layer.clientWidth, height: layer.clientHeight };
    const resize = () => {
      clearance.width = layer.clientWidth;
      clearance.height = layer.clientHeight;
      measure();
    };
    window.addEventListener("resize", resize);

    const seekTo = (time: number) => {
      // 二分找到第一个不早于 time 的弹幕
      let low = 0;
      let high = items.length - 1;
      let found = items.length;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (items[mid].time >= time - 0.25) {
          found = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      pointer = found;
    };
    seekTo(video.currentTime);

    const clearActive = () => {
      for (const entry of active) {
        entry.node.remove();
      }
      active.length = 0;
    };

    const spawn = (item: DanmakuItem, now: number) => {
      const lane = pickLane(item.mode);
      if (lane < 0) {
        return;
      }
      const node = document.createElement("span");
      node.textContent = item.text;
      node.style.position = "absolute";
      node.style.whiteSpace = "pre";
      node.style.willChange = "transform";
      node.style.fontSize = `${Math.round(fontSize * (item.size / 25))}px`;
      node.style.fontWeight = "600";
      node.style.color = item.color === "#ffffff" ? "#ffffff" : item.color;
      node.style.textShadow = "0 1px 2px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)";
      node.style.left = "0";
      node.style.top = `${lane * rowHeight + 4}px`;
      node.style.pointerEvents = "none";
      layer.appendChild(node);

      const width = node.getBoundingClientRect().width || item.text.length * fontSize;
      const scroll = item.mode !== 4 && item.mode !== 5;
      const duration = scroll
        ? Math.max(4, (clearance.width + width) / Math.max(40, 140 * speed))
        : 4;
      node.style.transform = `translateX(${clearance.width}px)`;
      node.style.opacity = item.mode === 4 || item.mode === 5 ? "0" : "1";

      active.push({ node, startTime: now, duration, width, lane, scroll });
    };

    const pickLane = (mode: number): number => {
      const now = video.currentTime;
      if (mode === 5) {
        return 0; // 顶部
      }
      if (mode === 4) {
        return rows - 1; // 底部
      }
      let best = -1;
      let bestFree = Number.POSITIVE_INFINITY;
      for (let index = 1; index < rows; index += 1) {
        if (laneFree[index] <= now && laneFree[index] < bestFree) {
          best = index;
          bestFree = laneFree[index];
        }
      }
      if (best < 0) {
        return -1;
      }
      laneFree[best] = now + 1.2;
      return best;
    };

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = video.currentTime;
      const width = clearance.width;

      // 拖动进度条或跳转时重置
      if (lastTime >= 0 && Math.abs(now - lastTime) > 0.8) {
        clearActive();
        pointer = 0;
        seekTo(now);
        for (let index = 0; index < laneFree.length; index += 1) {
          laneFree[index] = 0;
        }
      }
      lastTime = now;

      // 补上到点该出现的弹幕（最多一次 12 条，避免密集处爆量）
      let spawned = 0;
      while (pointer < items.length && items[pointer].time <= now && spawned < 12) {
        if (items[pointer].time >= now - 1.5) {
          spawn(items[pointer], now);
          spawned += 1;
        }
        pointer += 1;
      }

      for (let index = active.length - 1; index >= 0; index -= 1) {
        const entry = active[index];
        const elapsed = now - entry.startTime;
        const progress = entry.duration > 0 ? elapsed / entry.duration : 1;
        if (progress >= 1 || progress < 0) {
          entry.node.remove();
          active.splice(index, 1);
          continue;
        }
        if (entry.scroll) {
          const x = width - progress * (width + entry.width);
          entry.node.style.transform = `translateX(${x}px)`;
        } else {
          entry.node.style.transform = `translateX(${(width - entry.width) / 2}px)`;
          entry.node.style.opacity = progress < 0.85 ? "1" : `${Math.max(0, (1 - progress) / 0.15)}`;
        }
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      clearActive();
      layer.replaceChildren();
    };
  }, [items, enabled, fontSize, speed, area, videoRef]);

  return (
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: enabled ? opacity : 0 }}
    />
  );
}
