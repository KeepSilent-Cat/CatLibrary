import PersistentMusic from "./PersistentMusic";
import { BookOpen, BookText, Camera, Gamepad2, House, ImageIcon, LayoutGrid, Loader2, Music, Newspaper, PlaySquare, Search, Settings2, Sparkles, Star } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import zeroCatLogo from "@/assets/zerocat-icon-max.png";
import { cn } from "@/lib/utils";
import ScreenshotOverlay from "@/components/ScreenshotOverlay";
import WindowDragBar from "@/components/WindowDragBar";
import WindowControls from "@/components/WindowControls";
import GlobalSearch from "@/components/GlobalSearch";
import { useAppStore } from "@/store/useAppStore";

/** 判断键盘事件是否匹配快捷键字符串，如 "ctrl+shift+s" */
function eventMatchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const hasCtrl = mods.includes("ctrl");
  const hasAlt = mods.includes("alt");
  const hasShift = mods.includes("shift");
  const hasMeta = mods.includes("meta");
  if (event.ctrlKey !== hasCtrl || event.altKey !== hasAlt || event.shiftKey !== hasShift || event.metaKey !== hasMeta) {
    return false;
  }
  const eventKey = event.key.toLowerCase();
  if (eventKey === key) {
    return true;
  }
  // 数字键 / 功能键的等价匹配
  return eventKey.length === 1 && eventKey === key;
}

/** 格式化快捷键显示：ctrl+shift+s → Ctrl+Shift+S */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .filter(Boolean)
    .map((part) => {
      const name = part.trim().toLowerCase();
      if (name === "ctrl") return "Ctrl";
      if (name === "alt") return "Alt";
      if (name === "shift") return "Shift";
      if (name === "meta") return "Win";
      return part.trim().length === 1 ? part.trim().toUpperCase() : part.trim();
    })
    .join("+");
}

const navItems = [
  { to: "/", label: "首页", icon: House, exact: true },
  { to: "/novels", label: "小说", icon: BookText },
  { to: "/images", label: "图片", icon: ImageIcon },
  { to: "/comics", label: "漫画", icon: BookOpen },
  { to: "/music", label: "音乐", icon: Music },
  { to: "/videos", label: "视频", icon: PlaySquare },
  { to: "/games", label: "游戏", icon: Gamepad2 },
  { to: "/live2d", label: "Live2D", icon: Sparkles },
  { to: "/screenshots", label: "截图", icon: Camera },
  { to: "/board", label: "画板", icon: LayoutGrid },
  { to: "/reports", label: "报道", icon: Newspaper },
  { to: "/favorites", label: "收藏", icon: Star },
  { to: "/settings", label: "设置", icon: Settings2 },
];

function SidebarLink({
  to,
  label,
  exact,
  icon: Icon,
}: {
  to: string;
  label: string;
  exact?: boolean;
  icon: typeof House;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-[22px] border px-4 py-3 text-sm font-medium transition",
          isActive
            ? "border-white/40 bg-white/28 text-white shadow-[0_18px_45px_rgba(79,70,229,0.16)]"
            : "border-transparent bg-white/8 text-white/70 hover:border-white/20 hover:bg-white/14 hover:text-white",
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const screenshotShortcut = useAppStore((state) => state.screenshotShortcut);
  const screenshotOpen = useAppStore((state) => state.screenshotOpen);
  const openScreenshot = useAppStore((state) => state.openScreenshot);
  const savedToast = useAppStore((state) => state.savedToast);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const ratingFilter=useAppStore(s=>s.ratingFilter);
  const wallpaper = useAppStore((state) => state.wallpaper);
  const toastTimerRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // 全局快捷键触发截图
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + K：全局搜索
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        closeSearch();
        return;
      }
      if (screenshotOpen) {
        return;
      }
      if (eventMatchesShortcut(event, screenshotShortcut)) {
        event.preventDefault();
        openScreenshot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screenshotShortcut, screenshotOpen, openScreenshot, openSearch, closeSearch, searchOpen]);

  // 保存成功提示自动消失
  useEffect(() => {
    if (!savedToast) {
      return;
    }
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setSavedToast(null), 2500);
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [savedToast, setSavedToast]);

  return (
    <div className="immersive-app h-screen text-white">
      <div
        className="immersive-background"
        style={
          wallpaper && ratingFilter===2
            ? {
                backgroundImage: `linear-gradient(180deg, rgba(17, 24, 39, 0.06), rgba(17, 24, 39, 0.16)), url("${wallpaper}")`,
              }
            : undefined
        }
      />
      <div className="immersive-overlay" />

      <div className="relative flex h-full flex-col">
        <WindowDragBar className="glass-window flex h-[72px] items-center justify-between rounded-none border-b border-white/16 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <img src={zeroCatLogo} alt="ZeroCat Logo" className="h-12 w-12 object-contain" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-[0.06em] text-white">Cat Library</p>
              <p className="truncate text-xs text-white/65">ZeroCat 沉浸式资源索引台</p>
            </div>
          </div>

          <div data-no-drag="true" className="flex items-center gap-2">
            {savedToast && (
              <span className="rounded-full border border-sky-300/30 bg-black/50 px-3 py-1.5 text-xs text-sky-100 backdrop-blur-sm">
                {savedToast}
              </span>
            )}
            <button
              type="button"
              onClick={openSearch}
              title="全局搜索（Ctrl+K）"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/16 hover:text-white"
            >
              <Search className="h-3.5 w-3.5" />
              搜索
            </button>
            <button
              type="button"
              onClick={openScreenshot}
              title={`截图（${formatShortcut(screenshotShortcut)}）`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/16 hover:text-white"
            >
              <Camera className="h-3.5 w-3.5" />
              截图
            </button>
            <WindowControls />
          </div>
        </WindowDragBar>

        <div className="flex min-h-0 flex-1">
          <aside className="glass-window flex w-[248px] min-h-0 flex-col overflow-hidden rounded-none border-r border-white/16 px-4 py-4">
            <nav className="space-y-2">
              {navItems.map((item) => (
                <SidebarLink key={item.to} {...item} />
              ))}
            </nav>
          </aside>

          <main className="glass-window min-h-0 flex-1 overflow-hidden rounded-none p-0">
            {/* 页面按需加载：只让内容区等待，侧栏保持可交互 */}
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
                  <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
                  正在加载…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <PersistentMusic />
      <ScreenshotOverlay />
      <GlobalSearch open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
