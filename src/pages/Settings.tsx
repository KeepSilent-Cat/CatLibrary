import { Camera, Eye, EyeOff, FolderTree, ImagePlus, Keyboard, ShieldAlert, ToggleLeft, ToggleRight, Wallpaper } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearLibraryIndexCache } from "@/lib/library-source";
import defaultBg from "@/assets/app-background.webp";
import type {
  ImagePreviewBehavior,
  PreviewMode,
  VideoPreviewBehavior,
} from "@/data/library";
import { formatShortcut } from "@/components/AppShell";
import { useAppStore } from "@/store/useAppStore";

const previewModeOptions: Array<{ value: PreviewMode; label: string; description: string }> = [
  { value: "hover", label: "悬停触发", description: "默认静止，鼠标悬停时才开始预览。" },
  { value: "auto", label: "自动预览", description: "进入列表后直接开始预览。" },
  { value: "off", label: "关闭预览", description: "只显示静态封面，不自动轮播或播放。" },
];

const imagePreviewBehaviorOptions: Array<{
  value: ImagePreviewBehavior;
  label: string;
  description: string;
}> = [
  { value: "loop", label: "循环轮播", description: "最后一张结束后回到第一张继续轮播。" },
  { value: "stop_end", label: "停在末张", description: "轮播到最后一张后停住，保留当前画面。" },
];

const videoPreviewBehaviorOptions: Array<{
  value: VideoPreviewBehavior;
  label: string;
  description: string;
}> = [
  { value: "loop_30", label: "30 秒循环", description: "每次预览只播放前 30 秒，结束后回到开头。" },
  { value: "stop_30", label: "30 秒停住", description: "播放到 30 秒后暂停，停在当前画面。" },
  { value: "full", label: "完整播放", description: "预览时不截断，直接播放完整视频。" },
];

