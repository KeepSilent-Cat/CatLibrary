import { invoke } from "@tauri-apps/api/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Italic,
  Languages,
  Loader2,
  Magnet,
  MousePointer2,
  PenLine,
  Pipette,
  Redo2,
  RotateCcw,
  Save,
  Stamp,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
}

interface Region {
  id: string;
  points: Point[]; // 自然分辨率坐标
  text: string;
  fill: string; // 填充色（白或取样气泡色）
  textColor: string;
  /** 文字描边色（null = 无描边），用于“填充 + 边框”样式的对话框文字 */
  strokeColor: string | null;
  /** 描边宽度（自然分辨率像素） */
  strokeWidth: number;
  /** 字号（自然分辨率像素，每框独立，改字号不影响其他框） */
  fontSize: number;
  /** 水平对齐：左 / 中 / 右 */
  align: "left" | "center" | "right";
  /** 斜体 */
  italic: boolean;
  /** 旋转角度（度，绕文字块中心） */
  rotation: number;
  /** 无填充：纯文本（不带气泡底色），「文本」工具创建 */
  noFill: boolean;
}

interface RestoreRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一次可撤销的编辑快照：框 + 恢复区 +（画笔/图章时）底图像素快照 */
interface HistoryEntry {
  kind: "region" | "canvas";
  regions: Region[];
  restoredRects: RestoreRect[];
  canvasData: ImageData | null;
}

type Tool = "move" | "freehand" | "polygonal" | "magnetic" | "restore" | "brush" | "stamp" | "text";
type FillMode = "sample" | "white";

/** 翻译参考侧栏：内嵌 Bing 翻译页（用户惯用的快速翻译入口） */
const TRANSLATOR_URL =
  "https://www.bing.com/search?q=%E7%BF%BB%E8%AF%91&form=ANNTH1&refig=6acea0656fdc4ba8bc07f02ff3d45087&pc=EDGENTP&dayref=1&ajf=10&form=TTSREF&isTTRefreshQuery=1";

interface TranslationEditorProps {
  resourceRoot: string;
  groupId: string;
  chapterName: string;
  imagePath: string;
  /** 原图路径（用于“恢复选区为原图”，始终指向 source 下的原图） */
  originalPath: string;
  /** 当前页码（0-based，用于编辑器内翻页） */
  pageIndex: number;
  totalPages: number;
  onNavigate: (dir: -1 | 1) => void;
  onClose: () => void;
  onSaved: () => void;
}

let regionSeq = 0;
function nextRegionId() {
  regionSeq += 1;
  return `r${Date.now().toString(36)}-${regionSeq}`;
}

function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取画布数据失败"));
    reader.readAsDataURL(blob);
  });
}

