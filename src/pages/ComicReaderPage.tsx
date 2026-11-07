import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Languages,
  LayoutGrid,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  ScrollText,
  Settings2,
  Tag,
  Wallpaper,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { RATING_OPTIONS, type ContentRating } from "@/data/library";
import { clearLibraryIndexCache } from "@/lib/library-source";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import TranslationEditor from "@/components/TranslationEditor";
interface ComicChapterPayload {
  name: string;
  images: string[];
  /** 与原图一一对应的翻译页路径（无翻译则为 null） */
  translatedImages: (string | null)[];
}

interface ComicPagesPayload {
  groupId: string;
  title: string;
  altName: string | null;
  summary: string | null;
  rating: ContentRating;
  tags: string[];
  chapters: ComicChapterPayload[];
}

type ReadMode = "single" | "double" | "paged" | "grid";
type TranslateMode = "original" | "translated" | "compare";

/** 阅读模式下的渲染单元：单页，或对照（原图+翻译） */
type ViewPage =
  | { kind: "single"; url: string; index: number }
  | { kind: "pair"; original: string; translated: string | null; index: number };

const SPACING_OPTIONS = [
  { value: 0, label: "无缝" },
  { value: 8, label: "小" },
  { value: 16, label: "中" },
  { value: 32, label: "大" },
] as const;

/** 章节文件夹 ch01 → “第1章”，其他名字原样显示 */
function chapterLabel(name: string): string {
  const match = /^ch(\d+)$/i.exec(name);
  if (match) {
    return `第${Number.parseInt(match[1], 10)}章`;
  }
  return name;
}

