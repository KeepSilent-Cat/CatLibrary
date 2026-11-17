import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const CHUNK_CHARS = 20000;

type Segment = { title: string; body: string };

/**
 * 长篇小说常见「一整个 txt」，直接渲染几百万字会卡死。
 * 这里按「第X章 / 第X回 / 第X节」切成段，读的时候一次只渲染一段。
 */
function splitSegments(raw: string): Segment[] {
  if (raw.length <= CHUNK_CHARS * 2) {
    return [{ title: "", body: raw }];
  }
  const heading = /^[ \t]*(第[0-9零一二三四五六七八九十百千万两]{1,12}[章回节卷][^\n]{0,30})$/gm;
  const marks: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = heading.exec(raw)) !== null) {
    marks.push({ index: match.index, title: match[1].trim() });
  }
  if (marks.length < 3) {
    // 认不出章节就按固定字数切块，至少不会一次渲染整个文件
    const chunks: Segment[] = [];
    for (let offset = 0; offset < raw.length; offset += CHUNK_CHARS) {
      chunks.push({
        title: `第 ${chunks.length + 1} 段`,
        body: raw.slice(offset, offset + CHUNK_CHARS),
      });
    }
    return chunks;
  }
  const segments: Segment[] = [];
  if (marks[0].index > 0) {
    const head = raw.slice(0, marks[0].index).trim();
    if (head) {
      segments.push({ title: "开头", body: head });
    }
  }
  marks.forEach((mark, position) => {
    const end = position + 1 < marks.length ? marks[position + 1].index : raw.length;
    segments.push({ title: mark.title, body: raw.slice(mark.index, end) });
  });
  return segments;
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
  const [segmentIndex, setSegmentIndex] = useState(0);
  const segments = useMemo(() => splitSegments(text), [text]);
  useEffect(() => {
    setSegmentIndex(0);
  }, [text]);
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
          {segments.length > 1 ? (
            <select
              value={segmentIndex}
              onChange={(event) => {
                setSegmentIndex(Number(event.target.value));
                scrollRef.current?.scrollTo({ top: 0 });
              }}
              title="这本书太长，已自动按章节分段"
              className="max-w-[220px] shrink-0 rounded-full border border-white/16 bg-white/8 px-2 py-1 text-[11px] text-white/80 outline-none"
            >
              {segments.map((segment, index) => (
                <option key={`${segment.title}-${index}`} value={index}>
                  {index + 1}. {segment.title || `第 ${index + 1} 段`}
                </option>
              ))}
            </select>
          ) : null}
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
            <>
              {segments.length > 1 ? (
                <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-white/40">
                  <span>
                    分段 {segmentIndex + 1} / {segments.length}
                    {segments[segmentIndex]?.title ? ` · ${segments[segmentIndex].title}` : ""}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={segmentIndex <= 0}
                      onClick={() => {
                        setSegmentIndex((index) => Math.max(0, index - 1));
                        scrollRef.current?.scrollTo({ top: 0 });
                      }}
                      className="rounded-full border border-white/16 bg-white/8 px-2 py-0.5 text-white/70 transition hover:bg-white/16 disabled:opacity-35"
                    >
                      上一段
                    </button>
                    <button
                      type="button"
                      disabled={segmentIndex >= segments.length - 1}
                      onClick={() => {
                        setSegmentIndex((index) => Math.min(segments.length - 1, index + 1));
                        scrollRef.current?.scrollTo({ top: 0 });
                      }}
                      className="rounded-full border border-white/16 bg-white/8 px-2 py-0.5 text-white/70 transition hover:bg-white/16 disabled:opacity-35"
                    >
                      下一段
                    </button>
                  </div>
                </div>
              ) : null}
              <pre
                className="whitespace-pre-wrap break-words font-sans leading-[1.9] text-white/86"
                style={{ fontSize }}
              >
                {segments[segmentIndex]?.body ?? ""}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
