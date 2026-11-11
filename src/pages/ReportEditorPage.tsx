import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  FileText,
  FolderOpen,
  ImagePlus,
  Loader2,
  Music,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReportMediaPicker from "@/components/ReportMediaPicker";
import {
  BLOCK_LABELS,
  BLOCK_ORDER,
  COLOR_PRESETS,
  WIDTH_CLASS,
  WIDTH_LABELS,
  assetUrl,
  blocksFromMarkdown,
  createBlock,
  importReportFolder,
  listReportAssets,
  loadReports,
  reportTitle,
  saveReport,
  type BlockAlign,
  type Report,
  type ReportBlock,
  type ReportMediaRef,
  type ReportWidth,
} from "@/lib/reports";
import { useAppStore } from "@/store/useAppStore";

/** 高度跟随内容的多行输入（标题也用 textarea，长标题才会自动换行、不会看不全） */
function GrowingTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-white/22 ${className ?? ""}`}
    />
  );
}

function MediaPreview({ block, preview }: { block: ReportBlock; preview: boolean }) {
  const media = block.media;
  if (!media) {
    return null;
  }
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

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

export default function ReportEditorPage() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const setSavedToast = useAppStore((state) => state.setSavedToast);

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<"image" | "video" | "audio">("image");
  const pickTargetRef = useRef<string | null>(null);
  const skipFirstSaveRef = useRef(true);

  // 载入报道（不存在时顺手新建一份，方便「新建后直接编辑」）
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
        setReport(found ?? null);
        if (!found) {
          setError("找不到这篇报道，可能已被删除。");
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

  // 自动保存（停止输入 700ms 后写入这篇报道自己的目录）
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
          await saveReport(resourceRoot, report);
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

  /** 导入一个本地文件夹到这篇报道的仓库；若里面有 md/txt 正文，顺手生成整篇内容 */
  const importFolder = async (replaceBody: boolean) => {
    if (!report) {
      return;
    }
    const chosen = await open({ directory: true, multiple: false });
    if (!chosen || typeof chosen !== "string") {
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const result = await importReportFolder(resourceRoot, report.id, chosen);
      const markdown = result.assets.find(
        (asset) => asset.kind === "text" && /\.(md|markdown|txt)$/i.test(asset.name),
      );

      const toMediaBlock = (asset: (typeof result.assets)[number]): ReportBlock => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type: (asset.kind === "image" ? "image" : asset.kind === "video" ? "video" : "audio") as ReportBlock["type"],
        media: {
          category: "report",
          itemId: asset.relativePath,
          path: assetUrl(asset),
          title: asset.name,
        },
      });

      let generated: ReportBlock[] = [];

      if (markdown) {
        const text = await invoke<string>("read_novel_text", { path: markdown.path });
        generated = blocksFromMarkdown(text, result.assets, markdown.relativePath);
      }

      // 正文里没引用到的媒体（尤其是 视频/ 目录里的原件）直接按顺序补成块，不转码、不改文件
      const referenced = new Set(
        generated
          .filter((block) => block.media?.category === "report")
          .map((block) => block.media!.itemId),
      );
      const extraMedia = result.assets.filter(
        (asset) =>
          (asset.kind === "video" || asset.kind === "audio" || asset.kind === "image") &&
          !referenced.has(asset.relativePath),
      );
      generated = [...generated, ...extraMedia.map(toMediaBlock)];

      if (generated.length > 0) {
        patchReport((current) => {
          const kept = replaceBody
            ? []
            : current.blocks.filter((block) => (block.text ?? "").trim() || block.media);
          const titleBlock = generated.find((block) => block.type === "h1" && block.text);
          return {
            ...current,
            blocks: [...kept, ...generated],
            title: current.title.trim() || titleBlock?.text?.trim() || current.title,
          };
        });
      }

      setSavedToast(
        `已导入 ${result.assets.length} 个文件${generated.length > 0 ? `，生成 ${generated.length} 个内容块` : ""}`,
      );
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "导入文件夹失败");
    } finally {
      setImporting(false);
    }
  };

  /** 把本报道已导入的图片/视频按顺序追加成块 */
  const insertOwnMedia = async () => {
    if (!report) {
      return;
    }
    try {
      const assets = await listReportAssets(resourceRoot, report.id);
      const media = assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
      if (media.length === 0) {
        setSavedToast("这篇报道还没有导入图片或视频");
        return;
      }
      patchReport((current) => ({
        ...current,
        blocks: [
          ...current.blocks,
          ...media.map((asset) => ({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            type: (asset.kind === "image" ? "image" : "video") as ReportBlock["type"],
            media: {
              category: "report" as const,
              itemId: asset.relativePath,
              path: assetUrl(asset),
              title: asset.name,
            },
          })),
        ],
      }));
      setSavedToast(`已追加 ${media.length} 个媒体块`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取本报道素材失败");
    }
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

  const width = report.width ?? "medium";
  const blockCardClass =
    "group relative rounded-[16px] border border-white/10 bg-white/4 p-3 transition hover:border-white/20";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
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
          {mode === "preview"
            ? "阅读模式"
            : importing
              ? "导入中…"
              : saving
                ? "保存中…"
                : savedAt
                  ? "已自动保存"
                  : "改动会自动保存"}
        </span>
        {mode === "edit" ? (
          <>
            <button
              type="button"
              onClick={() => void importFolder(false)}
              disabled={importing}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/35 bg-amber-300/12 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-300/22 disabled:opacity-50"
              title="把准备好的文件夹整个搬进这篇报道，有 md/txt 正文会自动生成内容块"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              导入文件夹
            </button>
            <button
              type="button"
              onClick={() => void insertOwnMedia()}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/16"
              title="把本篇报道已导入的图片/视频按顺序追加成块"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              插入全部媒体
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-300/35 bg-sky-300/12 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-300/22"
        >
          {mode === "edit" ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {mode === "edit" ? "预览" : "编辑"}
        </button>
      </div>

      {/* 排版设置（仅编辑模式） */}
      {mode === "edit" ? (
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/8 px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-white/40">宽度</span>
          {(["narrow", "medium", "wide"] as ReportWidth[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => patchReport((current) => ({ ...current, width: value }))}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                width === value
                  ? "border-sky-300/50 bg-sky-300/18 text-sky-100"
                  : "border-white/14 bg-white/6 text-white/60 hover:bg-white/12"
              }`}
            >
              {WIDTH_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-white/40">全文颜色</span>
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.label}
              onClick={() => patchReport((current) => ({ ...current, color: preset.value }))}
              className={`h-5 w-5 rounded-full border transition ${
                (report.color ?? "") === preset.value
                  ? "border-sky-300 ring-1 ring-sky-300/60"
                  : "border-white/25 hover:border-white/60"
              }`}
              style={{ background: preset.value || "transparent" }}
            >
              {preset.value ? null : <span className="block text-[9px] leading-5 text-white/60">A</span>}
            </button>
          ))}
          <input
            type="color"
            value={report.color || "#f8fafc"}
            onChange={(event) => patchReport((current) => ({ ...current, color: event.target.value }))}
            title="自定义颜色"
            className="h-5 w-5 cursor-pointer rounded border border-white/25 bg-transparent"
          />
        </div>

        <span className="ml-auto text-[11px] text-white/30">{report.blocks.length} 个块</span>
      </div>
      ) : null}

      {error ? (
        <div className="mx-4 mt-2 rounded-[10px] border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      {/* 文档主体 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div
          className={`mx-auto w-full ${WIDTH_CLASS[width]}`}
          style={{ color: report.color || undefined }}
        >
          <GrowingTextarea
            value={report.title}
            onChange={(value) => patchReport((current) => ({ ...current, title: value }))}
            placeholder="报道标题…"
            className="text-3xl font-bold leading-tight tracking-tight text-white"
          />
          <GrowingTextarea
            value={report.subtitle ?? ""}
            onChange={(value) => patchReport((current) => ({ ...current, subtitle: value }))}
            placeholder="副标题（可选）"
            className="mt-2 text-sm text-white/60"
          />
          <div className="mt-4 h-px w-full bg-white/10" />

          <div className="mt-4 space-y-3">
            {report.blocks.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/40">还没有内容，用下面的按钮添加一个块。</p>
            ) : null}

            {report.blocks.map((block) => {
              const isMedia = block.type === "image" || block.type === "video" || block.type === "audio";
              const align = block.style?.align ?? "left";
              const AlignIcon = ALIGN_ICONS[align];

              return (
                <div
                  key={block.id}
                  className={mode === "edit" ? blockCardClass : "relative py-1"}
                  style={{
                    textAlign: block.style?.align,
                    color: block.style?.color || undefined,
                  }}
                >
                  {mode === "edit" ? (
                    <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/50">
                        {BLOCK_LABELS[block.type]}
                      </span>
                      <button
                        type="button"
                        title="切换对齐"
                        onClick={() =>
                          updateBlock(block.id, {
                            style: {
                              ...block.style,
                              align: align === "left" ? "center" : align === "center" ? "right" : "left",
                            },
                          })
                        }
                        className="rounded-full border border-white/14 bg-black/60 p-1 text-white/70 hover:bg-white/20"
                      >
                        <AlignIcon className="h-3 w-3" />
                      </button>
                      <input
                        type="color"
                        title="这个块的颜色"
                        value={block.style?.color || report.color || "#f8fafc"}
                        onChange={(event) =>
                          updateBlock(block.id, { style: { ...block.style, color: event.target.value } })
                        }
                        className="h-5 w-5 cursor-pointer rounded border border-white/20 bg-transparent"
                      />
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

                  {block.type === "h1" ? (
                    mode === "edit" ? (
                      <GrowingTextarea
                        value={block.text ?? ""}
                        onChange={(value) => updateBlock(block.id, { text: value })}
                        placeholder="大标题"
                        className="text-2xl font-bold leading-snug text-white"
                      />
                    ) : (
                      <h1 className="whitespace-pre-wrap break-words text-2xl font-bold leading-snug">
                        {block.text || "大标题"}
                      </h1>
                    )
                  ) : null}

                  {block.type === "h2" ? (
                    mode === "edit" ? (
                      <GrowingTextarea
                        value={block.text ?? ""}
                        onChange={(value) => updateBlock(block.id, { text: value })}
                        placeholder="小标题"
                        className="text-lg font-semibold leading-snug text-white/92"
                      />
                    ) : (
                      <h2 className="whitespace-pre-wrap break-words text-lg font-semibold leading-snug">
                        {block.text || "小标题"}
                      </h2>
                    )
                  ) : null}

                  {block.type === "text" || block.type === "quote" ? (
                    mode === "edit" ? (
                      <GrowingTextarea
                        value={block.text ?? ""}
                        onChange={(value) => updateBlock(block.id, { text: value })}
                        placeholder={block.type === "quote" ? "引用内容…" : "正文…"}
                        className={`text-sm leading-7 ${
                          block.type === "quote"
                            ? "border-l-2 border-sky-300/40 pl-3 italic text-white/72"
                            : "text-white/86"
                        }`}
                      />
                    ) : block.type === "quote" ? (
                      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-sky-300/40 pl-3 text-sm italic leading-7 text-white/72">
                        {block.text}
                      </blockquote>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-white/86">
                        {block.text}
                      </p>
                    )
                  ) : null}

                  {block.type === "divider" ? <div className="my-2 h-px w-full bg-white/14" /> : null}

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
                          从素材库或本报道素材里选择{BLOCK_LABELS[block.type]}
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
        reportId={report.id}
        onClose={() => setPickerOpen(false)}
        onPick={handlePicked}
      />
    </div>
  );
}
