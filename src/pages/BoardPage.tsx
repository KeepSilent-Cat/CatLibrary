import { LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import BoardAddPicker from "@/components/BoardAddPicker";
import BoardPanel from "@/components/BoardPanel";
import type { LibraryItem } from "@/data/library";
import { loadLibraryIndex, type LibraryIndex } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";

const BOARD_WIDTH = 3200;
const BOARD_HEIGHT = 2000;

export default function BoardPage() {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const boardPanels = useAppStore((state) => state.boardPanels);
  const addBoardPanel = useAppStore((state) => state.addBoardPanel);
  const removeBoardPanel = useAppStore((state) => state.removeBoardPanel);
  const moveBoardPanel = useAppStore((state) => state.moveBoardPanel);
  const resizeBoardPanel = useAppStore((state) => state.resizeBoardPanel);

  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLibraryIndex(resourceRoot)
      .then((result) => {
        if (!cancelled) {
          setIndex(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIndex(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceRoot]);

  // 面板 → 素材 的快速查找
  const itemMap = useMemo(() => {
    const map = new Map<string, LibraryItem>();
    if (index) {
      for (const key of Object.keys(index) as Array<keyof LibraryIndex>) {
        for (const item of index[key]) {
          map.set(`${item.category}/${item.id}`, item);
        }
      }
    }
    return map;
  }, [index]);

  const clearAll = () => {
    for (const panel of boardPanels) {
      removeBoardPanel(panel.id);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/48">Board</p>
          <h2 className="mt-1 text-lg font-semibold text-white">画板</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="glass-chip px-3 py-1 text-xs text-white/72">
            {boardPanels.length} 个面板
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/16"
          >
            <Plus className="h-3.5 w-3.5" />
            添加素材
          </button>
          {boardPanels.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              title="清空画板"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/16 hover:text-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/62">
          正在读取素材目录…
        </div>
      ) : boardPanels.length === 0 ? (
        <div className="glass-panel flex flex-1 flex-col items-center justify-center gap-3 rounded-[32px]">
          <LayoutGrid className="h-10 w-10 text-white/30" />
          <p className="text-sm text-white/62">画板是空的</p>
          <p className="max-w-sm text-center text-xs leading-5 text-white/42">
            点右上「添加素材」，把视频、漫画、图片等放到画板上自由摆放、缩放。
            视频会一边播放，漫画可自动滚屏，互不干扰。
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-300/12 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-300/20"
          >
            <Plus className="h-4 w-4" />
            添加第一个面板
          </button>
        </div>
      ) : (
        <div className="glass-panel min-h-0 flex-1 overflow-auto rounded-[24px]">
          <div className="relative" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
            {boardPanels.map((panel) => (
              <BoardPanel
                key={panel.id}
                panel={panel}
                item={itemMap.get(`${panel.category}/${panel.itemId}`)}
                resourceRoot={resourceRoot}
                onRemove={removeBoardPanel}
                onMove={moveBoardPanel}
                onResize={resizeBoardPanel}
              />
            ))}
          </div>
        </div>
      )}

      <BoardAddPicker
        open={pickerOpen}
        index={index}
        onClose={() => setPickerOpen(false)}
        onPick={(category, itemId) => addBoardPanel(category, itemId)}
      />
    </div>
  );
}
