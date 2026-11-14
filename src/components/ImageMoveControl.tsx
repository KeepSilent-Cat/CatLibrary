import { FolderInput, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearLibraryIndexCache, loadLibraryIndex } from "@/lib/library-source";
import type { LibraryItem } from "@/data/library";
import { useAppStore } from "@/store/useAppStore";

type MoveResult = { path: string; sourceGroupRemoved: boolean };

/**
 * 把单张图片移动到另一个图片合集。
 * 只在阅读页的「编辑」里出现，避免在浏览界面上显得每张图都要改动。
 */
export default function ImageMoveControl({
  paths,
  groupId,
  sourceRating = 0,
  onMoved,
  initialPath,
}: {
  paths: string[];
  initialPath?: string;
  groupId: string;
  /** 源合集分级：用于提示「目标合集分级更低」 */
  sourceRating?: number;
  onMoved: (sourceGroupRemoved: boolean) => void;
}) {
  const root = useAppStore((state) => state.resourceRoot);
  const filter = useAppStore((state) => state.ratingFilter);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    loadLibraryIndex(root)
      .then((index) => setItems(index.images.filter((item) => item.id !== groupId && item.rating <= filter)))
      .catch((error) => setMessage(String(error)));
  }, [open, root, groupId, filter]);

  const filtered = useMemo(() => {
    const word = query.trim().toLowerCase();
    const pool = word
      ? items.filter((item) =>
          `${item.altName ?? ""} ${item.title}`.toLowerCase().includes(word),
        )
      : items;
    return pool.slice(0, 60);
  }, [items, query]);

  const targetItem = items.find((item) => item.id === target);
  const downgrade = targetItem ? targetItem.rating < sourceRating : false;

  const confirmMove = async () => {
    setBusy(true);
    try {
      const result = await invoke<MoveResult>("move_image_to_collection", {
        resourceRoot: root,
        sourceGroup: groupId,
        targetGroup: target,
        sourcePath: source,
      });
      useAppStore.getState().rememberMediaMove(source, result.path);
      clearLibraryIndexCache(root);
      setOpen(false);
      onMoved(result.sourceGroupRemoved);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSource(initialPath ?? "");
          setTarget("");
          setQuery("");
          setMessage("");
        }}
        title="把这个合集里的某一张图移动到另一个合集"
        className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/14 hover:text-white"
      >
        <FolderInput className="h-3.5 w-3.5" />
        移动图片
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="移动图片到其他合集"
          className="fixed inset-0 z-[80] grid place-items-center bg-black/60 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setOpen(false);
            }
          }}
        >
          <section className="glass-panel w-[560px] max-w-full rounded-[24px] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">移动图片到其他合集</h2>
                <p className="mt-2 text-[11px] leading-5 text-white/45">
                  实际移动本地原文件，不是复制。移动后这张图跟随目标合集的分级显示；源合集如果被搬空会自动移除。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-full border border-white/14 bg-white/6 p-1.5 text-white/55 transition hover:bg-white/14"
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] text-white/45">要移动的图片</span>
                <select
                  aria-label="选择单张图片"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="mt-1 w-full rounded-[12px] border border-white/14 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-sky-300/50"
                >
                  <option value="">请选择要移动的单张图片</option>
                  {paths.map((path, index) => (
                    <option key={path} value={path}>
                      {index + 1} · {path.split(/[\\/]/).pop()}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/45">目标合集</span>
                  <span className="text-[10px] text-white/25">
                    {targetItem ? `已选：${targetItem.altName ?? targetItem.title}` : `${filtered.length} 个可选`}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 rounded-[12px] border border-white/14 bg-black/30 px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="输入关键词筛选合集，输入越多越精确…"
                    aria-label="搜索目标合集"
                    className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/28"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="shrink-0 text-white/40 transition hover:text-white"
                      title="清空"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-1.5 max-h-[168px] overflow-y-auto rounded-[12px] border border-white/10 bg-black/20 p-1.5">
                  {filtered.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-white/30">没有匹配的合集</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {filtered.map((item) => {
                        const active = item.id === target;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setTarget(item.id)}
                            className={`flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-xs transition ${
                              active
                                ? "bg-sky-300/20 text-sky-50"
                                : "text-white/70 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">{item.altName ?? item.title}</span>
                            <span className="shrink-0 text-[10px] text-white/30">
                              {item.rating === 2 ? "18+" : item.rating === 1 ? "R15" : "全年龄"} · {item.sourceCount}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {downgrade ? (
              <p className="mt-3 rounded-[10px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] leading-5 text-amber-100/85">
                目标合集分级低于源合集，移过去后这张图会按目标合集的分级显示。
              </p>
            ) : null}
            {source ? (
              <p className="mt-3 break-all rounded-[10px] bg-black/25 px-3 py-2 text-[10px] text-white/40">
                {source}
              </p>
            ) : null}
            {message ? (
              <p role="status" className="mt-2 text-[11px] text-rose-200">
                {message}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/16 bg-white/8 px-4 py-1.5 text-xs text-white/70 transition hover:bg-white/16 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || !source || !target}
                onClick={() => void confirmMove()}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/45 bg-sky-300/20 px-4 py-1.5 text-xs text-sky-50 transition hover:bg-sky-300/30 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                确认移动原文件
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
