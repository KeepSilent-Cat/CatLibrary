import {MusicSession} from "@/components/PersistentMusic";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Camera, FolderOpen, FolderTree, ImagePlus, Loader2, Maximize2, PanelRight, Play, Settings2, Tag, Trash2, Wallpaper, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { categoryMeta, RATING_OPTIONS, type CategoryKey, type ContentRating, type LibraryItem } from "@/data/library";
import { clearLibraryIndexCache, filterLibraryIndex, loadLibraryIndex, saveLibraryMetadata } from "@/lib/library-source";
import { useAppStore } from "@/store/useAppStore";
import { type MusicTrack } from "@/components/MusicPlayer";
import ImageCoverPicker from "@/components/ImageCoverPicker";
import Live2DPanel from "@/components/Live2DPanel";
import NovelReader from "@/components/NovelReader";
import OriginalImageViewer from "@/components/OriginalImageViewer";

function pathBaseName(path: string): string {
  const normalized = path.split("?")[0]?.replace(/\\/g, "/") ?? path;
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

/** 视频条目里的单个视频文件（后端 list_video_tracks 返回，按集数自然排序） */
interface VideoTrack {
  name: string;
  path: string;
  relativePath: string;
}

export default function LibraryDetailPage({ category }: { category: CategoryKey }) {
  const videoFrameRef=useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const { itemId } = useParams();
  const resourceRoot = useAppStore((state) => state.resourceRoot);
  const ratingFilter = useAppStore((state) => state.ratingFilter);
  const openGameCoverScreenshot = useAppStore((state) => state.openGameCoverScreenshot);
  const coverRefreshSignal = useAppStore((state) => state.coverRefreshSignal);
  const gameEmbed = useAppStore((state) => state.gameEmbed);
  const setWallpaper = useAppStore((state) => state.setWallpaper);
  const setSavedToast = useAppStore((state) => state.setSavedToast);
  const meta = categoryMeta.find((item) => item.key === category)!;
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [altNameDraft, setAltNameDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [ratingDraft, setRatingDraft] = useState<ContentRating>(0);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 游戏专属：启动 / 绑定 / 封面管理
  const isGames = category === "games";
  const isImages = category === "images";
  const isMusic = category === "music";
  const isVideos = category === "videos";
  const isLive2d = category === "live2d";
  const isNovels = category === "novels";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [gameExes, setGameExes] = useState<string[]>([]);
  const [manualExe, setManualExe] = useState("");
  const [boundExe, setBoundExe] = useState("");
  const [sourceDir, setSourceDir] = useState("");
  const [coverImages, setCoverImages] = useState<string[]>([]);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicCoverBusy, setMusicCoverBusy] = useState(false);
  const [musicCoverPickerOpen, setMusicCoverPickerOpen] = useState(false);
  const [musicCoverPickerLoading, setMusicCoverPickerLoading] = useState(false);
  const [imageLibraryItems, setImageLibraryItems] = useState<LibraryItem[]>([]);
  // 视频：一个条目里可以有多个视频文件，按「集」播放
  const [videoTracks, setVideoTracks] = useState<VideoTrack[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoIndex, setVideoIndex] = useState(0);
  const [videoCoverBusy, setVideoCoverBusy] = useState(false);
  const [videoCoverPickerOpen, setVideoCoverPickerOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);

  const refreshLibraryState = async () => {
    const index = filterLibraryIndex(await loadLibraryIndex(resourceRoot), ratingFilter);
    setItems(index[category]);
    const tagSet = new Set<string>();
    for (const key of Object.keys(index) as CategoryKey[]) {
      for (const entry of index[key]) {
        for (const tag of entry.tags) {
          tagSet.add(tag);
        }
      }
    }
    setAllTags([...tagSet].sort((left, right) => left.localeCompare(right, "zh-Hans-CN")));
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setPageError(null);

    loadLibraryIndex(resourceRoot)
      .then((rawIndex) => {
        if (!cancelled) {
          // 分级过滤：被隐藏的条目在这里就不该出现在列表里
          const index = filterLibraryIndex(rawIndex, ratingFilter);
          setItems(index[category]);
          // 汇总全部素材的标签，作为输入建议
          const tagSet = new Set<string>();
          for (const key of Object.keys(index) as CategoryKey[]) {
            for (const entry of index[key]) {
              for (const tag of entry.tags) {
                tagSet.add(tag);
              }
            }
          }
          setAllTags([...tagSet].sort((left, right) => left.localeCompare(right, "zh-Hans-CN")));
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setPageError(currentError instanceof Error ? currentError.message : "读取详情失败");
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
  }, [category, resourceRoot, ratingFilter]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [isMusic, itemId]);

  const currentItem = useMemo(
    () => items.find((item) => item.id === itemId),
    [itemId, items],
  );

  // 把当前条目的封面设为整个应用的背景
  const setAsWallpaper = async () => {
    const path = currentItem?.coverImage;
    if (!path) {
      setSaveError("没有可设为背景的封面图");
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
      setSavedToast("已设为应用背景");
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "设为背景失败");
    }
  };

  useEffect(() => {
    if (currentItem) {
      setTitleDraft(currentItem.title);
      setAltNameDraft(currentItem.altName ?? "");
      setSummaryDraft(currentItem.summary);
      setRatingDraft(currentItem.rating);
      setTagDraft(currentItem.tags);
      setTagInput("");
    }
  }, [currentItem]);

  // 游戏：加载封面（cover）目录图片列表
  useEffect(() => {
    if (isGames && currentItem) {
      void loadCovers(currentItem.id);
    } else {
      setCoverImages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGames, currentItem?.id, coverRefreshSignal]);

  useEffect(() => {
    let cancelled = false;

    if (!isMusic || !currentItem) {
      setMusicTracks([]);
      setMusicLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMusicLoading(true);
    invoke<MusicTrack[]>("list_music_tracks", {
      resourceRoot,
      groupId: currentItem.id,
    })
      .then((result) => {
        if (!cancelled) {
          setMusicTracks(result ?? []);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setMusicTracks([]);
          setSaveError(currentError instanceof Error ? currentError.message : "读取音乐曲目失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMusicLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentItem?.id, isMusic, resourceRoot]);

  // 视频：加载该条目 source 下的全部视频文件，用于选集
  useEffect(() => {
    let cancelled = false;

    if (!isVideos || !currentItem) {
      setVideoTracks([]);
      setVideoLoading(false);
      setVideoIndex(0);
      return () => {
        cancelled = true;
      };
    }

    setVideoLoading(true);
    setVideoIndex(0);
    invoke<VideoTrack[]>("list_video_tracks", {
      resourceRoot,
      groupId: currentItem.id,
    })
      .then((result) => {
        if (!cancelled) {
          setVideoTracks(result ?? []);
        }
      })
      .catch((currentError) => {
        if (!cancelled) {
          setVideoTracks([]);
          setSaveError(currentError instanceof Error ? currentError.message : "读取视频列表失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVideoLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentItem?.id, isVideos, resourceRoot]);

  // 添加标签：去空白、去重
  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    setTagDraft((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setTagInput("");
  };

  // 建议：全库已有但当前条目还没加的标签
  const tagSuggestions = useMemo(
    () => allTags.filter((tag) => !tagDraft.includes(tag)).slice(0, 12),
    [allTags, tagDraft],
  );

  const handleSave = async () => {
    if (!currentItem) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      await saveLibraryMetadata(
        resourceRoot,
        category,
        currentItem.id,
        titleDraft,
        summaryDraft,
        ratingDraft,
        tagDraft,
        altNameDraft,
      );
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === currentItem.id
            ? {
                ...item,
                title: titleDraft.trim() || currentItem.id,
                altName: altNameDraft.trim() || undefined,
                summary: summaryDraft.trim() || item.summary,
                rating: ratingDraft,
                tags: tagDraft,
              }
            : item,
        ),
      );
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 删除整个条目：两步确认（第一次点击进入确认态，3 秒内再点执行）
  const handleDelete = async () => {
    if (!currentItem) {
      return;
    }
    if (!deleting) {
      setDeleting(true);
      window.setTimeout(() => setDeleting(false), 3000);
      return;
    }
    setDeleting(false);
    setDeleteError(null);
    try {
      await invoke("delete_library_item", {
        resourceRoot,
        category,
        itemId: currentItem.id,
      });
      navigate(`/${category}`);
    } catch (currentError) {
      setDeleteError(currentError instanceof Error ? currentError.message : "删除失败");
    }
  };

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result.split(",")[1] ?? "");
        } else {
          reject(new Error("读取文件失败"));
        }
      };
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });

  const readBlobAsBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result.split(",")[1] ?? "");
        } else {
          reject(new Error("读取图片失败"));
        }
      };
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(blob);
    });

  const loadCovers = async (groupId: string) => {
    try {
      const list = await invoke<string[]>("list_game_covers", { resourceRoot, groupId });
      setCoverImages(list);
    } catch {
      setCoverImages([]);
    }
  };

  const handleOpenFolder = async () => {
    if (!currentItem) return;
    try {
      await invoke("open_game_folder", { resourceRoot, groupId: currentItem.id });
    } catch (currentError) {
      setLaunchMsg(currentError instanceof Error ? currentError.message : "打开文件夹失败");
    }
  };

  const handleLaunchGame = async () => {
    if (!currentItem) return;
    setLaunching(true);
    setLaunchMsg(null);
    try {
      const exe = await invoke<string>("launch_game", {
        resourceRoot,
        groupId: currentItem.id,
        embed: gameEmbed,
      });
      setLaunchMsg(`已启动：${exe}`);
    } catch {
      // 找不到 / 需要选择 → 打开设置弹层
      await handleOpenBind();
    } finally {
      setLaunching(false);
    }
  };

  const handleOpenBind = async () => {
    if (!currentItem) return;
    try {
      const info = await invoke<{
        launchPath: string | null;
        candidates: string[];
        sourceDir: string;
      }>("get_game_launch", { resourceRoot, groupId: currentItem.id });
      setBoundExe(info.launchPath ?? "");
      setGameExes(info.candidates ?? []);
      setSourceDir(info.sourceDir ?? "");
    } catch {
      setBoundExe("");
      setGameExes([]);
      setSourceDir("");
    }
    setBindOpen(true);
  };

  const handleBind = async (exePath: string) => {
    if (!currentItem) return;
    setLaunching(true);
    setLaunchMsg(null);
    try {
      await invoke("bind_game_executable", {
        resourceRoot,
        groupId: currentItem.id,
        executablePath: exePath,
      });
      const exe = await invoke<string>("launch_game", {
        resourceRoot,
        groupId: currentItem.id,
        embed: gameEmbed,
      });
      setBindOpen(false);
      setManualExe("");
      setBoundExe(exePath);
      setLaunchMsg(`已启动：${exe}`);
    } catch (currentError) {
      setLaunchMsg(currentError instanceof Error ? currentError.message : "绑定或启动失败");
    } finally {
      setLaunching(false);
    }
  };

  const handleUnbind = async () => {
    if (!currentItem) return;
    try {
      await invoke("bind_game_executable", {
        resourceRoot,
        groupId: currentItem.id,
        executablePath: "",
      });
      setBoundExe("");
      setLaunchMsg("已清除绑定，将恢复自动探测");
    } catch (currentError) {
      setLaunchMsg(currentError instanceof Error ? currentError.message : "清除绑定失败");
    }
  };

  const browseExe = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: sourceDir || undefined,
        filters: [{ name: "可执行文件", extensions: ["exe"] }],
      });
      if (typeof selected === "string" && selected) {
        setManualExe(selected);
        await handleBind(selected);
      }
    } catch {
      // 用户取消或失败，忽略
    }
  };

  const handleAddCovers = async (files: FileList | null) => {
    if (!files || files.length === 0 || !currentItem) return;
    setCoverBusy(true);
    try {
      const images: Array<{ name: string; data: string }> = [];
      for (const file of Array.from(files)) {
        images.push({ name: file.name, data: await readFileAsBase64(file) });
      }
      const list = await invoke<string[]>("add_game_covers", {
        resourceRoot,
        groupId: currentItem.id,
        images,
      });
      setCoverImages(list);
      clearLibraryIndexCache(resourceRoot);
    } catch (currentError) {
      setLaunchMsg(currentError instanceof Error ? currentError.message : "添加封面失败");
    } finally {
      setCoverBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const handleDeleteCover = async (imagePath: string) => {
    if (!currentItem) return;
    setCoverBusy(true);
    try {
      const list = await invoke<string[]>("delete_game_cover", {
        resourceRoot,
        groupId: currentItem.id,
        imagePath,
      });
      setCoverImages(list);
      clearLibraryIndexCache(resourceRoot);
    } catch (currentError) {
      setLaunchMsg(currentError instanceof Error ? currentError.message : "删除封面失败");
    } finally {
      setCoverBusy(false);
    }
  };

  const openMusicCoverPicker = async () => {
    if (!currentItem) {
      return;
    }

    try {
      setMusicCoverPickerLoading(true);
      const index = await loadLibraryIndex(resourceRoot);
      setImageLibraryItems(filterLibraryIndex(index, ratingFilter).images);
      setMusicCoverPickerOpen(true);
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "读取图片库失败");
    } finally {
      setMusicCoverPickerLoading(false);
    }
  };

  const handlePickMusicCoverFromLibrary = async (imageUrl: string) => {
    if (!currentItem) {
      return;
    }

    try {
      setMusicCoverBusy(true);
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error("读取图片库图片失败");
      }
      const blob = await response.blob();
      const data = await readBlobAsBase64(blob);
      await invoke("set_music_cover", {
        resourceRoot,
        groupId: currentItem.id,
        image: {
          name: decodeURIComponent(pathBaseName(imageUrl)),
          data,
        },
      });
      clearLibraryIndexCache(resourceRoot);
      await refreshLibraryState();
      setMusicCoverPickerOpen(false);
      setSavedToast("音乐封面已更新");
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "设置音乐封面失败");
    } finally {
      setMusicCoverBusy(false);
    }
  };

  const handleDeleteMusicCover = async () => {
    if (!currentItem) {
      return;
    }

    try {
      setMusicCoverBusy(true);
      await invoke("delete_music_cover", {
        resourceRoot,
        groupId: currentItem.id,
      });
      clearLibraryIndexCache(resourceRoot);
      await refreshLibraryState();
      setSavedToast("已移除音乐封面");
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "移除音乐封面失败");
    } finally {
      setMusicCoverBusy(false);
    }
  };

  // 视频封面：从图片库挑一张，写入该条目的 cover/ 目录
  const openVideoCoverPicker = async () => {
    if (!currentItem) {
      return;
    }

    try {
      setVideoCoverBusy(true);
      setSaveError(null);
      const index = await loadLibraryIndex(resourceRoot);
      setImageLibraryItems(filterLibraryIndex(index, ratingFilter).images);
      setVideoCoverPickerOpen(true);
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "读取图片库失败");
    } finally {
      setVideoCoverBusy(false);
    }
  };

  const handlePickVideoCover = async (imageUrl: string) => {
    if (!currentItem) {
      return;
    }

    try {
      setVideoCoverBusy(true);
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error("读取图片库图片失败");
      }
      const blob = await response.blob();
      const data = await readBlobAsBase64(blob);
      await invoke("set_video_cover", {
        resourceRoot,
        groupId: currentItem.id,
        image: {
          name: decodeURIComponent(pathBaseName(imageUrl)),
          data,
        },
      });
      clearLibraryIndexCache(resourceRoot);
      await refreshLibraryState();
      setVideoCoverPickerOpen(false);
      setSavedToast("视频封面已更新");
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "设置视频封面失败");
    } finally {
      setVideoCoverBusy(false);
    }
  };

  const handleDeleteVideoCover = async () => {
    if (!currentItem) {
      return;
    }

    try {
      setVideoCoverBusy(true);
      await invoke("delete_video_cover", {
        resourceRoot,
        groupId: currentItem.id,
      });
      clearLibraryIndexCache(resourceRoot);
      await refreshLibraryState();
      setSavedToast("已移除视频封面");
    } catch (currentError) {
      setSaveError(currentError instanceof Error ? currentError.message : "移除视频封面失败");
    } finally {
      setVideoCoverBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel flex h-full items-center justify-center rounded-[32px] p-6 text-sm text-white/62">
        正在读取真实素材目录...
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="glass-panel flex h-full items-center justify-center rounded-[32px] p-6 text-sm text-rose-100/82">
        {pageError}
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="glass-panel flex h-full flex-col items-center justify-center gap-3 rounded-[32px] p-6 text-center">
        <p className="text-sm text-white/72">该内容不存在，或已被内容分级隐藏。</p>
        <p className="text-xs leading-5 text-white/45">
          想看的话，可以在「设置 → 内容分级」里把显示范围调大。
        </p>
        <button
          type="button"
          onClick={() => navigate(`/${category}`)}
          className="mt-1 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm text-white transition hover:bg-white/16"
        >
          返回 {meta.title}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5">
      <div className={`grid h-full min-h-0 gap-6 ${sidebarOpen ? "xl:grid-cols-[1.15fr_0.85fr]" : ""}`}>
        <section className={`${isMusic ? "flex min-h-0 flex-col overflow-hidden" : "glass-panel flex min-h-0 flex-col overflow-hidden rounded-[32px]"}`}>
          <div className="flex items-center justify-between px-6 py-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/${category}`)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/16"
              >
                <ArrowLeft className="h-4 w-4" />
                返回列表
              </button>
              {isImages ? (
                <button
                  type="button"
                  onClick={() => void setAsWallpaper()}
                  title="把当前封面设为整个应用的背景"
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100/85 transition hover:bg-emerald-300/20"
                >
                  <Wallpaper className="h-4 w-4" />
                  设为背景
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleDelete}
                className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition ${
                  deleting
                    ? "border-rose-300/60 bg-rose-300/30 text-rose-50"
                    : "border-rose-300/25 bg-rose-300/10 text-rose-200/85 hover:bg-rose-300/20"
                }`}
                title="删除整个条目（不可恢复，需点击两次确认）"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "确认删除？" : "删除"}
              </button>
              {isMusic ? (
                <>
                  <button
                    type="button"
                    onClick={() => void openMusicCoverPicker()}
                    disabled={musicCoverBusy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/16 disabled:opacity-60"
                  >
                    <ImagePlus className="h-4 w-4" />
                    从图片库选封面
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteMusicCover()}
                    disabled={musicCoverBusy || !currentItem.coverImage}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/24 bg-rose-300/10 px-4 py-2 text-sm text-rose-100/85 transition hover:bg-rose-300/20 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    清除封面
                  </button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {isGames ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleOpenFolder()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/16"
                  >
                    <FolderOpen className="h-4 w-4" />
                    打开文件夹
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLaunchGame()}
                    disabled={launching}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/20 px-4 py-2 text-sm font-medium text-sky-50 transition hover:bg-sky-300/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" />
                    {launching ? "启动中…" : "启动游戏"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOpenBind()}
                    title="修改/绑定启动程序"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/70 transition hover:bg-white/16 hover:text-white"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                </>
              ) : null}
              <span className="rounded-full border border-white/18 bg-white/8 px-3 py-1 text-xs text-white/72">
                {meta.title} 详情
              </span>
              <button
                type="button"
                onClick={() => setSidebarOpen((value) => !value)}
                title={sidebarOpen ? (isMusic ? "收起编辑区" : "收起侧边栏") : (isMusic ? "展开编辑区" : "展开侧边栏")}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
                  sidebarOpen
                    ? "border-sky-300/40 bg-sky-300/20 text-sky-50"
                    : "border-white/20 bg-white/10 text-white/70 hover:bg-white/16 hover:text-white"
                }`}
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          {deleteError ? (
            <p className="px-6 pb-2 text-sm text-rose-100/82">{deleteError}</p>
          ) : null}

          <div className={`min-h-0 flex-1 overflow-y-auto ${isMusic ? "px-0 pb-0" : "px-6 pb-6"}`}>
            {isLive2d ? (
              <Live2DPanel itemId={currentItem.id} />
            ) : isNovels ? (
              <div className="px-1 pb-1">
                <NovelReader itemId={currentItem.id} />
              </div>
            ) : isMusic ? (
              <MusicSession albumId={currentItem.id} rating={currentItem.rating}
                tracks={musicTracks}
                coverImage={currentItem.coverImage}
                title={currentItem.altName ?? currentItem.title}
                subtitle={currentItem.altName ? currentItem.title : undefined}
                summary={currentItem.summary}
                sourceCount={currentItem.sourceCount}
                loadingTracks={musicLoading}
              />
            ) : (
              <div className="relative overflow-hidden rounded-[28px] bg-black/16">
              {isVideos&&<button disabled={videoCoverBusy} className="rounded-full border border-white/20 px-4 py-2" onClick={async()=>{const video=videoFrameRef.current;if(!video||!currentItem||video.readyState<2||video.seeking){setSaveError('请先播放到需要的画面');return;}setVideoCoverBusy(true);try{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');if(!ctx)throw Error('无法创建画布');ctx.drawImage(video,0,0);await invoke('set_video_cover',{resourceRoot,groupId:currentItem.id,image:{name:'frame.png',data:c.toDataURL('image/png').split(',')[1]}});clearLibraryIndexCache(resourceRoot);await refreshLibraryState();setSavedToast('当前帧已保存为封面');}catch(e){setSaveError('保存当前帧失败：'+String(e));}finally{setVideoCoverBusy(false);}}}>用当前播放画面设置封面</button>}
              {isVideos && videoTracks.length > 0 ? (
                <div className="flex items-center gap-2 overflow-x-auto border-b border-white/10 bg-black/55 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setVideoIndex((index) => Math.max(0, index - 1))}
                    disabled={videoIndex === 0}
                    className="shrink-0 rounded-full border border-white/16 bg-white/8 px-3 py-1 text-xs text-white/80 transition hover:bg-white/16 disabled:opacity-40"
                  >
                    上一集
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-white/70">
                    {videoIndex + 1} / {videoTracks.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVideoIndex((index) => Math.min(videoTracks.length - 1, index + 1))}
                    disabled={videoIndex >= videoTracks.length - 1}
                    className="shrink-0 rounded-full border border-white/16 bg-white/8 px-3 py-1 text-xs text-white/80 transition hover:bg-white/16 disabled:opacity-40"
                  >
                    下一集
                  </button>
                  <div className="flex flex-1 items-center gap-1 overflow-x-auto">
                    {videoTracks.map((track, index) => (
                      <button
                        key={track.path}
                        type="button"
                        title={track.relativePath}
                        onClick={() => setVideoIndex(index)}
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs tabular-nums transition ${
                          index === videoIndex
                            ? "border-sky-300/50 bg-sky-300/20 text-sky-100"
                            : "border-white/12 bg-white/6 text-white/60 hover:bg-white/12"
                        }`}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {isVideos ? (
                videoLoading ? (
                  <div className="flex h-[52vh] min-h-[320px] w-full items-center justify-center gap-2 text-sm text-white/60">
                    <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
                    正在读取视频列表…
                  </div>
                ) : (
                  <video crossOrigin="anonymous" ref={videoFrameRef}
                    key={videoTracks[videoIndex]?.path ?? currentItem.previewMedia ?? "empty"}
                    src={
                      videoTracks[videoIndex]?.path
                        ? convertFileSrc(videoTracks[videoIndex].path)
                        : (currentItem.previewMedia ?? undefined)
                    }
                    controls
                    playsInline
                    className="mx-auto block max-h-[70vh] w-full object-contain"
                    onEnded={() => {
                      if (videoIndex < videoTracks.length - 1) {
                        setVideoIndex(videoIndex + 1);
                      }
                    }}
                  />
                )
              ) : currentItem.coverType === "video" && currentItem.previewMedia ? (
                <video
                  src={currentItem.previewMedia}
                  controls
                  muted
                  playsInline
                  className="mx-auto block max-h-[70vh] w-full object-contain"
                />
              ) : currentItem.coverImage ? (
                <img
                  src={currentItem.coverImage}
                  alt={currentItem.title}
                  onClick={() => setOriginalOpen(true)}
                  title="点击查看原图"
                  className="block h-auto w-full cursor-zoom-in"
                />
              ) : (
                <div className="h-[52vh] min-h-[320px] w-full bg-[linear-gradient(145deg,rgba(31,41,55,0.94),rgba(15,23,42,0.96),rgba(24,24,27,0.96))]" />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/78 via-black/12 to-black/22" />
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                {currentItem.coverImage ? (
                  <button
                    type="button"
                    onClick={() => setOriginalOpen(true)}
                    title="全屏查看原图（可缩放、按原始像素查看）"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/24 bg-black/55 px-3.5 py-2 text-xs text-white/90 backdrop-blur-sm transition hover:bg-black/75 hover:text-white"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    看原图
                  </button>
                ) : null}
                {isImages && currentItem.coverImage ? (
                  <button
                    type="button"
                    onClick={() => void setAsWallpaper()}
                    title="把这张图设为整个应用的背景"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/24 bg-black/55 px-3.5 py-2 text-xs text-white/90 backdrop-blur-sm transition hover:bg-black/75 hover:text-white"
                  >
                    <Wallpaper className="h-3.5 w-3.5" />
                    设为背景
                  </button>
                ) : null}
                {isVideos ? (
                  <button
                    type="button"
                    onClick={() => void openVideoCoverPicker()}
                    disabled={videoCoverBusy}
                    title="从图片库挑一张图作为这个视频条目的封面"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/24 bg-black/55 px-3.5 py-2 text-xs text-white/90 backdrop-blur-sm transition hover:bg-black/75 hover:text-white disabled:opacity-50"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    设置封面
                  </button>
                ) : null}
                {isVideos && currentItem.coverImage ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteVideoCover()}
                    disabled={videoCoverBusy}
                    title="移除自定义封面，回到自动生成"
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/30 bg-black/55 px-3.5 py-2 text-xs text-rose-100 backdrop-blur-sm transition hover:bg-black/75 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除封面
                  </button>
                ) : null}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6">
                <div className="max-w-2xl rounded-[28px] bg-black/18 px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-white/56">{meta.title}</p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">
                    {currentItem.altName ?? currentItem.title}
                  </h2>
                  {currentItem.altName ? (
                    <p className="mt-1 text-sm text-white/60">{currentItem.title}</p>
                  ) : null}
                  <p className="mt-3 text-sm leading-7 text-white/78">{currentItem.summary}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/48">
                    {currentItem.sourceCount} 项源内容
                  </p>
                </div>
              </div>
            </div>
            )}
          </div>
        </section>

        {sidebarOpen ? (
          <aside className={`${isMusic ? "rounded-[28px] bg-black/22 p-6 backdrop-blur-md" : "glass-panel rounded-[32px] p-6"} flex min-h-0 flex-col`}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="glass-chip rounded-[24px] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <FolderTree className="h-4 w-4 text-sky-100" />
                <span>素材组路径</span>
              </div>
              <p className="mt-3 break-all text-sm leading-6 text-white/70">{currentItem.relativePath}</p>
            </div>

            {isGames ? (
              <div className="glass-chip rounded-[24px] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">封面 / 预览图</p>
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={coverBusy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs text-white/76 transition hover:bg-white/16 disabled:opacity-60"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    添加封面图
                  </button>
                  <button
                    type="button"
                    onClick={() => openGameCoverScreenshot(currentItem.id)}
                    disabled={coverBusy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100/90 transition hover:bg-sky-300/20 disabled:opacity-60"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    截取画面
                  </button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleAddCovers(event.target.files)}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-white/42">
                  选中的图片会存入本游戏的 cover 目录，列表卡片将轮播这些图。
                </p>
                {coverImages.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {coverImages.map((image) => (
                      <div
                        key={image}
                        className="group relative aspect-[3/4] overflow-hidden rounded-[14px] border border-white/12 bg-white/6"
                      >
                        <img
                          src={convertFileSrc(image)}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void handleDeleteCover(image)}
                          disabled={coverBusy}
                          title="删除这张封面"
                          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/40 bg-rose-950/60 text-rose-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-900/70"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-white/40">还没有自定义封面，卡片会显示自动探测的图片。</p>
                )}
              </div>
            ) : null}

            {isMusic ? (
              <div className={`${isMusic ? "rounded-[24px] bg-white/6 p-4" : "glass-chip rounded-[24px] p-4"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">专辑封面</p>
                  <span className="text-[11px] text-white/42">使用顶部按钮更换或清除封面</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-white/42">
                  从图片库选中的那张图会复制到当前音乐组的 cover 目录，列表卡片和播放器都会优先使用它。
                </p>
                <div className="mt-3 overflow-hidden rounded-[18px] border border-white/12 bg-white/6">
                  {currentItem.coverImage ? (
                    <img
                      src={currentItem.coverImage}
                      alt={currentItem.title}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-sm text-white/38">
                      还没有专辑封面
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className={`${isMusic ? "rounded-[24px] bg-white/6 p-4" : "glass-chip rounded-[24px] p-4"}`}>
              <p className="text-sm font-medium text-white">展示信息</p>
              <div className="mt-3 space-y-3">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/36 focus:bg-white/14"
                  placeholder="原名（原始标题）"
                />
                <input
                  value={altNameDraft}
                  onChange={(event) => setAltNameDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/36 focus:bg-white/14"
                  placeholder="艺名 / 译名（自己翻译的名称，留空则只显示原名）"
                />
                <textarea
                  value={summaryDraft}
                  onChange={(event) => setSummaryDraft(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-white/18 bg-white/10 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-white/36 focus:bg-white/14"
                  placeholder="描述内容"
                />
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "保存中..." : "保存展示名称、描述与标签"}
                </button>
                <div>
                  <p className="mb-2 text-sm text-white/78">内容分级</p>
                  <div className="flex items-center gap-2">
                    {RATING_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRatingDraft(option.value)}
                        className={`flex-1 rounded-2xl border px-3 py-2.5 text-sm transition ${
                          ratingDraft === option.value
                            ? option.value === 0
                              ? "border-sky-300/40 bg-sky-300/12 text-sky-100"
                              : "border-rose-300/35 bg-rose-300/12 text-rose-100"
                            : "border-white/18 bg-white/10 text-white/72 hover:bg-white/14"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-white/42">
                    {RATING_OPTIONS.find((option) => option.value === ratingDraft)?.description}
                    ；擦边和 18+ 默认在所有列表隐藏，需在设置中调整显示范围。
                  </p>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm text-white/78">
                    <Tag className="h-3.5 w-3.5 text-sky-100" />
                    标签
                  </p>
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
                        addTag(tagInput);
                      } else if (
                        event.key === "Backspace" &&
                        tagInput === "" &&
                        tagDraft.length > 0
                      ) {
                        setTagDraft((current) => current.slice(0, -1));
                      }
                    }}
                    placeholder="输入标签后回车添加…"
                    className="mt-2 w-full rounded-2xl border border-white/18 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/36 focus:bg-white/14"
                  />
                  {tagSuggestions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tagSuggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addTag(tag)}
                          className="rounded-full border border-white/14 bg-white/6 px-2.5 py-1 text-[11px] text-white/60 transition hover:bg-white/14"
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] leading-5 text-white/42">
                    标签跨所有分类通用，可用于列表页顶部筛选。
                  </p>
                </div>
                {saveError ? <p className="text-sm text-rose-100/82">{saveError}</p> : null}
              </div>
            </div>

            <div className={`${isMusic ? "rounded-[24px] bg-white/6 p-4" : "glass-chip rounded-[24px] p-4"}`}>
              <p className="text-sm font-medium text-white">源文件列表</p>
              <div className="mt-3 space-y-2">
                {currentItem.sourceEntries.map((entry) => (
                  <div
                    key={entry.relativePath}
                    className="rounded-[18px] border border-white/12 bg-white/6 px-3 py-2 text-sm text-white/76"
                  >
                    <p className="truncate font-medium text-white/86">{entry.name}</p>
                    <p className="mt-1 break-all text-xs leading-5 text-white/52">{entry.relativePath}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${isMusic ? "rounded-[24px] bg-white/6 p-4" : "glass-chip rounded-[24px] p-4"}`}>
              <p className="text-sm font-medium text-white">当前根目录</p>
              <p className="mt-3 break-all text-sm leading-6 text-white/70">{resourceRoot}</p>
            </div>
          </div>
          </aside>
        ) : null}
      </div>

      {bindOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-window w-[540px] max-w-[90vw] rounded-[28px] p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">启动程序设置</h3>
              <button
                type="button"
                onClick={() => setBindOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/16 bg-white/8 text-white/70 transition hover:bg-white/16 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {boundExe ? (
              <div className="mt-3 rounded-[16px] border border-sky-300/30 bg-sky-300/10 px-4 py-3">
                <p className="text-xs text-sky-100/70">当前绑定</p>
                <p className="mt-1 break-all text-sm text-white">{boundExe}</p>
                <button
                  type="button"
                  onClick={() => void handleUnbind()}
                  className="mt-2 text-xs text-rose-200/80 transition hover:text-rose-100"
                >
                  清除绑定，恢复自动探测
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-white/55">
                当前未绑定。请选择一个候选启动程序，或手动输入完整路径。
              </p>
            )}
            {gameExes.length > 0 ? (
              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                {gameExes.map((exe) => (
                  <button
                    key={exe}
                    type="button"
                    onClick={() => void handleBind(exe)}
                    disabled={launching}
                    className="flex w-full items-center gap-2 rounded-[16px] border border-white/14 bg-white/6 px-4 py-3 text-left text-sm text-white/80 transition hover:border-sky-300/40 hover:bg-white/10 disabled:opacity-60"
                  >
                    <Play className="h-4 w-4 shrink-0 text-sky-200" />
                    <span className="truncate">{exe}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-[16px] border border-white/12 bg-white/6 px-4 py-3 text-sm text-white/50">
                没有找到 .exe。可点「打开文件夹」确认游戏文件，或手动输入启动程序完整路径。
              </p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <input
                value={manualExe}
                onChange={(event) => setManualExe(event.target.value)}
                placeholder="手动输入 .exe 完整路径…"
                className="min-w-0 flex-1 rounded-2xl border border-white/18 bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/36 focus:bg-white/14"
              />
              <button
                type="button"
                onClick={() => void browseExe()}
                disabled={launching}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white transition hover:bg-white/16 disabled:opacity-60"
              >
                浏览…
              </button>
              <button
                type="button"
                onClick={() => manualExe.trim() && void handleBind(manualExe.trim())}
                disabled={launching || !manualExe.trim()}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-300/20 px-4 py-2.5 text-sm font-medium text-sky-50 transition hover:bg-sky-300/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                绑定并启动
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {launchMsg ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sky-300/30 bg-black/70 px-4 py-2 text-sm text-sky-100 backdrop-blur-sm">
          {launchMsg}
        </div>
      ) : null}

      <ImageCoverPicker
        open={musicCoverPickerOpen}
        loading={musicCoverPickerLoading}
        items={imageLibraryItems}
        onClose={() => setMusicCoverPickerOpen(false)}
        onPick={(imageUrl) => void handlePickMusicCoverFromLibrary(imageUrl)}
      />

      <ImageCoverPicker
        open={videoCoverPickerOpen}
        loading={videoCoverBusy}
        items={imageLibraryItems}
        onClose={() => setVideoCoverPickerOpen(false)}
        onPick={(imageUrl) => void handlePickVideoCover(imageUrl)}
      />

      <OriginalImageViewer
        open={originalOpen}
        src={currentItem.coverImage}
        title={currentItem.altName ?? currentItem.title}
        onClose={() => setOriginalOpen(false)}
      />
    </div>
  );
}
