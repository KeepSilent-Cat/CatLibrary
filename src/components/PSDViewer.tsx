import { convertFileSrc } from "@tauri-apps/api/core";
import { readPsd, type Layer, type Psd } from "ag-psd";
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  Download,
  Eye,
  EyeOff,
  FoldVertical,
  Layers,
  Loader2,
  RotateCcw,
  Trash2,
  UnfoldVertical,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from "react";

interface PSDViewerProps {
  psdPaths: string[];
  onDeletePsd?: (path: string) => void;
  onSetCover?: (pngData: number[]) => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "layer";
}

/** 统计叶子图层（有 canvas 的）总数与可见数 */
function countLayers(layers: Layer[]): { total: number; visible: number } {
  let total = 0;
  let visible = 0;
  for (const layer of layers) {
    if (layer.canvas) {
      total += 1;
      if (!layer.hidden) {
        visible += 1;
      }
    }
    if (layer.children && layer.children.length > 0) {
      const sub = countLayers(layer.children);
      total += sub.total;
      visible += sub.visible;
    }
  }
  return { total, visible };
}

/** 收集所有图层组的 path key（用于一键展开/收起） */
function collectGroupKeys(layers: Layer[], prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    const path = `${prefix}.${i}`;
    if (layer.children && layer.children.length > 0) {
      keys.push(path);
      keys.push(...collectGroupKeys(layer.children, path));
    }
  }
  return keys;
}

