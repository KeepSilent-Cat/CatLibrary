import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 分层 PNG 骨架播放器（非 Cubism）。
 *
 * 桌宠类角色用的是「一张张图层 + 一套参数」的土法骨架：manifest.json 描述图层顺序、
 * 头部/后发枢轴、眼睛中心，以及呼吸/摆动/视线幅度。这里按这套参数做最小可用的动态化：
 * 呼吸缩放、整体摆动、定时眨眼、视线跟随鼠标、点击开口说话。
 */
interface RigLayer {
  id: string;
  file: string;
  group?: string;
  role?: string;
}

interface RigMotion {
  breath?: number;
  sway?: number;
  headTurn?: number;
  gazeMax?: [number, number];
  backHairSway?: number;
}

interface RigManifest {
  name?: string;
  canvas: { w: number; h: number };
  rigOptions?: {
    headPivot?: [number, number];
    backHairPivot?: [number, number];
    eyeCenters?: { l?: [number, number]; r?: [number, number] };
    motion?: RigMotion;
    mouth?: { open?: string; hideBase?: boolean };
  };
  layers: RigLayer[];
}

interface LoadedLayer extends RigLayer {
  image: HTMLImageElement;
}

/** 把绝对路径转成 asset URL（Tauri 会把反斜杠编码成 %5C，这里还原） */
function toAssetUrl(path: string): string {
  try {
    return convertFileSrc(path.replace(/\\/g, "/")).replace(/%5C/gi, "/");
  } catch {
    return path.replace(/\\/g, "/");
  }
}