/** 从章节文件夹名解析章节号；非 chXX 格式返回 null */
function chapterNumberFromName(name: string): number | null {
  const match = /^ch(\d+)$/i.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** 中文数字 → 阿拉伯数字（一到九十九） */
function chineseNumberToArabic(text: string): number | null {
  const digits: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (text === "十") return 10;
  if (text === "百") return 100;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  if (text.includes("十")) {
    const [tensText, onesText = ""] = text.split("十");
    const tens = tensText ? (digits[tensText] ?? 1) : 1;
    const ones = onesText ? (digits[onesText] ?? 0) : 0;
    return tens * 10 + ones;
  }
  if (digits[text] !== undefined) return digits[text];
  return null;
}

/** 从章节名解析季号：支持 “第2季 / S2 / Season 2” 等，解析不到返回 null */
function parseSeasonFromName(name: string): number | null {
  const chinese = /第\s*([一二三四五六七八九十百\d]+)\s*季/.exec(name);
  if (chinese) {
    return chineseNumberToArabic(chinese[1]);
  }
  const short = /(?:^|[^\d])S(\d{1,2})(?:[^\d]|$)/i.exec(name);
  if (short) {
    return Number.parseInt(short[1], 10);
  }
  const full = /Season\s*(\d{1,2})/i.exec(name);
  if (full) {
    return Number.parseInt(full[1], 10);
  }
  return null;
}

const SEASON_STORAGE_PREFIX = "catlib-comic-seasons";
const READER_SETTINGS_KEY = "catlib-reader-settings";

export default function ComicReaderPage({ category = "comics" }: { category?: "comics" | "images" }) {
  const navigate = useNavigate();
  const { itemId } = useParams();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const setWallpaper = useAppStore((state) => state.setWallpaper);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const isComics = category === "comics";

  const [payload, setPayload] = useState<ComicPagesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [activeChapter, setActiveChapter] = useState(0);
  const [readMode, setReadMode] = useState<ReadMode>(() => {
    try {
      const raw = localStorage.getItem(READER_SETTINGS_KEY);
      if (raw) {
        // 旧格式：纯字符串
        if (raw === "single" || raw === "double" || raw === "paged" || raw === "grid") {
          return raw;
        }
        // 新格式：JSON
        const saved = JSON.parse(raw);
        if (
          saved.readMode === "single" ||
          saved.readMode === "double" ||
          saved.readMode === "paged" ||
          saved.readMode === "grid"
        ) {
          return saved.readMode;
        }
      }
    } catch {
      // 本地缓存损坏时用默认
    }
    return "single";
  });
  const [gridColumns, setGridColumns] = useState(() => {
    try {
      const raw = localStorage.getItem(READER_SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const columns = Number(saved.gridColumns);
        if (Number.isFinite(columns) && columns >= 1 && columns <= 10) {
          return Math.floor(columns);
        }
      }
    } catch {
      // 忽略
    }
    return 3;
  });
  const [translateMode, setTranslateMode] = useState<TranslateMode>("original");
  const [translatingPage, setTranslatingPage] = useState<number | null>(null);
  const [spacing, setSpacing] = useState(0);
  // 长图显示宽度（百分比），翻页模式自适应全屏不受影响
  const [imageWidth, setImageWidth] = useState(100);
  const [pageIndex, setPageIndex] = useState(0);
  // 图片缓存版本：每次重扫章节后 +1，拼到图片 URL 上强制刷新（保存翻译后立刻看到新图）
  const [imageVersion, setImageVersion] = useState(0);
  const [showSidebar, setShowSidebar] = useState(true);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [altNameDraft, setAltNameDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [ratingDraft, setRatingDraft] = useState<ContentRating>(0);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [chapterNumbers, setChapterNumbers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 删除章节的两段确认：第一次点击变"确认删除？"，3 秒内再点才执行
  const [deletingChapter, setDeletingChapter] = useState<string | null>(null);
  // 删除整个条目（图片等非漫画分类）：两步确认
  const [deletingItem, setDeletingItem] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  // 滚动到底连续滚轮触发下一章
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const bottomHitsRef = useRef(0);
  // 自动播放：自动从上到下滚动，滚到底等待后切下一章；手动滚轮会暂停
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlaySpeed = useAppStore((state) => state.autoPlaySpeed);
  const chapterDelay = useAppStore((state) => state.chapterDelay);
  const autoSkipPages = useAppStore((state) => state.autoSkipPages);
  const setAutoPlaySpeed = useAppStore((state) => state.setAutoPlaySpeed);
  const setChapterDelay = useAppStore((state) => state.setChapterDelay);
  const setAutoSkipPages = useAppStore((state) => state.setAutoSkipPages);
  // 季号：手动设置存 localStorage（按章节名做 key），多季漫画目录按季分组
  const [seasonOverrides, setSeasonOverrides] = useState<Record<string, number>>({});

  // 阅读模式（单页/双页/多页/整页翻页）+ 每行页数持久化，重开应用保留上次选择
  useEffect(() => {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ readMode, gridColumns }));
    } catch {
      // 存储失败不影响本次会话
    }
  }, [readMode, gridColumns]);

  useEffect(() => {
    if (!itemId) {
      return;
    }
    try {
      const raw = localStorage.getItem(`${SEASON_STORAGE_PREFIX}:${itemId}`);
      if (raw) {
        setSeasonOverrides(JSON.parse(raw) as Record<string, number>);
      }
    } catch {
      // 本地缓存损坏时忽略，用默认季号
    }
  }, [itemId]);

  const setSeasonFor = (chapterName: string, value: number) => {
    setSeasonOverrides((previous) => {
      const next = { ...previous, [chapterName]: value };
      if (itemId) {
        try {
          localStorage.setItem(
            `${SEASON_STORAGE_PREFIX}:${itemId}`,
            JSON.stringify(next),
          );
        } catch {
          // 存储失败不影响本次会话
        }
      }
      return next;
    });
  };

  const chapters = payload?.chapters ?? [];
  const currentChapter = chapters[Math.min(activeChapter, Math.max(0, chapters.length - 1))];

  /** 章节的季号：手动设置 > 名字解析 > 向前跟随最近设置 > 默认第 1 季 */
  const seasonOf = (name: string, index: number): number => {
    if (seasonOverrides[name] !== undefined) {
      return seasonOverrides[name];
    }
    const parsed = parseSeasonFromName(name);
    if (parsed !== null) {
      return parsed;
    }
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = chapters[i];
      if (previous && seasonOverrides[previous.name] !== undefined) {
        return seasonOverrides[previous.name];
      }
      if (previous && parseSeasonFromName(previous.name) !== null) {
        return parseSeasonFromName(previous.name) ?? 1;
      }
    }
    return 1;
  };

  /** 目录按季分组（保持章节原有顺序） */
  const seasonGroups = useMemo(() => {
    const groups: { season: number; chapters: { chapter: ComicChapterPayload; index: number }[] }[] = [];
    chapters.forEach((chapter, index) => {
      const season = seasonOf(chapter.name, index);
      const last = groups[groups.length - 1];
      if (last && last.season === season) {
        last.chapters.push({ chapter, index });
      } else {
        groups.push({ season, chapters: [{ chapter, index }] });
      }
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, seasonOverrides]);
  const multiSeason = seasonGroups.length > 1;
  // 折叠的季：Set<season 号>（多季目录可像菜单一样收起/展开）
  const [collapsedSeasons, setCollapsedSeasons] = useState<Set<number>>(new Set());
  const toggleSeason = (season: number) => {
    setCollapsedSeasons((previous) => {
      const next = new Set(previous);
      if (next.has(season)) {
        next.delete(season);
      } else {
        next.add(season);
      }
      return next;
    });
  };

  /** 多季漫画的当前章节信息（季号 + 季内序号） */
  const currentChapterInfo = useMemo(() => {
    if (!currentChapter) {
      return null;
    }
    for (const group of seasonGroups) {
      const localIndex = group.chapters.findIndex(
        (entry) => entry.chapter.name === currentChapter.name,
      );
      if (localIndex >= 0) {
        return { season: group.season, localIndex };
      }
    }
    return null;
  }, [seasonGroups, currentChapter]);

  /** 当前章节显示名：多季时"第X季 · 第Y章"（季内重新从第1章编号），否则原名 */
  const currentChapterLabel = (() => {
    if (!currentChapter) {
      return "";
    }
    if (multiSeason && currentChapterInfo) {
      const base = chapterLabel(currentChapter.name);
      const inner =
        chapterNumberFromName(currentChapter.name) !== null
          ? `第${currentChapterInfo.localIndex + 1}章`
          : base;
      return `第${currentChapterInfo.season}季 · ${inner}`;
    }
    return chapterLabel(currentChapter.name);
  })();
  const chapterImageUrls = useMemo(
    () =>
      currentChapter
        ? currentChapter.images.map((path) => `${convertFileSrc(path)}?v=${imageVersion}`)
        : [],
    [currentChapter, imageVersion],
  );
  const translatedUrls = useMemo(
    () =>
      currentChapter
        ? currentChapter.translatedImages.map((path) =>
            path ? `${convertFileSrc(path)}?v=${imageVersion}` : null,
          )
        : [],
    [currentChapter, imageVersion],
  );

  const viewPages = useMemo<ViewPage[]>(
    () =>
      chapterImageUrls.map((url, index) => {
        if (translateMode === "compare") {
          return { kind: "pair", original: url, translated: translatedUrls[index] ?? null, index };
        }
        if (translateMode === "translated") {
          return { kind: "single", url: translatedUrls[index] ?? url, index };
        }
        return { kind: "single", url, index };
      }),
    [chapterImageUrls, translatedUrls, translateMode],
  );

  const totalPages = viewPages.length;
  const currentViewPage = viewPages[Math.min(pageIndex, Math.max(0, totalPages - 1))];

  // 把当前正在看的那张图设为整个应用的背景（图片分类）
  const setCurrentAsWallpaper = async () => {
    const current = currentViewPage;
    if (!current) {
      setSavedToast("没有可设为背景的图片");
      return;
    }
    const path = currentChapter?.images[current.index];
    if (!path) {
      setSavedToast("没有可设为背景的图片");
      return;
    }
    try {
      const res = await fetch(convertFileSrc(path));
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
      });
      setWallpaper(dataUrl);
      setSavedToast("已把当前图片设为应用背景");
    } catch (currentError) {
      setSavedToast(currentError instanceof Error ? currentError.message : "设为背景失败");
    }
  };

  const reload = useCallback(async () => {
    if (!itemId) {
      return;
    }
    setLoading(true);
    setPageError(null);
    try {
      const result = isComics
        ? await invoke<ComicPagesPayload>("scan_comic_pages", { resourceRoot, groupId: itemId })
        : await invoke<ComicPagesPayload>("scan_image_pages", { resourceRoot, category, groupId: itemId });
      setPayload(result);
      setImageVersion((version) => version + 1);
      setActiveChapter((previous) =>
        Math.min(previous, Math.max(0, result.chapters.length - 1)),
      );
    } catch (currentError) {
      setPageError(currentError instanceof Error ? currentError.message : "读取漫画失败");
    } finally {
      setLoading(false);
    }
  }, [itemId, resourceRoot, isComics, category]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setActiveChapter(0);
    setPageIndex(0);

    if (!itemId) {
      setPageError("缺少漫画编号");
      setLoading(false);
      return;
    }

    (isComics
      ? invoke<ComicPagesPayload>("scan_comic_pages", { resourceRoot, groupId: itemId })
      : invoke<ComicPagesPayload>("scan_image_pages", { resourceRoot, category, groupId: itemId })
    )
      .then((result) => {
        if (!cancelled) {
          setPayload(result);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setPageError(currentError instanceof Error ? currentError.message : "读取漫画失败");
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
  }, [itemId, resourceRoot, isComics, category]);

  // 翻页模式：方向键翻页
  useEffect(() => {
    if (readMode !== "paged") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        setPageIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "ArrowRight") {
        setPageIndex((index) => Math.min(totalPages - 1, index + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readMode, totalPages]);

  // 打开编辑弹窗时填充草稿
  useEffect(() => {
    if (editOpen && payload) {
      setTitleDraft(payload.title);
      setAltNameDraft(payload.altName ?? "");
      setSummaryDraft(payload.summary ?? "");
      setRatingDraft(payload.rating);
      setTagDraft(payload.tags ?? []);
      setTagInput("");
      setDeletingChapter(null);
      if (deleteTimerRef.current !== null) {
        window.clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
      const numbers: Record<string, string> = {};
      for (const chapter of payload.chapters) {
        const number = chapterNumberFromName(chapter.name);
        if (number !== null) {
          numbers[chapter.name] = String(number);
        }
      }
      setChapterNumbers(numbers);
      setSaveError(null);
    }
  }, [editOpen, payload]);

  const selectChapter = (index: number) => {
    setActiveChapter(index);
    setPageIndex(0);
    bottomHitsRef.current = 0;
    // 切章回到顶部（自动播放切章后从新章开头继续滚）
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0;
    }
  };

  const goPrevChapter = () => {
    if (activeChapter > 0) {
      selectChapter(activeChapter - 1);
    }
  };

  const goNextChapter = () => {
    if (activeChapter < chapters.length - 1) {
      selectChapter(activeChapter + 1);
    }
  };

  // 自动播放时阻止系统息屏/睡眠（挂机看漫画不待机），暂停或离开页面时恢复
  useEffect(() => {
    void invoke("set_keep_awake", { enabled: autoPlay });
    return () => {
      void invoke("set_keep_awake", { enabled: false });
    };
  }, [autoPlay]);

  // 自动播放：匀速滚动 → 到底等待 chapterDelay 秒 → 切下一章继续；最后一章自动停止
  // 用 30fps interval 替代 rAF（60fps），等待切章时完全停表，降低持续渲染负载
  useEffect(() => {
    if (!autoPlay || readMode === "paged" || chapters.length === 0) {
      return;
    }
    let timerId: number | null = null;
    let lastTick = performance.now();
    let waitingForChapter = false;
    let chapterTimer: number | null = null;
    // 切章后新章节图片还没加载，高度为 0，需要冷却期避免误判"已到底"连环切章
    const startedAt = performance.now();
    const settleMs = 800;
    // 连续多帧都在底部才确认到底（图片懒加载会持续撑高内容）
    let bottomStreak = 0;
    // 跳过前情提要：冷却期后定位到第 N+1 张图，每次切章只执行一次
    let skipApplied = false;

    const applySkip = () => {
      if (autoSkipPages <= 0) {
        return;
      }
      const el = scrollAreaRef.current;
      if (!el) {
        return;
      }
      const images = el.querySelectorAll("img");
      const target = images[autoSkipPages]; // 第 N+1 张（跳过前 N 张）
      if (!target) {
        return;
      }
      const containerRect = el.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      el.scrollTop = el.scrollTop + (targetRect.top - containerRect.top) - 24;
    };

    const stopTicking = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };
    const startTicking = () => {
      if (timerId === null) {
        lastTick = performance.now();
        timerId = window.setInterval(tick, 33); // ~30fps
      }
    };
    const tick = () => {
      const el = scrollAreaRef.current;
      if (!el) {
        return;
      }
      const now = performance.now();
      const deltaSeconds = (now - lastTick) / 1000;
      lastTick = now;

      if (now - startedAt < settleMs) {
        return; // 冷却期：等新章节内容渲染/图片加载
      }
      if (!skipApplied) {
        skipApplied = true;
        applySkip(); // 跳过前情提要（前 N 张）
      }
      if (waitingForChapter) {
        return; // 等待切章中（interval 已停表，此处兜底）
      }
      const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (remaining <= 2) {
        bottomStreak += 1;
        if (bottomStreak < 3) {
          return; // 连续确认，防止高度抖动误判
        }
        // 确认到底：停表等待设定秒数后切下一章
        waitingForChapter = true;
        stopTicking();
        chapterTimer = window.setTimeout(() => {
          waitingForChapter = false;
          if (activeChapter >= chapters.length - 1) {
            setAutoPlay(false); // 已是最后一章，停止
            return;
          }
          goNextChapter();
          startTicking();
        }, chapterDelay * 1000);
        return;
      }
      bottomStreak = 0;
      el.scrollTop += autoPlaySpeed * deltaSeconds;
    };
    startTicking();
    return () => {
      stopTicking();
      if (chapterTimer !== null) {
        window.clearTimeout(chapterTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, autoPlaySpeed, chapterDelay, autoSkipPages, readMode, activeChapter, chapters.length]);

  // 手动滚轮 → 暂停自动播放（避免互相打架）
  const handleScrollWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (readMode === "paged") {
      return;
    }
    if (autoPlay && event.deltaY !== 0) {
      setAutoPlay(false);
    }
    const el = scrollAreaRef.current;
    if (!el) {
      return;
    }
    if (event.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      bottomHitsRef.current += 1;
      if (bottomHitsRef.current >= 2) {
        bottomHitsRef.current = 0;
        goNextChapter();
      }
    } else if (event.deltaY < 0) {
      bottomHitsRef.current = 0;
    }
  };

  // 切换自动播放：翻页模式不适用，开启时自动切回滚动模式
  const toggleAutoPlay = () => {
    if (readMode === "paged") {
      setReadMode("single");
    }
    setAutoPlay((value) => !value);
  };

  const saveEdits = async () => {
    if (!itemId || !payload || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("save_library_metadata", {
        resourceRoot,
        category,
        itemId,
        title: titleDraft,
        summary: summaryDraft,
        altName: altNameDraft,
        adult: ratingDraft >= 2,
        rating: ratingDraft,
        tags: tagDraft,
      });

      // 章节号变更 → 批量重排（支持链式/环式交换，如 3换5 同时 5换3）
      const changes: { chapterName: string; newChapterNumber: number }[] = [];
      for (const chapter of payload.chapters) {
        const currentNumber = chapterNumberFromName(chapter.name);
        const nextRaw = chapterNumbers[chapter.name]?.trim();
        if (currentNumber === null || !nextRaw) {
          continue;
        }
        const nextNumber = Number.parseInt(nextRaw, 10);
        if (!Number.isFinite(nextNumber) || nextNumber < 1 || nextNumber > 9999) {
          throw new Error(`章节 ${chapterLabel(chapter.name)} 的章节号无效：${nextRaw}`);
        }
        if (nextNumber !== currentNumber) {
          changes.push({ chapterName: chapter.name, newChapterNumber: nextNumber });
        }
      }
      if (changes.length > 0) {
        await invoke("reorder_comic_chapters", {
          resourceRoot,
          groupId: itemId,
          changes,
        });
      }

      // 清列表缓存：标题/分级变更立即在分类列表生效（否则要重启才刷新）
      clearLibraryIndexCache(resourceRoot);

      await reload();
      setEditOpen(false);
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setSaving(false);
    }
  };

  // 删除整个条目（图片等非漫画分类）：两步确认
  const handleDeleteItem = async () => {
    if (!itemId) {
      return;
    }
    if (!deletingItem) {
      setDeletingItem(true);
      window.setTimeout(() => setDeletingItem(false), 3000);
      return;
    }
    setDeletingItem(false);
    try {
      await invoke("delete_library_item", {
        resourceRoot,
        category,
        itemId,
      });
      navigate(`/${category}`);
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : String(currentError));
    }
  };

  // 把某章移出为独立的新漫画（用于误放进来的章节）
  const extractChapter = async (chapterName: string) => {
    if (!itemId || !payload || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("extract_comic_chapter", {
        resourceRoot,
        groupId: itemId,
        chapterName,
        displayName: payload.title || null,
      });
      setEditOpen(false);
      await reload();
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setSaving(false);
    }
  };

  // 删除章节：第一次点击进入确认态，3 秒内再点执行
  const requestDeleteChapter = (chapterName: string) => {
    if (deletingChapter === chapterName) {
      void doDeleteChapter(chapterName);
      return;
    }
    setDeletingChapter(chapterName);
    if (deleteTimerRef.current !== null) {
      window.clearTimeout(deleteTimerRef.current);
    }
    deleteTimerRef.current = window.setTimeout(() => setDeletingChapter(null), 3000);
  };

  const doDeleteChapter = async (chapterName: string) => {
    if (!itemId || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("delete_comic_chapter", {
        resourceRoot,
        groupId: itemId,
        chapterName,
      });
      if (deleteTimerRef.current !== null) {
        window.clearTimeout(deleteTimerRef.current);
      }
      setDeletingChapter(null);
      setEditOpen(false);
      await reload();
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setSaving(false);
    }
  };

  const renderPaged = () => {
    const page = currentViewPage;
    if (!page) {
      return null;
    }
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-stretch justify-center gap-2 overflow-hidden">
          {page.kind === "pair" ? (
            <>
              <div className="flex min-w-0 flex-1 items-center justify-center">
                <img
                  src={page.original}
                  alt={`${currentChapterLabel} 第 ${pageIndex + 1} 页 原图`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-center">
                {page.translated ? (
                  <img
                    src={page.translated}
                    alt={`${currentChapterLabel} 第 ${pageIndex + 1} 页 翻译`}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-white/40">未翻译</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <img
                src={page.url}
                alt={`${currentChapterLabel} 第 ${pageIndex + 1} 页`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="上一页"
          onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full border border-white/12 bg-black/45 p-2 text-white/75 transition hover:bg-black/70 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="下一页"
          onClick={() => setPageIndex((index) => Math.min(totalPages - 1, index + 1))}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full border border-white/12 bg-black/45 p-2 text-white/75 transition hover:bg-black/70 hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="shrink-0 pb-3 text-center text-xs text-white/45">
          {pageIndex + 1} / {totalPages} · 可用 ← → 键翻页
        </div>
      </div>
    );
  };

  const renderScrolling = () => {
    if (viewPages.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/58">
          <BookOpen className="h-8 w-8 text-white/30" />
          这一章还没有可阅读的图片
        </div>
      );
    }
    const compareMode = translateMode === "compare";
    const gridMode = readMode === "grid";
    return (
      <div
        className="mx-auto"
        style={{
          display: gridMode ? "grid" : "flex",
          gridTemplateColumns: gridMode ? `repeat(${gridColumns}, minmax(0, 1fr))` : undefined,
          flexDirection: compareMode || readMode === "single" ? "column" : "row",
          flexWrap: compareMode || readMode === "single" ? "nowrap" : "wrap",
          gap: spacing,
          width: `${imageWidth}%`,
          maxWidth: "100%",
        }}
      >
        {viewPages.map((page) => {
          if (page.kind === "pair") {
            return (
              <div
                key={`${currentChapter.name}-${page.index}`}
                style={{
                  display: "flex",
                  gap: spacing,
                  width: "100%",
                  ...(gridMode ? { gridColumn: "1 / -1" } : {}),
                }}
              >
                <img
                  src={page.original}
                  alt={`${currentChapterLabel} 第 ${page.index + 1} 页 原图`}
                  loading="lazy"
                  style={{ display: "block", width: `calc(50% - ${spacing / 2}px)` }}
                  className="bg-black/20"
                />
                {page.translated ? (
                  <img
                    src={page.translated}
                    alt={`${currentChapterLabel} 第 ${page.index + 1} 页 翻译`}
                    loading="lazy"
                    style={{ display: "block", width: `calc(50% - ${spacing / 2}px)` }}
                    className="bg-black/20"
                  />
                ) : (
                  <div
                    style={{ width: `calc(50% - ${spacing / 2}px)` }}
                    className="flex items-center justify-center bg-black/20 text-xs text-white/40"
                  >
                    未翻译
                  </div>
                )}
              </div>
            );
          }
          return (
            <img
              key={`${currentChapter.name}-${page.index}`}
              src={page.url}
              alt={`${currentChapterLabel} 第 ${page.index + 1} 页`}
              loading={autoPlay && autoSkipPages > 0 && page.index <= autoSkipPages ? "eager" : "lazy"}
              style={{
                display: "block",
                width: gridMode ? "100%" : readMode === "double" ? `calc(50% - ${spacing / 2}px)` : "100%",
              }}
              className="bg-black/20"
            />
          );
        })}
        <p className="w-full pt-3 text-center text-xs text-white/40">
          {currentChapterLabel} · 共 {viewPages.length} 页
        </p>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏 */}
      <div className="relative flex shrink-0 items-center gap-4 px-5 pb-3 pt-5">
        <button
          type="button"
          onClick={() => navigate(`/${category}`)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isComics ? "返回漫画" : "返回图片"}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.24em] text-white/48">{isComics ? "Comics" : "Images"}</p>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-white">
            {payload?.altName ?? payload?.title ?? (isComics ? "漫画" : "图片")}
          </h2>
          {payload?.altName ? (
            <p className="truncate text-xs text-white/45">{payload.title}</p>
          ) : null}
        </div>
        {isComics && (
          <button
            type="button"
            onClick={() => setShowSidebar((visible) => !visible)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14"
            title={showSidebar ? "隐藏目录栏" : "显示目录栏"}
          >
            {showSidebar ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            )}
            {showSidebar ? "隐藏目录" : "显示目录"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleAutoPlay}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
            autoPlay
              ? "border-sky-300/40 bg-sky-300/20 text-sky-100"
              : "border-white/14 bg-white/7 text-white/76 hover:bg-white/14",
          )}
          title={
            readMode === "paged"
              ? "翻页模式不支持自动播放"
              : autoPlay
                ? `自动播放中（${autoPlaySpeed}px/s），点击暂停`
                : "自动从上到下播放，点击开始"
          }
        >
          {autoPlay ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {autoPlay ? "暂停" : "自动播放"}
        </button>
        {isComics && (
          <>
            <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
              {(["original", "translated", "compare"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTranslateMode(mode)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition",
                    translateMode === mode ? "bg-sky-300/25 text-sky-50" : "text-white/60 hover:text-white",
                  )}
                >
                  {mode === "original" ? "原图" : mode === "translated" ? "翻译" : "对照"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTranslatingPage(pageIndex)}
              disabled={totalPages === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Languages className="h-3.5 w-3.5" />
              翻译本页
            </button>
          </>
        )}
        {!isComics ? (
          <button
            type="button"
            onClick={() => void setCurrentAsWallpaper()}
            disabled={totalPages === 0}
            title="把当前正在看的图片设为整个应用的背景"
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100/85 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Wallpaper className="h-3.5 w-3.5" />
            设为背景
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14"
        >
          <Settings2 className="h-3.5 w-3.5" />
          设置
        </button>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/7 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/14"
        >
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </button>
      </div>

      {/* 主体：左图右栏 */}
      <div className="flex min-h-0 flex-1">
        {/* 图区 */}
        <div
          ref={scrollAreaRef}
          onWheel={handleScrollWheel}
          className={cn(
            "min-w-0 flex-1",
            readMode === "paged" ? "overflow-hidden" : "overflow-y-auto px-6 pb-6",
          )}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-white/62">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取章节…
            </div>
          ) : pageError ? (
            <div className="flex h-full items-center justify-center text-sm text-rose-100/82">
              {pageError}
            </div>
          ) : chapters.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/58">
              <BookOpen className="h-8 w-8 text-white/30" />
              这本漫画还没有可阅读的章节
            </div>
          ) : readMode === "paged" ? (
            renderPaged()
          ) : (
            renderScrolling()
          )}
        </div>

        {/* 右侧目录栏（图片分类单章节，无目录） */}
        {isComics && showSidebar && (
          <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-l border-white/10 p-4">
            {/* 上一章 / 下一章 */}
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={goPrevChapter}
                disabled={activeChapter === 0}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-white/14 bg-white/7 px-2 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一章
              </button>
              <button
                type="button"
                onClick={goNextChapter}
                disabled={activeChapter >= chapters.length - 1}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-white/14 bg-white/7 px-2 py-1.5 text-xs text-white/76 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35"
              >
                下一章
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {payload?.summary ? (
              <div className="mb-4">
                <p className="mb-1.5 text-xs uppercase tracking-[0.2em] text-white/40">简介</p>
                <p className="text-xs leading-relaxed text-white/62">{payload.summary}</p>
              </div>
            ) : null}

            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">目录</p>
            {chapters.length === 0 ? (
              <p className="text-xs text-white/38">暂无章节</p>
            ) : (
              <div className="space-y-3">
                {seasonGroups.map((group) => {
                  const collapsed = collapsedSeasons.has(group.season);
                  return (
                    <div key={group.season}>
                      {multiSeason ? (
                        <button
                          type="button"
                          onClick={() => toggleSeason(group.season)}
                          className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] font-semibold tracking-wide text-sky-100/80 transition hover:bg-white/6 hover:text-sky-100"
                          title={collapsed ? "展开本季" : "收起本季"}
                        >
                          <ChevronRight
                            className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
                          />
                          <span className="inline-block h-1 w-1 rounded-full bg-sky-300/70" />
                          第{group.season}季
                          <span className="ml-auto text-[10px] font-normal text-white/38">
                            {group.chapters.length} 章
                          </span>
                        </button>
                      ) : null}
                      {!collapsed && (
                        <div className="space-y-1">
                          {group.chapters.map(({ chapter, index }, localIndex) => (
                            <button
                              key={chapter.name}
                              type="button"
                              onClick={() => selectChapter(index)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-xs transition",
                                index === activeChapter
                                  ? "bg-sky-300/20 text-sky-100"
                                  : "text-white/62 hover:bg-white/8 hover:text-white/88",
                              )}
                            >
                              <span className="truncate">
                                {multiSeason && chapterNumberFromName(chapter.name) !== null
                                  ? `第${localIndex + 1}章`
                                  : chapterLabel(chapter.name)}
                              </span>
                              <span
                                className={cn(
                                  "ml-2 shrink-0",
                                  index === activeChapter ? "text-sky-100/70" : "text-white/35",
                                )}
                              >
                                {chapter.images.length} 页
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 设置弹窗 */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettingsOpen(false);
            }
          }}
        >
          <div
            onMouseDown={(event) => event.stopPropagation()}
            className="glass-panel flex w-[440px] max-w-[92vw] flex-col rounded-[24px] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/48">Reader Settings</p>
                <h3 className="mt-0.5 text-base font-semibold text-white">阅读设置</h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-white/14 bg-white/6 p-2 text-white/70 transition hover:bg-white/14"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 阅读模式 */}
              <div>
                <p className="mb-1.5 text-xs text-white/62">阅读模式</p>
                <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
                  <button
                    type="button"
                    onClick={() => setReadMode("single")}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-xs transition",
                      readMode === "single"
                        ? "bg-sky-300/22 text-sky-100"
                        : "text-white/62 hover:text-white/88",
                    )}
                  >
                    <ScrollText className="h-4 w-4" />
                    单页滚动
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadMode("double")}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-xs transition",
                      readMode === "double"
                        ? "bg-sky-300/22 text-sky-100"
                        : "text-white/62 hover:text-white/88",
                    )}
                  >
                    <Columns2 className="h-4 w-4" />
                    双页并排
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadMode("paged")}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-xs transition",
                      readMode === "paged"
                        ? "bg-sky-300/22 text-sky-100"
                        : "text-white/62 hover:text-white/88",
                    )}
                  >
                    <ChevronRight className="h-4 w-4" />
                    整页翻页
                  </button>
                  <button
                    type="button"
                    onClick={() => setReadMode("grid")}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-xs transition",
                      readMode === "grid"
                        ? "bg-sky-300/22 text-sky-100"
                        : "text-white/62 hover:text-white/88",
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    多页
                  </button>
                </div>
                {readMode === "grid" && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="shrink-0 text-xs text-white/62">每行页数</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={gridColumns}
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10);
                        if (Number.isFinite(value) && value >= 1 && value <= 10) {
                          setGridColumns(value);
                        }
                      }}
                      className="w-16 rounded-[8px] border border-white/14 bg-black/30 px-2 py-1 text-center text-xs text-white outline-none focus:border-sky-300/50"
                    />
                  </div>
                )}
              </div>

              {/* 长图宽度 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs text-white/62">图片宽度</p>
                  <p className="text-xs text-sky-100/80">{imageWidth}%</p>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={imageWidth}
                  onChange={(event) => setImageWidth(Number(event.target.value))}
                  className="w-full accent-sky-300"
                />
                <p className="mt-1 text-[11px] text-white/38">
                  长图显示宽度，屏幕矮时调窄可减少上下滚动；翻页模式自适应全屏
                </p>
              </div>

              {/* 自动播放 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs text-white/62">自动播放</p>
                  <button
                    type="button"
                    onClick={toggleAutoPlay}
                    disabled={readMode === "paged"}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
                      autoPlay
                        ? "border-sky-300/40 bg-sky-300/20 text-sky-100"
                        : "border-white/14 bg-white/7 text-white/72 hover:bg-white/14",
                    )}
                  >
                    {autoPlay ? "已开启" : "已关闭"}
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs text-white/62">滚动速度</p>
                      <p className="text-xs text-sky-100/80">{autoPlaySpeed} px/s</p>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={1200}
                      step={100}
                      value={autoPlaySpeed}
                      onChange={(event) => setAutoPlaySpeed(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs text-white/62">章节切换等待</p>
                      <p className="text-xs text-sky-100/80">{chapterDelay} 秒</p>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={chapterDelay}
                      onChange={(event) => setChapterDelay(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs text-white/62">跳过每章开头</p>
                      <p className="text-xs text-sky-100/80">
                        {autoSkipPages === 0 ? "不跳过" : `前 ${autoSkipPages} 页`}
                      </p>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={autoSkipPages}
                      onChange={(event) => setAutoSkipPages(Number(event.target.value))}
                      className="w-full accent-sky-300"
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-white/38">
                  自动从上到下匀速滚动，滚到底后等待设定秒数自动进入下一章（最后一章自动停止）；
                  跳过每章开头可略过前情提要 / 回顾页；手动滚动会暂停。翻页模式不支持自动播放。
                </p>
              </div>

              {/* 图片间距 */}
              <div>
                <p className="mb-1.5 text-xs text-white/62">
                  图片间距{readMode === "paged" ? "（翻页模式不适用）" : ""}
                </p>
                <div className="flex items-center gap-1 rounded-full border border-white/14 bg-white/7 p-1">
                  {SPACING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSpacing(option.value)}
                      disabled={readMode === "paged"}
                      className={cn(
                        "flex-1 rounded-full px-3 py-1.5 text-xs transition",
                        spacing === option.value
                          ? "bg-sky-300/22 text-sky-100"
                          : "text-white/62 hover:text-white/88",
                        readMode === "paged" && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full bg-sky-300/25 px-5 py-2 text-sm text-sky-50 transition hover:bg-sky-300/35"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editOpen && payload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditOpen(false);
            }
          }}
        >
          <div
            onMouseDown={(event) => event.stopPropagation()}
            className="glass-panel flex max-h-[84vh] w-[520px] max-w-[92vw] flex-col rounded-[24px] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/48">{isComics ? "Edit Comic" : "Edit Images"}</p>
                <h3 className="mt-0.5 text-base font-semibold text-white">{isComics ? "编辑漫画" : "编辑图片"}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-full border border-white/14 bg-white/6 p-2 text-white/70 transition hover:bg-white/14"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <div>
                <label className="mb-1 block text-xs text-white/62">原名</label>
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  placeholder="漫画原名…"
                  className="w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/62">艺名 / 译名</label>
                <input
                  value={altNameDraft}
                  onChange={(event) => setAltNameDraft(event.target.value)}
                  placeholder="自己翻译的名称，留空则只显示原名…"
                  className="w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/62">简介 / 介绍</label>
                <textarea
                  value={summaryDraft}
                  onChange={(event) => setSummaryDraft(event.target.value)}
                  placeholder="写点什么介绍这本漫画…"
                  rows={3}
                  className="w-full resize-none rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/62">内容分级</label>
                <div className="flex items-center gap-2">
                  {RATING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRatingDraft(option.value)}
                      className={`flex-1 rounded-[12px] border px-3 py-2 text-sm transition ${
                        ratingDraft === option.value
                          ? option.value === 0
                            ? "border-sky-300/40 bg-sky-300/12 text-sky-100"
                            : "border-rose-300/35 bg-rose-300/12 text-rose-100"
                          : "border-white/14 bg-black/25 text-white/72 hover:bg-black/35"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-white/40">
                  擦边和 18+ 默认在所有列表隐藏，需在设置里调整显示范围
                </p>
              </div>

              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs text-white/62">
                  <Tag className="h-3.5 w-3.5 text-sky-100" />
                  标签
                </label>
                <div className="flex flex-wrap gap-2">
                  {tagDraft.length === 0 ? (
                    <span className="text-xs text-white/40">还没有标签</span>
                  ) : (
                    tagDraft.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-sky-300/35 bg-sky-300/12 px-3 py-1 text-xs text-sky-100"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() =>
                            setTagDraft((current) => current.filter((existing) => existing !== tag))
                          }
                          className="text-sky-100/70 transition hover:text-white"
                          title="移除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "," || event.key === "，") {
                      event.preventDefault();
                      const trimmed = tagInput.trim();
                      if (trimmed) {
                        setTagDraft((current) =>
                          current.includes(trimmed) ? current : [...current, trimmed],
                        );
                        setTagInput("");
                      }
                    } else if (
                      event.key === "Backspace" &&
                      tagInput === "" &&
                      tagDraft.length > 0
                    ) {
                      setTagDraft((current) => current.slice(0, -1));
                    }
                  }}
                  placeholder="输入标签后回车添加…"
                  className="mt-2 w-full rounded-[12px] border border-white/14 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/50"
                />
                <p className="mt-1 text-[11px] text-white/40">
                  标签跨所有分类通用，可用于列表页顶部筛选
                </p>
              </div>

              {isComics && (
              <div>
                <label className="mb-1 block text-xs text-white/62">
                  章节号（填错可以直接改，例如第3章改成第2章）；季号用于多季漫画的目录分组，改完即时生效
                </label>
                <div className="space-y-1.5">
                  {payload.chapters.map((chapter, chapterIndex) => {
                    const number = chapterNumberFromName(chapter.name);
                    return (
                      <div
                        key={chapter.name}
                        className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <span className="w-14 shrink-0 truncate text-xs text-white/62">
                          {chapterLabel(chapter.name)}
                        </span>
                        <span className="text-xs text-white/38">第</span>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={String(seasonOf(chapter.name, chapterIndex))}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 99) {
                              setSeasonFor(chapter.name, parsed);
                            }
                          }}
                          className="w-12 rounded-[10px] border border-white/14 bg-black/30 px-1 py-1 text-center text-sm text-white outline-none focus:border-sky-300/50"
                        />
                        <span className="text-xs text-white/38">季</span>
                        {number === null ? (
                          <>
                            <span className="ml-auto shrink-0 text-xs text-white/38">
                              （非数字章节，不支持改号）
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-white/38">第</span>
                            <input
                              type="number"
                              min={1}
                              max={9999}
                              value={chapterNumbers[chapter.name] ?? String(number)}
                              onChange={(event) =>
                                setChapterNumbers((previous) => ({
                                  ...previous,
                                  [chapter.name]: event.target.value,
                                }))
                              }
                              className="w-20 rounded-[10px] border border-white/14 bg-black/30 px-2 py-1 text-center text-sm text-white outline-none focus:border-sky-300/50"
                            />
                            <span className="text-xs text-white/38">章</span>
                            <span className="ml-auto shrink-0 text-xs text-white/38">
                              {chapter.images.length} 页
                            </span>
                            <button
                              type="button"
                              onClick={() => extractChapter(chapter.name)}
                              disabled={saving}
                              title="把这章移出，成为一本独立的新漫画（用于误放进来的章节）"
                              className="shrink-0 rounded-full border border-rose-300/25 bg-rose-300/10 px-2.5 py-1 text-[11px] text-rose-200/85 transition hover:bg-rose-300/20 disabled:opacity-50"
                            >
                              移出为新漫画
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteChapter(chapter.name)}
                              disabled={saving}
                              title="删除这一章（不可恢复，需点击两次确认）"
                              className={cn(
                                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50",
                                deletingChapter === chapter.name
                                  ? "border-rose-300/60 bg-rose-300/30 text-rose-50"
                                  : "border-white/14 bg-white/6 text-white/55 hover:bg-rose-300/15 hover:text-rose-200/90",
                              )}
                            >
                              {deletingChapter === chapter.name ? "确认删除？" : "删除"}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {saveError && <div className="text-xs text-rose-300">{saveError}</div>}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {!isComics && (
                <button
                  type="button"
                  onClick={handleDeleteItem}
                  disabled={saving}
                  className={`mr-auto rounded-full border px-4 py-2 text-sm transition disabled:opacity-50 ${
                    deletingItem
                      ? "border-rose-300/60 bg-rose-300/30 text-rose-50"
                      : "border-rose-300/25 bg-rose-300/10 text-rose-200/85 hover:bg-rose-300/20"
                  }`}
                  title="删除整个条目（不可恢复，需点击两次确认）"
                >
                  {deletingItem ? "确认删除？" : "删除"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={saving}
                className="rounded-full border border-white/14 bg-white/6 px-4 py-2 text-sm text-white/76 transition hover:bg-white/14 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className="rounded-full bg-sky-300/25 px-5 py-2 text-sm text-sky-50 transition hover:bg-sky-300/35 disabled:opacity-50"
              >
                {saving ? "正在保存…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 翻译编辑器（套索框选对话框 → 打字覆盖 → 存为独立翻译页） */}
      {translatingPage !== null && currentChapter && currentChapter.images[translatingPage] ? (
        <TranslationEditor
          resourceRoot={resourceRoot}
          groupId={itemId ?? ""}
          chapterName={currentChapter.name}
          imagePath={currentChapter.translatedImages[translatingPage] ?? currentChapter.images[translatingPage]}
          originalPath={currentChapter.images[translatingPage]}
          pageIndex={translatingPage}
          totalPages={currentChapter.images.length}
          onNavigate={(dir) =>
            setTranslatingPage((page) =>
              page === null
                ? page
                : Math.max(0, Math.min(currentChapter.images.length - 1, page + dir)),
            )
          }
          onClose={() => setTranslatingPage(null)}
          onSaved={async () => {
            setTranslatingPage(null);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}
