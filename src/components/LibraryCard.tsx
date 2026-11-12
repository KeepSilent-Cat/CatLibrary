import { Maximize2, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ImagePreviewBehavior,
  PreviewMode,
  VideoFitMode,
  VideoPreviewBehavior,
  VideoSoundMode,
} from "@/data/library";
import type { LibraryItem } from "@/data/library";
import { RATING_OPTIONS } from "@/data/library";
import OriginalImageViewer from "@/components/OriginalImageViewer";
import { cn } from "@/lib/utils";

export default function LibraryCard({
  item,
  previewMode,
  imagePreviewBehavior,
  videoPreviewBehavior,
  videoProgress,
  videoMuted,
  videoSoundMode,
  videoFitMode,
  showInfo = true,
  favorite = false,
  selected = false,
  onToggleFavorite,
  onSelect,
  onClick,
}: {
  item: LibraryItem;
  previewMode: PreviewMode;
  imagePreviewBehavior: ImagePreviewBehavior;
  videoPreviewBehavior: VideoPreviewBehavior;
  videoProgress: number;
  videoMuted: boolean;
  videoSoundMode: VideoSoundMode;
  videoFitMode: VideoFitMode;
  showInfo?: boolean;
  favorite?: boolean;
  selected?: boolean;
  onToggleFavorite?: () => void;
  onSelect?: (item: LibraryItem) => void;
  onClick: (item: LibraryItem) => void;
}) {
  const fallbackLabel =
    item.category === "images"
      ? "图片组"
      : item.category === "videos"
        ? "视频组"
        : item.category === "comics"
          ? "漫画"
          : item.category === "screenshots"
            ? "截图"
            : item.category === "music"
              ? "音乐集"
              : "游戏组";
  const [isHovering, setIsHovering] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // 原图帧（未缩略图化），"查看原图"从这里取当前正在显示的那一张
  const originalFrames = useMemo(
    () =>
      item.previewImages.length > 0
        ? item.previewImages
        : item.coverImage
          ? [item.coverImage]
          : [],
    [item.coverImage, item.previewImages],
  );
  const imageFrames = useMemo(() => {
    // 卡片静止时只显示第一帧，把第一帧换成后端生成的缩略图：
    // 放大窗口/全屏时几十张卡片同时加载，也不会再去解码原始大图。
    if (originalFrames.length > 0 && item.coverThumb) {
      return [item.coverThumb, ...originalFrames.slice(1)];
    }

    return originalFrames;
  }, [originalFrames, item.coverThumb]);
  // 只有进入视口的卡片才参与图片轮播 / 视频自动播放。
  // 放大窗口后一屏会出现几十张卡片，若全部同时预览会瞬间抢光解码与 IO 资源。
  const shouldPreview =
    inView && (previewMode === "auto" || (previewMode === "hover" && isHovering));

  useEffect(() => {
    const element = cardRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setInView(entries[0]?.isIntersecting ?? false);
      },
      { rootMargin: "200px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [item.id]);

  useEffect(() => {
    if (
      (item.category !== "images" && item.category !== "comics") ||
      imageFrames.length <= 1
    ) {
      return;
    }

    if (!shouldPreview) {
      setActiveImageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveImageIndex((current) => {
        if (imagePreviewBehavior === "loop") {
          return (current + 1) % imageFrames.length;
        }

        return current >= imageFrames.length - 1 ? current : current + 1;
      });
    }, 1200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [imageFrames.length, imagePreviewBehavior, item.category, shouldPreview]);

  useEffect(() => {
    if (item.coverType !== "video" || !item.previewMedia || !videoRef.current) {
      return;
    }

    const element = videoRef.current;

    const stopPreview = () => {
      element.pause();
      element.currentTime = 0;
    };

    const limitPlayback = () => {
      if (videoPreviewBehavior === "full") {
        return;
      }

      if (element.currentTime >= 30) {
        if (videoPreviewBehavior === "loop_30") {
          element.currentTime = 0;
          void element.play().catch(() => undefined);
        } else {
          element.pause();
        }
      }
    };

    element.addEventListener("timeupdate", limitPlayback);

    if (shouldPreview) {
      element.currentTime = 0;
      void element.play().catch(() => undefined);
    } else {
      stopPreview();
    }

    return () => {
      element.removeEventListener("timeupdate", limitPlayback);
      stopPreview();
    };
  }, [item.coverType, item.previewMedia, shouldPreview, videoPreviewBehavior]);

  // 统一进度条：拖动后所有正在预览的视频按同一百分比 seek 并继续播放
  useEffect(() => {
    if (item.coverType !== "video" || !videoRef.current || !shouldPreview) {
      return;
    }

    const element = videoRef.current;

    const seekToProgress = () => {
      if (isFinite(element.duration) && element.duration > 0) {
        element.currentTime = element.duration * videoProgress;
        void element.play().catch(() => undefined);
      }
    };

    if (isFinite(element.duration) && element.duration > 0) {
      seekToProgress();
      return;
    }

    element.addEventListener("loadedmetadata", seekToProgress, { once: true });
    return () => element.removeEventListener("loadedmetadata", seekToProgress);
  }, [item.coverType, shouldPreview, videoProgress]);

  const isVideoMuted =
    videoMuted ||
    (videoSoundMode === "hover" && !isHovering) ||
    (videoSoundMode === "selected" && !selected);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={() => {
        // 选中出声模式：单击只选中（出声），双击打开详情
        if (onSelect) {
          onSelect(item);
        } else {
          onClick(item);
        }
      }}
      onDoubleClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(item);
        }
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={cn(
        "group relative overflow-hidden rounded-[24px] border border-white/16 text-left transition duration-200",
        // 视频卡片高度由统一进度/行高控制（可调宽高），其他分类保持固定 5:6 比例
        item.category === "videos"
          ? "h-full"
          : "aspect-[5/6]",
        "bg-white/6 shadow-[0_16px_40px_rgba(16,10,34,0.2)] hover:border-white/28 hover:shadow-[0_20px_48px_rgba(24,16,52,0.24)]",
        "cursor-pointer outline-none focus-visible:border-white/40",
        // 选中出声模式下被选中的卡片高亮
        selected &&
          "border-sky-300/80 shadow-[0_0_0_2px_rgba(125,211,252,0.55),0_20px_48px_rgba(24,16,52,0.24)]",
      )}
    >
      {item.coverType === "video" && item.previewMedia ? (
        <video
          ref={videoRef}
          src={item.previewMedia}
          poster={item.coverImage}
          muted={isVideoMuted}
          playsInline
          preload="metadata"
          // 首帧不解码的话卡片就是一片黑：定位到极小的一个时间点，强制渲染出一帧当封面
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            if (Number.isFinite(element.duration) && element.duration > 0 && element.currentTime === 0) {
              try {
                element.currentTime = Math.min(0.1, element.duration * 0.05);
              } catch {
                // 某些格式不允许 seek，忽略即可
              }
            }
          }}
          className={cn(
            "absolute inset-0 h-full w-full transition duration-300 group-hover:scale-[1.03]",
            videoFitMode === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : imageFrames.length > 0 ? (
        <img
          src={imageFrames[activeImageIndex]}
          alt={item.title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(31,41,55,0.88),rgba(15,23,42,0.94),rgba(24,24,27,0.94))]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/18 to-black/38" />
      {showInfo ? (
        <div className="relative flex h-full flex-col justify-start p-4">
          <div className="max-w-full rounded-[18px] bg-black/18 px-3.5 py-2.5">
            <h3 className="text-sm font-semibold tracking-[0.02em] text-white">
              {item.altName ?? item.title}
            </h3>
            {item.altName ? (
              <p className="mt-0.5 text-[11px] leading-4 text-white/55">{item.title}</p>
            ) : null}
            <p className="mt-1 text-xs leading-5 text-white/78">{item.summary}</p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/48">
              {fallbackLabel} · {item.sourceCount}
            </p>
            {item.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-sky-300/30 bg-sky-300/12 px-2 py-0.5 text-[10px] text-sky-100/90"
                  >
                    {tag}
                  </span>
                ))}
                {item.tags.length > 4 ? (
                  <span className="text-[10px] text-white/45">+{item.tags.length - 4}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="relative flex h-full flex-col justify-start p-4" />
      )}
      {onToggleFavorite ? (
        <button
          type="button"
          title={favorite ? "取消收藏" : "收藏"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
            favorite
              ? "border-amber-300/60 bg-amber-300/25 text-amber-300 hover:bg-amber-300/40"
              : "border-white/20 bg-black/30 text-white/70 hover:bg-black/50 hover:text-white",
          )}
        >
          <Star className={cn("h-4 w-4", favorite && "fill-amber-300")} />
        </button>
      ) : null}
      {/* 查看原图：平时隐形，悬停/聚焦才出现，避免卡片信息过载 */}
      {originalFrames.length > 0 && item.coverType !== "video" ? (
        <button
          type="button"
          title="查看原图"
          onClick={(event) => {
            event.stopPropagation();
            setOriginalOpen(true);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="absolute bottom-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/75 opacity-0 transition hover:bg-black/60 hover:text-white focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-events-none"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      ) : null}
      {/* 分级角标：R15 / 18+ */}
      {item.rating > 0 && (
        <span
          className={cn(
            "absolute left-3 top-3 z-10 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
            item.rating === 2
              ? "border-rose-300/50 bg-rose-950/78 text-rose-200"
              : "border-amber-300/50 bg-amber-950/78 text-amber-200",
          )}
        >
          {RATING_OPTIONS.find((option) => option.value === item.rating)?.short}
        </span>
      )}
      <OriginalImageViewer
        open={originalOpen}
        src={originalFrames[activeImageIndex] ?? originalFrames[0]}
        title={item.altName ?? item.title}
        onClose={() => setOriginalOpen(false)}
      />
    </div>
  );
}
