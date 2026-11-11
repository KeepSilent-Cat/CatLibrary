import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createReport, loadReports, reportTitle, saveReports, type Report } from "@/lib/reports";
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

export default function ReportsPage() {
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  const createNew = async () => {
    const report = createReport();
    const next = [report, ...reports];
    setReports(next);
    try {
      await saveReports(resourceRoot, next);
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

    const next = reports.filter((entry) => entry.id !== report.id);
    setReports(next);
    setDeleting(null);
    try {
      await saveReports(resourceRoot, next);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "删除报道失败");
    }
  };

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
        <button
          type="button"
          onClick={() => void createNew()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-3.5 py-2 text-xs font-medium text-sky-100 transition hover:bg-sky-300/25"
        >
          <Plus className="h-3.5 w-3.5" />
          新建报道
        </button>
      </div>

      {error ? (
        <div className="mx-5 mb-2 rounded-[10px] border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
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
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {reports.map((report) => {
              const cover = reportCover(report);
              return (
                <div
                  key={report.id}
                  className="group relative overflow-hidden rounded-[20px] border border-white/14 bg-white/6 text-left transition hover:border-sky-300/40 hover:bg-white/10"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/reports/${report.id}`)}
                    className="block w-full text-left"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        className="h-32 w-full object-cover"
                      />
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
                    className="absolute right-2 top-2 rounded-full border border-rose-300/30 bg-black/60 p-1.5 text-rose-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-300/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {deleting === report.id ? (
                    <span className="absolute right-2 top-11 rounded-full bg-black/75 px-2 py-0.5 text-[10px] text-rose-200">
                      再点一次确认
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
