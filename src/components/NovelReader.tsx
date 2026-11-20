import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
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
 * 长篇常见「一整个 txt」，直接渲染几百万字会卡死，所以按章节切段。
 * 切出来的段同时用作目录条目，这样一本书也能在左侧看到全部章节。
 */
function splitSegments(raw: string): Segment[] {
  if (raw.length <= CHUNK_CHARS * 2) {
    return [{ title: "正文", body: raw }];
  }
  const heading = /^[ \t]*(第[0-9零一二三四五六七八九十百千万两]{1,12}[章回节卷][^\n]{0,40})$/gm;
  const marks: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = heading.exec(raw)) !== null) {
    marks.push({ index: match.index, title: match[1].trim() });
  }
  if (marks.length < 3) {
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

/** 记住每本书读到哪一节 */
function progressKey(itemId: string): string {
  return `catlibrary-novel-progress:${itemId}`;
}

type SavedProgress = { file: number; segment: number };

function readProgress(itemId: string, fileCount: number): SavedProgress {
  try {
    const raw = localStorage.getItem(progressKey(itemId));
    if (!raw) {
      return { file: 0, segment: 0 };
    }
    // 兼容旧格式：以前只存一个数字（文件索引）
    if (/^\d+$/.test(raw)) {
      return { file: Math.min(Math.max(Number(raw), 0), Math.max(fileCount - 1, 0)), segment: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    return {
      file: Math.min(Math.max(Number(parsed.file ?? 0), 0), Math.max(fileCount - 1, 0)),
      segment: Math.max(Number(parsed.segment ?? 0), 0),
    };
  } catch {
    return { file: 0, segment: 0 };
  }
}

export default function NovelReader({ itemId }: { itemId: string }) {
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [files, setFiles] = useState<NovelChapter[]>([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [text, setText] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingText, setLoadingText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(17);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingSegment = useRef(0);

  const segments = useMemo(() => splitSegments(text), [text]);
  const currentFile = files[fileIndex] ?? null;
  const segment = segments[segmentIndex] ?? null;

  // 加载文件列表
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
        setFiles(list);
        const saved = readProgress(itemId, list.length);
        pendingSegment.current = saved.segment;
        setFileIndex(saved.file);
      })
      .catch((currentError) => {
        if (!cancelled) {
          setFiles([]);
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

  // 加载当前文件正文
  useEffect(() => {
    const file = files[fileIndex];
    if (!file) {
      setText("");
      return;
    }
    if (isEpub(file)) {
      setText("");
      setError("EPUB 暂不支持在应用内阅读，可用外部阅读器打开。");
      return;
    }

    let cancelled = false;
    setLoadingText(true);
    setError(null);

    invoke<string>("read_novel_text", { path: file.path })
      .then((content) => {
        if (cancelled) {
          return;
        }
        setText(content);
        setSegmentIndex(pendingSegment.current);
        pendingSegment.current = 0;
        scrollRef.current?.scrollTo({ top: 0 });
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

    return () => {
      cancelled = true;
    };
  }, [files, fileIndex]);

  // 记住进度
  useEffect(() => {
    if (!files.length) {
      return;
    }
    try {
      localStorage.setItem(progressKey(itemId), JSON.stringify({ file: fileIndex, segment: segmentIndex }));
    } catch {
      // 存不下只影响下次打开时的定位
    }
  }, [fileIndex, segmentIndex, itemId, files.length]);

  const gotoSegment = (index: number) => {
    setSegmentIndex(index);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const step = (delta: -1 | 1) => {
    const next = segmentIndex + delta;
    if (next >= 0 && next < segments.length) {
      gotoSegment(next);
      return;
    }
    // 跨文件：最后一节往后 → 下一个文件的第 0 节
    if (next >= segments.length && fileIndex + 1 < files.length) {
      pendingSegment.current = 0;
      setFileIndex(fileIndex + 1);
      return;
    }
    if (next < 0 && fileIndex > 0) {
      pendingSegment.current = Number.MAX_SAFE_INTEGER;
      setFileIndex(fileIndex - 1);
    }
  };

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 rounded-[28px] bg-black/16 text-sm text-white/60">
        <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
        正在读取章节目录…
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-[52vh] items-center justify-center rounded-[28px] bg-black/16 text-sm text-white/55">
        这个条目下还没有可阅读的文本文件（支持 txt / md）。
      </div>
    );
  }

  return (
    <div className="flex h-[72vh] min-h-[420px] gap-3">
      {/* 目录 */}
      {sidebarOpen ? (
        <div className="flex w-60 shrink-0 flex-col rounded-[20px] border border-white/12 bg-black/24">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-2 py-2">
            <List className="h-3.5 w-3.5 shrink-0 text-white/40" />
            <span className="text-xs text-white/60">目录</span>
            <span className="text-[11px] tabular-nums text-white/35">{segments.length} 章</span>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              title="收起目录"
              className="ml-auto rounded-full border border-white/12 bg-white/6 p-1 text-white/55 transition hover:bg-white/14 hover:text-white"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 多个 txt 时才显示文件切换 */}
          {files.length > 1 ? (
            <div className="shrink-0 border-b border-white/10 p-1.5">
              <p className="px-1.5 pb-1 text-[10px] text-white/30">{files.length} 个文件</p>
              {files.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => {
                    pendingSegment.current = 0;
                    setFileIndex(index);
                  }}
                  title={file.relativePath}
                  className={`mb-0.5 block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] transition ${
                    index === fileIndex
                      ? "bg-sky-300/20 text-sky-100"
                      : "text-white/55 hover:bg-white/10 hover:text-white/85"
                  }`}
                >
                  {chapterLabel(file)}
                </button>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {segments.map((entry, index) => (
              <button
                key={`${entry.title}-${index}`}
                type="button"
                onClick={() => gotoSegment(index)}
                title={entry.title}
                className={`mb-0.5 block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  index === segmentIndex
                    ? "bg-sky-300/20 text-sky-100"
                    : "text-white/62 hover:bg-white/10 hover:text-white/90"
                }`}
              >
                {entry.title || `第 ${index + 1} 节`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 正文 */}
      <div className="flex min-w-0 flex-1 flex-col rounded-[20px] border border-white/12 bg-black/24">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
          {!sidebarOpen ? (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title="展开目录"
              className="rounded-full border border-white/16 bg-white/8 p-1 text-white/70 transition hover:bg-white/16"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={segmentIndex === 0 && fileIndex === 0}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/75 transition hover:bg-white/16 disabled:opacity-35"
            title="上一章"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={segmentIndex >= segments.length - 1 && fileIndex >= files.length - 1}
            className="rounded-full border border-white/16 bg-white/8 p-1 text-white/75 transition hover:bg-white/16 disabled:opacity-35"
            title="下一章"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-white/70">
            {segment?.title ?? currentFile?.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-white/35">
            {segmentIndex + 1} / {segments.length}
          </span>
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
              {segment?.body ?? ""}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
