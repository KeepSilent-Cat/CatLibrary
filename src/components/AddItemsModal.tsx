import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileArchive,
  FileImage,
  FileVideo2,
  FolderDown,
  FolderOpen,
  Music,
  X,
} from "lucide-react";
import type { CategoryKey } from "@/data/library";
import type { LibraryItem } from "@/data/library";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

function defaultGroupName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const baseName = normalized.split("/").filter(Boolean).pop() ?? "";
  const lastDot = baseName.lastIndexOf(".");
  // 文件夹（无扩展名判断不了，直接取整名）；文件去掉最后一个扩展名
  return lastDot > 0 ? baseName.slice(0, lastDot) : baseName;
}

function pathBaseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

function isArchivePath(path: string): boolean {
  return /\.(zip|rar|7z|cbz|cbr|cb7)$/i.test(path);
}

interface AddItemsModalProps {
  open: boolean;
  category: CategoryKey;
  resourceRoot: string;
  nextGroupFolder: string;
  /** 漫画分类下：已有的漫画列表，用于“加入已有漫画”选择 */
  existingItems?: LibraryItem[];
  onClose: () => void;
  onOpenRequest: () => void;
  onAdded: (created: string[]) => void;
}

const categoryTitle: Record<CategoryKey, string> = {
  images: "图片",
  videos: "视频",
  games: "游戏",
  comics: "漫画",
  novels: "小说",
  screenshots: "截图",
  music: "音乐",
  live2d: "模型",
};

