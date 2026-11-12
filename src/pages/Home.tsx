import {loadReports,type Report} from "@/lib/reports";
import RandomShowcase from "@/components/RandomShowcase";
import {
  ArrowRight,
  BookOpen,
  BookText,
  Camera,
  Gamepad2,
  ImageIcon,
  LayoutGrid,
  Newspaper,
  Music,
  PlaySquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import zeroCatLogo from "@/assets/zerocat-icon-max.png";
import { categoryMeta, type CategoryKey, type LibraryItem } from "@/data/library";
import { filterLibraryIndex, loadLibraryIndex, type LibraryIndex } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";

/** 分类 → 图标映射。未来新增分类时，在 categoryMeta 与这里各补一项即可，首页自动多一扇门。 */
const categoryIcons: Record<CategoryKey, LucideIcon> = {
  images: ImageIcon,
  videos: PlaySquare,
  games: Gamepad2,
  comics: BookOpen,
  screenshots: Camera,
  music: Music,
  live2d: Sparkles,
  novels: BookText,
};

const emptyIndex: LibraryIndex = {
  images: [],
  videos: [],
  games: [],
  comics: [],
  screenshots: [],
  music: [],
  live2d: [],
  novels: [],
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "早上好";
  if (hour >= 11 && hour < 13) return "中午好";
  if (hour >= 13 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}

export default function Home() {
  const navigate = useNavigate();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const boards=useAppStore(state=>state.boards);
  const extraRatings=useAppStore(state=>state.extraRatings);
  const [reports,setReports]=useState<Report[]>([]);
  const [index, setIndex] = useState<LibraryIndex>(emptyIndex);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadLibraryIndex(resourceRoot)
      .then((result) => {
        if (!cancelled) setIndex(result);
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取素材目录失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resourceRoot, refreshKey]);

  useEffect(()=>{let current=true;loadReports(resourceRoot).then(items=>{if(current)setReports(items);}).catch(()=>{if(current)setReports([]);});return()=>{current=false;};},[resourceRoot,refreshKey]);

  // 分级过滤后的馆藏：计数、最近入馆、藏室卡片都只看得到的内容
  const visibleIndex = useMemo(
    () => filterLibraryIndex(index, ratingFilter),
    [index, ratingFilter],
  );

  const boardCount=boards.filter(board=>(extraRatings["board/"+board.id]??2)<=ratingFilter).length;
  const reportCount=reports.filter(report=>(extraRatings["reports/"+report.id]??2)<=ratingFilter).length;
  const totalCount = useMemo(
    () => categoryMeta.reduce((sum, meta) => sum + visibleIndex[meta.key].length, 0)+boardCount+reportCount,
    [visibleIndex,boardCount,reportCount],
  );

  const recentItems = useMemo(() => {
    const all: Array<{ item: LibraryItem; category: CategoryKey }> = [];
    for (const meta of categoryMeta) {
      for (const item of visibleIndex[meta.key]) {
        all.push({ item, category: meta.key });
      }
    }
    return all.sort((left, right) => right.item.modifiedAt - left.item.modifiedAt).slice(0, 10);
  }, [visibleIndex]);

  const rooms=[...categoryMeta.map(meta=>({...meta,route:"/"+meta.key,Icon:categoryIcons[meta.key],count:visibleIndex[meta.key].length,unit:"件"})),{key:"board",title:"画板",description:"把参考、灵感与片段，摆进自己的创作桌面。",route:"/board",Icon:LayoutGrid,count:boardCount,unit:"块"},{key:"reports",title:"报道",description:"以文字与媒体编排，整理值得留下的故事。",route:"/reports",Icon:Newspaper,count:reportCount,unit:"篇"}];
  const showcaseItems=Object.values(visibleIndex).flat();
  return (
    <section className="glass-panel relative h-full min-h-0 overflow-y-auto rounded-[32px]">
      <div className="p-6">
        {/* 门面：黑猫 + 品牌 + 馆藏总览 */}
        <div className="relative overflow-hidden rounded-[28px] border border-white/14 bg-white/6 px-7 py-8">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-sky-400/14 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-fuchsia-400/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-x-7 gap-y-5">
            <img
              src={zeroCatLogo}
              alt="Cat Library"
              className="h-24 w-24 object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
            />
            <div className="min-w-0">
              <p className="text-sm text-white/55">{greeting()}，欢迎回馆</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Cat Library</h1>
              <p className="mt-1.5 text-sm text-white/58">
                你的一整座私人藏馆 ·{" "}
                {new Date().toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">馆藏</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums leading-none text-white">
                {loading ? "—" : totalCount}
              </p>
              <p className="mt-2 text-xs text-white/52">
                {rooms.length} 间藏室 · {totalCount} 件藏品
              </p>
            </div>
          </div>
        </div>

        {/* 藏室：每个分类一扇门，数据驱动、可扩展 */}
        <div className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-white/48">藏室</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {rooms.map((meta) => {
              const Icon = meta.Icon;
              const count = meta.count;
              return (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => navigate(meta.route)}
                  className="group relative overflow-hidden rounded-[24px] border border-white/14 bg-white/6 p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-sky-300/40 hover:bg-white/10 hover:shadow-[0_18px_44px_rgba(24,16,52,0.28)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/16 bg-white/8 text-sky-100 transition group-hover:bg-sky-300/18">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{meta.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-white/55">{meta.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs tabular-nums text-white/70">{count} {meta.unit}</span>
                    <ArrowRight className="h-4 w-4 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-sky-200" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <RandomShowcase items={showcaseItems}/>
        {/* 最近入馆：跨分类最近修改的条目 */}
        {recentItems.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-white/48">
              最近入馆
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {recentItems.map(({ item, category }) => {
                const meta = categoryMeta.find((entry) => entry.key === category);
                const cover = item.coverThumb ?? item.coverImage;
                return (
                  <button
                    key={`${category}/${item.id}`}
                    type="button"
                    onClick={() => navigate(`/${category}/${item.id}`)}
                    className="group relative aspect-[5/6] overflow-hidden rounded-[20px] border border-white/14 bg-white/6 text-left transition hover:border-white/30"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={item.altName ?? item.title}
                        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                      />
                    ) : item.category === "videos" && item.previewMedia ? (
                      // 视频没有图片封面时，直接解码首帧当封面，避免首页是一块黑
                      <video
                        src={item.previewMedia}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                          const element = event.currentTarget;
                          if (Number.isFinite(element.duration) && element.duration > 0) {
                            try {
                              element.currentTime = Math.min(0.1, element.duration * 0.05);
                            } catch {
                              // 忽略不允许 seek 的格式
                            }
                          }
                        }}
                        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(31,41,55,0.88),rgba(15,23,42,0.94))]" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.altName ?? item.title}
                      </p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/55">
                        {meta?.title}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-[20px] border border-rose-300/30 bg-rose-950/30 p-4 text-sm text-rose-200">
            {error}
            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              className="ml-3 rounded-full border border-rose-300/40 px-3 py-1 text-xs text-rose-100 hover:bg-rose-300/15"
            >
              重试
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