async function loadImageFromPath(path: string): Promise<HTMLImageElement> {
  const base64 = await invoke<string>("read_image_base64", { path });
  const dataUrl = `data:${mimeForPath(path)};base64,${base64}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = dataUrl;
  });
}

function polygonBounds(points: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

const TOOL_HINTS: Record<Tool, string> = {
  move: "选择：点选已有框可编辑，按住拖动可移动位置",
  freehand: "自由套索：按住拖动，圈出对话框，松开闭合",
  polygonal: "多边形套索：点击逐点加顶点，点回起点或按回车闭合",
  magnetic: "磁性套索：按住沿边缘拖动，自动吸附气泡轮廓",
  restore: "恢复：按住拖动框选要还原的区域，松手即用原图像素替换回去",
  brush: "画笔：按住拖动，用当前颜色涂画，填补/覆盖背景里的文字",
  stamp: "纹理图章：先框选一块纹理，再点击把纹理复制到别处（仿制图章）",
  text: "文本：在画面点击一处，直接添加一段纯文本（不带气泡底色）",
};

export default function TranslationEditor({
  resourceRoot,
  groupId,
  chapterName,
  imagePath,
  originalPath,
  pageIndex,
  totalPages,
  onNavigate,
  onClose,
  onSaved,
}: TranslationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gradientRef = useRef<Float32Array | null>(null);
  const gradientSizeRef = useRef<{ w: number; h: number } | null>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // 底图编辑层：底图 + 画笔/图章的像素级修改（导出时烘焙进 PNG）
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 图章采集的纹理块
  const stampCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 画笔上一笔落点（自然分辨率坐标）
  const brushLastRef = useRef<Point | null>(null);
  // 图章预览位置（自然分辨率坐标，跟随鼠标）
  const stampPreviewRef = useRef<Point | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [showRefPanel, setShowRefPanel] = useState(true);
  const [panelWidth, setPanelWidth] = useState(400);

  const [regions, setRegions] = useState<Region[]>([]);
  const [restoredRects, setRestoredRects] = useState<RestoreRect[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [fillMode, setFillMode] = useState<FillMode>("sample");
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [restoreDraft, setRestoreDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragState, setDragState] = useState<{ id: string; last: Point } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [fontSize, setFontSize] = useState(18);
  const [textColor, setTextColor] = useState("#111111");
  const [strokeColor, setStrokeColor] = useState<string | null>(null);
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [align, setAlign] = useState<"left" | "center" | "right">("center");
  const [italic, setItalic] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(24);
  const [picking, setPicking] = useState(false);
  const [stampSource, setStampSource] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [stampDraft, setStampDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoHistoryRef = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pageName = useMemo(
    () => imagePath.replace(/\\/g, "/").split("/").pop() ?? "page",
    [imagePath],
  );
  const resuming = useMemo(() => /[\\/]translated[\\/]/.test(imagePath), [imagePath]);
  const activeRegion = useMemo(
    () => regions.find((region) => region.id === activeId) ?? null,
    [regions, activeId],
  );

  // 加载底图 + 原图（走 base64，避免自定义协议污染画布）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const baseImage = await loadImageFromPath(imagePath);
        if (cancelled) return;
        imageRef.current = baseImage;
        setNatural({ w: baseImage.naturalWidth, h: baseImage.naturalHeight });
        setFontSize(Math.max(14, Math.round(baseImage.naturalWidth / 60)));

        // 独立底图 canvas（只含底图，供取色/边缘检测，不受叠加框影响）
        const base = document.createElement("canvas");
        base.width = baseImage.naturalWidth;
        base.height = baseImage.naturalHeight;
        base.getContext("2d")?.drawImage(baseImage, 0, 0);
        baseCanvasRef.current = base;

        // 底图编辑层：初始 = 底图，画笔/图章直接改这里的像素（导出时烘焙进 PNG）
        const edit = document.createElement("canvas");
        edit.width = baseImage.naturalWidth;
        edit.height = baseImage.naturalHeight;
        edit.getContext("2d")?.drawImage(baseImage, 0, 0);
        editCanvasRef.current = edit;

        // 画笔默认粗细按图宽自适应
        setBrushSize(Math.max(8, Math.round(baseImage.naturalWidth / 80)));

        // 原图（用于“恢复选区为原图”），与底图同路径则复用
        if (originalPath !== imagePath) {
          const originalImage = await loadImageFromPath(originalPath);
          if (cancelled) return;
          originalImageRef.current = originalImage;
        } else {
          originalImageRef.current = baseImage;
        }

        setLoading(false);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imagePath, originalPath]);

  // 切页（或重新打开）时清空当前页的编辑状态，避免上一页的框/恢复区串页
  useEffect(() => {
    setRegions([]);
    setRestoredRects([]);
    setActiveId(null);
    setTextDraft("");
    historyRef.current = [];
    redoHistoryRef.current = [];
    setHistoryVersion((version) => version + 1);
    setDrawing(null);
    setRestoreDraft(null);
    setDragState(null);
    setTool("move");
    setDeleting(false);
    setSaveError(null);
    setStampSource(null);
    setStampDraft(null);
    setPicking(false);
    setStrokeColor(null);
    setStrokeWidth(0);
    brushLastRef.current = null;
    stampPreviewRef.current = null;
  }, [imagePath]);

  // 文本框自动撑高（Shift+回车可手动换行，多行时随内容增高，最高 132px 后滚动）
  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [textDraft]);

  // 计算画布适配尺寸（object-contain），实际显示 = 适配 × zoom
  useEffect(() => {
    if (!natural || !wrapRef.current) return;
    const compute = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const scale = Math.min(cw / natural.w, ch / natural.h, 1);
      setFit({
        w: Math.max(1, Math.floor(natural.w * scale)),
        h: Math.max(1, Math.floor(natural.h * scale)),
      });
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [natural]);

  const display = useMemo(() => ({ w: fit.w * zoom, h: fit.h * zoom }), [fit, zoom]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(8, z * 1.25)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.2, z / 1.25)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  // Ctrl+滚轮缩放（原生监听，non-passive 才能 preventDefault）
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25;
      setZoom((z) => Math.min(8, Math.max(0.2, z * factor)));
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  // 绘制一帧：图像 + 各框填充/文字；annotations 控制是否叠加外框/套索（导出时关闭）
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, annotations: boolean) => {
      const base = editCanvasRef.current;
      if (!base || !natural) return;
      ctx.clearRect(0, 0, natural.w, natural.h);
      ctx.drawImage(base, 0, 0, natural.w, natural.h);

      // 恢复区：用原图像素替换回去
      const original = originalImageRef.current;
      if (original) {
        for (const rect of restoredRects) {
          ctx.drawImage(original, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
        }
      }

      for (const region of regions) {
        if (region.points.length < 3) continue;
        ctx.beginPath();
        region.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        if (!region.noFill) {
          ctx.fillStyle = region.fill;
          ctx.fill();
        }
        drawRegionText(ctx, region, region.fontSize);
      }

      if (!annotations) return;

      // 框轮廓：非选中淡虚线，选中实线高亮（仅显示用，不入图）
      for (const region of regions) {
        if (region.points.length < 3) continue;
        const active = region.id === activeId;
        ctx.beginPath();
        region.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        if (active) {
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = Math.max(3, natural.w / 250);
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = Math.max(1.5, natural.w / 700);
          ctx.setLineDash([6, 5]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 进行中的套索
      if (drawing && drawing.length >= 1) {
        ctx.save();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = Math.max(2, natural.w / 600);
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        drawing.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        if (tool !== "polygonal" && drawing.length > 2) {
          ctx.lineTo(drawing[0].x, drawing[0].y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 恢复选区草稿框
      if (restoreDraft) {
        const x = Math.min(restoreDraft.x0, restoreDraft.x1);
        const y = Math.min(restoreDraft.y0, restoreDraft.y1);
        const w = Math.abs(restoreDraft.x1 - restoreDraft.x0);
        const h = Math.abs(restoreDraft.y1 - restoreDraft.y0);
        ctx.save();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = Math.max(2, natural.w / 600);
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }

      // 图章框选草稿
      if (stampDraft) {
        const x = Math.min(stampDraft.x0, stampDraft.x1);
        const y = Math.min(stampDraft.y0, stampDraft.y1);
        const w = Math.abs(stampDraft.x1 - stampDraft.x0);
        const h = Math.abs(stampDraft.y1 - stampDraft.y0);
        ctx.save();
        ctx.strokeStyle = "#a3e635";
        ctx.lineWidth = Math.max(2, natural.w / 600);
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }

      // 已采集的图章纹理源标记（绿色实线框）
      if (stampSource) {
        ctx.save();
        ctx.strokeStyle = "#a3e635";
        ctx.lineWidth = Math.max(2, natural.w / 500);
        ctx.setLineDash([]);
        ctx.strokeRect(stampSource.x, stampSource.y, stampSource.w, stampSource.h);
        ctx.restore();
      }

      // 图章预览（半透明，跟随鼠标位置）
      if (tool === "stamp" && stampSource && stampPreviewRef.current) {
        const stamp = stampCanvasRef.current;
        if (stamp) {
          const px = stampPreviewRef.current.x;
          const py = stampPreviewRef.current.y;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.drawImage(stamp, px - stamp.width / 2, py - stamp.height / 2);
          ctx.restore();
        }
      }
    },
    [regions, drawing, restoredRects, restoreDraft, stampDraft, stampSource, fontSize, activeId, natural, tool],
  );

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paint(ctx, true);
  }, [paint]);

  useEffect(() => {
    redraw();
  }, [redraw, loading]);

  // 同步选中框的文字与颜色草稿
  useEffect(() => {
    setTextDraft(activeRegion?.text ?? "");
    if (activeRegion) {
      setTextColor(activeRegion.textColor);
      setStrokeColor(activeRegion.strokeColor);
      setStrokeWidth(activeRegion.strokeWidth);
      setFontSize(activeRegion.fontSize);
      setAlign(activeRegion.align);
      setItalic(activeRegion.italic);
      setRotation(activeRegion.rotation);
    } else {
      setStrokeColor(null);
      setStrokeWidth(0);
    }
  }, [
    activeRegion?.id,
    activeRegion?.text,
    activeRegion?.textColor,
    activeRegion?.strokeColor,
    activeRegion?.strokeWidth,
    activeRegion?.fontSize,
    activeRegion?.align,
    activeRegion?.italic,
    activeRegion?.rotation,
  ]);

  // 选中框（套索闭合/点选）时自动聚焦输入框，直接打字
  useEffect(() => {
    if (activeId) {
      textAreaRef.current?.focus();
    }
  }, [activeId]);

  const MAX_HISTORY = 40;

  const pushUndo = useCallback(() => {
    historyRef.current.push({ kind: "region", regions, restoredRects, canvasData: null });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoHistoryRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, [regions, restoredRects]);

  // 画笔/图章落笔前：保存底图像素快照，让画笔/图章也能撤销
  const pushCanvasUndo = useCallback(() => {
    const edit = editCanvasRef.current;
    if (!edit || !natural) return;
    const ctx = edit.getContext("2d");
    if (!ctx) return;
    const canvasData = ctx.getImageData(0, 0, natural.w, natural.h);
    historyRef.current.push({ kind: "canvas", regions, restoredRects, canvasData });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoHistoryRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, [regions, restoredRects, natural]);

  // 应用一个历史快照：恢复底图像素（如有）+ 框/恢复区
  const applyEntry = useCallback(
    (entry: HistoryEntry) => {
      if (entry.canvasData) {
        const edit = editCanvasRef.current;
        const ctx = edit?.getContext("2d");
        if (ctx) ctx.putImageData(entry.canvasData, 0, 0);
        redraw();
      }
      setRegions(entry.regions);
      setRestoredRects(entry.restoredRects);
    },
    [redraw],
  );

  const undo = useCallback(() => {
    const entry = historyRef.current.pop();
    if (!entry) return;
    const redoEntry: HistoryEntry = { kind: entry.kind, regions, restoredRects, canvasData: null };
    if (entry.kind === "canvas") {
      const edit = editCanvasRef.current;
      const ctx = edit?.getContext("2d");
      if (ctx && natural) {
        redoEntry.canvasData = ctx.getImageData(0, 0, natural.w, natural.h);
      }
    }
    redoHistoryRef.current.push(redoEntry);
    applyEntry(entry);
    setActiveId(null);
    setHistoryVersion((version) => version + 1);
  }, [regions, restoredRects, natural, applyEntry]);

  const redo = useCallback(() => {
    const entry = redoHistoryRef.current.pop();
    if (!entry) return;
    const undoEntry: HistoryEntry = { kind: entry.kind, regions, restoredRects, canvasData: null };
    if (entry.kind === "canvas") {
      const edit = editCanvasRef.current;
      const ctx = edit?.getContext("2d");
      if (ctx && natural) {
        undoEntry.canvasData = ctx.getImageData(0, 0, natural.w, natural.h);
      }
    }
    historyRef.current.push(undoEntry);
    applyEntry(entry);
    setActiveId(null);
    setHistoryVersion((version) => version + 1);
  }, [regions, restoredRects, natural, applyEntry]);

  const commitText = useCallback(() => {
    if (!activeId) return;
    setRegions((prev) =>
      prev.map((region) => (region.id === activeId ? { ...region, text: textDraft } : region)),
    );
  }, [activeId, textDraft]);

  // 点「确定」：提交文字并取消选中（去掉蓝色边框，直接展示最终效果）
  const handleConfirm = () => {
    commitText();
    setActiveId(null);
    setTextDraft("");
  };

  const clientToNatural = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas || !natural) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * natural.w,
      y: ((clientY - rect.top) / rect.height) * natural.h,
    };
  };

  const hitTest = (p: Point): Region | null => {
    for (let i = regions.length - 1; i >= 0; i -= 1) {
      if (regions[i].points.length >= 3 && pointInPolygon(p, regions[i].points)) {
        return regions[i];
      }
    }
    return null;
  };

  // 取色填充：采样多边形内的主色
  const sampleFillColor = useCallback(
    (points: Point[]): string => {
      const base = baseCanvasRef.current;
      const baseCtx = base?.getContext("2d");
      if (!base || !baseCtx || !natural) return "#ffffff";
      const { minX, minY, maxX, maxY } = polygonBounds(points);
      const pad = 1;
      const x0 = Math.max(0, Math.floor(minX) - pad);
      const y0 = Math.max(0, Math.floor(minY) - pad);
      const x1 = Math.min(natural.w - 1, Math.ceil(maxX) + pad);
      const y1 = Math.min(natural.h - 1, Math.ceil(maxY) + pad);
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      if (w <= 0 || h <= 0) return "#ffffff";
      const img = baseCtx.getImageData(x0, y0, w, h).data;

      const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
      for (let py = 0; py < h; py += 1) {
        for (let px = 0; px < w; px += 1) {
          if (!pointInPolygon({ x: x0 + px + 0.5, y: y0 + py + 0.5 }, points)) continue;
          const o = (py * w + px) * 4;
          const r = img[o];
          const g = img[o + 1];
          const b = img[o + 2];
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const existing = buckets.get(key);
          if (existing) {
            existing.count += 1;
            existing.r += r;
            existing.g += g;
            existing.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }
      }
      let best: { count: number; r: number; g: number; b: number } | null = null;
      for (const bucket of buckets.values()) {
        if (!best || bucket.count > best.count) best = bucket;
      }
      if (!best || best.count === 0) return "#ffffff";
      return rgbToHex(best.r / best.count, best.g / best.count, best.b / best.count);
    },
    [natural],
  );

  // 磁性套索：预计算梯度
  const ensureGradient = useCallback(() => {
    if (gradientRef.current && gradientSizeRef.current) return;
    const base = baseCanvasRef.current;
    const baseCtx = base?.getContext("2d");
    if (!base || !baseCtx || !natural) return;
    const data = baseCtx.getImageData(0, 0, natural.w, natural.h).data;
    const { w, h } = natural;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const gx =
          -gray[i - 1 - w] + gray[i + 1 - w] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i - 1 + w] + gray[i + 1 + w];
        const gy =
          -gray[i - 1 - w] - 2 * gray[i - w] - gray[i + 1 - w] + gray[i - 1 + w] + 2 * gray[i + w] + gray[i + 1 + w];
        mag[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    gradientRef.current = mag;
    gradientSizeRef.current = { w, h };
  }, [natural]);

  const snapToEdge = useCallback(
    (p: Point): Point => {
      const mag = gradientRef.current;
      const size = gradientSizeRef.current;
      if (!mag || !size) return p;
      const radius = Math.max(8, Math.round(Math.min(size.w, size.h) / 120));
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      const x0 = Math.max(1, cx - radius);
      const x1 = Math.min(size.w - 2, cx + radius);
      const y0 = Math.max(1, cy - radius);
      const y1 = Math.min(size.h - 2, cy + radius);
      let bestX = cx;
      let bestY = cy;
      let bestMag = -1;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const m = mag[y * size.w + x];
          if (m > bestMag) {
            bestMag = m;
            bestX = x;
            bestY = y;
          }
        }
      }
      return { x: bestX, y: bestY };
    },
    [],
  );

  const closePolygon = useCallback(
    (points: Point[]) => {
      if (points.length < 3) return;
      const fill = fillMode === "sample" ? sampleFillColor(points) : "#ffffff";
      const id = nextRegionId();
      pushUndo();
      const region: Region = { id, points, text: "", fill, textColor, strokeColor: null, strokeWidth: 0, fontSize, align: "center", italic: false, rotation: 0, noFill: false };
      setRegions((prev) => [...prev, region]);
      setActiveId(id);
      setTextDraft("");
      setTool("move");
      setDrawing(null);
    },
    [fillMode, sampleFillColor, textColor, fontSize, pushUndo],
  );

  // 画笔：在底图编辑层画一段线
  const strokeBrush = (from: Point, to: Point) => {
    const edit = editCanvasRef.current;
    const ctx = edit?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  // 吸管：取画布某点的颜色作为画笔色
  const pickColor = (p: Point) => {
    const edit = editCanvasRef.current;
    const ctx = edit?.getContext("2d");
    if (!ctx || !natural) return;
    const x = Math.max(0, Math.min(natural.w - 1, Math.round(p.x)));
    const y = Math.max(0, Math.min(natural.h - 1, Math.round(p.y)));
    const data = ctx.getImageData(x, y, 1, 1).data;
    setBrushColor(rgbToHex(data[0], data[1], data[2]));
    setPicking(false);
  };

  // 图章：采集一块矩形区域作为纹理
  const captureStamp = (rect: { x: number; y: number; w: number; h: number }) => {
    const edit = editCanvasRef.current;
    if (!edit) return;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(rect.w));
    c.height = Math.max(1, Math.round(rect.h));
    c.getContext("2d")?.drawImage(edit, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    stampCanvasRef.current = c;
    setStampSource(rect);
  };

  // 图章：把纹理贴到鼠标位置（以纹理中心对齐）
  const placeStamp = (p: Point) => {
    const edit = editCanvasRef.current;
    const stamp = stampCanvasRef.current;
    const ctx = edit?.getContext("2d");
    if (!ctx || !stamp) return;
    ctx.drawImage(stamp, p.x - stamp.width / 2, p.y - stamp.height / 2);
  };

  // 文本工具：在点击处创建一个无填充的纯文本框
  const createTextItem = (p: Point) => {
    const w = Math.max(fontSize * 8, 160);
    const h = Math.max(fontSize * 3, 48);
    const id = nextRegionId();
    pushUndo();
    const region: Region = {
      id,
      points: [
        { x: p.x - w / 2, y: p.y - h / 2 },
        { x: p.x + w / 2, y: p.y - h / 2 },
        { x: p.x + w / 2, y: p.y + h / 2 },
        { x: p.x - w / 2, y: p.y + h / 2 },
      ],
      text: "",
      fill: "#ffffff",
      textColor,
      strokeColor: null,
      strokeWidth: 0,
      fontSize,
      align: "center",
      italic: false,
      rotation: 0,
      noFill: true,
    };
    setRegions((prev) => [...prev, region]);
    setActiveId(id);
    setTextDraft("");
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = clientToNatural(event.clientX, event.clientY);

    // 吸管取色中：点一下取色，不绘制
    if (picking) {
      pickColor(p);
      return;
    }

    if (tool === "move") {
      const hit = hitTest(p);
      if (hit) {
        commitText();
        setActiveId(hit.id);
        setDragState({ id: hit.id, last: p });
      } else {
        commitText();
        setActiveId(null);
      }
      return;
    }

    if (tool === "restore") {
      setRestoreDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    if (tool === "brush") {
      pushCanvasUndo();
      brushLastRef.current = p;
      const edit = editCanvasRef.current;
      const ctx = edit?.getContext("2d");
      if (ctx) {
        ctx.fillStyle = brushColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, brushSize / 2), 0, Math.PI * 2);
        ctx.fill();
      }
      redraw();
      return;
    }

    if (tool === "stamp") {
      if (stampSource) {
        pushCanvasUndo();
        placeStamp(p);
        redraw();
      } else {
        setStampDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }
      return;
    }

    if (tool === "text") {
      createTextItem(p);
      return;
    }

    if (tool === "polygonal") {
      setDrawing((prev) => {
        const pts = prev ?? [];
        const closeThreshold = Math.max(12, (natural?.w ?? 1000) / 120);
        if (pts.length >= 3 && dist(p, pts[0]) <= closeThreshold) {
          closePolygon(pts);
          return null;
        }
        return [...pts, p];
      });
      return;
    }

    // freehand / magnetic
    if (tool === "magnetic") ensureGradient();
    setDrawing([tool === "magnetic" ? snapToEdge(p) : p]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = clientToNatural(event.clientX, event.clientY);

    if (restoreDraft) {
      setRestoreDraft((prev) => (prev ? { ...prev, x1: p.x, y1: p.y } : prev));
      return;
    }

    if (brushLastRef.current && tool === "brush") {
      const last = brushLastRef.current;
      strokeBrush(last, p);
      brushLastRef.current = p;
      redraw();
      return;
    }

    if (stampDraft) {
      setStampDraft((prev) => (prev ? { ...prev, x1: p.x, y1: p.y } : prev));
      return;
    }

    // 图章工具 + 已采集纹理：更新预览位置
    if (tool === "stamp" && stampSource) {
      stampPreviewRef.current = p;
      redraw();
    }

    if (dragState) {
      const dx = p.x - dragState.last.x;
      const dy = p.y - dragState.last.y;
      setRegions((prev) =>
        prev.map((region) =>
          region.id === dragState.id
            ? {
                ...region,
                points: region.points.map((q) => ({ x: q.x + dx, y: q.y + dy })),
              }
            : region,
        ),
      );
      setDragState({ id: dragState.id, last: p });
      return;
    }

    if (drawing && tool !== "polygonal") {
      const point = tool === "magnetic" ? snapToEdge(p) : p;
      setDrawing((prev) => {
        if (!prev) return prev;
        const last = prev[prev.length - 1];
        if (dist(point, last) < 1) return prev;
        return [...prev, point];
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (restoreDraft) {
      const x = Math.min(restoreDraft.x0, restoreDraft.x1);
      const y = Math.min(restoreDraft.y0, restoreDraft.y1);
      const w = Math.abs(restoreDraft.x1 - restoreDraft.x0);
      const h = Math.abs(restoreDraft.y1 - restoreDraft.y0);
      if (w > 3 && h > 3) {
        pushUndo();
        setRestoredRects((prev) => [...prev, { id: nextRegionId(), x, y, w, h }]);
      }
      setRestoreDraft(null);
      return;
    }

    if (brushLastRef.current && tool === "brush") {
      brushLastRef.current = null;
      return;
    }

    if (stampDraft) {
      const x = Math.min(stampDraft.x0, stampDraft.x1);
      const y = Math.min(stampDraft.y0, stampDraft.y1);
      const w = Math.abs(stampDraft.x1 - stampDraft.x0);
      const h = Math.abs(stampDraft.y1 - stampDraft.y0);
      setStampDraft(null);
      if (w > 3 && h > 3) {
        captureStamp({ x, y, w, h });
      }
      return;
    }

    if (dragState) {
      setDragState(null);
      return;
    }

    if (drawing && tool !== "polygonal") {
      if (drawing.length >= 3) {
        closePolygon(drawing);
      } else {
        setDrawing(null);
      }
    }
  };

  // Esc 取消进行中的框选
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawing(null);
        setDragState(null);
        setRestoreDraft(null);
        setStampDraft(null);
        brushLastRef.current = null;
        stampPreviewRef.current = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做；输入框聚焦时不拦截，交给浏览器处理文字撤销
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      event.preventDefault();
      if (key === "z" && event.shiftKey) {
        redo();
      } else if (key === "z") {
        undo();
      } else if (key === "y") {
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const deleteActive = () => {
    if (!activeId) return;
    pushUndo();
    setRegions((prev) => prev.filter((region) => region.id !== activeId));
    setActiveId(null);
    setTextDraft("");
  };

  const clearAll = () => {
    if (regions.length === 0 && restoredRects.length === 0) return;
    pushUndo();
    setRegions([]);
    setRestoredRects([]);
    setActiveId(null);
    setTextDraft("");
  };

  const changeTextColor = (color: string) => {
    setTextColor(color);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, textColor: color } : region)),
      );
    }
  };

  const changeStrokeColor = (color: string | null) => {
    setStrokeColor(color);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, strokeColor: color } : region)),
      );
    }
  };

  const changeStrokeWidth = (width: number) => {
    setStrokeWidth(width);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, strokeWidth: width } : region)),
      );
    }
  };

  const changeFontSize = (size: number) => {
    setFontSize(size);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, fontSize: size } : region)),
      );
    }
  };

  const changeAlign = (next: "left" | "center" | "right") => {
    setAlign(next);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, align: next } : region)),
      );
    }
  };

  const changeItalic = (next: boolean) => {
    setItalic(next);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, italic: next } : region)),
      );
    }
  };

  const changeRotation = (deg: number) => {
    setRotation(deg);
    if (activeId) {
      setRegions((prev) =>
        prev.map((region) => (region.id === activeId ? { ...region, rotation: deg } : region)),
      );
    }
  };

  /** 把当前画布导出为 PNG 并写盘（不含外框/套索标注）。返回 Promise，出错抛异常。 */
  const exportAndSave = async () => {
    commitText();
    // 导出到独立画布（不含外框/套索标注），避免把蓝色选中框一并存进图片
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = natural.w;
    exportCanvas.height = natural.h;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("生成图片失败");
    paint(ctx, false);
    const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("生成图片失败");
    const base64 = await blobToBase64(blob);
    await invoke("save_comic_translation", {
      resourceRoot,
      groupId,
      chapterName,
      pageName,
      imageData: base64,
    });
  };

  const handleSave = async () => {
    if (saving || !natural) return;
    setSaving(true);
    setSaveError(null);
    try {
      await exportAndSave();
      onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  /** 编辑器内翻页：当前页有未保存的框/恢复区则先存盘，再切页 */
  const navigate = async (dir: -1 | 1) => {
    if (saving || !natural) return;
    const target = pageIndex + dir;
    if (target < 0 || target >= totalPages) return;
    setSaveError(null);
    if (regions.length > 0 || restoredRects.length > 0) {
      setSaving(true);
      try {
        await exportAndSave();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    onNavigate(dir);
  };

  const handleDelete = async () => {
    if (deleting) {
      setDeleting(false);
      setSaving(true);
      setSaveError(null);
      try {
        await invoke("delete_comic_translation", {
          resourceRoot,
          groupId,
          chapterName,
          pageName,
        });
        onSaved();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    } else {
      setDeleting(true);
      window.setTimeout(() => setDeleting(false), 3000);
    }
  };

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = { startX: event.clientX, startWidth: panelWidth };
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStartRef.current) return;
    const dx = resizeStartRef.current.startX - event.clientX;
    setPanelWidth(Math.min(800, Math.max(280, resizeStartRef.current.startWidth + dx)));
  };
  const onResizeEnd = () => {
    resizeStartRef.current = null;
  };

  const containerStyle = useMemo(
    () => ({ width: `${display.w}px`, height: `${display.h}px` }),
    [display],
  );

  const toolButtons: { key: Tool; label: string; icon: JSX.Element }[] = [
    { key: "move", label: "选择", icon: <MousePointer2 className="h-3.5 w-3.5" /> },
    { key: "freehand", label: "自由", icon: <PenLine className="h-3.5 w-3.5" /> },
    { key: "polygonal", label: "多边形", icon: <Check className="h-3.5 w-3.5" /> },
    { key: "magnetic", label: "磁性", icon: <Magnet className="h-3.5 w-3.5" /> },
    ...(resuming
      ? [{ key: "restore" as Tool, label: "恢复", icon: <RotateCcw className="h-3.5 w-3.5" /> }]
      : []),
    { key: "brush", label: "画笔", icon: <Brush className="h-3.5 w-3.5" /> },
    { key: "stamp", label: "图章", icon: <Stamp className="h-3.5 w-3.5" /> },
    { key: "text", label: "文本", icon: <Type className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/85 backdrop-blur-sm">
      {/* 顶栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
        <p className="text-sm font-semibold text-white">
          翻译本页 · {pageName}
          {resuming ? (
            <span className="ml-2 rounded-full border border-emerald-300/30 bg-emerald-300/12 px-2 py-0.5 text-[11px] font-normal text-emerald-100/85">
              续接上次翻译
            </span>
          ) : null}
        </p>

        <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={saving || pageIndex <= 0}
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs text-white/70 transition hover:bg-white/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title="上一页（有未保存编辑会先自动保存）"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </button>
          <span className="px-1 text-xs tabular-nums text-white/60">
            {pageIndex + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => navigate(1)}
            disabled={saving || pageIndex >= totalPages - 1}
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs text-white/70 transition hover:bg-white/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title="下一页（有未保存编辑会先自动保存）"
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
          {toolButtons.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => {
                setDrawing(null);
                setDragState(null);
                setRestoreDraft(null);
                setStampDraft(null);
                brushLastRef.current = null;
                setPicking(false);
                setTool(b.key);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
                tool === b.key ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white"
              }`}
            >
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
          <button
            type="button"
            onClick={() => setFillMode("sample")}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
              fillMode === "sample" ? "bg-emerald-300/25 text-emerald-50" : "text-white/60 hover:text-white"
            }`}
          >
            <Pipette className="h-3.5 w-3.5" />
            取色填充
          </button>
          <button
            type="button"
            onClick={() => setFillMode("white")}
            className={`rounded-full px-2.5 py-1 text-xs transition ${
              fillMode === "white" ? "bg-emerald-300/25 text-emerald-50" : "text-white/60 hover:text-white"
            }`}
          >
            白色
          </button>
        </div>

        <button
          type="button"
          onClick={undo}
          disabled={historyRef.current.length === 0}
          className="inline-flex items-center gap-1 rounded-full border border-white/14 bg-white/6 px-2.5 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:opacity-40"
          title="撤销"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={redoHistoryRef.current.length === 0}
          className="inline-flex items-center gap-1 rounded-full border border-white/14 bg-white/6 px-2.5 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:opacity-40"
          title="重做"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRefPanel((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              showRefPanel
                ? "border-sky-300/40 bg-sky-300/20 text-sky-100"
                : "border-white/14 bg-white/6 text-white/76 hover:bg-white/14"
            }`}
            title="显示/隐藏翻译参考侧栏"
          >
            <Languages className="h-3.5 w-3.5" />
            翻译参考
          </button>
          {resuming && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                deleting
                  ? "border-rose-300/60 bg-rose-300/30 text-rose-50"
                  : "border-rose-300/25 bg-rose-300/10 text-rose-200/85 hover:bg-rose-300/20"
              }`}
              title="删除此页翻译，整页恢复原图"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "确认删除？" : "删除翻译"}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-300/25 px-4 py-1.5 text-sm text-sky-50 transition hover:bg-sky-300/35 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "保存中…" : "保存翻译"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/6 px-4 py-1.5 text-sm text-white/76 transition hover:bg-white/14 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            关闭
          </button>
        </div>
      </div>

      {/* 提示行 */}
      <div className="shrink-0 px-5 pb-1 text-xs text-white/42">
        {TOOL_HINTS[tool]} · Ctrl+滚轮缩放 · Esc 取消
      </div>

      {/* 画布区（可滚动平移，放大后超界自动滚动） + 翻译参考侧栏 */}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 flex-1">
        <div ref={wrapRef} className="flex min-h-0 flex-1 overflow-auto px-4 pb-2">
          {loading ? (
            <div className="m-auto flex items-center gap-2 text-sm text-white/62">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载原图…
            </div>
          ) : loadError ? (
            <div className="m-auto text-sm text-rose-200/85">{loadError}</div>
          ) : (
            <div className="m-auto" style={containerStyle}>
              <canvas
                ref={canvasRef}
                width={natural?.w ?? 1}
                height={natural?.h ?? 1}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`h-full w-full touch-none select-none ${
                  tool === "move" && !picking ? "cursor-default" : "cursor-crosshair"
                }`}
              />
            </div>
          )}
        </div>

        {!loading && !loadError && (
          <div className="absolute bottom-3 right-4 flex items-center gap-1 rounded-full border border-white/14 bg-black/60 p-1 backdrop-blur">
            <button
              type="button"
              onClick={resetZoom}
              title="适应窗口"
              className="rounded-full px-2 py-1 text-xs text-white/70 transition hover:bg-white/12 hover:text-white"
            >
              适应
            </button>
            <button
              type="button"
              onClick={zoomOut}
              title="缩小"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-white/70 transition hover:bg-white/12 hover:text-white"
            >
              −
            </button>
            <span className="w-12 text-center text-xs tabular-nums text-white/70">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              title="放大"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-white/70 transition hover:bg-white/12 hover:text-white"
            >
              +
            </button>
          </div>
        )}
        </div>

        {showRefPanel && (
          <aside
            className="relative flex shrink-0 flex-col border-l border-white/10 bg-black/40"
            style={{ width: panelWidth }}
          >
            <div
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-sky-300/40"
              title="拖动调整宽度"
            />
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="text-xs text-white/60">翻译参考 · Bing</span>
              <button
                type="button"
                onClick={() => setShowRefPanel(false)}
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
                title="收起侧栏"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <iframe
              src={TRANSLATOR_URL}
              title="翻译参考"
              className="min-h-0 w-full flex-1 border-0 bg-white"
            />
          </aside>
        )}
      </div>

      {/* 画笔/图章控制条（仅在对应工具激活时显示） */}
      {(tool === "brush" || tool === "stamp") && (
        <div className="shrink-0 border-t border-white/10 bg-white/4 px-5 py-2.5">
          {tool === "brush" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span>画笔色</span>
              <input
                type="color"
                value={brushColor}
                onChange={(event) => setBrushColor(event.target.value)}
                className="h-7 w-9 cursor-pointer rounded border border-white/14 bg-transparent"
                title="画笔颜色"
              />
              <button
                type="button"
                onClick={() => setPicking(true)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 transition ${
                  picking
                    ? "border-emerald-300/50 bg-emerald-300/25 text-emerald-50"
                    : "border-white/14 bg-white/6 text-white/76 hover:bg-white/14"
                }`}
                title="吸管取色：点一下画面取该处颜色"
              >
                <Pipette className="h-3.5 w-3.5" />
                {picking ? "点画面取色…" : "取色"}
              </button>
              <span>粗细</span>
              <input
                type="range"
                min={2}
                max={Math.max(80, Math.round((natural?.w ?? 1000) / 12))}
                value={brushSize}
                onChange={(event) => setBrushSize(Number.parseInt(event.target.value, 10))}
                className="h-1.5 w-32 cursor-pointer"
              />
              <span className="w-8 text-right tabular-nums">{brushSize}</span>
              <span className="ml-auto text-white/35">按住拖动涂画，覆盖背景文字</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-white/55">
              {stampSource ? (
                <>
                  <span className="text-emerald-200/85">纹理已采集（绿色框标记）· 点画面放置</span>
                  <button
                    type="button"
                    onClick={() => setStampSource(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/14 bg-white/6 px-2.5 py-1.5 text-white/76 transition hover:bg-white/14"
                  >
                    重新取纹理
                  </button>
                </>
              ) : (
                <span>拖动框选一块背景纹理，之后点击画面即可把它复制过去覆盖文字</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 底部输入栏 */}
      <div className="shrink-0 border-t border-white/10 px-5 py-3">
        {saveError ? <p className="mb-2 text-xs text-rose-300">{saveError}</p> : null}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <textarea
              ref={textAreaRef}
              value={textDraft}
              onChange={(event) => {
                setTextDraft(event.target.value);
                if (activeId) {
                  setRegions((prev) =>
                    prev.map((region) =>
                      region.id === activeId ? { ...region, text: event.target.value } : region,
                    ),
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  commitText();
                }
              }}
              disabled={!activeId}
              rows={1}
              placeholder={activeId ? "输入译文（回车确认，Shift+回车换行）…" : "用套索工具框选一个对话框"}
              className="w-full resize-none overflow-y-auto rounded-[12px] border border-white/14 bg-black/30 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50 disabled:opacity-40"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-white/55">
            <span>字号</span>
            <input
              type="range"
              min={10}
              max={Math.max(24, Math.round((natural?.w ?? 1000) / 20))}
              value={fontSize}
              onChange={(event) => changeFontSize(Number.parseInt(event.target.value, 10))}
              className="h-1.5 w-24 cursor-pointer"
            />
            <span className="w-8 text-right tabular-nums">{fontSize}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-white/55">
            <span>字色</span>
            <input
              type="color"
              value={textColor}
              onChange={(event) => changeTextColor(event.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-white/14 bg-transparent"
              title="字体颜色"
            />
          </div>
          {activeId && (
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-white/55">
              <span>描边</span>
              <button
                type="button"
                onClick={() => {
                  if (strokeColor) {
                    changeStrokeColor(null);
                  } else {
                    changeStrokeColor("#ffffff");
                    if (strokeWidth === 0) {
                      changeStrokeWidth(Math.max(2, Math.round(fontSize / 6)));
                    }
                  }
                }}
                className={`rounded-full px-2.5 py-1 transition ${
                  strokeColor
                    ? "bg-sky-300/25 text-sky-50"
                    : "text-white/60 hover:text-white/88"
                }`}
                title="文字描边（填充 + 边框）"
              >
                {strokeColor ? "开" : "关"}
              </button>
              {strokeColor && (
                <>
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(event) => changeStrokeColor(event.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-white/14 bg-transparent"
                    title="描边颜色"
                  />
                  <input
                    type="range"
                    min={1}
                    max={Math.max(12, Math.round(fontSize / 2))}
                    value={Math.max(1, strokeWidth)}
                    onChange={(event) => changeStrokeWidth(Number.parseInt(event.target.value, 10))}
                    className="h-1.5 w-16 cursor-pointer"
                    title="描边粗细"
                  />
                  <span className="w-6 text-right tabular-nums">{Math.max(1, strokeWidth)}</span>
                </>
              )}
            </div>
          )}
          {activeId && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/14 bg-white/7 p-0.5">
              <button
                type="button"
                onClick={() => changeAlign("left")}
                className={`rounded-full p-1.5 transition ${
                  align === "left" ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white"
                }`}
                title="左对齐"
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => changeAlign("center")}
                className={`rounded-full p-1.5 transition ${
                  align === "center" ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white"
                }`}
                title="居中"
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => changeAlign("right")}
                className={`rounded-full p-1.5 transition ${
                  align === "right" ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white"
                }`}
                title="右对齐"
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {activeId && (
            <button
              type="button"
              onClick={() => changeItalic(!italic)}
              className={`rounded-full p-1.5 transition ${
                italic ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white"
              }`}
              title="斜体"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
          )}
          {activeId && (
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-white/55">
              <span>旋转</span>
              <input
                type="range"
                min={-45}
                max={45}
                value={rotation}
                onChange={(event) => changeRotation(Number.parseInt(event.target.value, 10))}
                className="h-1.5 w-16 cursor-pointer"
                title="旋转角度"
              />
              <span className="w-8 text-right tabular-nums">{rotation}°</span>
            </div>
          )}
          <button
            type="button"
            onClick={deleteActive}
            disabled={!activeId}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-300/25 bg-rose-300/10 px-3 py-1.5 text-xs text-rose-200/85 transition hover:bg-rose-300/20 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删此框
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={regions.length === 0}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/14 disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5" />
            清空
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!activeId}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 在框选多边形内绘制自动换行的居中文字 */
function drawRegionText(ctx: CanvasRenderingContext2D, region: Region, fontSize: number) {
  const text = region.text.trim();
  if (!text) return;
  const { minX, minY, maxX, maxY } = polygonBounds(region.points);
  const padding = fontSize * 0.5;
  const maxW = Math.max(fontSize, maxX - minX - padding * 2);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfW = (maxX - minX) / 2;

  ctx.save();
  ctx.fillStyle = region.textColor;
  const italicPrefix = region.italic ? "italic " : "";
  ctx.font = `${italicPrefix}500 ${fontSize}px -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const hasStroke = Boolean(region.strokeColor) && region.strokeWidth > 0;
  if (hasStroke) {
    ctx.strokeStyle = region.strokeColor as string;
    ctx.lineWidth = region.strokeWidth;
  }

  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }

  const lineHeight = fontSize * 1.3;
  const totalH = lines.length * lineHeight;

  // 旋转：绕文字块中心
  ctx.translate(centerX, centerY);
  if (region.rotation) {
    ctx.rotate((region.rotation * Math.PI) / 180);
  }

  // 水平对齐（相对中心的 x 基准）
  let x = 0;
  ctx.textAlign = "center";
  if (region.align === "left") {
    ctx.textAlign = "left";
    x = -halfW + padding;
  } else if (region.align === "right") {
    ctx.textAlign = "right";
    x = halfW - padding;
  }

  let y = -totalH / 2 + lineHeight / 2;
  for (const line of lines) {
    if (hasStroke) {
      ctx.strokeText(line, x, y);
    }
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  ctx.restore();
}
