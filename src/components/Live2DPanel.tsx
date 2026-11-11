import { invoke } from "@tauri-apps/api/core";
import RigViewer from "./RigViewer";
import ViewerErrorBoundary from "./ViewerErrorBoundary";
import { open } from "@tauri-apps/plugin-dialog";
import { Box, FileImage, Layers, Loader2, Smile, Trash2 } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { clearLibraryIndexCache } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";

// 重量级渲染器按需加载：Live2D framework 与 ag-psd 只在真正打开对应标签页时下载
const Live2DViewer = lazy(() => import("./Live2DViewer"));
const PSDViewer = lazy(() => import("./PSDViewer"));

function ViewerFallback() {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center gap-2 rounded-[24px] border border-white/12 bg-black/24 text-sm text-white/60">
      <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
      正在加载查看器…
    </div>
  );
}

interface Live2DSources {
  model3: string[];
  psd: string[];
  rig: string[];
}

interface Live2DPanelProps {
  itemId: string;
}

export default function Live2DPanel({ itemId }: Live2DPanelProps) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const [model3, setModel3] = useState<string[]>([]);
  const [psd, setPsd] = useState<string[]>([]);
  const [rig, setRig] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"model" | "psd">("model");

  const reload = useCallback(async () => {
    const result = await invoke<Live2DSources>("list_live2d_sources", { resourceRoot, itemId });
    setModel3(result.model3 ?? []);
    setPsd(result.psd ?? []);
    setRig(result.rig ?? []);
  }, [resourceRoot, itemId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<Live2DSources>("list_live2d_sources", { resourceRoot, itemId })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const models = result.model3 ?? [];
        const psds = result.psd ?? [];
        const rigs = result.rig ?? [];
        setModel3(models);
        setPsd(psds);
        setRig(rigs);
        // 分层骨架也当作「模型」展示，避免直接跳到空的 PSD 页
        setTab(models.length > 0 || rigs.length > 0 ? "model" : "psd");
        setLoading(false);
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(String(currentError));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceRoot, itemId]);

  const addPsd = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "PSD 画稿", extensions: ["psd", "psb"] }],
      });
      if (!selected) {
        return;
      }
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) {
        return;
      }
      setBusy(true);
      await invoke("add_live2d_psd", { resourceRoot, groupId: itemId, psdPaths: paths });
      clearLibraryIndexCache(resourceRoot);
      await reload();
      setTab("psd");
      setSavedToast(`已添加 ${paths.length} 个 PSD`);
    } catch (currentError) {
      setSavedToast(`添加失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const addModel = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setBusy(true);
      await invoke("add_live2d_model", { resourceRoot, groupId: itemId, modelPath: selected });
      clearLibraryIndexCache(resourceRoot);
      await reload();
      setTab("model");
      setSavedToast("模型已添加");
    } catch (currentError) {
      setSavedToast(`添加失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const removePsd = async (path: string) => {
    try {
      setBusy(true);
      await invoke("remove_live2d_psd", { resourceRoot, groupId: itemId, psdPath: path });
      clearLibraryIndexCache(resourceRoot);
      await reload();
      setSavedToast("已删除 PSD");
    } catch (currentError) {
      setSavedToast(`删除失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async () => {
    if (!window.confirm("确定删除当前模型吗？模型槽内的所有文件都会被删除。")) {
      return;
    }
    try {
      setBusy(true);
      await invoke("remove_live2d_model", { resourceRoot, groupId: itemId });
      clearLibraryIndexCache(resourceRoot);
      await reload();
      setTab("psd");
      setSavedToast("模型已删除");
    } catch (currentError) {
      setSavedToast(`删除失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const setCover = async (pngData: number[]) => {
    try {
      setBusy(true);
      await invoke("save_live2d_cover", { resourceRoot, groupId: itemId, pngData });
      clearLibraryIndexCache(resourceRoot);
      setSavedToast("封面已设置");
    } catch (currentError) {
      setSavedToast(`设置封面失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const hasModel = model3.length > 0;
  const hasRig = rig.length > 0;
  const hasPsd = psd.length > 0;
  const activeTab: "model" | "psd" =
    tab === "model" && (hasModel || hasRig) ? "model" : hasPsd ? "psd" : "model";

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-3">
      {/* Tab 栏 + 添加按钮 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-1 items-center gap-1 rounded-full border border-white/12 bg-white/6 p-1">
          <button
            type="button"
            onClick={() => setTab("model")}
            disabled={!hasModel}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
              activeTab === "model" ? "bg-sky-300/20 text-sky-50" : "text-white/60 hover:text-white"
            }`}
          >
            <Smile className="h-3.5 w-3.5" />
            模型{hasModel ? `（${model3.length}）` : ""}
          </button>
          <button
            type="button"
            onClick={() => setTab("psd")}
            disabled={!hasPsd}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
              activeTab === "psd" ? "bg-sky-300/20 text-sky-50" : "text-white/60 hover:text-white"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            PSD 图层{hasPsd ? `（${psd.length}）` : ""}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void addModel()}
          disabled={busy}
          title="添加模型（选择 runtime 目录，含 .model3.json）"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-fuchsia-300/40 bg-fuchsia-300/15 px-3 py-1.5 text-xs font-medium text-fuchsia-100 transition hover:bg-fuchsia-300/25 disabled:opacity-50"
        >
          <Box className="h-3.5 w-3.5" />
          添加模型
        </button>
        {hasModel ? (
          <button
            type="button"
            onClick={() => void removeModel()}
            disabled={busy}
            title="删除当前模型"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-300/30 bg-rose-300/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-300/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除模型
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void addPsd()}
          disabled={busy}
          title="添加 PSD 画稿"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-3 py-1.5 text-xs font-medium text-sky-100 transition hover:bg-sky-300/25 disabled:opacity-50"
        >
          <FileImage className="h-3.5 w-3.5" />
          添加 PSD
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
          正在扫描模型与 PSD…
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-rose-200">{error}</div>
      ) : !hasModel && !hasRig && !hasPsd ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-white/50">
          <p>这个角色还是空的。</p>
          <p className="text-xs leading-5 text-white/40">
            点右上角「添加模型」选 runtime 目录，或「添加 PSD」选画稿文件。
          </p>
        </div>
      ) : activeTab === "model" ? (
        hasModel ? (
          <ViewerErrorBoundary key={`${itemId}-${activeTab}`}><Suspense fallback={<ViewerFallback />}>
            <Live2DViewer modelPaths={model3} />
          </Suspense></ViewerErrorBoundary>
        ) : (
          <ViewerErrorBoundary key={`${itemId}-rig`}>
            <RigViewer manifestPath={rig[0]} />
          </ViewerErrorBoundary>
        )
      ) : (
        <ViewerErrorBoundary key={`${itemId}-${activeTab}`}><Suspense fallback={<ViewerFallback />}>
          <PSDViewer psdPaths={psd} onDeletePsd={removePsd} onSetCover={setCover} />
        </Suspense></ViewerErrorBoundary>
      )}
    </div>
  );
}
