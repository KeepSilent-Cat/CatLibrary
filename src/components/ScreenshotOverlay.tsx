import { Camera, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearLibraryIndexCache } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";

interface Selection {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

interface ScreenCaptureResult {
  left: number;
  top: number;
  width: number;
  height: number;
  imageBase64: string;
}

function rectOf(selection: Selection) {
  return {
    left: Math.min(selection.startX, selection.x),
    top: Math.min(selection.startY, selection.y),
    width: Math.abs(selection.x - selection.startX),
    height: Math.abs(selection.y - selection.startY),
  };
}

export default function ScreenshotOverlay() {
  const open = useAppStore((state) => state.screenshotOpen);
  const closeScreenshot = useAppStore((state) => state.closeScreenshot);
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const screenshotTarget = useAppStore((state) => state.screenshotTarget);
  const bumpCoverRefresh = useAppStore((state) => state.bumpCoverRefresh);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  selectionRef.current = selection;

  const reset = useCallback(() => {
    setSelection(null);
    setDragging(false);
    setSaving(false);
    setHiding(false);
    setError(null);
  }, []);

  // 打开时直接进入选区状态，不预截屏
  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open, reset]);

  const cancel = useCallback(() => {
    reset();
    closeScreenshot();
  }, [reset, closeScreenshot]);

  // 键盘：Esc 取消，Enter 保存
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "Enter" && selectionRef.current && !saving) {
        event.preventDefault();
        void confirmSave();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving, cancel]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (saving) {
      return;
    }
    // 忽略按钮上的按下（保存/取消按钮的 mousedown 不能触发新选区）
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    startPointRef.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    setSelection({
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragging || !startPointRef.current) {
      return;
    }
    setSelection({
      startX: startPointRef.current.x,
      startY: startPointRef.current.y,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleMouseUp = () => {
    setDragging(false);
    startPointRef.current = null;
  };

  const confirmSave = async () => {
    const currentSelection = selectionRef.current;
    if (!currentSelection || saving) {
      return;
    }
    const sel = rectOf(currentSelection);
    if (sel.width < 4 || sel.height < 4) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 1. 瞬间隐藏遮罩（含选区框），等两帧让合成器提交
      setHiding(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      // 2. 抓屏（GDI，~50ms，此刻画面干净）
      let capture: ScreenCaptureResult;
      try {
        capture = await invoke<ScreenCaptureResult>("capture_screen_instant");
      } finally {
        setHiding(false); // 无论成败立即恢复遮罩
      }

      // 3. base64 → Blob → ImageBitmap
      const binary = atob(capture.imageBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);

      // 4. 选区坐标（CSS px）→ 屏幕物理像素
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.max(0, Math.round((window.screenX + sel.left) * dpr) - capture.left);
      const sy = Math.max(0, Math.round((window.screenY + sel.top) * dpr) - capture.top);
      const sw = Math.min(capture.width - sx, Math.round(sel.width * dpr));
      const sh = Math.min(capture.height - sy, Math.round(sel.height * dpr));
      if (sw <= 0 || sh <= 0 || sx >= capture.width || sy >= capture.height) {
        throw new Error("选区超出屏幕范围");
      }

      // 5. 裁剪
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("无法创建画布");
      }
      context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      const outBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出图片失败"))), "image/png");
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(outBlob);
      });

      // 6. 保存（截图库 或 游戏封面目录）
      const imageData = dataUrl.split(",")[1] ?? "";
      if (screenshotTarget.type === "game-cover") {
        await invoke("add_game_covers", {
          resourceRoot,
          groupId: screenshotTarget.groupId,
          images: [{ name: "capture.png", data: imageData }],
        });
        bumpCoverRefresh();
        clearLibraryIndexCache(resourceRoot);
        closeScreenshot();
        setSavedToast("已设为游戏封面");
      } else {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const displayName = `屏幕截图 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        await invoke("save_crop_screenshot", {
          resourceRoot,
          tempPath: "",
          imageData,
          displayName,
        });
        clearLibraryIndexCache(resourceRoot);
        closeScreenshot();
        setSavedToast("截图已保存到截图库");
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : String(currentError));
      setHiding(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  const selRect = selection ? rectOf(selection) : null;

  return (
    <div
      className={`fixed inset-0 z-[100] cursor-crosshair bg-black/60 ${hiding ? "pointer-events-none opacity-0" : "opacity-100"}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* 选区框 */}
      {selRect && selRect.width > 0 && selRect.height > 0 && (
        <>
          <div
            className="absolute border-2 border-sky-300/90"
            style={{
              left: selRect.left,
              top: selRect.top,
              width: selRect.width,
              height: selRect.height,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          />
          <div
            className="absolute rounded-md bg-sky-300 px-2 py-0.5 text-xs font-medium text-slate-900"
            style={{ left: selRect.left, top: selRect.top - 26 }}
          >
            {Math.round(selRect.width)} x {Math.round(selRect.height)}
          </div>
          <div
            className="absolute flex gap-2"
            style={{ left: selRect.left + selRect.width - 96, top: selRect.top + selRect.height + 10 }}
          >
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void confirmSave();
              }}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-sky-200 disabled:opacity-60"
            >
              <Camera className="h-3.5 w-3.5" />
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                cancel();
              }}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/25 disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
          </div>
        </>
      )}

      {/* 底部提示 */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-xs text-white/75 backdrop-blur-sm">
        {saving ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在保存…
          </span>
        ) : (
          "拖动选择截图区域 · Enter 保存 · Esc 取消"
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 rounded-full border border-rose-300/30 bg-black/70 px-4 py-2 text-xs text-rose-200 backdrop-blur-sm">
          {error}
        </div>
      )}
    </div>
  );
}
