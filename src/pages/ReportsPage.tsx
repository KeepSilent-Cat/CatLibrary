import { ChevronLeft, ChevronRight, FileText, LayoutGrid, List, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createReport, deleteReport, loadReports, reportTitle, saveReport, type Report } from "@/lib/reports";
import { useAppStore } from "@/store/useAppStore";

/** 列表卡片封面：取第一个图片块 */
function reportCover(report: Report): string | undefined {
  const block = report.blocks.find((entry) => entry.type === "image" && entry.media?.path);
  return block?.media?.path;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ViewMode = "grid" | "list";

const PAGE_SIZE: Record<ViewMode, number> = { grid: 12, list: 20 };
const VIEW_STORAGE_KEY = "catlibrary-reports-view";

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadReports(resourceRoot)
      .then((list) => {
        if (!cancelled) {
          setReports(list);
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
  }, [resourceRoot]);

  const pageSize = PAGE_SIZE[view];
  const totalPages = Math.max(1, Math.ceil(reports.length / pageSize));

  // 数据变少（删除/切换视图）后把页码夹回合法范围
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  const pagedReports = useMemo(
    () => reports.slice(page * pageSize, page * pageSize + pageSize),
    [reports, page, pageSize],
  );

  const switchView = (next: ViewMode) => {
    setView(next);
    setPage(0);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // 存不下只影响下次打开时的默认视图
    }
  };

  const createNew = async () => {
    const report = createReport();
    setReports([report, ...reports]);
    setPage(0);
    try {
      await saveReport(resourceRoot, report);
      navigate(`/reports/${report.id}`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "新建报道失败");
    }
  };

  const removeReport = async (report: Report) => {
    if (deleting !== report.id) {
      setDeleting(report.id);
      window.setTimeout(() => setDeleting(null), 3000);
      return;
    }

    setReports(reports.filter((entry) => entry.id !== report.id));
    setDeleting(null);
    try {
      await deleteReport(resourceRoot, report.id);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "删除报道失败");
    }
  };

  const pagination = totalPages > 1;
  const pageButtons = useMemo(() => {
    const buttons: number[] = [];
    for (let index = 0; index < totalPages; index++) {
      if (index === 0 || index === totalPages - 1 || Math.abs(index - page) <= 2) {
        buttons.push(index);
      }
    }
    return buttons;
  }, [totalPages, page]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-3 pt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/48">Reports</p>
          <h2 className="mt-1 text-lg font-semibold text-white">报道</h2>
          <p className="mt-1 text-xs text-white/45">
            像搭积木一样排版：标题、正文、引用、图片、视频、音乐都能自由组合。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/6 p-1">
            <button
              type="button"
              onClick={() => switchView("grid")}
              title="卡片视图"
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                view === "grid" ? "bg-sky-300/22 text-sky-100" : "text-white/55 hover:text-white/85"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => switchView("list")}
              title="列表视图"
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                view === "list" ? "bg-sky-300/22 text-sky-100" : "text-white/55 hover:text-white/85"
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void createNew()}
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-3.5 py-2 text-xs font-medium text-sky-100 transition hover:bg-sky-300/25"
          >
            <Plus className="h-3.5 w-3.5" />
            新建报道
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-5 mb-2 rounded-[10px] border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="mx-5 mb-2 flex shrink-0 items-center justify-between text-[11px] text-white/40">
        <span>
          共 {reports.length} 篇
          {pagination ? ` · 第 ${page + 1} / ${totalPages} 页` : ""}
        </span>
        <span>{view === "grid" ? "卡片视图" : "列表视图"} · 每页 {pageSize} 篇</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
            正在读取报道…
          </div>
        ) : reports.length === 0 ? (
          <div className="glass-panel flex h-64 flex-col items-center justify-center gap-3 rounded-[28px]">
            <FileText className="h-10 w-10 text-white/30" />
            <p className="text-sm text-white/62">还没有报道</p>
            <p className="max-w-sm text-center text-xs leading-5 text-white/42">
              点右上角「新建报道」，然后从素材库里挑图片、视频、音乐，配上标题和正文。
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {pagedReports.map((report) => {
              const cover = reportCover(report);
              return (
                <div
                  key={report.id}
                  className="group relative overflow-hidden rounded-[20px] border border-white/14 bg-white/6 transition hover:border-sky-300/40 hover:bg-white/10"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/reports/${report.id}`)}
                    className="block w-full text-left"
                  >
                    {cover ? (
                      <img src={cover} alt="" loading="lazy" className="h-32 w-full object-cover" />
                    ) : (
                      <div className="flex h-32 w-full items-center justify-center bg-[linear-gradient(145deg,rgba(31,41,55,0.88),rgba(15,23,42,0.94))]">
                        <FileText className="h-8 w-8 text-white/25" />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="truncate text-sm font-semibold text-white">{reportTitle(report)}</p>
                      <p className="mt-1 truncate text-xs text-white/50">
                        {report.subtitle?.trim() || `${report.blocks.length} 个内容块`}
                      </p>
                      <p className="mt-2 text-[11px] text-white/35">更新于 {formatTime(report.updatedAt)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeReport(report)}
                    title={deleting === report.id ? "再点一次确认删除" : "删除这篇报道"}
                    className={`absolute right-2 top-2 rounded-full border p-1.5 opacity-0 transition group-hover:opacity-100 ${
                      deleting === report.id
                        ? "border-rose-300/60 bg-rose-400/40 text-rose-50"
                        : "border-rose-300/30 bg-black/60 text-rose-200 hover:bg-rose-300/20"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[18px] border border-white/12">
            {pagedReports.map((report, index) => {
              const cover = reportCover(report);
              return (
                <div
                  key={report.id}
                  className={`group flex items-center gap-3 bg-white/4 px-3 py-2.5 transition hover:bg-white/8 ${
                    index > 0 ? "border-t border-white/8" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/reports/${report.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        className="h-14 w-20 shrink-0 rounded-[10px] object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-[10px] bg-black/30">
                        <FileText className="h-5 w-5 text-white/25" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{reportTitle(report)}</p>
                      <p className="mt-0.5 truncate text-xs text-white/45">
                        {report.subtitle?.trim() || "（无副标题）"}
                      </p>
                    </div>
                    <span className="hidden shrink-0 text-[11px] tabular-nums text-white/40 sm:block">
                      {report.blocks.length} 个块
                    </span>
                    <span className="hidden shrink-0 text-[11px] tabular-nums text-white/35 md:block">
                      {formatTime(report.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeReport(report)}
                    title={deleting === report.id ? "再点一次确认删除" : "删除这篇报道"}
                    className={`shrink-0 rounded-full border p-1.5 transition ${
                      deleting === report.id
                        ? "border-rose-300/60 bg-rose-400/40 text-rose-50"
                        : "border-white/14 bg-white/6 text-white/50 hover:border-rose-300/40 hover:text-rose-200"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pagination ? (
        <div className="flex shrink-0 items-center justify-center gap-1.5 px-5 pb-4 pt-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            className="rounded-full border border-white/14 bg-white/6 px-2.5 py-1 text-xs text-white/65 transition hover:bg-white/12 disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {pageButtons.map((index, position) => (
            <span key={index} className="flex items-center gap-1.5">
              {position > 0 && index - pageButtons[position - 1] > 1 ? (
                <span className="text-xs text-white/25">…</span>
              ) : null}
              <button
                type="button"
                onClick={() => setPage(index)}
                className={`min-w-[28px] rounded-full border px-2 py-1 text-xs tabular-nums transition ${
                  index === page
                    ? "border-sky-300/50 bg-sky-300/20 text-sky-100"
                    : "border-white/14 bg-white/6 text-white/60 hover:bg-white/12 hover:text-white/85"
                }`}
              >
                {index + 1}
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-full border border-white/14 bg-white/6 px-2.5 py-1 text-xs text-white/65 transition hover:bg-white/12 disabled:opacity-35"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