export default function PSDViewer({ psdPaths, onDeletePsd, onSetCover }: PSDViewerProps) {
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const psdRef = useRef<Psd | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [psdIndex, setPsdIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [coverCrop, setCoverCrop] = useState(false);
  const [cropSize, setCropSize] = useState({ w: 0, h: 0 });
  const [, setRenderTick] = useState(0);

  const currentPath = psdPaths[psdIndex] ?? "";

  // 绘制：children 是「底→顶」，正向遍历即底层先画、顶层后画覆盖
  const drawChildren = useCallback((ctx: CanvasRenderingContext2D, layers: Layer[]) => {
    for (const layer of layers) {
      if (layer.hidden) {
        continue;
      }
      if (layer.canvas) {
        // ag-psd 的 opacity 是 0~1 浮点数
        ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 1));
        ctx.drawImage(layer.canvas, layer.left ?? 0, layer.top ?? 0);
        ctx.globalAlpha = 1;
      }
      if (layer.children && layer.children.length > 0) {
        drawChildren(ctx, layer.children);
      }
    }
  }, []);

  const render = useCallback(() => {
    const canvas = displayRef.current;
    const psd = psdRef.current;
    if (!canvas || !psd) {
      return;
    }
    canvas.width = psd.width;
    canvas.height = psd.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawChildren(ctx, psd.children ?? []);
  }, [drawChildren]);

  useEffect(() => {
    let disposed = false;

    if (!currentPath) {
      setFileName("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    async function load() {
      try {
        const url = convertFileSrc(currentPath);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`读取失败：HTTP ${res.status}`);
        }
        const buffer = await res.arrayBuffer();
        const psd = readPsd(buffer);
        psdRef.current = psd;
        if (!disposed) {
          setFileName(baseName(currentPath));
          setCollapsedKeys(new Set());
          setLoading(false);
          setScale(1);
          setPan({ x: 0, y: 0 });
          panRef.current = { x: 0, y: 0 };
          setRenderTick((tick) => tick + 1);
          render();
        }
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  useEffect(() => {
    render();
  }, [render]);

  // 计算 5:6 裁剪框尺寸（跟随视口大小）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const update = () => {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const cw = Math.min(vw * 0.85, (vh * 0.85 * 5) / 6);
      setCropSize({ w: Math.round(cw), h: Math.round((cw * 6) / 5) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const toggleLayer = useCallback(
    (layer: Layer) => {
      const target = !layer.hidden;
      const apply = (current: Layer) => {
        current.hidden = target;
        if (current.children) {
          for (const child of current.children) {
            apply(child);
          }
        }
      };
      apply(layer);
      setRenderTick((tick) => tick + 1);
      render();
    },
    [render],
  );

  const setAllLayers = useCallback(
    (visible: boolean) => {
      const psd = psdRef.current;
      if (!psd) {
        return;
      }
      const apply = (layer: Layer) => {
        layer.hidden = !visible;
        if (layer.children) {
          for (const child of layer.children) {
            apply(child);
          }
        }
      };
      for (const child of psd.children ?? []) {
        apply(child);
      }
      setRenderTick((tick) => tick + 1);
      render();
    },
    [render],
  );

  const toggleCollapse = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => {
    setCollapsedKeys(new Set());
  }, []);

  const collapseAllGroups = useCallback(() => {
    const psd = psdRef.current;
    if (!psd) {
      return;
    }
    setCollapsedKeys(new Set(collectGroupKeys(psd.children ?? [], "r")));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
  }, []);

  const handleDelete = useCallback(() => {
    if (!onDeletePsd || !currentPath) {
      return;
    }
    const label = fileName || baseName(currentPath);
    if (window.confirm(`确定删除「${label}」吗？此操作不可恢复。`)) {
      onDeletePsd(currentPath);
    }
  }, [onDeletePsd, currentPath, fileName]);

  const setAsCover = useCallback(() => {
    const canvas = displayRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || !onSetCover) {
      return;
    }
    const cw = cropSize.w;
    const ch = cropSize.h;
    if (!cw || !ch) {
      return;
    }
    // 用画布实际渲染位置（含 transform）计算裁剪框对应的像素区域
    const canvasRect = canvas.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();
    const cropLeft = vpRect.left + (vpRect.width - cw) / 2;
    const cropTop = vpRect.top + (vpRect.height - ch) / 2;
    const sx = ((cropLeft - canvasRect.left) * canvas.width) / canvasRect.width;
    const sy = ((cropTop - canvasRect.top) * canvas.height) / canvasRect.height;
    const sw = (cw * canvas.width) / canvasRect.width;
    const sh = (ch * canvas.height) / canvasRect.height;
    // 精确 5:6 输出，透明区域保持透明
    const outW = 1000;
    const outH = 1200;
    const output = document.createElement("canvas");
    output.width = outW;
    output.height = outH;
    const ctx = output.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH);
    output.toBlob(async (blob) => {
      if (!blob) {
        return;
      }
      const buffer = await blob.arrayBuffer();
      onSetCover(Array.from(new Uint8Array(buffer)));
    }, "image/png");
  }, [onSetCover, cropSize]);

  const exportLayer = useCallback((layer: Layer) => {
    if (!layer.canvas) {
      return;
    }
    layer.canvas.toBlob((blob) => {
      if (!blob) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${sanitizeFilename(layer.name || "layer")}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, []);

  // 画布缩放/平移：Ctrl+滚轮缩放，按住拖拽平移
  const onWheel = useCallback(
    (event: ReactWheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = Math.min(8, Math.max(0.05, scale * factor));
      const ratio = nextScale / scale;
      const nextPan = {
        x: mouseX - cx - (mouseX - cx - pan.x) * ratio,
        y: mouseY - cy - (mouseY - cy - pan.y) * ratio,
      };
      setScale(nextScale);
      setPan(nextPan);
      panRef.current = nextPan;
    },
    [scale, pan],
  );

  const onMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      setIsDragging(true);
    },
    [],
  );

  const onMouseMove = useCallback((event: ReactMouseEvent) => {
    if (!dragRef.current) {
      return;
    }
    const nextPan = {
      x: dragRef.current.panX + (event.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (event.clientY - dragRef.current.startY),
    };
    setPan(nextPan);
    panRef.current = nextPan;
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // 递归渲染图层树（反向遍历：顶层显示在最上面，与 Photoshop 面板一致）
  const renderLayerRows = (layers: Layer[], depth: number, pathPrefix: string): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      const path = `${pathPrefix}.${i}`;
      const isGroup = !!(layer.children && layer.children.length > 0);
      const isCollapsed = collapsedKeys.has(path);
      rows.push(
        <div key={path}>
          <div
            className="group flex items-center gap-1 rounded-[10px] py-1 pr-1.5 transition hover:bg-white/8"
            style={{ paddingLeft: `${4 + depth * 14}px` }}
          >
            {isGroup ? (
              <button
                type="button"
                onClick={() => toggleCollapse(path)}
                title={isCollapsed ? "展开组" : "收起组"}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/55 transition hover:bg-white/14 hover:text-white"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => toggleLayer(layer)}
              title={layer.hidden ? "显示图层" : "隐藏图层"}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/60 transition hover:bg-white/14 hover:text-white"
            >
              {layer.hidden ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            <span
              className={`min-w-0 flex-1 truncate text-xs ${
                layer.hidden ? "text-white/35" : "text-white/78"
              } ${isGroup ? "font-medium" : ""}`}
            >
              {layer.name || "图层"}
            </span>
            {!isGroup && layer.canvas ? (
              <button
                type="button"
                onClick={() => exportLayer(layer)}
                title="导出此图层为 PNG"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/40 opacity-0 transition hover:bg-white/14 hover:text-white group-hover:opacity-100"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {isGroup && !isCollapsed ? (
            <div>{renderLayerRows(layer.children!, depth + 1, path)}</div>
          ) : null}
        </div>,
      );
    }
    return rows;
  };

  const layerStats = useMemo(
    () => (psdRef.current ? countLayers(psdRef.current.children ?? []) : { total: 0, visible: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPath, collapsedKeys, loading],
  );

  return (
    <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-[24px] border border-white/12 bg-black/24">
      {/* 工具栏：文件名切换（箭头）+ 面板开关 + 全显/全隐 + 展开/收起 + 删除 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-3 py-2">
        {psdPaths.length > 1 ? (
          <button
            type="button"
            onClick={() => setPsdIndex((value) => (value - 1 + psdPaths.length) % psdPaths.length)}
            title="上一个 PSD"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/16 bg-white/8 text-white/70 transition hover:bg-white/16"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">
          {fileName || "未选择 PSD"}
          {psdPaths.length > 1 ? `（${psdIndex + 1}/${psdPaths.length}）` : ""}
        </p>
        {psdPaths.length > 1 ? (
          <button
            type="button"
            onClick={() => setPsdIndex((value) => (value + 1) % psdPaths.length)}
            title="下一个 PSD"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/16 bg-white/8 text-white/70 transition hover:bg-white/16"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setLayersPanelOpen((value) => !value)}
          title={layersPanelOpen ? "收起图层面板" : "展开图层面板"}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
            layersPanelOpen
              ? "border-sky-300/40 bg-sky-300/20 text-sky-50"
              : "border-white/16 bg-white/8 text-white/70 hover:bg-white/16"
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
        </button>
        <span className="shrink-0 text-[11px] text-white/45">
          {layerStats.visible}/{layerStats.total} 层
        </span>
        <button
          type="button"
          onClick={() => setAllLayers(true)}
          title="显示全部图层"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-white/16 bg-white/8 px-2.5 text-[11px] text-white/70 transition hover:bg-white/16"
        >
          <Eye className="h-3 w-3" />
          全显
        </button>
        <button
          type="button"
          onClick={() => setAllLayers(false)}
          title="隐藏全部图层"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-white/16 bg-white/8 px-2.5 text-[11px] text-white/70 transition hover:bg-white/16"
        >
          <EyeOff className="h-3 w-3" />
          全隐
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-white/45">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={resetView}
          title="重置缩放与位置"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/16 bg-white/8 text-white/70 transition hover:bg-white/16"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setCoverCrop((value) => !value)}
          title={coverCrop ? "隐藏 5:6 封面裁剪框" : "显示 5:6 封面裁剪框"}
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
            coverCrop
              ? "border-emerald-300/40 bg-emerald-300/20 text-emerald-50"
              : "border-white/16 bg-white/8 text-white/70 hover:bg-white/16"
          }`}
        >
          <Crop className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={setAsCover}
          disabled={!onSetCover || !psdRef.current}
          title="将 5:6 裁剪框内的内容设为封面"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-300/15 px-2.5 text-[11px] font-medium text-emerald-100 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Camera className="h-3 w-3" />
          设封面
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!onDeletePsd || !currentPath}
          title="删除当前 PSD"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-rose-300/30 bg-rose-300/10 text-rose-200 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 图层面板 */}
        {layersPanelOpen ? (
          <div className="flex w-64 shrink-0 flex-col border-r border-white/10">
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
              <span className="flex-1 text-[11px] text-white/45">图层</span>
              <button
                type="button"
                onClick={expandAllGroups}
                title="展开所有图层组"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-white/55 transition hover:bg-white/14 hover:text-white"
              >
                <UnfoldVertical className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={collapseAllGroups}
                title="收起所有图层组"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-white/55 transition hover:bg-white/14 hover:text-white"
              >
                <FoldVertical className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
              {psdRef.current ? renderLayerRows(psdRef.current.children ?? [], 0, "r") : null}
              {!loading && !psdRef.current ? (
                <p className="px-2 py-4 text-xs text-white/40">
                  没有图层（可能是单层 PSD 或解析失败）
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 预览画布：Ctrl+滚轮缩放，按住拖拽平移 */}
        <div
          ref={viewportRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <canvas
            ref={displayRef}
            className="max-h-full max-w-full rounded-[12px]"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: "center center",
              cursor: isDragging ? "grabbing" : "grab",
            }}
          />
          {coverCrop && cropSize.w > 0 && !loading && !error ? (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{
                width: cropSize.w,
                height: cropSize.h,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                border: "2px solid rgba(255,255,255,0.85)",
                borderRadius: 10,
              }}
            />
          ) : null}
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 text-sm text-white/70">
              <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
              正在解析 PSD…
            </div>
          ) : null}
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm text-rose-200">PSD 加载失败</p>
              <p className="max-w-full break-all text-xs leading-5 text-white/50">{error}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
