import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  Music,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReportMediaPicker from "@/components/ReportMediaPicker";
import {
  BLOCK_LABELS,
  BLOCK_ORDER,
  createBlock,
  loadReports,
  reportTitle,
  saveReports,
  type Report,
  type ReportBlock,
  type ReportMediaRef,
} from "@/lib/reports";
import { useAppStore } from "@/store/useAppStore";

/** 让多行输入框高度跟随内容 */
function autoGrow(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

function MediaPreview({ block, preview }: { block: ReportBlock; preview: boolean }) {
  const media = block.media;
  if (!media) {
    return null;
  }
  // 选择器存进来的已经是可直接播放/显示的 asset URL，这里不要再做一次转换
  const url = media.path;

  if (block.type === "image") {
    return (
      <img
        src={url}
        alt={media.title}
        className={`w-full rounded-[14px] object-contain ${preview ? "max-h-[70vh]" : "max-h-[46vh]"}`}
      />
    );
  }
  if (block.type === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        className={`w-full rounded-[14px] bg-black/40 ${preview ? "max-h-[70vh]" : "max-h-[46vh]"}`}
      />
    );
  }
  return <audio src={url} controls className="w-full" />;
}

export default function ReportEditorPage() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<"image" | "video" | "audio">("image");
  const pickTargetRef = useRef<string | null>(null);
  const skipFirstSaveRef = useRef(true);

  // 载入报道
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadReports(resourceRoot)
      .then((list) => {
        if (cancelled) {
          return;
        }
        const found = list.find((entry) => entry.id === reportId);
        if (!found) {
          setError("找不到这篇报道，可能已被删除。");
          setReport(null);
        } else {
          setReport(found);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取报道失败");
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
  }, [reportId, resourceRoot]);

  // 自动保存（停止输入 700ms 后写入）
  useEffect(() => {
    if (!report) {
      return;
    }
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }

    setSaving(true);
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const all = await loadReports(resourceRoot);
          const exists = all.some((entry) => entry.id === report.id);
          const next = exists
            ? all.map((entry) => (entry.id === report.id ? report : entry))
            : [report, ...all];
          await saveReports(resourceRoot, next);
          setSavedAt(Date.now());
          setError(null);
        } catch (currentError) {
          setError(currentError instanceof Error ? currentError.message : "保存失败");
        } finally {
          setSaving(false);
        }
      })();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [report, resourceRoot]);

  const patchReport = useCallback((updater: (current: Report) => Report) => {
    setReport((current) => {
      if (!current) {
        return current;
      }
      return { ...updater(current), updatedAt: Date.now() };
    });
  }, []);

  const updateBlock = useCallback(
    (blockId: string, patch: Partial<ReportBlock>) => {
      patchReport((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === blockId ? { ...block, ...patch } : block,
        ),
      }));
    },
    [patchReport],
  );

  const addBlock = useCallback(
    (type: ReportBlock["type"], afterId?: string) => {
      const block = createBlock(type);
      patchReport((current) => {
        if (!afterId) {
          return { ...current, blocks: [...current.blocks, block] };
        }
        const index = current.blocks.findIndex((entry) => entry.id === afterId);
        const blocks = [...current.blocks];
        blocks.splice(index < 0 ? blocks.length : index + 1, 0, block);
        return { ...current, blocks };
      });
    },
    [patchReport],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      patchReport((current) => ({
        ...current,
        blocks: current.blocks.filter((block) => block.id !== blockId),
      }));
    },
    [patchReport],
  );

  const moveBlock = useCallback(
    (blockId: string, direction: -1 | 1) => {
      patchReport((current) => {
        const index = current.blocks.findIndex((block) => block.id === blockId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= current.blocks.length) {
          return current;
        }
        const blocks = [...current.blocks];
        const [moved] = blocks.splice(index, 1);
        blocks.splice(target, 0, moved);
        return { ...current, blocks };
      });
    },
    [patchReport],
  );

  const openMediaPicker = (kind: "image" | "video" | "audio", blockId: string) => {
    pickTargetRef.current = blockId;
    setPickerKind(kind);
    setPickerOpen(true);
  };

  const handlePicked = (media: ReportMediaRef) => {
    const blockId = pickTargetRef.current;
    setPickerOpen(false);
    if (!blockId) {
      return;
    }
    updateBlock(blockId, { media, caption: undefined });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
        <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
        正在读取报道…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-white/70">{error ?? "找不到这篇报道"}</p>
        <button
          type="button"
          onClick={() => navigate("/reports")}
          className="rounded-full border border-white/18 bg-white/8 px-4 py-2 text-sm text-white/80 transition hover:bg-white/16"
        >
          返回报道列表
        </button>
      </div>
    );
  }

  const blockCardClass =
    "group relative rounded-[16px] border border-white/10 bg-white/4 p-3 transition hover:border-white/20";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部工具条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => navigate("/reports")}
          className="inline-flex items-center gap-1 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/16"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <span className="ml-1 min-w-0 flex-1 truncate text-sm text-white/80">{reportTitle(report)}</span>
        <span className="shrink-0 text-[11px] text-white/40">
          {saving ? "保存中…" : savedAt ? "已自动保存" : "改动会自动保存"}
        </span>
        <button
          type="button"
          onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-300/35 bg-sky-300/12 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-300/22"
        >
          {mode === "edit" ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {mode === "edit" ? "预览" : "继续编辑"}
        </button>
      </div>

      {error ? (
        <div className="mx-4 mt-2 rounded-[10px] border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      {/* 文档主体 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-3xl">
          {/* 标题区 */}
          <input
            value={report.title}
            onChange={(event) => patchReport((current) => ({ ...current, title: event.target.value }))}
            placeholder="报道标题…"
            className="w-full bg-transparent text-3xl font-bold tracking-tight text-white outline-none placeholder:text-white/25"
          />
          <input
            value={report.subtitle ?? ""}
            onChange={(event) => patchReport((current) => ({ ...current, subtitle: event.target.value }))}
            placeholder="副标题（可选）"
            className="mt-2 w-full bg-transparent text-sm text-white/60 outline-none placeholder:text-white/22"
          />
          <div className="mt-4 h-px w-full bg-white/10" />

          {/* 内容块 */}
          <div className="mt-4 space-y-3">
            {report.blocks.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/40">还没有内容，用下面的按钮添加一个块。</p>
            ) : null}

            {report.blocks.map((block) => {
              const isMedia = block.type === "image" || block.type === "video" || block.type === "audio";

              return (
                <div key={block.id} className={mode === "edit" ? blockCardClass : "relative py-1"}>
                  {mode === "edit" ? (
                    <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/50">
                        {BLOCK_LABELS[block.type]}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, -1)}
                        title="上移"
                        className="rounded-full border border-white/14 bg-black/60 p-1 text-white/70 hover:bg-white/20"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, 1)}
                        title="下移"
                        className="rounded-full border border-white/14 bg-black/60 p-1 text-white/70 hover:bg-white/20"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlock("text", block.id)}
                        title="在下方插入正文"
                        className="rounded-full border border-white/14 bg-black/60 p-1 text-white/70 hover:bg-white/20"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(block.id)}
                        title="删除这个块"
                        className="rounded-full border border-rose-300/30 bg-black/60 p-1 text-rose-200 hover:bg-rose-300/20"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null}

                  {/* 文本类块 */}
                  {block.type === "h1" ? (
                    mode === "edit" ? (
                      <input
                        value={block.text ?? ""}
                        onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                        placeholder="大标题"
                        className="w-full bg-transparent text-2xl font-bold text-white outline-none placeholder:text-white/22"
                      />
                    ) : (
                      <h1 className="text-2xl font-bold text-white">{block.text || "大标题"}</h1>
                    )
                  ) : null}

                  {block.type === "h2" ? (
                    mode === "edit" ? (
                      <input
                        value={block.text ?? ""}
                        onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                        placeholder="小标题"
                        className="w-full bg-transparent text-lg font-semibold text-white/92 outline-none placeholder:text-white/22"
                      />
                    ) : (
                      <h2 className="text-lg font-semibold text-white/92">{block.text || "小标题"}</h2>
                    )
                  ) : null}

                  {block.type === "text" || block.type === "quote" ? (
                    mode === "edit" ? (
                      <textarea
                        ref={(element) => autoGrow(element)}
                        value={block.text ?? ""}
                        onChange={(event) => {
                          updateBlock(block.id, { text: event.target.value });
                          autoGrow(event.currentTarget);
                        }}
                        placeholder={block.type === "quote" ? "引用内容…" : "正文…"}
                        rows={2}
                        className={`w-full resize-none bg-transparent text-sm leading-7 text-white/86 outline-none placeholder:text-white/22 ${
                          block.type === "quote" ? "border-l-2 border-sky-300/40 pl-3 italic text-white/72" : ""
                        }`}
                      />
                    ) : block.type === "quote" ? (
                      <blockquote className="border-l-2 border-sky-300/40 pl-3 text-sm italic leading-7 text-white/72">
                        {block.text}
                      </blockquote>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-7 text-white/86">{block.text}</p>
                    )
                  ) : null}

                  {block.type === "divider" ? <div className="my-2 h-px w-full bg-white/14" /> : null}

                  {/* 媒体块 */}
                  {isMedia ? (
                    <div className="space-y-2">
                      {block.media ? (
                        <MediaPreview block={block} preview={mode === "preview"} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => openMediaPicker(block.type as "image" | "video" | "audio", block.id)}
                          className="flex h-24 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-white/20 bg-black/20 text-sm text-white/55 transition hover:border-sky-300/45 hover:text-sky-100"
                        >
                          {block.type === "audio" ? <Music className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
                          从素材库选择{BLOCK_LABELS[block.type]}
                        </button>
                      )}

                      {block.media && mode === "edit" ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openMediaPicker(block.type as "image" | "video" | "audio", block.id)}
                            className="rounded-full border border-white/16 bg-white/8 px-2.5 py-1 text-[11px] text-white/70 transition hover:bg-white/16"
                          >
                            更换
                          </button>
                          <button
                            type="button"
                            onClick={() => updateBlock(block.id, { media: undefined })}
                            className="rounded-full border border-white/16 bg-white/8 px-2.5 py-1 text-[11px] text-white/60 transition hover:bg-white/16"
                          >
                            移除
                          </button>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-white/40">
                            {block.media.title}
                          </span>
                        </div>
                      ) : null}

                      {block.media && mode === "edit" ? (
                        <input
                          value={block.caption ?? ""}
                          onChange={(event) => updateBlock(block.id, { caption: event.target.value })}
                          placeholder="图注（可选）"
                          className="w-full bg-transparent text-xs text-white/55 outline-none placeholder:text-white/22"
                        />
                      ) : block.caption ? (
                        <p className="text-xs text-white/50">{block.caption}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* 添加块 */}
          {mode === "edit" ? (
            <div className="mt-5 rounded-[16px] border border-white/10 bg-black/20 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-white/45">
                <FileText className="h-3 w-3" />
                添加内容块
              </p>
              <div className="flex flex-wrap gap-1.5">
                {BLOCK_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addBlock(type)}
                    className="rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/75 transition hover:border-sky-300/40 hover:bg-sky-300/15 hover:text-sky-100"
                  >
                    {BLOCK_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ReportMediaPicker
        open={pickerOpen}
        kind={pickerKind}
        onClose={() => setPickerOpen(false)}
        onPick={handlePicked}
      />
    </div>
  );
}
