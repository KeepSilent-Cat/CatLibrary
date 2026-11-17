import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  Eye,
  Loader2,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

type StepKind = "point" | "polygon";

type Step = { id: string; label: string; kind: StepKind; hint: string };
type Part = { id: string; label: string; steps: Step[] };

type Vec2 = { x: number; y: number };

type Annotation = {
  version: 1;
  image: string;
  canvas: { w: number; h: number };
  points: Record<string, Vec2>;
  invisible: Record<string, true>;
  polygons: Record<string, Vec2[]>;
  updatedAt: number;
};

const point = (id: string, label: string, hint: string): Step => ({ id, label, kind: "point", hint });
const poly = (id: string, label: string, hint: string): Step => ({ id, label, kind: "polygon", hint });

/** 按「先定位点、再补轮廓」的顺序排好，跟标注规范一致 */
const PARTS: Part[] = [
  {
    id: "full",
    label: "全身",
    steps: [
      poly("full.outline", "角色外框", "沿身体最外缘依次点一圈；头发/衣摆也算外框"),
      point("full.foot.l", "左脚接触点", "角色左脚与地面的接触点"),
      point("full.foot.r", "右脚接触点", "角色右脚与地面的接触点"),
      point("full.center", "躯干中心", "大约在胸口偏下、身体中轴线上"),
    ],
  },
  {
    id: "face",
    label: "头脸",
    steps: [
      poly("face.area", "脸部范围", "从额头到下巴，绕开头发点一圈"),
      point("face.chin", "下巴", "下巴最下缘的中点"),
      point("face.neck", "头颈连接点", "头部与脖子交界处"),
    ],
  },
  {
    id: "eye",
    label: "眼睛",
    steps: [
      point("eye.l.pupil", "左眼瞳孔中心", "画面右侧那只眼（角色左眼）"),
      point("eye.l.inner", "左眼内眼角", "靠近鼻子那一侧"),
      point("eye.l.outer", "左眼外眼角", "靠近耳朵那一侧"),
      point("eye.l.top", "左眼上眼睑", "上眼皮边缘最高点"),
      point("eye.l.bottom", "左眼下眼睑", "下眼皮边缘最低点"),
      poly("eye.l.iris", "左眼虹膜范围", "绕虹膜外缘点一圈，不要把高光算进去"),
      point("eye.r.pupil", "右眼瞳孔中心", "画面左侧那只眼（角色右眼）"),
      point("eye.r.inner", "右眼内眼角", "靠近鼻子那一侧"),
      point("eye.r.outer", "右眼外眼角", "靠近耳朵那一侧"),
      point("eye.r.top", "右眼上眼睑", "上眼皮边缘最高点"),
      point("eye.r.bottom", "右眼下眼睑", "下眼皮边缘最低点"),
      poly("eye.r.iris", "右眼虹膜范围", "绕虹膜外缘点一圈"),
    ],
  },
  {
    id: "face2",
    label: "眉毛与嘴",
    steps: [
      point("brow.l.end", "左眉外侧端", "眉头或眉尾任一端点都行，保持左右一致"),
      point("brow.r.end", "右眉外侧端", "同上"),
      point("mouth.center", "嘴中心", "嘴唇闭合线的中点"),
      poly("mouth.area", "嘴部范围", "嘴角到嘴角点一圈"),
    ],
  },
  {
    id: "hair",
    label: "头发 / 角 / 耳 / 饰品",
    steps: [
      point("hair.root", "头发连接点", "发根与头顶的连接位置"),
      point("hair.tip", "发梢末端", "最长那缕头发的末端"),
      point("horn.root", "角根部（若有）", "没有角就标「不可见」"),
      point("horn.tip", "角尖端（若有）", "同上"),
      point("ear.root", "耳朵根部（若有）", "没有人耳/兽耳就标「不可见」"),
      point("tail.root", "尾巴根部（若有）", "没有尾巴就标「不可见」"),
      point("tail.tip", "尾巴末端（若有）", "同上"),
    ],
  },
  {
    id: "cloth",
    label: "衣服",
    steps: [
      point("cloth.neck", "领口（颈部）", "衣服与脖子交界处"),
      point("cloth.shoulder.l", "左肩关节", "画面右侧那只肩"),
      point("cloth.shoulder.r", "右肩关节", "画面左侧那只肩"),
      point("cloth.waist", "腰线", "衣服收腰的位置"),
      poly("cloth.top", "上衣范围", "沿上衣外缘点一圈"),
      poly("cloth.hem", "下摆范围", "裙子/下摆的外缘"),
    ],
  },
  {
    id: "limb",
    label: "手臂与腿",
    steps: [
      point("arm.l.shoulder", "左肩", "画面右侧"),
      point("arm.l.elbow", "左肘", "手肘外侧"),
      point("arm.l.wrist", "左腕", "手腕处"),
      point("arm.l.palm", "左掌心", "手掌中心"),
      point("arm.r.shoulder", "右肩", "画面左侧"),
      point("arm.r.elbow", "右肘", ""),
      point("arm.r.wrist", "右腕", ""),
      point("arm.r.palm", "右掌心", ""),
      point("leg.l.hip", "左髋", "髋关节外侧"),
      point("leg.l.knee", "左膝", "膝盖中心"),
      point("leg.l.ankle", "左踝", "脚踝处"),
      point("leg.l.sole", "左脚底接触点", "脚掌与地面接触处"),
      point("leg.r.hip", "右髋", ""),
      point("leg.r.knee", "右膝", ""),
      point("leg.r.ankle", "右踝", ""),
      point("leg.r.sole", "右脚底接触点", ""),
    ],
  },
  {
    id: "tail",
    label: "尾巴 / 特效",
    steps: [
      point("tail.path.start", "尾根起点", "与身体连接处"),
      point("tail.path.mid", "尾中段", "沿中心走向取一点"),
      point("tail.path.end", "尾尖", "尾巴末端"),
      poly("tail.outline", "尾巴外轮廓", "不要把水墨/光效算进去"),
    ],
  },
];

