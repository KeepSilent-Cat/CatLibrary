const rememberedSorts = new Map<string,import("@/data/library").SortMode>();
const rememberedPages = new Map<string,number>();
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  FolderPlus,
  Maximize2,
  Minimize2,
  MousePointer2,
  MousePointerClick,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AddItemsModal from "@/components/AddItemsModal";
import ComicSearchBox from "@/components/ComicSearchBox";
import EditableNumber from "@/components/EditableNumber";
import LibraryCard from "@/components/LibraryCard";
import TagFilterControl from "@/components/TagFilterControl";
import {
  categoryMeta,
  type CategoryKey,
  type LibraryItem,
  type SortMode,
  type VideoSoundMode,
} from "@/data/library";
import { loadLibraryIndex, clearLibraryIndexCache } from "@/lib/library-source";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

// 生成翻页数字：当前页附近的 5 页（当前页尽量居中），边界裁剪
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index);
  }
  let start = Math.max(0, current - 2);
  let end = Math.min(total - 1, current + 2);
  if (end - start < 4) {
    if (start === 0) {
      end = Math.min(total - 1, 4);
    } else {
      start = Math.max(0, total - 5);
    }
  }
  const pages: number[] = [];
  for (let index = start; index <= end; index += 1) {
    pages.push(index);
  }
  return pages;
}

function PageNav({
  current,
  total,
  onGoto,
}: {
  current: number;
  total: number;
  onGoto: (page: number) => void;
}) {
  const [jump, setJump] = useState("");
  const pages = getPageNumbers(current, total);
  const navBtn =
    "inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/16 bg-white/8 px-1.5 text-xs text-white/70 transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-35";
  const activeBtn =
    "inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-sky-300/50 bg-sky-300/22 px-1.5 text-xs font-semibold text-sky-100";
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onGoto(0)} disabled={current <= 0} title="第一页" className={navBtn}>
        <ChevronsLeft className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => onGoto(current - 1)} disabled={current <= 0} title="上一页" className={navBtn}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {pages.map((page) => (
        <button
          key={page}
          type="button"
          onClick={() => onGoto(page)}
          className={page === current ? activeBtn : navBtn}
        >
          {page + 1}
        </button>
      ))}
      <button type="button" onClick={() => onGoto(current + 1)} disabled={current >= total - 1} title="下一页" className={navBtn}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => onGoto(total - 1)} disabled={current >= total - 1} title="最后一页" className={navBtn}>
        <ChevronsRight className="h-3.5 w-3.5" />
      </button>
      <input
        value={jump}
        onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            const target = Number(jump);
            if (Number.isFinite(target) && target >= 1 && target <= total) {
              onGoto(target - 1);
              setJump("");
            }
          }
        }}
        placeholder="页"
        title="跳转到第几页（回车确认）"
        className="h-7 w-12 rounded-full border border-white/16 bg-white/8 px-2 text-center text-xs text-white outline-none placeholder:text-white/35 focus:border-white/36"
      />
    </div>
  );
}

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: "default", label: "标准排序" },
  { value: "time_desc", label: "按时间" },
  { value: "name_asc", label: "按名称" },
];

// 非视频分类使用 aspect-[5/6]，高 = 宽 × 6/5；视频分类宽高可独立调节；间距 gap-4 = 16px
const GRID_GAP = 16;
const CARD_MIN_WIDTH = 200;
const CARD_ASPECT = 6 / 5;
const VIDEO_CARD_WIDTH_MIN = 100;
const VIDEO_CARD_WIDTH_MAX = 1500;
const VIDEO_CARD_HEIGHT_MIN = 100;
const VIDEO_CARD_HEIGHT_MAX = 1200;
const VIDEO_PAGE_SIZE_MIN = 2;
const VIDEO_PAGE_SIZE_MAX = 50;

