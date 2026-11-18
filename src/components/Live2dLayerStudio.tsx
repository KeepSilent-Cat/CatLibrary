import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Move,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

type LayerEntry = {
  id: string;
  role: string;
  group: string;
  file: string;
  path: string;
  offset: [number, number];
  hidden: boolean;
};

type LayerManifest = { canvasW: number; canvasH: number; layers: LayerEntry[] };

type LoadedLayer = LayerEntry & { image: HTMLImageElement; order: number };

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

/**
 * 图层比对工作台：像 PS 一样把分层 PNG 叠起来看，
 * 选中某一层时自动算出「被上层遮住的区域」并用红色呼吸遮罩标出来。
 */
export default function Live2dLayerStudio({ groupId, title, onClose }: { groupId: string; title: string; onClose: () => void }) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [manifest, setManifest] = useState<LayerManifest | null>(null);
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [maskUrl, setMaskUrl] = useState<string>("");
  const [occlusionBusy, setOcclusionBusy] = useState(false);
  const [occludedRatio, setOccludedRatio] = useState(0);
  const [selfBox, setSelfBox] = useState<[number, number, number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const historyRef = useRef<LoadedLayer[][]>([]);
  const redoRef = useRef<LoadedLayer[][]>([]);
  const [showMask, setShowMask] = useState(true);
  const [othersFaded, setOthersFaded] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ panning: boolean; startX: number; startY: number; panX: number; panY: number }>({
    panning: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });

  // 载入 manifest + 图片
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<LayerManifest>("load_live2d_layers", { resourceRoot, groupId })
      .then(async (data) => {
        if (cancelled) {
          return;
        }
        setManifest(data);
        const loaded = await Promise.all(
          data.layers.map(
            (layer, index) =>
              new Promise<LoadedLayer | null>((resolve) => {
                const image = new Image();
                image.onload = () => resolve({ ...layer, image, order: index });
                image.onerror = () => resolve(null);
                image.src = convertFileSrc(layer.path);
              }),
          ),
        );
        if (cancelled) {
          return;
        }
        const list = loaded.filter((item): item is LoadedLayer => Boolean(item));
        setLayers(list);
        setSelected(list.find((item) => !item.hidden)?.id ?? list[0]?.id ?? null);
        setLoading(false);
        // 自动适配视图
        const stage = stageRef.current;
        if (stage && data.canvasW > 0) {
          const scale = Math.min(stage.clientWidth / data.canvasW, stage.clientHeight / data.canvasH) * 0.92;
          setZoom(Math.max(0.1, Math.min(3, scale)));
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取图层失败");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, resourceRoot]);

  // 合成绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest || layers.length === 0) {
      return;
    }
    canvas.width = manifest.canvasW;
    canvas.height = manifest.canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visible = layers.filter((layer) => !layer.hidden);
    for (const layer of visible) {
      const isSelected = layer.id === selected;
      ctx.globalAlpha = othersFaded && selected && !isSelected ? 0.35 : 1;
      ctx.drawImage(layer.image, layer.offset[0], layer.offset[1], layer.image.width, layer.image.height);
    }
    ctx.globalAlpha = 1;
  }, [layers, manifest, selected, othersFaded]);

  // 遮挡检测交给后端（Rust 读 PNG 算 alpha 交集），避免 canvas 跨源读像素触发 SecurityError
  useEffect(() => {
    if (!manifest || !selected) {
      setMaskUrl("");
      setSelfBox(null);
      setOccludedRatio(0);
      return;
    }
    let cancelled = false;
    setOcclusionBusy(true);
    const timer = window.setTimeout(() => {
      invoke<{ ratio: number; bbox: [number, number, number, number] | null; maskDataUrl: string }>(
        "compute_live2d_occlusion",
        {
          resourceRoot,
          groupId,
          selectedId: selected,
          layers: layers.map((layer) => ({
            id: layer.id,
            file: layer.file,
            offset: layer.offset,
            hidden: layer.hidden,
          })),
        },
      )
        .then((result) => {
          if (cancelled) {
            return;
          }
          setMaskUrl(result.maskDataUrl || "");
          setSelfBox(result.bbox ?? null);
          setOccludedRatio(result.ratio ?? 0);
        })
        .catch(() => {
          if (!cancelled) {
            setMaskUrl("");
            setOccludedRatio(0);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setOcclusionBusy(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [layers, manifest, selected, groupId, resourceRoot]);

  // 保存图层状态
  const saveState = useCallback(
    async (next: LoadedLayer[]) => {
      setSaving(true);
      try {
        await invoke("save_live2d_layers", {
          resourceRoot,
          groupId,
          payload: {
            order: next.map((layer) => layer.id),
            offsets: Object.fromEntries(next.map((layer) => [layer.id, layer.offset])),
            hidden: next.filter((layer) => layer.hidden).map((layer) => layer.id),
            updatedAt: Date.now(),
          },
        });
      } finally {
        setSaving(false);
      }
    },
    [groupId, resourceRoot],
  );

  const updateLayers = (next: LoadedLayer[]) => {
    historyRef.current.push(layers);
    if (historyRef.current.length > 80) {
      historyRef.current.shift();
    }
    redoRef.current = [];
    setLayers(next);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) {
      return;
    }
    redoRef.current.push(layers);
    setLayers(previous);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) {
      return;
    }
    historyRef.current.push(layers);
    setLayers(next);
  };

  // 图层变化后统一防抖保存（拖偏移/键盘微调也会走到这里）
  const loadedRef = useRef(false);
  useEffect(() => {
    if (layers.length === 0) {
      return;
    }
    if (!loadedRef.current) {
      loadedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void saveState(layers);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [layers, saveState]);

  const toggleHidden = (id: string) => {
    updateLayers(layers.map((layer) => (layer.id === id ? { ...layer, hidden: !layer.hidden } : layer)));
  };

  const moveLayer = (id: string, direction: -1 | 1) => {
    const index = layers.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layers.length) {
      return;
    }
    const next = [...layers];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    updateLayers(next);
  };

  const nudge = (id: string, dx: number, dy: number) => {
    updateLayers(
      layers.map((layer) =>
        layer.id === id ? { ...layer, offset: [layer.offset[0] + dx, layer.offset[1] + dy] } : layer,
      ),
    );
  };

  const setOffset = (id: string, axis: 0 | 1, value: number) => {
    updateLayers(
      layers.map((layer) => {
        if (layer.id !== id) {
          return layer;
        }
        const offset: [number, number] = [layer.offset[0], layer.offset[1]];
        offset[axis] = value;
        return { ...layer, offset };
      }),
    );
  };

  // 方向键微调偏移（Shift 一次 10px），文档里承诺过的快捷键
  useEffect(() => {
    if (!selected) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = map[event.key];
      if (!delta) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      setLayers((current) =>
        current.map((layer) =>
          layer.id === selected
            ? { ...layer, offset: [layer.offset[0] + delta[0] * step, layer.offset[1] + delta[1] * step] }
            : layer,
        ),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const selectedLayer = layers.find((layer) => layer.id === selected) ?? null;
  const stageStyle = useMemo(
    () => ({ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }),
    [pan, zoom],
  );

  const toCanvasPoint = (event: React.MouseEvent) => {
    if (!manifest) {
      return null;
    }
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) {
      return null;
    }
    const x = (event.clientX - box.left - pan.x) / zoom;
    const y = (event.clientY - box.top - pan.y) / zoom;
    return { x: Math.round(x), y: Math.round(y) };
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0b0910] text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <button type="button" onClick={onClose} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title || groupId} · 图层比对</p>
          <p className="text-[11px] text-white/40">
            {layers.length} 层 · {manifest ? `${manifest.canvasW}×${manifest.canvasH}` : "—"}
            {saving ? " · 保存中…" : ""}
            {selectedLayer ? ` · 选中：${selectedLayer.id}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={undo} disabled={historyRef.current.length === 0} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16 disabled:opacity-30" title="撤销（Ctrl+Z）">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={redoRef.current.length === 0} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16 disabled:opacity-30" title="重做（Ctrl+Shift+Z）">
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom((value) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(value) - 1)] ?? value / 1.2)} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16" title="缩小">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-[11px] tabular-nums text-white/45">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(value) + 1)] ?? value * 1.2)} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16" title="放大">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const stage = stageRef.current;
              if (stage && manifest) {
                const scale = Math.min(stage.clientWidth / manifest.canvasW, stage.clientHeight / manifest.canvasH) * 0.92;
                setZoom(Math.max(0.1, Math.min(3, scale)));
                setPan({ x: 0, y: 0 });
              }
            }}
            className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16"
            title="适配窗口"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowMask((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${showMask ? "border-rose-300/45 bg-rose-300/18 text-rose-50" : "border-white/16 bg-white/8 text-white/60"}`}
            title="红色呼吸遮罩标出被上层盖住的像素"
          >
            <Crosshair className="h-3.5 w-3.5" /> 遮挡遮罩
          </button>
          <button
            type="button"
            onClick={() => setOthersFaded((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${othersFaded ? "border-sky-300/45 bg-sky-300/18 text-sky-50" : "border-white/16 bg-white/8 text-white/60"}`}
            title="其他层半透明，只看选中层"
          >
            <Layers className="h-3.5 w-3.5" /> 只亮选中层
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 图层列表 */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/10">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-white/40">
            <span>图层（上 = 更靠前）</span>
            <span className="tabular-nums">{layers.filter((layer) => !layer.hidden).length}/{layers.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {[...layers].reverse().map((layer) => (
              <div
                key={layer.id}
                className={`mb-1 flex items-center gap-1 rounded-[10px] px-1.5 py-1 text-[11px] transition ${
                  layer.id === selected ? "bg-sky-300/20 text-sky-50" : "text-white/65 hover:bg-white/8"
                }`}
              >
                <button type="button" onClick={() => toggleHidden(layer.id)} className="shrink-0 p-0.5 text-white/45 transition hover:text-white" title={layer.hidden ? "显示这一层" : "隐藏这一层"}>
                  {layer.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => setSelected(layer.id)} className="min-w-0 flex-1 truncate text-left" title={layer.file}>
                  {layer.id}
                </button>
                <button type="button" onClick={() => moveLayer(layer.id, 1)} className="shrink-0 p-0.5 text-white/30 transition hover:text-white" title="往上（更靠前）">
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => moveLayer(layer.id, -1)} className="shrink-0 p-0.5 text-white/30 transition hover:text-white" title="往下">
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* 画布 + 坐标尺 */}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_25%,rgba(52,38,74,0.35),rgba(8,6,12,1))]">
          {loading ? (
            <div className="grid h-full place-items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center text-sm text-rose-200">{error}</div>
          ) : (
            <>
              {/* 顶部 / 左侧坐标尺 */}
              {manifest ? (
                <>
                  <div className="pointer-events-none absolute left-6 right-0 top-0 z-10 h-5 border-b border-white/10 bg-black/40">
                    {Array.from({ length: Math.floor(manifest.canvasW / 100) + 1 }).map((_, tick) => {
                      const left = 24 + tick * 100 * zoom + pan.x;
                      return (
                        <span key={`x-${tick}`} className="absolute top-0.5 text-[9px] text-white/35" style={{ left }}>
                          {tick * 100}
                        </span>
                      );
                    })}
                  </div>
                  <div className="pointer-events-none absolute bottom-0 left-0 top-5 z-10 w-6 border-r border-white/10 bg-black/40">
                    {Array.from({ length: Math.floor(manifest.canvasH / 100) + 1 }).map((_, tick) => {
                      const top = 20 + tick * 100 * zoom + pan.y;
                      return (
                        <span key={`y-${tick}`} className="absolute left-0.5 text-[9px] text-white/35" style={{ top }}>
                          {tick * 100}
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <div
                ref={stageRef}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onMouseMove={(event) => {
                  const point = toCanvasPoint(event);
                  if (point) {
                    setCursor(point);
                  }
                  const drag = dragRef.current;
                  if (drag.panning) {
                    setPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) });
                  }
                }}
                onMouseLeave={() => setCursor(null)}
                onMouseDown={(event) => {
                  dragRef.current = { panning: true, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                }}
                onMouseUp={() => {
                  dragRef.current = { panning: false, startX: 0, startY: 0, panX: pan.x, panY: pan.y };
                }}
              >
                <div className="absolute left-6 top-5 origin-top-left" style={stageStyle}>
                  <div className="relative" style={{ width: manifest?.canvasW, height: manifest?.canvasH }}>
                    <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ width: manifest?.canvasW, height: manifest?.canvasH }} />
                    {maskUrl ? (
                      <img
                        src={maskUrl}
                        alt=""
                        className="pointer-events-none absolute inset-0 h-full w-full animate-pulse"
                        style={{ width: manifest?.canvasW, height: manifest?.canvasH, opacity: 0.55 }}
                      />
                    ) : null}
                    <div className="pointer-events-none absolute inset-0 border border-white/20" />
                    {selfBox ? (
                      <div
                        className="pointer-events-none absolute border border-dashed border-amber-300/70"
                        style={{ left: selfBox[0], top: selfBox[1], width: selfBox[2], height: selfBox[3] }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {/* 十字准线 + 坐标 */}
              {cursor ? (
                <>
                  <div className="pointer-events-none absolute left-6 top-0 z-20 h-full w-px bg-sky-300/30" style={{ transform: `translateX(${cursor.x * zoom + pan.x}px)` }} />
                  <div className="pointer-events-none absolute left-0 top-5 z-20 h-px w-full bg-sky-300/30" style={{ transform: `translateY(${cursor.y * zoom + pan.y}px)` }} />
                </>
              ) : null}
              <div className="pointer-events-none absolute bottom-2 left-8 z-20 rounded-full bg-black/60 px-3 py-1 text-[11px] tabular-nums text-white/50">
                {cursor ? `x ${cursor.x} · y ${cursor.y}` : "拖动平移 · 滚轮缩放（Ctrl）"}
                {selectedLayer && occludedRatio > 0 ? ` · 遮挡 ${(occludedRatio * 100).toFixed(1)}%` : ""}
                {occlusionBusy ? " · 计算遮挡…" : ""}
              </div>
            </>
          )}
        </div>

        {/* 选中层的偏移控制 */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 border-l border-white/10 p-3">
          {selectedLayer ? (
            <>
              <div className="rounded-[14px] border border-white/12 bg-white/5 p-3">
                <p className="text-[11px] text-white/40">选中图层</p>
                <p className="mt-0.5 truncate text-sm font-medium text-white">{selectedLayer.id}</p>
                <p className="mt-0.5 truncate text-[10px] text-white/30">{selectedLayer.file}</p>
              </div>

              <div className="rounded-[14px] border border-white/12 bg-white/5 p-3">
                <p className="mb-2 flex items-center gap-1 text-[11px] text-white/40">
                  <Move className="h-3 w-3" /> 偏移（画布像素）
                </p>
                <div className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-1 text-[10px] text-white/40">
                    X
                    <input
                      type="number"
                      value={selectedLayer.offset[0]}
                      onChange={(event) => setOffset(selectedLayer.id, 0, Number(event.target.value))}
                      className="w-full rounded-[6px] border border-white/14 bg-black/40 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1 text-[10px] text-white/40">
                    Y
                    <input
                      type="number"
                      value={selectedLayer.offset[1]}
                      onChange={(event) => setOffset(selectedLayer.id, 1, Number(event.target.value))}
                      className="w-full rounded-[6px] border border-white/14 bg-black/40 px-1.5 py-1 text-[11px] text-white outline-none"
                    />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  <span />
                  <button type="button" onClick={() => nudge(selectedLayer.id, 0, -1)} className="rounded-[6px] border border-white/14 bg-white/8 py-1 text-[10px] text-white/70 hover:bg-white/16">↑</button>
                  <span />
                  <button type="button" onClick={() => nudge(selectedLayer.id, -1, 0)} className="rounded-[6px] border border-white/14 bg-white/8 py-1 text-[10px] text-white/70 hover:bg-white/16">←</button>
                  <button type="button" onClick={() => setOffset(selectedLayer.id, 0, 0)} className="rounded-[6px] border border-white/14 bg-white/8 py-1 text-[10px] text-white/50 hover:bg-white/16">0</button>
                  <button type="button" onClick={() => nudge(selectedLayer.id, 1, 0)} className="rounded-[6px] border border-white/14 bg-white/8 py-1 text-[10px] text-white/70 hover:bg-white/16">→</button>
                  <span />
                  <button type="button" onClick={() => nudge(selectedLayer.id, 0, 1)} className="rounded-[6px] border border-white/14 bg-white/8 py-1 text-[10px] text-white/70 hover:bg-white/16">↓</button>
                  <span />
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/30">
                  方向键微调；Shift+方向键一次 10px。偏移会随图层一起保存。
                </p>
              </div>

              <div className="rounded-[14px] border border-white/12 bg-white/5 p-3">
                <p className="text-[11px] text-white/40">遮挡情况</p>
                {occludedRatio > 0 ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-rose-200">{(occludedRatio * 100).toFixed(1)}% 被上层盖住</p>
                    <p className="mt-1 text-[10px] leading-4 text-white/35">
                      红色呼吸区域就是看不见的部分。把它隐藏掉再对照，就能判断补全范围。
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-white/45">
                    {occlusionBusy ? "计算中…" : "这一层没有被其它层遮挡"}
                  </p>
                )}
              </div>

              <div className="mt-auto flex items-center gap-1.5 text-[10px] text-white/25">
                <Save className="h-3 w-3" /> 自动保存到 live2d/{groupId}/data/layers.json
              </div>
            </>
          ) : (
            <p className="text-[11px] text-white/40">左侧选一个图层</p>
          )}
        </aside>
      </div>

      <footer className="shrink-0 border-t border-white/10 px-4 py-1.5 text-[10px] text-white/30">
        方向键微调偏移（Shift×10）· Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 · 拖空白平移 · Ctrl+滚轮缩放 · 黄虚线 = 选中层内容范围
      </footer>
    </div>
  );
}