export default function Settings() {
  const {
    resourceRoot,
    logoSourcePath,
    relativeModeEnabled,
    previewMode,
    imagePreviewBehavior,
    videoPreviewBehavior,
    setResourceRoot,
    setLogoSourcePath,
    setRelativeModeEnabled,
    setPreviewMode,
    setImagePreviewBehavior,
    setVideoPreviewBehavior,
    ratingFilter,
    setRatingFilter,
    screenshotShortcut,
    setScreenshotShortcut,
    openScreenshot,
    gameEmbed,
    setGameEmbed,
    wallpaper,
    resetWallpaper,
    setSavedToast,
  } = useAppStore();

  // 快捷键录制：点击"录制"后监听下一次按键组合
  const [recordingKey, setRecordingKey] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = recordingKey;

  // 备份当前背景到图片分类（默认背景或自定义背景，缩放到最长边 2048 后保存）
  const backupWallpaper = async () => {
    try {
      const imageUrl = wallpaper || defaultBg;
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("加载背景图失败"));
        img.src = imageUrl;
      });
      const max = 2048;
      const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("无法创建画布");
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
      });
      const buffer = await blob.arrayBuffer();
      await invoke("add_wallpaper_to_images", {
        resourceRoot,
        pngData: Array.from(new Uint8Array(buffer)),
      });
      clearLibraryIndexCache(resourceRoot);
      setSavedToast("背景已备份到图片分类");
    } catch (currentError) {
      setSavedToast(`备份失败：${String(currentError)}`);
    }
  };

  useEffect(() => {
    if (!recordingKey) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const mods: string[] = [];
      if (event.ctrlKey) mods.push("ctrl");
      if (event.altKey) mods.push("alt");
      if (event.shiftKey) mods.push("shift");
      if (event.metaKey) mods.push("meta");
      if (event.key === "Escape") {
        setRecordingKey(false);
        return;
      }
      const key = event.key.toLowerCase();
      // 忽略纯修饰键
      if (["control", "alt", "shift", "meta"].includes(key)) {
        return;
      }
      const parts = [...mods, key];
      if (parts.length < 2) {
        return; // 必须带至少一个修饰键，避免影响正常输入
      }
      setScreenshotShortcut(parts.join("+"));
      setRecordingKey(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingKey, setScreenshotShortcut]);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="glass-panel rounded-[32px] p-6">
          <h2 className="text-xl font-semibold text-white">基础设置</h2>
          <p className="mt-2 text-sm leading-6 text-white/68">
            这里只保留最核心的设置入口，先服务于可迁移结构与基础框架验证。
          </p>

          <div className="mt-6 space-y-5">
            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <FolderTree className="h-4 w-4 text-sky-100" />
                <span>资源根目录</span>
              </div>
              <input
                value={resourceRoot}
                onChange={(event) => setResourceRoot(event.target.value)}
                className="mt-4 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-white/38 focus:bg-white/14"
              />
              <p className="mt-3 text-xs leading-6 text-white/52">
                当前用于演示相对路径基准位置，后续可接入真实目录选择。
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ShieldAlert className="h-4 w-4 text-rose-200" />
                <span>内容分级</span>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  {
                    value: 0 as const,
                    title: "仅显示全年龄",
                    description: "隐藏擦边（R15）和 18+ 内容（默认）",
                  },
                  {
                    value: 1 as const,
                    title: "显示擦边内容",
                    description: "显示全年龄 + 擦边（R15），隐藏 18+",
                  },
                  {
                    value: 2 as const,
                    title: "显示全部内容",
                    description: "包括 18+ 在内的所有内容都显示",
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRatingFilter(option.value)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                      ratingFilter === option.value
                        ? "border-rose-300/35 bg-rose-300/12 text-rose-100"
                        : "border-white/18 bg-white/10 text-white/78 hover:bg-white/14"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {ratingFilter === option.value ? (
                        <Eye className="h-4 w-4 text-rose-200" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-white/45" />
                      )}
                      {option.title}
                    </span>
                    <span
                      className={`h-4 w-4 rounded-full border transition ${
                        ratingFilter === option.value
                          ? "border-rose-200 bg-rose-300/80"
                          : "border-white/30"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-6 text-white/52">
                在图片 / 视频 / 游戏 / 漫画的详情或编辑里可给内容设置分级：全年龄（默认）、擦边 R15、
                成人 18+。擦边和 18+ 默认在列表中隐藏，添加的内容默认都是全年龄。
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Camera className="h-4 w-4 text-sky-100" />
                <span>截图快捷键</span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRecordingKey(true)}
                  disabled={recordingKey}
                  className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white transition hover:bg-white/14 disabled:opacity-70"
                >
                  <Keyboard className="h-4 w-4 text-white/50" />
                  {recordingKey ? "请按下新快捷键…" : formatShortcut(screenshotShortcut)}
                </button>
                <button
                  type="button"
                  onClick={openScreenshot}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-white/14 bg-white/8 px-4 py-3 text-xs text-white/72 transition hover:bg-white/16"
                >
                  <Camera className="h-3.5 w-3.5" />
                  立即截图
                </button>
              </div>
              <p className="mt-3 text-xs leading-6 text-white/52">
                点击后按下新的组合键（如 Ctrl+Shift+A）即可更换；Esc 取消录制。截图后拖动选择区域，
                Enter 或点保存存入截图库。
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ImagePlus className="h-4 w-4 text-sky-100" />
                <span>Logo 来源路径</span>
              </div>
              <input
                value={logoSourcePath}
                onChange={(event) => setLogoSourcePath(event.target.value)}
                className="mt-4 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-white/38 focus:bg-white/14"
              />
              <p className="mt-3 text-xs leading-6 text-white/52">
                当前界面已接入项目内复制好的 ZeroCat 图片，这里先保留可调整入口。
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Wallpaper className="h-4 w-4 text-emerald-100" />
                <span>应用背景</span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={resetWallpaper}
                  disabled={!wallpaper}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white transition hover:bg-white/14 disabled:opacity-50"
                >
                  恢复默认背景
                </button>
                <button
                  type="button"
                  onClick={() => void backupWallpaper()}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-white/14 bg-white/8 px-4 py-3 text-xs text-white/72 transition hover:bg-white/16"
                >
                  备份当前背景到图片
                </button>
              </div>
              <p className="mt-3 text-xs leading-6 text-white/52">
                可在图片分类的详情页把某张图设为应用背景；恢复默认会清掉自定义背景。
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ImagePlus className="h-4 w-4 text-sky-100" />
                <span>预览模式</span>
              </div>
              <select
                value={previewMode}
                onChange={(event) => setPreviewMode(event.target.value as PreviewMode)}
                className="mt-4 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-white/38 focus:bg-white/14"
              >
                {previewModeOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-6 text-white/52">
                {previewModeOptions.find((option) => option.value === previewMode)?.description}
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ImagePlus className="h-4 w-4 text-sky-100" />
                <span>图片轮播</span>
              </div>
              <select
                value={imagePreviewBehavior}
                onChange={(event) =>
                  setImagePreviewBehavior(event.target.value as ImagePreviewBehavior)
                }
                className="mt-4 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-white/38 focus:bg-white/14"
              >
                {imagePreviewBehaviorOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-6 text-white/52">
                {
                  imagePreviewBehaviorOptions.find((option) => option.value === imagePreviewBehavior)
                    ?.description
                }
              </p>
            </div>

            <div className="glass-chip rounded-[24px] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ImagePlus className="h-4 w-4 text-sky-100" />
                <span>视频预览</span>
              </div>
              <select
                value={videoPreviewBehavior}
                onChange={(event) =>
                  setVideoPreviewBehavior(event.target.value as VideoPreviewBehavior)
                }
                className="mt-4 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-white/38 focus:bg-white/14"
              >
                {videoPreviewBehaviorOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-6 text-white/52">
                {
                  videoPreviewBehaviorOptions.find((option) => option.value === videoPreviewBehavior)
                    ?.description
                }
              </p>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-6">
          <h2 className="text-xl font-semibold text-white">路径策略</h2>
          <p className="mt-2 text-sm leading-6 text-white/68">
            当前先只定方向：让应用跟着目录结构走，而不是锁死在某一台电脑上。
          </p>

          <button
            type="button"
            onClick={() => setRelativeModeEnabled(!relativeModeEnabled)}
            className="glass-chip mt-6 flex w-full items-center justify-between rounded-[28px] px-5 py-5 text-left transition hover:bg-white/22"
          >
            <div>
              <p className="text-sm font-medium text-white">相对路径模式</p>
              <p className="mt-2 text-xs leading-6 text-white/52">
                打开后优先按目录结构和根目录设置来定位内容。
              </p>
            </div>

            {relativeModeEnabled ? (
              <ToggleRight className="h-8 w-8 text-sky-100" />
            ) : (
              <ToggleLeft className="h-8 w-8 text-white/42" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setGameEmbed(!gameEmbed)}
            className="glass-chip mt-4 flex w-full items-center justify-between rounded-[28px] px-5 py-5 text-left transition hover:bg-white/22"
          >
            <div>
              <p className="text-sm font-medium text-white">游戏嵌入应用窗口</p>
              <p className="mt-2 text-xs leading-6 text-white/52">
                启动游戏时尝试把游戏窗口嵌进应用窗口；嵌不进去（全屏独占等）会自动回退为独立窗口。
              </p>
            </div>

            {gameEmbed ? (
              <ToggleRight className="h-8 w-8 text-sky-100" />
            ) : (
              <ToggleLeft className="h-8 w-8 text-white/42" />
            )}
          </button>

          <div className="mt-6 rounded-[28px] border border-white/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.22),rgba(255,255,255,0.06),rgba(125,211,252,0.12))] p-5 shadow-[0_20px_50px_rgba(42,22,88,0.18)]">
            <p className="text-sm font-medium text-white">当前状态</p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-white/76">
              <li>资源目录可迁移：{relativeModeEnabled ? "是" : "否"}</li>
              <li>当前基准目录：{resourceRoot}</li>
              <li>Logo 资源入口：已预留</li>
              <li>预览模式：{previewModeOptions.find((option) => option.value === previewMode)?.label}</li>
              <li>
                图片轮播：
                {imagePreviewBehaviorOptions.find((option) => option.value === imagePreviewBehavior)?.label}
              </li>
              <li>
                视频预览：
                {videoPreviewBehaviorOptions.find((option) => option.value === videoPreviewBehavior)?.label}
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
