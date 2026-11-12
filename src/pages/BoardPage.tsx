import {ExtraFavorite,ExtraRating} from "@/components/ExtraFavorite";
import { LayoutGrid, Pencil, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardAddPicker from "@/components/BoardAddPicker";
import BoardPanel from "@/components/BoardPanel";
import type { LibraryItem } from "@/data/library";
import { filterLibraryIndex, loadLibraryIndex, type LibraryIndex } from "@/lib/library-source";
import { loadReports, type Report } from "@/lib/reports";
import { useAppStore } from "@/store/useAppStore";

const BOARD_WIDTH = 3200;
const BOARD_HEIGHT = 2000;

/** 报道的封面：取第一个图片块的地址 */
function reportCover(report: Report): string | undefined {
  const block = report.blocks.find((entry) => entry.type === "image" && entry.media?.path);
  return block?.media?.path;
}

export default function BoardPage() {
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const ratingFilter = useAppStore((state) => state.ratingFilter);

  const allBoards = useAppStore((state) => state.boards);
  const ratings=useAppStore(s=>s.extraRatings);
  const boards=allBoards.filter(b=>(ratings["board/"+b.id]??2)<=ratingFilter);
  const activeBoardId = useAppStore((state) => state.activeBoardId);
  const createBoard = useAppStore((state) => state.createBoard);
  const renameBoard = useAppStore((state) => state.renameBoard);
  const deleteBoard = useAppStore((state) => state.deleteBoard);
  const setActiveBoard = useAppStore((state) => state.setActiveBoard);
  const addBoardPanel = useAppStore((state) => state.addBoardPanel);
  const removeBoardPanel = useAppStore((state) => state.removeBoardPanel);
  const moveBoardPanel = useAppStore((state) => state.moveBoardPanel);
  const resizeBoardPanel = useAppStore((state) => state.resizeBoardPanel);
  const updateBoardPanelText = useAppStore((state) => state.updateBoardPanelText);
  const updateBoardPanelTextStyle = useAppStore((state) => state.updateBoardPanelTextStyle);

  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 至少保证有一块画板
  useEffect(() => {
    if (allBoards.length === 0 && ratingFilter===2) {
      createBoard("画板 1");
    }
  }, [allBoards.length, createBoard,ratingFilter]);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];

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

  useEffect(() => {
    let cancelled = false;
    loadReports(resourceRoot)
      .then((list) => {
        if (!cancelled) {
          setReports(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReports([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceRoot]);

  const visibleIndex = useMemo(
    () => (index ? filterLibraryIndex(index, ratingFilter) : null),
    [index, ratingFilter],
  );

  // 面板 → 素材 的快速查找
  const itemMap = useMemo(() => {
    const map = new Map<string, LibraryItem>();
    if (visibleIndex) {
      for (const key of Object.keys(visibleIndex) as Array<keyof LibraryIndex>) {
        for (const item of visibleIndex[key]) {
          map.set(`${item.category}/${item.id}`, item);
        }
      }
    }
    return map;
  }, [visibleIndex]);

  const reportMap = useMemo(() => {
    const map = new Map<string, Report>();
    for (const report of reports.filter(r=>(ratings["reports/"+r.id]??2)<=ratingFilter)) {
      map.set(report.id, report);
    }
    return map;
  }, [reports,ratings,ratingFilter]);

  useEffect(()=>{if(boards.length&&!boards.some(b=>b.id===activeBoardId))setActiveBoard(boards[0].id);},[boards,activeBoardId,setActiveBoard]);
  const panels = activeBoard?.panels ?? [];

  const startRename = () => {
    if (!activeBoard) {
      return;
    }
    setNameDraft(activeBoard.name);
    setRenaming(true);
  };

  const commitRename = () => {
    if (activeBoard) {
      renameBoard(activeBoard.id, nameDraft);
    }
    setRenaming(false);
  };

  const handleDeleteBoard = () => {
    if (!activeBoard) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    deleteBoard(activeBoard.id);
    setConfirmDelete(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/48">Board</p>
          <h2 className="mt-1 text-lg font-semibold text-white">画板</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="glass-chip px-3 py-1 text-xs text-white/72">{panels.length} 个面板</span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/16"
          >
            <Plus className="h-3.5 w-3.5" />
            添加素材
          </button>
          <button
            type="button"
            onClick={() => addBoardPanel("text", { text: "", textStyle: "caption" })}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/16"
          >
            <Type className="h-3.5 w-3.5" />
            添加文字
          </button>
        </div>
      </div>

      {activeBoard&&<div className="mb-3 flex gap-3"><ExtraFavorite kind="board" id={activeBoard.id}/><ExtraRating kind="board" id={activeBoard.id}/></div>}
      {/* 画板切换 */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
        {boards.map((board) =>
          renaming && activeBoard?.id === board.id ? (
            <input
              key={board.id}
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitRename();
                }
                if (event.key === "Escape") {
                  setRenaming(false);
                }
              }}
              className="w-36 rounded-full border border-sky-300/45 bg-black/40 px-3 py-1.5 text-xs text-white outline-none"
            />
          ) : (
            <button
              key={board.id}
              type="button"
              onClick={() => setActiveBoard(board.id)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                board.id === activeBoard?.id
                  ? "border-sky-300/50 bg-sky-300/18 text-sky-100"
                  : "border-white/14 bg-white/6 text-white/60 hover:bg-white/12 hover:text-white/85"
              }`}
            >
              {board.name}
              <span className="ml-1.5 text-[10px] text-white/40">{board.panels.length}</span>
            </button>
          ),
        )}
        <button
          type="button"
          disabled={ratingFilter<2} title="新增画板默认为18+，请先解锁显示全部" onClick={() => createBoard()}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/22 px-3 py-1.5 text-xs text-white/55 transition hover:border-sky-300/45 hover:text-sky-100"
        >
          <Plus className="h-3 w-3" />
          新建画板
        </button>
        {activeBoard ? (
          <>
            <button
              type="button"
              onClick={startRename}
              title="重命名当前画板"
              className="rounded-full border border-white/14 bg-white/6 p-1.5 text-white/55 transition hover:bg-white/12 hover:text-white/85"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={handleDeleteBoard}
              title={confirmDelete ? "再点一次确认删除" : "删除当前画板"}
              className={`rounded-full border p-1.5 transition ${
                confirmDelete
                  ? "border-rose-300/60 bg-rose-300/25 text-rose-100"
                  : "border-white/14 bg-white/6 text-white/55 hover:bg-white/12 hover:text-rose-200"
              }`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/62">
          正在读取素材目录…
        </div>
      ) : panels.length === 0 ? (
        <div className="glass-panel flex flex-1 flex-col items-center justify-center gap-3 rounded-[32px]">
          <LayoutGrid className="h-10 w-10 text-white/30" />
          <p className="text-sm text-white/62">「{activeBoard?.name ?? "画板"}」还是空的</p>
          <p className="max-w-sm text-center text-xs leading-5 text-white/42">
            点右上「添加素材」把视频、漫画、图片、报道放上来，或用「添加文字」写个标题 / 注释。
            画板只引用素材库和报道，不会复制文件。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-300/12 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-300/20"
            >
              <Plus className="h-4 w-4" />
              添加第一个面板
            </button>
            <button
              type="button"
              onClick={() => addBoardPanel("text", { text: "标题", textStyle: "title" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-4 py-2 text-sm text-white/78 transition hover:bg-white/16"
            >
              <Type className="h-4 w-4" />
              加个标题
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-panel min-h-0 flex-1 overflow-auto rounded-[24px]">
          <div className="relative" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
            {panels.map((panel) => (
              <BoardPanel
                key={panel.id}
                panel={panel}
                item={
                  panel.kind === "item" && panel.category && panel.itemId
                    ? itemMap.get(`${panel.category}/${panel.itemId}`)
                    : undefined
                }
                report={
                  panel.kind === "report" && panel.itemId
                    ? (() => {
                        const found = reportMap.get(panel.itemId);
                        return found
                          ? {
                              id: found.id,
                              title: found.title,
                              blocks: found.blocks,
                              cover: reportCover(found),
                            }
                          : undefined;
                      })()
                    : undefined
                }
                resourceRoot={resourceRoot}
                onRemove={removeBoardPanel}
                onMove={moveBoardPanel}
                onResize={resizeBoardPanel}
                onTextChange={updateBoardPanelText}
                onTextStyleChange={updateBoardPanelTextStyle}
                onOpenReport={(id) => navigate(`/reports/${id}`)}
              />
            ))}
          </div>
        </div>
      )}

      <BoardAddPicker
        open={pickerOpen}
        index={visibleIndex}
        reports={reports.filter(r=>(ratings["reports/"+r.id]??2)<=ratingFilter)}
        onClose={() => setPickerOpen(false)}
        onPick={(payload) => {
          if (payload.kind === "report") {
            addBoardPanel("report", { itemId: payload.reportId });
          } else {
            addBoardPanel("item", { category: payload.category, itemId: payload.itemId });
          }
        }}
      />
    </div>
  );
}