const FALLBACK_LAYOUT = { cols: 5, rows: 2, pageSize: 10, cardWidth: 200, cardHeight: 240 };

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortLibraryItems(items: LibraryItem[], sortMode: SortMode) {
  const cloned = [...items];

  switch (sortMode) {
    case "time_desc":
      return cloned.sort((left, right) => right.modifiedAt - left.modifiedAt || naturalCompare(left.id, right.id));
    case "name_asc":
      return cloned.sort((left, right) => naturalCompare(left.title, right.title));
    case "default":
    default:
      return cloned.sort((left, right) => naturalCompare(left.id, right.id));
  }
}

// 卡片宽/高调节（滑块 + 可点击输入），普通模式与全屏模式共用
function CardSizeControl({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-xs text-white/72">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={10}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-24 cursor-pointer accent-sky-300"
      />
      <EditableNumber value={value} min={min} max={max} suffix={suffix} onChange={onChange} />
    </label>
  );
}

// 每页数量调节（滑块 + 可点击输入 + 自动）
function PageSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-xs text-white/72">
      <span className="whitespace-nowrap">每页数量</span>
      <input
        type="range"
        min={VIDEO_PAGE_SIZE_MIN}
        max={VIDEO_PAGE_SIZE_MAX}
        step={1}
        value={Math.min(value, VIDEO_PAGE_SIZE_MAX)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-24 cursor-pointer accent-sky-300"
      />
      <EditableNumber
        value={value}
        min={VIDEO_PAGE_SIZE_MIN}
        max={VIDEO_PAGE_SIZE_MAX}
        suffix=" 项"
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => onChange(0)}
        title="恢复为按一屏自动计算"
        className="inline-flex items-center gap-1 rounded-full border border-white/16 bg-white/8 px-2.5 py-1 text-xs text-white/76 transition hover:bg-white/16"
      >
        <RotateCcw className="h-3 w-3" />
        自动
      </button>
    </label>
  );
}

// 统一进度条（视频页底部控制台，普通模式与全屏模式共用）
function VideoProgressControl({
  videoProgress,
  onProgressChange,
}: {
  videoProgress: number;
  onProgressChange: (value: number) => void;
}) {
  return (
    <>
      <span className="whitespace-nowrap text-xs text-white/62">统一进度</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(videoProgress * 1000)}
        onChange={(event) => onProgressChange(Number(event.target.value) / 1000)}
        className="h-1.5 min-w-40 flex-1 cursor-pointer accent-sky-300"
      />
      <span className="w-12 text-right text-xs tabular-nums text-white/76">
        {Math.round(videoProgress * 100)}%
      </span>
    </>
  );
}

