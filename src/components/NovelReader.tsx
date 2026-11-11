import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";

interface NovelChapter {
  name: string;
  path: string;
  relativePath: string;
  size: number;
}

/** 章节名去掉扩展名，作为目录里的显示名 */
function chapterLabel(chapter: NovelChapter): string {
  return chapter.relativePath.replace(/\.(txt|md|markdown|epub)$/i, "");
}

function isEpub(chapter: NovelChapter): boolean {
  return /\.epub$/i.test(chapter.relativePath);
}

/** 记住每本书读到第几章 */
function progressKey(itemId: string): string {
  return `catlibrary-novel-progress:${itemId}`;
}

export default function NovelReader({ itemId }: { itemId: string }) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [chapters, setChapters] = useState<NovelChapter[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [text, setText] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingText, setLoadingText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(17);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 加载章节列表
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setError(null);

    invoke<NovelChapter[]>("list_novel_chapters", { resourceRoot, groupId: itemId })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const list = result ?? [];
        setChapters(list);

        // 恢复上次读到的章节
        let saved = 0;
        try {
          saved = Number(localStorage.getItem(progressKey(itemId)) ?? 0) || 0;
        } catch {
          saved = 0;
        }
        setCurrentIndex(list.length > 0 ? Math.min(Math.max(saved, 0), list.length - 1) : 0);
      })
      .catch((currentError) => {
        if (!cancelled) {
          setChapters([]);
          setError(currentError instanceof Error ? currentError.message : "读取章节目录失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [itemId, resourceRoot]);

  // 加载正文
  useEffect(() => {
    const chapter = chapters[currentIndex];
    if (!chapter) {
      setText("");
      return;
    }

    if (isEpub(chapter)) {
      setText("");
      setError("EPUB 暂不支持在应用内阅读，可在资源管理器里用外部阅读器打开。");
      return;
    }

    let cancelled = false;
    setLoadingText(true);
    setError(null);

    invoke<string>("read_novel_text", { path: chapter.path })
      .then((content) => {
        if (!cancelled) {
          setText(content);
          scrollRef.current?.scrollTo({ top: 0 });
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setText("");
          setError(currentError instanceof Error ? currentError.message : "读取正文失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingText(false);
        }
      });

    try {
      localStorage.setItem(progressKey(itemId), String(currentIndex));
    } catch {
      // 存不下就只影响下次打开时的定位
    }

    return () => {
      cancelled = true;
    };
  }, [chapters, currentIndex, itemId]);

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 rounded-[28px] bg-black/16 text-sm text-white/60">
        <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
        正在读取章节…
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="flex h-[52vh] items-center justify-center rounded-[28px] bg-black/16 text-sm text-white/55">
        这个条目下还没有可阅读的文本文件（支持 txt / md）。
      </div>
    );
  }

  const chapter = chapters[currentIndex];

  return (
    <div className="flex h-[72vh] min-h-[420px] gap-3">
      {/* 章节目录 */}
      <div className="flex w-56 shrink-0 flex-col rounded-[20px] border border-white/12 bg-black/24">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="text-xs text-white/60">目录</span>
          <span className="text-[11px] tabular-nums text-white/40">{chapters.length} 章</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {chapters.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setCurrentIndex(index)}
              title={entry.relativePath}
              className={`mb-0.5 block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                index === currentIndex
                  ? "bg-sky-300/20 text-sky-100"
                  : "text-white/62 hover:bg-white/10 hover:text-white/90"
              }`}
            >
              {chapterLabel(entry)}
            </button>
          ))}
        </div>
      </div>

      {/* 正文 */}
      <div className="flex min-w-0 flex-1 flex-col rounded-[20px] border border-white/12 bg-black/24">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={currentIndex === 0}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/75 transition hover:bg-white/16 disabled:opacity-35"
            title="上一章"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentIndex((index) => Math.min(chapters.length - 1, index + 1))}
            disabled={currentIndex >= chapters.length - 1}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/75 transition hover:bg-white/16 disabled:opacity-35"
            title="下一章"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-white/70">{chapterLabel(chapter)}</span>
          <button
            type="button"
            onClick={() => setFontSize((size) => Math.max(12, size - 1))}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/70 transition hover:bg-white/16"
            title="字号减小"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-8 text-center text-[11px] tabular-nums text-white/50">{fontSize}</span>
          <button
            type="button"
            onClick={() => setFontSize((size) => Math.min(30, size + 1))}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/70 transition hover:bg-white/16"
            title="字号增大"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loadingText ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-white/55">
              <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
              正在读取正文…
            </div>
          ) : error ? (
            <p className="text-sm leading-7 text-rose-200">{error}</p>
          ) : (
            <pre
              className="whitespace-pre-wrap break-words font-sans leading-[1.9] text-white/86"
              style={{ fontSize }}
            >
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
