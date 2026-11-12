import ContentGate from "@/components/ContentGate";
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
            <Route path="/images" element={<CategoryPage key="images" category="images" />} />
            <Route path="/images/:itemId" element={<ContentGate category="images"><ComicReaderPage category="images" /></ContentGate>} />
            <Route path="/videos" element={<CategoryPage key="videos" category="videos" />} />
            <Route path="/videos/:itemId" element={<ContentGate category="videos"><LibraryDetailPage category="videos" /></ContentGate>} />
            <Route path="/games" element={<CategoryPage key="games" category="games" />} />
            <Route path="/games/:itemId" element={<ContentGate category="games"><LibraryDetailPage category="games" /></ContentGate>} />
            <Route path="/comics" element={<CategoryPage key="comics" category="comics" />} />
            <Route path="/comics/:itemId" element={<ContentGate category="comics"><ComicReaderPage /></ContentGate>} />
            <Route path="/screenshots" element={<CategoryPage key="screenshots" category="screenshots" />} />
            <Route path="/screenshots/:itemId" element={<ContentGate category="screenshots"><LibraryDetailPage category="screenshots" /></ContentGate>} />
            <Route path="/music" element={<CategoryPage key="music" category="music" />} />
            <Route path="/music/:itemId" element={<ContentGate category="music"><LibraryDetailPage category="music" /></ContentGate>} />
            <Route path="/live2d" element={<CategoryPage key="live2d" category="live2d" />} />
            <Route path="/live2d/:itemId" element={<ContentGate category="live2d"><LibraryDetailPage category="live2d" /></ContentGate>} />
            <Route path="/novels" element={<CategoryPage key="novels" category="novels" />} />
            <Route path="/novels/:itemId" element={<ContentGate category="novels"><LibraryDetailPage category="novels" /></ContentGate>} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:reportId" element={<ContentGate category="reports"><ReportEditorPage /></ContentGate>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