function dirName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图层加载失败：${url}`));
    image.src = url;
  });
}

export default function RigViewer({ manifestPath }: { manifestPath: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState("正在加载图层…");
  const [error, setError] = useState<string | null>(null);
  const [skinName, setSkinName] = useState("");
  const talkingUntilRef = useRef(0);
  const gazeRef = useRef({ x: 0, y: 0 });

  const triggerTalk = useCallback(() => {
    talkingUntilRef.current = performance.now() + 1600;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    let disposed = false;
    let frame = 0;
    let layers: LoadedLayer[] = [];
    let mouthOpen: HTMLImageElement | null = null;
    let manifest: RigManifest | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const ctx = canvas.getContext("2d");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      return { dpr, width, height };
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      gazeRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
      };
    };

    const onPointerLeave = () => {
      gazeRef.current = { x: 0, y: 0 };
    };

    const render = () => {
      if (disposed || !manifest || !ctx) {
        return;
      }

      const { dpr, width, height } = resize();
      const { w: cw, h: ch } = manifest.canvas;
      const fit = Math.min(width / cw, height / ch) * 0.96;
      const offsetX = (width - cw * fit) / 2;
      const offsetY = (height - ch * fit) / 2;

      const t = performance.now() / 1000;
      const motion = manifest.rigOptions?.motion ?? {};
      const breath = motion.breath ?? 0.01;
      const sway = motion.sway ?? 0.008;
      const backHairSway = motion.backHairSway ?? 0.02;
      const gazeMax = motion.gazeMax ?? [5, 3];

      const headPivot = manifest.rigOptions?.headPivot ?? [cw / 2, ch / 2];
      const backHairPivot = manifest.rigOptions?.backHairPivot ?? [cw / 2, ch * 0.2];
      const eyeCenters = manifest.rigOptions?.eyeCenters ?? {};

      const breathPhase = Math.sin(t * 1.7) * breath;
      const swayPhase = Math.sin(t * 0.85) * sway;

      // 眨眼：每 3.7 秒一次，持续约 0.13 秒
      const cycle = t % 3.7;
      const blink = cycle < 0.13 ? 0.12 : 1;

      const talking = performance.now() < talkingUntilRef.current;
      const mouthOpenFrame = talking && Math.floor(t * 8) % 2 === 0;
      const gazeX = gazeRef.current.x * gazeMax[0];
      const gazeY = gazeRef.current.y * gazeMax[1];

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * fit, 0, 0, dpr * fit, offsetX * dpr, offsetY * dpr);

      const applyAround = (
        pivot: [number, number],
        rotate: number,
        scaleY: number,
        translateX = 0,
        translateY = 0,
      ) => {
        if (!ctx) {
          return;
        }
        ctx.translate(pivot[0] + translateX, pivot[1] + translateY);
        if (rotate !== 0) {
          ctx.rotate(rotate);
        }
        if (scaleY !== 1) {
          ctx.scale(1, scaleY);
        }
        ctx.translate(-pivot[0], -pivot[1]);
      };

      for (const layer of layers) {
        const role = layer.role ?? "";
        const group = layer.group ?? "";

        // 张嘴时用开口图层替换静止的嘴
        if (role === "mouth" && mouthOpen && manifest.rigOptions?.mouth?.hideBase !== false) {
          if (mouthOpenFrame) {
            ctx.save();
            applyAround(headPivot as [number, number], swayPhase, 1 + breathPhase);
            ctx.drawImage(mouthOpen, 0, 0, cw, ch);
            ctx.restore();
            continue;
          }
        }

        ctx.save();

        const isEye = role.startsWith("eye.");
        const side = role.endsWith(".l") ? "l" : role.endsWith(".r") ? "r" : null;
        const eyeCenter = side ? (eyeCenters as Record<string, [number, number] | undefined>)[side] : undefined;

        if (role === "hair.back") {
          applyAround(backHairPivot as [number, number], Math.sin(t * 0.9) * backHairSway, 1);
        } else if (group === "head") {
          applyAround(headPivot as [number, number], swayPhase, 1 + breathPhase);
          if (isEye) {
            // 眨眼：以眼睛中心为锚点压扁
            if (eyeCenter) {
              applyAround(eyeCenter, 0, blink);
            }
            // 视线跟随：只动瞳孔
            if (role.startsWith("eye.iris") && blink > 0.5) {
              ctx.translate(gazeX, gazeY);
            }
          }
        } else {
          applyAround([cw / 2, ch], 0, 1 + breathPhase * 0.6);
        }

        ctx.drawImage(layer.image, 0, 0, cw, ch);
        ctx.restore();
      }

      frame = requestAnimationFrame(render);
    };

    const bootstrap = async () => {
      try {
        setLoading(true);
        setError(null);
        setLoadingText("正在读取骨架配置…");

        const manifestUrl = toAssetUrl(manifestPath);
        const response = await fetch(manifestUrl);
        if (!response.ok) {
          throw new Error(`读取 manifest 失败：HTTP ${response.status}`);
        }
        manifest = (await response.json()) as RigManifest;
        if (disposed) {
          return;
        }
        setSkinName(manifest.name ?? "");
        setLoadingText("正在加载图层…");

        const base = dirName(manifestPath);
        const loaded: LoadedLayer[] = [];
        for (const layer of manifest.layers ?? []) {
          try {
            const image = await loadImage(toAssetUrl(`${base}/${layer.file}`));
            loaded.push({ ...layer, image });
          } catch {
            // 缺图层不影响整体，跳过即可
          }
        }
        if (disposed) {
          return;
        }
        layers = loaded;

        const openFile = manifest.rigOptions?.mouth?.open;
        if (openFile) {
          try {
            mouthOpen = await loadImage(toAssetUrl(`${base}/${openFile}`));
          } catch {
            mouthOpen = null;
          }
        }

        setLoading(false);
        resizeObserver = new ResizeObserver(() => {
          // 下一帧自动跟随容器尺寸
        });
        resizeObserver.observe(container);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerleave", onPointerLeave);
        canvas.addEventListener("pointerdown", triggerTalk);
        render();
      } catch (currentError) {
        if (!disposed) {
          setError(currentError instanceof Error ? currentError.message : "骨架加载失败");
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", triggerTalk);
    };
  }, [manifestPath, triggerTalk]);

  return (
    <div className="relative flex h-full min-h-[320px] flex-col overflow-hidden rounded-[24px] border border-white/12 bg-black/24">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-xs text-white/70">{skinName || "分层骨架"}</span>
        <span className="rounded-full border border-white/14 bg-white/6 px-2 py-0.5 text-[10px] text-white/50">
          分层 PNG · 非 Cubism
        </span>
        <button
          type="button"
          onClick={triggerTalk}
          className="ml-auto rounded-full border border-white/16 bg-white/8 px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/14"
        >
          说句话
        </button>
        <span className="text-xs text-white/45">移动鼠标看视线 · 点击开口</span>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 bg-[#0b0f19]">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/40 text-sm text-white/70">
            <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
            {loadingText}
          </div>
        ) : error ? (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-rose-500/12 px-3 py-2 text-xs leading-5 text-rose-100">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
