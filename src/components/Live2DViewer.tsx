import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LAppDelegate } from "@/live2d/sample/lappdelegate";
import { setModelEntries, type ModelEntry } from "@/live2d/sample/lappdefine";

interface Live2DViewerProps {
  modelPaths: string[];
}

/** Cubism Core 脚本：走 Tauri 自带的静态资源，不再依赖 CDN（离线可用） */
const CORE_SCRIPT_SRC = "/live2dcubismcore.min.js";
/** 模型加载超时（毫秒）：超时后提示路径问题，避免一直转圈 */
const MODEL_LOAD_TIMEOUT = 20000;

let coreScriptPromise: Promise<void> | null = null;

function ensureCubismCore(): Promise<void> {
  if (typeof window !== "undefined" && window.Live2DCubismCore) {
    return Promise.resolve();
  }

  if (coreScriptPromise) {
    return coreScriptPromise;
  }

  coreScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-live2dcore="1"]`,
    );

    const script = existing ?? document.createElement("script");
    script.src = CORE_SCRIPT_SRC;
    script.async = true;
    script.dataset.live2dcore = "1";

    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        coreScriptPromise = null;
        reject(new Error(`Live2D Core 加载失败：${CORE_SCRIPT_SRC}`));
      },
      { once: true },
    );

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  return coreScriptPromise;
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

/** 把绝对路径转成官方 framework 需要的 { dir: '.../目录/', json: 'xxx.model3.json' } */
function toModelEntry(path: string): ModelEntry {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dirPath = slash >= 0 ? normalized.slice(0, slash) : normalized;
  const json = normalized.slice(slash + 1);

  let dirUrl: string;
  try {
    dirUrl = convertFileSrc(dirPath).replace(/%5C/gi, "/");
  } catch {
    dirUrl = dirPath;
  }

  return {
    dir: `${dirUrl.replace(/\/+$/, "")}/`,
    json,
    label: json.replace(/\.model3\.json$/i, ""),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

export default function Live2DViewer({ modelPaths }: Live2DViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const delegateRef = useRef<LAppDelegate | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState("正在加载 Live2D 运行环境…");
  const [error, setError] = useState<string | null>(null);
  const [debugText, setDebugText] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");

  const modelKey = modelPaths.join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (modelPaths.length === 0) {
      setLoading(false);
      setError("未找到可用模型（需要 .model3.json）");
      return;
    }

    let cancelled = false;
    let readyTimer: number | null = null;
    const entries = modelPaths.map(toModelEntry);
    const safeIndex = Math.min(modelIndex, entries.length - 1);

    const stopPolling = () => {
      if (readyTimer !== null) {
        window.clearInterval(readyTimer);
        readyTimer = null;
      }
    };

    const onResize = () => {
      delegateRef.current?.onResize();
    };

    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      setDebugText("");
      setLoadingText("正在加载 Live2D Core…");

      try {
        await ensureCubismCore();
        if (cancelled) {
          return;
        }

        setLoadingText("正在初始化渲染器…");

        // 清掉上一份实例与它的 canvas
        try {
          LAppDelegate.releaseInstance();
        } catch {
          // 旧实例可能已经处于半释放状态，忽略
        }
        container.replaceChildren();

        setModelEntries(entries);

        const delegate = LAppDelegate.getInstance();
        delegateRef.current = delegate;

        if (!delegate.initialize(container)) {
          throw new Error("WebGL2 初始化失败：当前 WebView 无法创建渲染上下文。");
        }

        delegate.changeModel(safeIndex);
        delegate.run();

        if (cancelled) {
          return;
        }

        setLoadingText("正在加载模型…");
        window.addEventListener("resize", onResize);

        const startedAt = Date.now();
        readyTimer = window.setInterval(() => {
          if (cancelled) {
            return;
          }
          const current = delegateRef.current;
          if (!current) {
            return;
          }
          if (current.isModelReady()) {
            stopPolling();
            setDebugText(current.getDebugSummary());
            setLoading(false);
          } else if (Date.now() - startedAt > MODEL_LOAD_TIMEOUT) {
            stopPolling();
            setDebugText(current.getDebugSummary());
            setLoading(false);
            setError("模型加载超时：请检查 model3.json、moc3 与贴图路径是否完整。");
          }
        }, 200);
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(formatError(bootstrapError));
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      stopPolling();
      window.removeEventListener("resize", onResize);

      try {
        LAppDelegate.releaseInstance();
      } catch {
        // 忽略释放异常，避免打断组件卸载
      }
      delegateRef.current = null;
      container.replaceChildren();
    };
    // modelKey 用字符串比较，避免父组件每次渲染新建数组导致重初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, modelIndex, reloadToken]);

  const refitModel = () => {
    try {
      delegateRef.current?.refitModel();
      if (delegateRef.current) {
        setDebugText(delegateRef.current.getDebugSummary());
      }
    } catch {
      // 忽略：没有加载完成时重新适配没有意义
    }
  };

  const currentModelName = modelPaths[modelIndex] ? baseName(modelPaths[modelIndex]) : null;
  const diagnosticsText = [error, debugText].filter(Boolean).join("\n");

  const copyDiagnostics = async () => {
    if (!diagnosticsText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(diagnosticsText);
      setCopyFeedback("已复制");
    } catch {
      setCopyFeedback("复制失败");
    }
    window.setTimeout(() => setCopyFeedback(""), 1500);
  };

  return (
    <div className="relative flex h-full min-h-[320px] flex-col overflow-hidden rounded-[24px] border border-white/12 bg-black/24">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-3 py-2">
        {modelPaths.length > 1 ? (
          <select
            value={modelIndex}
            onChange={(event) => setModelIndex(Number(event.target.value))}
            className="shrink-0 rounded-full border border-white/16 bg-white/8 px-2 py-1.5 text-xs text-white outline-none"
          >
            {modelPaths.map((path, index) => (
              <option key={path} value={index} className="bg-slate-900">
                {baseName(path)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="rounded-full border border-white/16 bg-white/8 px-2 py-1 text-xs text-white/80 transition hover:bg-white/14"
        >
          重新加载
        </button>
        <button
          type="button"
          onClick={refitModel}
          className="rounded-full border border-white/16 bg-white/8 px-2 py-1 text-xs text-white/80 transition hover:bg-white/14"
        >
          重新适配
        </button>
        {diagnosticsText ? (
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            className="rounded-full border border-sky-200/30 bg-sky-300/10 px-2 py-1 text-xs text-sky-100 transition hover:bg-sky-300/18"
          >
            {copyFeedback || "复制信息"}
          </button>
        ) : null}
        <span className="truncate text-xs text-white/50">
          {currentModelName ?? "未选择模型"} · 拖拽转视线 · 点击播放动作
        </span>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#0b0f19]">
        <div ref={containerRef} className="absolute inset-0" />

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

        {debugText ? (
          <details className="absolute left-3 top-3 z-20 max-w-[min(72%,640px)] rounded-lg border border-white/10 bg-black/55 text-[11px] text-white/70">
            <summary className="cursor-pointer px-2 py-1">调试信息</summary>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-2 pb-2 font-mono leading-4">
              {debugText}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