const STORAGE_KEY = "catlibrary-live2d-annotate-view";

function emptyAnnotation(image: string, w: number, h: number): Annotation {
  return { version: 1, image, canvas: { w, h }, points: {}, invisible: {}, polygons: {}, updatedAt: Date.now() };
}

export default function Live2dAnnotator({ groupId, title, onClose }: { groupId: string; title: string; onClose: () => void }) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [images, setImages] = useState<string[]>([]);
  const [anno, setAnno] = useState<Annotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [partIndex, setPartIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [polyDraft, setPolyDraft] = useState<Vec2[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string | null; panning: boolean; startX: number; startY: number; panX: number; panY: number }>({
    id: null,
    panning: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });
  const historyRef = useRef<Annotation[]>([]);
  const redoRef = useRef<Annotation[]>([]);
  const saveTimer = useRef<number | null>(null);

  const part = PARTS[partIndex];
  const step = part.steps[stepIndex];

  // 载入基准图与已有标注
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      invoke<string[]>("list_live2d_base_images", { resourceRoot, groupId }),
      invoke<Annotation | null>("load_live2d_annotation", { resourceRoot, groupId }),
    ])
      .then(([list, saved]) => {
        if (cancelled) {
          return;
        }
        setImages(list ?? []);
        if (saved && saved.image) {
          setAnno(saved);
          setLoading(false);
          return;
        }
        const first = (list ?? [])[0];
        if (!first) {
          setError("这个角色还没有可用的基准图");
          setLoading(false);
          return;
        }
        const img = new Image();
        img.src = convertFileSrc(first);
        img.onload = () => {
          if (!cancelled) {
            setAnno(emptyAnnotation(first, img.naturalWidth, img.naturalHeight));
            setLoading(false);
          }
        };
        img.onerror = () => {
          if (!cancelled) {
            setError("基准图读取失败");
            setLoading(false);
          }
        };
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取失败");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, resourceRoot]);

  // 自动保存（防抖 800ms）
  useEffect(() => {
    if (!anno) {
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    setSaveState("saving");
    saveTimer.current = window.setTimeout(() => {
      invoke("save_live2d_annotation", { resourceRoot, groupId, payload: anno })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 800);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [anno, groupId, resourceRoot]);

  const progress = useMemo(() => {
    if (!anno) {
      return { done: 0, total: 0 };
    }
    let done = 0;
    let total = 0;
    for (const entry of PARTS) {
      for (const item of entry.steps) {
        total += 1;
        if (anno.points[item.id] || anno.invisible[item.id] || (anno.polygons[item.id]?.length ?? 0) > 0) {
          done += 1;
        }
      }
    }
    return { done, total };
  }, [anno]);

  const snapshot = () => {
    if (!anno) {
      return;
    }
    historyRef.current.push(structuredClone(anno));
    if (historyRef.current.length > 60) {
      historyRef.current.shift();
    }
    redoRef.current = [];
  };

  const mutate = (updater: (current: Annotation) => Annotation) => {
    snapshot();
    setAnno((current) => (current ? { ...updater(structuredClone(current)), updatedAt: Date.now() } : current));
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous || !anno) {
      return;
    }
    redoRef.current.push(structuredClone(anno));
    setAnno(previous);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next || !anno) {
      return;
    }
    historyRef.current.push(structuredClone(anno));
    setAnno(next);
  };

  const setPoint = (x: number, y: number) => {
    if (!step) {
      return;
    }
    if (step.kind === "point") {
      mutate((current) => {
        current.points[step.id] = { x: Math.round(x), y: Math.round(y) };
        delete current.invisible[step.id];
        return current;
      });
      goNext();
    } else {
      setPolyDraft((draft) => [...draft, { x: Math.round(x), y: Math.round(y) }]);
    }
  };

  const commitPolygon = () => {
    if (!step || polyDraft.length < 3) {
      return;
    }
    mutate((current) => {
      current.polygons[step.id] = [...polyDraft];
      delete current.invisible[step.id];
      return current;
    });
    setPolyDraft([]);
    goNext();
  };

  const markInvisible = () => {
    if (!step) {
      return;
    }
    mutate((current) => {
      current.invisible[step.id] = true;
      delete current.points[step.id];
      delete current.polygons[step.id];
      return current;
    });
    setPolyDraft([]);
    goNext();
  };

  const goNext = () => {
    setPolyDraft([]);
    if (stepIndex + 1 < part.steps.length) {
      setStepIndex(stepIndex + 1);
      return;
    }
    if (partIndex + 1 < PARTS.length) {
      setPartIndex(partIndex + 1);
      setStepIndex(0);
    }
  };

  const goPrev = () => {
    setPolyDraft([]);
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      return;
    }
    if (partIndex > 0) {
      setPartIndex(partIndex - 1);
      setStepIndex(PARTS[partIndex - 1].steps.length - 1);
    }
  };

  const toSvgPoint = (event: React.PointerEvent | React.MouseEvent): Vec2 | null => {
    const svg = svgRef.current;
    if (!svg || !anno) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return null;
    }
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const local = toSvgPoint(event);
    if (!local) {
      return;
    }
    dragRef.current = { id: null, panning: true, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag.id) {
      const local = toSvgPoint(event);
      if (local) {
        setAnno((current) => {
          if (!current) {
            return current;
          }
          return { ...current, points: { ...current.points, [drag.id as string]: { x: Math.round(local.x), y: Math.round(local.y) } } };
        });
      }
      return;
    }
    if (drag.panning) {
      setPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
    if (!drag.id && drag.panning && moved < 4) {
      const local = toSvgPoint(event);
      if (local) {
        setPoint(local.x, local.y);
      }
    }
    dragRef.current = { id: null, panning: false, startX: 0, startY: 0, panX: pan.x, panY: pan.y };
  };

  const exportJson = () => {
    if (!anno) {
      return;
    }
    const blob = new Blob([JSON.stringify(anno, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title || groupId}-annotations.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0d0a12] text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title || groupId} · 标注工作台</p>
          <p className="text-[11px] text-white/40">
            已标 {progress.done} / {progress.total}
            {saveState === "saving" ? " · 保存中…" : saveState === "saved" ? " · 已自动保存" : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={undo} disabled={historyRef.current.length === 0} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16 disabled:opacity-30" title="撤销（Ctrl+Z）">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redo} disabled={redoRef.current.length === 0} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16 disabled:opacity-30" title="重做">
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.min(6, value * 1.2))} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16" title="放大">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0.3, value / 1.2))} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16" title="缩小">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={resetView} className="rounded-full border border-white/16 bg-white/8 p-1.5 text-white/70 transition hover:bg-white/16" title="恢复视图">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={exportJson} className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-3 py-1.5 text-xs text-sky-50 transition hover:bg-sky-300/25">
            <Download className="h-3.5 w-3.5" /> 导出 JSON
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧：部位列表 */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/10">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {PARTS.map((entry, index) => {
              const total = entry.steps.length;
              const done = entry.steps.filter((item) => anno?.points[item.id] || anno?.invisible[item.id] || (anno?.polygons[item.id]?.length ?? 0) > 0).length;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setPartIndex(index);
                    setStepIndex(0);
                    setPolyDraft([]);
                  }}
                  className={`mb-1 flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-xs transition ${
                    index === partIndex ? "bg-sky-300/20 text-sky-50" : "text-white/65 hover:bg-white/8"
                  }`}
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-white/35">
                    {done}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 中间：画布 */}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(60,40,80,0.35),rgba(10,8,14,1))]">
          {loading ? (
            <div className="grid h-full place-items-center text-sm text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center text-sm text-rose-200">{error}</div>
          ) : anno ? (
            <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${anno.canvas.w} ${anno.canvas.h}`}
                className="h-full w-full touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={(event) => {
                  if (!event.ctrlKey && !event.metaKey) {
                    return;
                  }
                  event.preventDefault();
                  setZoom((value) => Math.min(6, Math.max(0.3, value * (event.deltaY < 0 ? 1.1 : 0.9))));
                }}
              >
                <image href={convertFileSrc(anno.image)} x={0} y={0} width={anno.canvas.w} height={anno.canvas.h} />
                {/* 已完成的点 */}
                {Object.entries(anno.points).map(([id, position]) => (
                  <g key={id}>
                    <circle
                      cx={position.x}
                      cy={position.y}
                      r={6 / zoom}
                      fill="#38bdf8"
                      stroke="#0f172a"
                      strokeWidth={1.5 / zoom}
                      className="cursor-grab"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (step?.kind === "point") {
                          dragRef.current = { id, panning: false, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                          (event.currentTarget as unknown as SVGCircleElement).setPointerCapture?.(event.pointerId);
                        }
                      }}
                    />
                    <text x={position.x + 8 / zoom} y={position.y - 6 / zoom} fontSize={10 / zoom} fill="#7dd3fc">
                      {id.split(".").slice(-1)[0]}
                    </text>
                  </g>
                ))}
                {/* 已完成的多边形 */}
                {Object.entries(anno.polygons).map(([id, vertices]) => (
                  <polygon
                    key={id}
                    points={vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ")}
                    fill="rgba(56,189,248,0.12)"
                    stroke="#38bdf8"
                    strokeWidth={1.5 / zoom}
                  />
                ))}
                {/* 正在画的轮廓 */}
                {polyDraft.length > 0 ? (
                  <polyline
                    points={polyDraft.map((vertex) => `${vertex.x},${vertex.y}`).join(" ")}
                    fill="rgba(250,204,21,0.12)"
                    stroke="#facc15"
                    strokeWidth={2 / zoom}
                  />
                ) : null}
              </svg>
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/50">
            点击空白处落点 · 拖空白平移视图 · Ctrl+滚轮缩放 · 拖蓝点微调
          </div>
        </div>

        {/* 右侧：当前步骤提示 */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 border-l border-white/10 p-3">
          <div className="rounded-[14px] border border-white/12 bg-white/5 p-3">
            <p className="text-[11px] text-white/40">
              {part.label} · {stepIndex + 1}/{part.steps.length}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-white">{step.label}</h3>
            <p className="mt-1.5 text-[11px] leading-5 text-white/45">{step.hint || "在画面上点一下定位"}</p>
            {anno?.points[step.id] ? (
              <p className="mt-2 text-[11px] tabular-nums text-sky-200">
                已标：{anno.points[step.id].x}, {anno.points[step.id].y}
              </p>
            ) : anno?.invisible[step.id] ? (
              <p className="mt-2 text-[11px] text-amber-200">已标记为不可见</p>
            ) : null}
          </div>

          {step.kind === "polygon" ? (
            <div className="rounded-[14px] border border-white/12 bg-white/5 p-3 text-[11px] text-white/50">
              <p>轮廓：已点 {polyDraft.length} 个顶点</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={commitPolygon}
                  disabled={polyDraft.length < 3}
                  className="flex-1 rounded-full border border-sky-300/40 bg-sky-300/15 px-3 py-1.5 text-[11px] text-sky-50 transition hover:bg-sky-300/25 disabled:opacity-40"
                >
                  闭合轮廓
                </button>
                <button
                  type="button"
                  onClick={() => setPolyDraft([])}
                  className="rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-[11px] text-white/70 transition hover:bg-white/16"
                >
                  清空
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button type="button" onClick={goPrev} className="flex-1 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-[11px] text-white/70 transition hover:bg-white/16">
              <ChevronLeft className="mx-auto h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={goNext} className="flex-1 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-[11px] text-white/70 transition hover:bg-white/16">
              <ChevronRight className="mx-auto h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={markInvisible}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-300/20"
          >
            <EyeOff className="h-3.5 w-3.5" /> 此项不可见
          </button>

          {anno ? (
            <div className="mt-auto space-y-2 rounded-[14px] border border-white/12 bg-white/5 p-3">
              <p className="text-[10px] text-white/35">基准图</p>
              <select
                value={anno.image}
                onChange={(event) => {
                  const next = event.target.value;
                  const img = new Image();
                  img.src = convertFileSrc(next);
                  img.onload = () => {
                    snapshot();
                    setAnno({ ...anno, image: next, canvas: { w: img.naturalWidth, h: img.naturalHeight }, updatedAt: Date.now() });
                  };
                }}
                className="w-full rounded-[8px] border border-white/14 bg-black/40 px-2 py-1.5 text-[11px] text-white/80 outline-none"
              >
                {images.map((image) => (
                  <option key={image} value={image}>
                    {image.split(/[\\/]/).slice(-1)[0]}
                  </option>
                ))}
              </select>
              <p className="flex items-center gap-1 text-[10px] text-white/30">
                <Save className="h-3 w-3" /> 自动保存到 live2d/{groupId}/data
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
