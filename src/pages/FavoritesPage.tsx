import { useState } from "react";
import CategoryPage from "@/pages/CategoryPage";
import type { CategoryKey } from "@/data/library";
import { cn } from "@/lib/utils";

const favoriteTabs: { key: CategoryKey; label: string }[] = [
  { key: "images", label: "图片" },
  { key: "videos", label: "视频" },
  { key: "games", label: "游戏" },
  { key: "comics", label: "漫画" },
  { key: "screenshots", label: "截图" },
  { key: "novels", label: "小说" },
];

export default function FavoritesPage() {
  const [activeTab, setActiveTab] = useState<CategoryKey>("videos");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-4 px-5 pb-3 pt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/48">Favorites</p>
          <h2 className="mt-1 text-lg font-semibold text-white">收藏</h2>
        </div>
        <div className="ml-2 flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
          {favoriteTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs transition",
                activeTab === tab.key
                  ? "bg-sky-300/22 text-sky-100"
                  : "text-white/62 hover:text-white/88",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CategoryPage key={activeTab} category={activeTab} favoritesOnly hideHeader />
      </div>
    </div>
  );
}
