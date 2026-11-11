import { Suspense, lazy, useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { useAppStore } from "@/store/useAppStore";

// 页面按需加载：首屏只需要外壳 + 首页，其余页面（尤其漫画阅读器、详情页）等真正进入时再下载
const Home = lazy(() => import("@/pages/Home"));
const CategoryPage = lazy(() => import("@/pages/CategoryPage"));
const FavoritesPage = lazy(() => import("@/pages/FavoritesPage"));
const LibraryDetailPage = lazy(() => import("@/pages/LibraryDetailPage"));
const ComicReaderPage = lazy(() => import("@/pages/ComicReaderPage"));
const BoardPage = lazy(() => import("@/pages/BoardPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const ReportEditorPage = lazy(() => import("@/pages/ReportEditorPage"));
const Settings = lazy(() => import("@/pages/Settings"));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
      <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
      正在加载…
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    (async () => {
      try {
        const { resourceRoot, setResourceRoot } = useAppStore.getState();
        const resolved = await invoke<string>("resolve_initial_resource_root", {
          current: resourceRoot,
        });
        if (!cancelled && resolved !== resourceRoot) {
          setResourceRoot(resolved);
        }
      } catch {
        // 非 Tauri 环境或命令缺失时保持现状
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <HashRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/images" element={<CategoryPage category="images" />} />
            <Route path="/images/:itemId" element={<ComicReaderPage category="images" />} />
            <Route path="/videos" element={<CategoryPage category="videos" />} />
            <Route path="/videos/:itemId" element={<LibraryDetailPage category="videos" />} />
            <Route path="/games" element={<CategoryPage category="games" />} />
            <Route path="/games/:itemId" element={<LibraryDetailPage category="games" />} />
            <Route path="/comics" element={<CategoryPage category="comics" />} />
            <Route path="/comics/:itemId" element={<ComicReaderPage />} />
            <Route path="/screenshots" element={<CategoryPage category="screenshots" />} />
            <Route path="/screenshots/:itemId" element={<LibraryDetailPage category="screenshots" />} />
            <Route path="/music" element={<CategoryPage category="music" />} />
            <Route path="/music/:itemId" element={<LibraryDetailPage category="music" />} />
            <Route path="/live2d" element={<CategoryPage category="live2d" />} />
            <Route path="/live2d/:itemId" element={<LibraryDetailPage category="live2d" />} />
            <Route path="/novels" element={<CategoryPage category="novels" />} />
            <Route path="/novels/:itemId" element={<LibraryDetailPage category="novels" />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:reportId" element={<ReportEditorPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