export default function AddItemsModal({
  open,
  category,
  resourceRoot,
  nextGroupFolder,
  existingItems,
  onClose,
  onOpenRequest,
  onAdded,
}: AddItemsModalProps) {
  // 新增条目的默认分级 = 当前显示范围（0 全年龄 / 1 R15 / 2 18+）
  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const [paths, setPaths] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [name, setName] = useState("");
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // 漫画模式：新建一本 / 加入已有漫画；章节号按“列表顺序 + 起始章节号”自动推导
  const isComics = category === "comics";
  const isImages = category === "images";
  const isMusic = category === "music";
  const [comicMode, setComicMode] = useState<"new" | "existing">("new");
  const [startChapter, setStartChapter] = useState(1);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  // 重名提醒：第一次点“确认添加”只是提醒，再点一次才真正继续
  const [duplicateAck, setDuplicateAck] = useState(false);

  // 关闭时清空
  useEffect(() => {
    if (!open) {
      setPaths([]);
      setPasteText("");
      setName("");
      setError(null);
      setBusy(false);
      setHover(false);
      setComicMode("new");
      setStartChapter(1);
      setSelectedGroupId("");
      setDuplicateAck(false);
    }
  }, [open]);

  // 拖入第一个文件时，用它的名字作为默认展示名（漫画新建模式也适用，可手改）
  useEffect(() => {
    if (paths.length > 0 && name.trim() === "") {
      setName(defaultGroupName(paths[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  // 窗口级拖放：拖到弹窗内才接收；弹窗未打开时直接打开并带入文件
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          if (openRef.current) {
            const rect = modalRef.current?.getBoundingClientRect();
            if (rect && isInside(event.payload.position, rect)) {
              setHover(true);
            } else {
              setHover(false);
            }
          }
          return;
        }

        if (event.payload.type === "leave") {
          setHover(false);
          return;
        }

        // drop
        setHover(false);
        const dropped = event.payload.paths;
        if (!dropped || dropped.length === 0) {
          return;
        }

        if (!openRef.current) {
          // 弹窗未开：直接打开并带入文件
          setPaths(dropped);
          onOpenRequest();
          return;
        }

        // 弹窗已开：窗口内任意位置放下都接收
        setPaths((previous) => {
          const merged = [...previous];
          for (const path of dropped) {
            if (!merged.includes(path)) {
              merged.push(path);
            }
          }
          return merged;
        });
      })
      .then((dispose) => {
        unlisten = dispose;
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 列表重排：上移/下移/整体反序（章节号按新顺序自动重算）
  const movePath = (index: number, delta: number) => {
    setPaths((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const reversePaths = () => {
    setPaths((previous) => [...previous].reverse());
  };

  const chapterForIndex = (index: number) => Math.floor(startChapter) + index;

  const trimmedName = name.trim();
  // 新建漫画时，展示名与已有漫画重名（注意：文件夹名仍会递增为 comic_N，只是标题会撞车）
  const conflictingComic = useMemo(() => {
    if (!isComics || comicMode !== "new" || trimmedName === "") {
      return undefined;
    }
    const key = trimmedName.toLowerCase();
    return existingItems?.find((item) => item.title.trim().toLowerCase() === key);
  }, [isComics, comicMode, trimmedName, existingItems]);

  // 粘贴路径：按行拆分，去掉首尾引号，过滤空行
  const parsePastedPaths = (raw: string): string[] =>
    raw
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^["']|["']$/g, ""))
      .filter((line) => line.length > 0);

  const addPastedPaths = () => {
    const parsed = parsePastedPaths(pasteText);
    if (parsed.length === 0) {
      return;
    }
    setPaths((previous) => {
      const merged = [...previous];
      for (const path of parsed) {
        if (!merged.includes(path)) {
          merged.push(path);
        }
      }
      return merged;
    });
    setPasteText("");
  };

  const confirm = async () => {
    if (paths.length === 0 || busy) {
      return;
    }

    // 漫画模式校验
    if (isComics) {
      const start = Math.floor(startChapter);
      if (!Number.isFinite(start) || start < 1 || start + paths.length - 1 > 9999) {
        setError("起始章节号无效：整批章节号需落在 1-9999 之间");
        return;
      }
      if (comicMode === "existing" && !selectedGroupId) {
        setError("请选择要加入的已有漫画");
        return;
      }
      // 重名提醒：先弹提醒，用户确认后才继续（文件夹仍是递增的 comic_N）
      if (conflictingComic && !duplicateAck) {
        setDuplicateAck(true);
        setError(null);
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      if (isComics) {
        // 整批归入【同一本】漫画的连续章节：
        // 新建模式下首个文件负责建档并返回 groupId，其余文件复用该 groupId。
        const start = Math.floor(startChapter);
        const created: string[] = [];
        let targetGroup: string | null = comicMode === "existing" ? selectedGroupId : null;

        for (let index = 0; index < paths.length; index += 1) {
          const path = paths[index];
          const result = await invoke<string[]>("add_comic_chapter", {
            resourceRoot,
            dropPaths: [path],
            chapterNumber: start + index,
            targetGroupId: targetGroup,
            displayName:
              targetGroup === null ? (name.trim() === "" ? null : name.trim()) : null,
            // 新建漫画时的默认分级跟随当前显示范围（加入已有漫画则不动它的分级）
            rating: targetGroup === null ? ratingFilter : null,
          });
          if (targetGroup === null && result.length > 0) {
            targetGroup = result[0];
          }
          created.push(...result);
        }
        onAdded(created);
      } else {
        const created = await invoke<string[]>("add_library_items", {
          resourceRoot,
          category,
          dropPaths: paths,
          displayName: name.trim() === "" ? null : name.trim(),
          // 默认分级跟随当前显示范围：全年龄→0，R15→1，18+→2
          rating: ratingFilter,
        });
        onAdded(created);
      }
      onClose();
    } catch (currentError) {
      setError(`添加失败：${String(currentError)}`);
    } finally {
      setBusy(false);
    }
  };

  const targetFolder = isComics
    ? ""
    : `${resourceRoot}\\${category}\\${nextGroupFolder}\\source\\`;

  const duplicateButtonLabel =
    conflictingComic && duplicateAck ? "仍然创建同名漫画" : "确认添加";

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onMouseDown={(event) => {
        // 只在直接按在遮罩上时关闭；从输入框内拖拽选字松手在遮罩上不会误关
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        onMouseDown={(event) => event.stopPropagation()}
        className="glass-panel flex max-h-[82vh] w-[540px] max-w-[92vw] flex-col rounded-[24px] p-5"
      >
        {/* 标题 */}
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/48">Add Items</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">
              添加{categoryTitle[category]}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/14 bg-white/6 p-2 text-white/70 transition hover:bg-white/14"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 中间内容可滚动：导入上百章时不会把按钮挤出窗外 */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* 拖放区 */}
        <div
          className={cn(
            "flex h-36 flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed text-center transition",
            hover
              ? "border-sky-300/70 bg-sky-300/12 text-sky-100"
              : paths.length > 0
                ? "border-white/16 bg-white/5 text-white/60"
                : "border-white/20 bg-white/4 text-white/55",
          )}
        >
          {hover ? (
            <>
              <FolderDown className="h-8 w-8" />
              <span className="text-sm">松开鼠标即可添加</span>
            </>
          ) : paths.length > 0 ? (
            <>
              <FolderOpen className="h-8 w-8" />
              <span className="text-sm">已选择 {paths.length} 项，可继续拖入更多</span>
            </>
          ) : (
            <>
              <FolderOpen className="h-8 w-8" />
              <span className="text-sm">
                {isComics
                  ? "把漫画压缩包（zip/rar/7z）拖到这里"
                  : isImages
                    ? "把图片拖到这里"
                    : isMusic
                    ? "把音乐文件或专辑文件夹拖到这里"
                      : "把文件或文件夹拖到这里"}
              </span>
              <span className="text-xs text-white/40">也可以直接拖进窗口任意位置</span>
            </>
          )}
        </div>

        {/* 粘贴路径导入（非漫画） */}
        {!isComics && (
          <div className="mt-3">
            <div className="flex items-end gap-2">
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="或直接粘贴文件/文件夹路径，每行一个"
                rows={2}
                className="min-h-0 flex-1 resize-none rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/30 focus:border-sky-300/50"
              />
              <button
                type="button"
                onClick={addPastedPaths}
                disabled={!pasteText.trim()}
                className="shrink-0 rounded-[12px] border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                加入
              </button>
            </div>
          </div>
        )}

        {/* 文件列表 */}
        {paths.length > 0 && (
          <>
            {isComics && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-white/45">
                  章节号按下面列表顺序自动安排（从上到下）
                </span>
                <button
                  type="button"
                  onClick={reversePaths}
                  title="整体反序"
                  className="inline-flex items-center gap-1 rounded-full border border-white/14 bg-white/6 px-2.5 py-1 text-[11px] text-white/70 transition hover:bg-white/14"
                >
                  <ArrowUpDown className="h-3 w-3" />
                  反序
                </button>
              </div>
            )}
            <div className="mt-2 max-h-40 shrink-0 overflow-y-auto rounded-[12px] border border-white/10 bg-black/20 p-2">
              {paths.map((path, index) => (
                <div key={path} className="flex items-center gap-2 px-1 py-0.5 text-xs text-white/72">
                  {isArchivePath(path) ? (
                    <FileArchive className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  ) : isImages ? (
                    <FileImage className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  ) : isMusic ? (
                    <Music className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  ) : (
                    <FileVideo2 className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  )}
                  <span className="w-5 shrink-0 text-center text-white/38">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{pathBaseName(path)}</span>
                  {isComics && (
                    <>
                      <span className="shrink-0 text-sky-100/80">第 {chapterForIndex(index)} 章</span>
                      <button
                        type="button"
                        onClick={() => movePath(index, -1)}
                        disabled={index === 0}
                        title="上移"
                        className="shrink-0 rounded-[6px] border border-white/12 bg-white/6 p-0.5 text-white/60 transition hover:bg-white/16 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePath(index, 1)}
                        disabled={index === paths.length - 1}
                        title="下移"
                        className="shrink-0 rounded-[6px] border border-white/12 bg-white/6 p-0.5 text-white/60 transition hover:bg-white/16 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* 漫画：新建 / 加入已有 + 起始章节号 */}
        {isComics && paths.length > 0 && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
              <button
                type="button"
                onClick={() => setComicMode("new")}
                className={cn(
                  "flex-1 rounded-full px-4 py-1.5 text-xs transition",
                  comicMode === "new"
                    ? "bg-sky-300/22 text-sky-100"
                    : "text-white/62 hover:text-white/88",
                )}
              >
                新建漫画
              </button>
              <button
                type="button"
                onClick={() => setComicMode("existing")}
                className={cn(
                  "flex-1 rounded-full px-4 py-1.5 text-xs transition",
                  comicMode === "existing"
                    ? "bg-sky-300/22 text-sky-100"
                    : "text-white/62 hover:text-white/88",
                )}
              >
                加入已有漫画
              </button>
            </div>

            {comicMode === "existing" ? (
              <div>
                <label className="mb-1 block text-xs text-white/62">选择要加入的漫画</label>
                <select
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(event.target.value)}
                  className="w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/50"
                >
                  <option value="" className="bg-slate-900 text-white">
                    请选择漫画…
                  </option>
                  {existingItems?.map((item) => (
                    <option key={item.id} value={item.id} className="bg-slate-900 text-white">
                      {item.title}（{item.summary}）
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-white/62">漫画名称（展示名）</label>
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDuplicateAck(false);
                  }}
                  placeholder="输入漫画名称…"
                  className="w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
                />
                {conflictingComic ? (
                  <div className="mt-2 rounded-[10px] border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                    <span className="font-medium">
                      已存在同名漫画《{conflictingComic.title}》
                    </span>
                    （ID：{conflictingComic.id}）。{duplicateAck
                      ? `再次点击「确认添加」即可继续：新漫画仍会新建为 ${nextGroupFolder}，不会并入该漫画，只是两本会显示相同标题。`
                      : `继续创建不会并入该漫画，而是新建 ${nextGroupFolder}，仅标题会撞车。`}
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="shrink-0 text-xs text-white/62">起始章节号</label>
              <input
                type="number"
                min={1}
                max={9999}
                value={startChapter}
                onChange={(event) => setStartChapter(Number(event.target.value))}
                className="w-20 rounded-[8px] border border-white/14 bg-black/30 px-2 py-1 text-center text-xs text-white outline-none focus:border-sky-300/50"
              />
              <span className="text-[11px] leading-relaxed text-white/45">
                第一个文件作为此章，后续依次 +1
              </span>
            </div>
          </div>
        )}

        {/* 展示名 + 目标路径（非漫画模式） */}
        {!isComics && paths.length > 0 && (
          <div className="mt-3">
            <label className="mb-1 block text-xs text-white/62">
              展示名（只影响卡片标题，不影响文件夹名）
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入名称…"
              className="w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
            />
          </div>
        )}

        {/* 目标路径预览 */}
        {paths.length > 0 && (
          <div className="mt-3 rounded-[12px] bg-black/25 px-3 py-2 text-xs text-white/55">
            {isComics ? (
              <>
                <span className="text-white/38">
                  {comicMode === "existing" ? "将导入到：" : "将新建 1 本漫画："}
                </span>
                <span className="break-all font-mono">
                  {comicMode === "existing" && selectedGroupId
                    ? `${resourceRoot}\\comics\\${selectedGroupId}\\source\\`
                    : `${resourceRoot}\\comics\\${nextGroupFolder}\\source\\`}
                </span>
                <span className="mt-1 block break-words text-white/38">
                  {paths
                    .slice(0, 6)
                    .map(
                      (path, index) =>
                        `${pathBaseName(path)} → 第 ${chapterForIndex(index)} 章`,
                    )
                    .join("、")}
                  {paths.length > 6 ? ` … 等 ${paths.length} 个文件` : ""}
                  {comicMode === "existing" && selectedGroupId
                    ? ` · 目标漫画：${existingItems?.find((item) => item.id === selectedGroupId)?.title ?? selectedGroupId}`
                    : trimmedName !== ""
                      ? ` · 漫画标题：${trimmedName}`
                      : ""}
                </span>
              </>
            ) : (
              <>
                <span className="text-white/38">将创建文件夹：</span>
                <span className="break-all font-mono">{targetFolder}</span>
                <span className="mt-1 block text-white/38">
                  卡片标题：{trimmedName === "" ? "（默认用文件夹名）" : trimmedName}
                  {isMusic ? " · 支持把 mp3/wav/flac 子目录一起放进同一专辑组" : ""}
                </span>
              </>
            )}
          </div>
        )}

        {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm text-white/76 transition hover:bg-white/14 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={paths.length === 0 || busy}
            className="rounded-full bg-sky-300/25 px-5 py-2 text-sm text-sky-50 transition hover:bg-sky-300/35 disabled:opacity-50"
          >
            {busy
              ? isComics
                ? "正在解压导入…"
                : "正在复制…"
              : isComics
                ? duplicateButtonLabel
                : "确认添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

function isInside(position: { x: number; y: number }, rect: DOMRect): boolean {
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  );
}