// 声音控制（静音 + 三种出声模式），普通模式与全屏模式共用
function SoundModeControl({
  videoMuted,
  onToggleMuted,
  videoSoundMode,
  onSoundModeChange,
}: {
  videoMuted: boolean;
  onToggleMuted: () => void;
  videoSoundMode: VideoSoundMode;
  onSoundModeChange: (mode: VideoSoundMode) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleMuted}
        title={videoMuted ? "开启声音" : "静音"}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/82 transition hover:bg-white/16"
      >
        {videoMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        {videoMuted ? "已静音" : "有声"}
      </button>

      <div className="flex items-center gap-1 rounded-full border border-white/16 bg-white/8 p-1">
        <button
          type="button"
          onClick={() => onSoundModeChange("all")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
            videoSoundMode === "all"
              ? "bg-sky-300/22 text-sky-100"
              : "text-white/62 hover:text-white/88"
          }`}
        >
          <Volume2 className="h-3.5 w-3.5" />
          全部出声
        </button>
        <button
          type="button"
          onClick={() => onSoundModeChange("hover")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
            videoSoundMode === "hover"
              ? "bg-sky-300/22 text-sky-100"
              : "text-white/62 hover:text-white/88"
          }`}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          仅悬浮
        </button>
        <button
          type="button"
          onClick={() => onSoundModeChange("selected")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
            videoSoundMode === "selected"
              ? "bg-sky-300/22 text-sky-100"
              : "text-white/62 hover:text-white/88"
          }`}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          选中出声
        </button>
      </div>

      {videoSoundMode === "selected" ? (
        <span className="whitespace-nowrap text-[10px] text-white/42">点击卡片多选出声 · 双击打开</span>
      ) : null}
    </>
  );
}

export default function CategoryPage({
  category,
  favoritesOnly = false,
  hideHeader = false,
}: {
  category: CategoryKey;
  favoritesOnly?: boolean;
  hideHeader?: boolean;
}) {
  const navigate = useNavigate();
  const meta = categoryMeta.find((item) => item.key === category)!;
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const previewMode = useAppStore((state) => state.previewMode);
  const imagePreviewBehavior = useAppStore((state) => state.imagePreviewBehavior);
  const videoPreviewBehavior = useAppStore((state) => state.videoPreviewBehavior);
  const videoCardWidth = useAppStore((state) => state.videoCardWidth);
  const videoCardHeight = useAppStore((state) => state.videoCardHeight);
  const videoPageSize = useAppStore((state) => state.videoPageSize);
  const videoAutoLayout = useAppStore((state) => state.videoAutoLayout);
  const videoShowInfo = useAppStore((state) => state.videoShowInfo);
  const videoMuted = useAppStore((state) => state.videoMuted);
  const videoSoundMode = useAppStore((state) => state.videoSoundMode);
  const videoFitMode = useAppStore((state) => state.videoFitMode);
  const videoProgress = useAppStore((state) => state.videoProgress);
  const favoriteIds = useAppStore((state) => state.favoriteIds);
  const setVideoCardWidth = useAppStore((state) => state.setVideoCardWidth);
  const setVideoCardHeight = useAppStore((state) => state.setVideoCardHeight);
  const setVideoPageSize = useAppStore((state) => state.setVideoPageSize);
  const setVideoAutoLayout = useAppStore((state) => state.setVideoAutoLayout);
  const setVideoShowInfo = useAppStore((state) => state.setVideoShowInfo);
  const setVideoMuted = useAppStore((state) => state.setVideoMuted);
  const setVideoSoundMode = useAppStore((state) => state.setVideoSoundMode);
  const setVideoFitMode = useAppStore((state) => state.setVideoFitMode);
  const setVideoProgress = useAppStore((state) => state.setVideoProgress);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewKey=resourceRoot+"/"+category+"/"+favoritesOnly;
  const [sortMode, setSortMode] = useState<SortMode>(()=>rememberedSorts.get(viewKey)??"default");
  useEffect(()=>{rememberedSorts.set(viewKey,sortMode);},[viewKey,sortMode]);
  const isVideoCategory = category === "videos";

  const gridAreaRef = useRef<HTMLDivElement | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const pageKey = viewKey;
  const [page, setPage] = useState(()=>rememberedPages.get(pageKey)??0);
  useEffect(()=>{rememberedPages.set(pageKey,page);},[pageKey,page]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [creatingLive2d, setCreatingLive2d] = useState(false);
  // 添加完成后跳到最后一项所在页
  const jumpToNewestRef = useRef(false);

  // 全屏浏览：只显示卡片网格，顶部/底部控制台随鼠标移动显隐
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  const lastMoveRef = useRef({ x: -1, y: -1 });
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  // 全屏时窗口级监听：鼠标移动（位移超过 4px 才算，防手抖）、按键、点击、滚轮都让控制台出现
  useEffect(() => {
    if (!fullscreen) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const last = lastMoveRef.current;
      if (Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y) > 4) {
        lastMoveRef.current = { x: event.clientX, y: event.clientY };
        pokeControls();
      }
    };
    const handleActivity = () => pokeControls();

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("wheel", handleActivity);
    pokeControls();

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("wheel", handleActivity);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [fullscreen, pokeControls]);

  // 选中出声模式：记录选中的卡片（支持多选，点选切换）
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedVideoIds([]);
  }, [category]);

  const selectedModeActive = isVideoCategory && videoSoundMode === "selected";

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    loadLibraryIndex(resourceRoot)
      .then((index) => {
        if (!cancelled) {
          setItems(index[category]);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setError(currentError instanceof Error ? currentError.message : "读取素材目录失败");
          setItems([]);
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
  }, [category, resourceRoot, refreshKey]);

  // 测量网格区域尺寸，按实际可用空间自适应列数与行数，保证每页内容一屏放得下
  // 注意：网格在数据加载完成后才渲染，effect 依赖里必须包含加载状态，否则 observer 永远挂不上
  useEffect(() => {
    const element = gridAreaRef.current;
    if (!element) {
      return;
    }

    // 窗口放大/全屏时 ResizeObserver 会连续触发几十次，若每次都立刻重算布局，
    // 会引发整页卡片反复重排 + 重挂图片。这里做防抖，等尺寸稳定后再算一次。
    let timer = 0;
    const applySize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setGridSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    applySize();

    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(applySize, 120);
    });

    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [loading, error, items.length, category, resourceRoot, fullscreen]);

  // 阻止 WebView2 对拖入文件的默认导航行为
  useEffect(() => {
    const preventDefault = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const tagFilter = useAppStore((state) => state.tagFilter);

  // 标签筛选条的候选标签：与内容共用同一套分级隐藏规则——
  // 被当前显示范围排除的素材，其独有的标签也不参与筛选（全年龄模式下不会冒出 18+ 专属标签）
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.rating > ratingFilter) {
        continue;
      }
      for (const tag of item.tags) {
        set.add(tag);
      }
    }
    return [...set].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  }, [items, ratingFilter]);

  const sortedItems = useMemo(() => {
    // 按内容分级过滤：0=仅全年龄 1=含擦边R15 2=全部
    // 标签筛选：需同时包含全部选中标签（AND）
    const filtered = items.filter(
      (item) =>
        item.rating <= ratingFilter &&
        (tagFilter.length === 0 || tagFilter.every((tag) => item.tags.includes(tag))),
    );
    return sortLibraryItems(filtered, sortMode);
  }, [items, sortMode, ratingFilter, tagFilter]);

  // 收藏模式：只保留当前分类下已收藏的条目
  const visibleItems = useMemo(() => {
    if (!favoritesOnly) {
      return sortedItems;
    }

    return sortedItems.filter((item) => favoriteIds.includes(`${category}/${item.id}`));
  }, [sortedItems, favoritesOnly, category, favoriteIds]);

  // 视频卡片：默认自适应（像图片/漫画一样均分排列），切到自定义才用固定宽高
  const useCustomVideoLayout = isVideoCategory && !videoAutoLayout;

  const layout = useMemo(() => {
    const { width, height } = gridSize;

    if (width <= 0 || height <= 0) {
      return FALLBACK_LAYOUT;
    }

    const cardWidthBase = useCustomVideoLayout ? videoCardWidth : CARD_MIN_WIDTH;
    // 最小 1 列：宽度超过网格可用宽度时允许单列展示（不横向溢出）
    const cols = Math.max(1, Math.floor((width + GRID_GAP) / (cardWidthBase + GRID_GAP)));
    const cardWidth = useCustomVideoLayout
      ? Math.min(videoCardWidth, width)
      : (width - (cols - 1) * GRID_GAP) / cols;
    const cardHeight = useCustomVideoLayout ? videoCardHeight : cardWidth * CARD_ASPECT;
    const rows = Math.max(1, Math.floor((height + GRID_GAP) / (cardHeight + GRID_GAP)));

    // 视频自定义布局支持手动指定每页数量；0 表示按一屏自适应
    const pageSize = useCustomVideoLayout && videoPageSize > 0 ? videoPageSize : cols * rows;

    // 显式行高：grid 自动行会被卡片内文字高度带偏（128px），导致卡片溢出压住下一行
    return { cols, rows, pageSize, cardWidth, cardHeight };
  }, [gridSize, useCustomVideoLayout, videoCardWidth, videoCardHeight, videoPageSize]);

  const effectivePageSize = isVideoCategory && videoPageSize > 0 ? videoPageSize : layout.pageSize;
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / effectivePageSize));
  const currentPage = Math.min(page, pageCount - 1);

  // 下一个顺序分组文件夹名（videos→video_N、images→img_N、games→game_N、comics→comic_N），只用于预览
  const nextGroupFolder = useMemo(() => {
    const prefix =
      category === "images" ? "img" : category === "games" ? "game" : category === "comics" ? "comic" : category === "music" ? "music" : category === "live2d" ? "live2d" : "video";
    let maxNumber = 0;
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    for (const item of items) {
      const match = item.id.match(pattern);
      if (match) {
        maxNumber = Math.max(maxNumber, Number.parseInt(match[1], 10));
      }
    }
    return `${prefix}_${maxNumber + 1}`;
  }, [items, category]);

  // 快捷创建游戏分组文件夹并打开对应目录
  const handleCreateGameFolder = async () => {
    setCreatingGame(true);
    try {
      const groupId = await invoke<string>("create_game_group", { resourceRoot, rating: ratingFilter });
      clearLibraryIndexCache(resourceRoot);
      setRefreshKey((key) => key + 1);
      setSavedToast(`已创建并打开 ${groupId}`);
    } catch (currentError) {
      setSavedToast(currentError instanceof Error ? currentError.message : "创建文件夹失败");
    } finally {
      setCreatingGame(false);
    }
  };

  // 快捷新建 live2d 角色分组
  const handleCreateLive2dGroup = async () => {
    setCreatingLive2d(true);
    try {
      const groupId = await invoke<string>("create_live2d_group", { resourceRoot, rating: ratingFilter });
      clearLibraryIndexCache(resourceRoot);
      setRefreshKey((key) => key + 1);
      setSavedToast(`已创建角色 ${groupId}，点进去添加 PSD 和模型`);
    } catch (currentError) {
      setSavedToast(currentError instanceof Error ? currentError.message : "创建角色失败");
    } finally {
      setCreatingLive2d(false);
    }
  };

  const pageItems = useMemo(
    () => visibleItems.slice(currentPage * effectivePageSize, (currentPage + 1) * effectivePageSize),
    [visibleItems, currentPage, effectivePageSize],
  );

  // 分类、排序、收藏或条目数量变化时回到第一页；刚添加完则跳到最新项所在页
  useEffect(() => {
    if (jumpToNewestRef.current) {
      jumpToNewestRef.current = false;
      setPage(Number.MAX_SAFE_INTEGER);
    } else {
      setPage(rememberedPages.get(pageKey)??0);
    }
  }, [category, sortMode]);

  return (
    <section
      className={cn(
        "glass-panel relative flex h-full min-h-0 flex-col rounded-[32px] p-5",
        fullscreen && "fixed inset-0 z-50 rounded-none",
      )}
      style={
        fullscreen
          ? {
              // 全屏时用粉色磨砂玻璃盖住背后的应用界面（inline 覆盖 .glass-panel 的半透明背景）
              // 不再叠加全屏 backdrop-filter：整屏 blur 会持续占用 GPU，却没有实际观感收益
              background:
                "linear-gradient(165deg, rgba(64, 24, 52, 0.94), rgba(30, 13, 36, 0.97))",
              border: "none",
            }
          : undefined
      }
    >
      {!hideHeader && !fullscreen ? (
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/48">{meta.title}</p>
            <h2 className="mt-2 text-lg font-semibold text-white">{meta.description}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="glass-chip px-3 py-1 text-xs text-white/72">
              {visibleItems.length} 项{favoritesOnly ? "收藏" : "内容"}
            </span>
            {category === "games" ? (
              <button
                type="button"
                onClick={() => void handleCreateGameFolder()}
                disabled={creatingGame}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/15 px-4 py-2 text-xs font-medium text-sky-100 transition hover:bg-sky-300/25 disabled:opacity-60"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {creatingGame ? "创建中…" : "新建游戏"}
              </button>
            ) : category === "live2d" ? (
              <button
                type="button"
                onClick={() => void handleCreateLive2dGroup()}
                disabled={creatingLive2d}
                className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300/40 bg-fuchsia-300/15 px-4 py-2 text-xs font-medium text-fuchsia-100 transition hover:bg-fuchsia-300/25 disabled:opacity-60"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {creatingLive2d ? "创建中…" : "新建角色"}
              </button>
            ) : null}
            <TagFilterControl tags={allTags} />
            <select
              value={sortMode}
              onChange={(event) => {setPage(0);setSortMode(event.target.value as SortMode);}}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white outline-none transition focus:border-white/36 focus:bg-white/14"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {(category !== "screenshots" &&
        (isVideoCategory || category === "comics" || category === "images" || category === "music")) &&
      !fullscreen ? (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-white/12 bg-white/6 px-4 py-2">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/16"
          >
            <Plus className="h-3.5 w-3.5" />
            新增
          </button>
          {category === "comics" ? (
            <ComicSearchBox items={items} onSelect={(item) => navigate(`/comics/${item.id}`)} />
          ) : null}
          {isVideoCategory ? (
            <>
              <button
                type="button"
                onClick={() => setVideoAutoLayout(!videoAutoLayout)}
                title={videoAutoLayout ? "当前自适应，点击切换为自定义尺寸" : "当前自定义，点击切换为自适应"}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/82 transition hover:bg-white/16"
              >
                {videoAutoLayout ? "自适应" : "自定义尺寸"}
              </button>
              {!videoAutoLayout ? (
                <>
                  <CardSizeControl
                    label="卡片宽度"
                    value={videoCardWidth}
                    min={VIDEO_CARD_WIDTH_MIN}
                    max={VIDEO_CARD_WIDTH_MAX}
                    suffix="px"
                    onChange={setVideoCardWidth}
                  />

                  <CardSizeControl
                    label="卡片高度"
                    value={videoCardHeight}
                    min={VIDEO_CARD_HEIGHT_MIN}
                    max={VIDEO_CARD_HEIGHT_MAX}
                    suffix="px"
                    onChange={setVideoCardHeight}
                  />
                </>
              ) : null}

              <button
                type="button"
                onClick={() => setVideoShowInfo(!videoShowInfo)}
                title={videoShowInfo ? "隐藏卡片信息" : "显示卡片信息"}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/82 transition hover:bg-white/16"
              >
                {videoShowInfo ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {videoShowInfo ? "信息开" : "信息关"}
              </button>

              <div className="flex items-center gap-1 rounded-full border border-white/16 bg-white/8 p-1">
                <button
                  type="button"
                  onClick={() => setVideoFitMode("cover")}
                  title="裁剪铺满卡片"
                  className={cn(
                    "rounded-full px-3 py-0.5 text-xs transition",
                    videoFitMode === "cover"
                      ? "bg-sky-300/22 text-sky-100"
                      : "text-white/62 hover:text-white/88",
                  )}
                >
                  填充
                </button>
                <button
                  type="button"
                  onClick={() => setVideoFitMode("contain")}
                  title="完整显示整段画面（比例不符时留黑边）"
                  className={cn(
                    "rounded-full px-3 py-0.5 text-xs transition",
                    videoFitMode === "contain"
                      ? "bg-sky-300/22 text-sky-100"
                      : "text-white/62 hover:text-white/88",
                  )}
                >
                  完整
                </button>
              </div>

              <PageSizeControl value={effectivePageSize} onChange={setVideoPageSize} />
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setFullscreen(true)}
            title="全屏浏览（只显示卡片，鼠标移动显示控制台）"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/16"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            全屏
          </button>
        </div>
      ) : null}

      {category !== "screenshots" &&
        (isVideoCategory || category === "comics" || category === "images" || category === "music") && (
        <AddItemsModal
          open={addModalOpen}
          category={category}
          resourceRoot={resourceRoot}
          nextGroupFolder={nextGroupFolder}
          existingItems={category === "comics" ? items : undefined}
          onClose={() => setAddModalOpen(false)}
          onOpenRequest={() => setAddModalOpen(true)}
          onAdded={() => {
            // 清掉索引缓存，否则 loadLibraryIndex 返回旧数据，列表不刷新
            clearLibraryIndexCache(resourceRoot);
            jumpToNewestRef.current = true;
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/62">正在读取真实素材目录...</div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-rose-100/82">{error}</div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/58">当前分类下还没有可展示内容</div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/58">还没有收藏的内容，在卡片右上角点星标即可收藏</div>
      ) : (
        <>
          <div
            ref={gridAreaRef}
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-1"
            style={{
              gridTemplateColumns: `repeat(${layout.cols}, ${
                useCustomVideoLayout ? videoCardWidth : layout.cardWidth
              }px)`,
              gridAutoRows: `${layout.cardHeight}px`,
              justifyContent: useCustomVideoLayout ? "center" : undefined,
            }}
          >
            {pageItems.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                previewMode={previewMode}
                imagePreviewBehavior={imagePreviewBehavior}
                videoPreviewBehavior={videoPreviewBehavior}
                videoProgress={videoProgress}
                videoMuted={videoMuted}
                videoSoundMode={videoSoundMode}
                videoFitMode={videoFitMode}
                showInfo={isVideoCategory ? videoShowInfo : true}
                favorite={favoriteIds.includes(`${category}/${item.id}`)}
                selected={selectedModeActive && selectedVideoIds.includes(item.id)}
                onToggleFavorite={() => toggleFavorite(category, item.id)}
                onSelect={
                  selectedModeActive
                    ? (current) => {
                        setSelectedVideoIds((previous) =>
                          previous.includes(current.id)
                            ? previous.filter((id) => id !== current.id)
                            : [...previous, current.id],
                        );
                      }
                    : undefined
                }
                onClick={(current) => navigate(`/${category}/${current.id}`)}
              />
            ))}
          </div>

          {isVideoCategory && !fullscreen ? (
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-white/14 bg-white/7 px-4 py-2">
              <VideoProgressControl
                videoProgress={videoProgress}
                onProgressChange={setVideoProgress}
              />
              <SoundModeControl
                videoMuted={videoMuted}
                onToggleMuted={() => setVideoMuted(!videoMuted)}
                videoSoundMode={videoSoundMode}
                onSoundModeChange={setVideoSoundMode}
              />
            </div>
          ) : null}

          {pageCount > 1 && !fullscreen ? (
            <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
              <span className="text-xs text-white/62">
                共 {visibleItems.length} 项 · 第 {currentPage + 1} / {pageCount} 页
              </span>
              <PageNav current={currentPage} total={pageCount} onGoto={setPage} />
            </div>
          ) : null}

          {/* 全屏模式：浮动顶部/底部控制台，鼠标不动自动隐藏 */}
          {isVideoCategory && fullscreen ? (
            <>
              <div
                className={cn(
                  "absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[16px] border border-white/14 bg-black/55 px-4 py-2.5 backdrop-blur-md transition-all duration-300",
                  controlsVisible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
                )}
              >
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/48">{meta.title}</p>
                  <h3 className="truncate text-sm font-semibold text-white">
                    {meta.description} · {visibleItems.length} 项
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <CardSizeControl
                    label="宽度"
                    value={videoCardWidth}
                    min={VIDEO_CARD_WIDTH_MIN}
                    max={VIDEO_CARD_WIDTH_MAX}
                    suffix="px"
                    onChange={setVideoCardWidth}
                  />
                  <CardSizeControl
                    label="高度"
                    value={videoCardHeight}
                    min={VIDEO_CARD_HEIGHT_MIN}
                    max={VIDEO_CARD_HEIGHT_MAX}
                    suffix="px"
                    onChange={setVideoCardHeight}
                  />
                  <PageSizeControl value={effectivePageSize} onChange={setVideoPageSize} />
                </div>

                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  title="退出全屏"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/82 transition hover:bg-white/16"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  退出全屏
                </button>
              </div>

              <div
                className={cn(
                  "absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[16px] border border-white/14 bg-black/55 px-4 py-2.5 backdrop-blur-md transition-all duration-300",
                  controlsVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
                )}
              >
                <VideoProgressControl
                  videoProgress={videoProgress}
                  onProgressChange={setVideoProgress}
                />
                <SoundModeControl
                  videoMuted={videoMuted}
                  onToggleMuted={() => setVideoMuted(!videoMuted)}
                  videoSoundMode={videoSoundMode}
                  onSoundModeChange={setVideoSoundMode}
                />
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <PageNav current={currentPage} total={pageCount} onGoto={setPage} />
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
