import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CategoryKey,
  ContentRating,
  ImagePreviewBehavior,
  PreviewMode,
  VideoPreviewBehavior,
  VideoFitMode,
  VideoSoundMode,
} from "@/data/library";

export interface BoardPanel {
  id: string;
  category: CategoryKey;
  itemId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 截图保存目标：截图库，或某游戏的封面目录 */
export type ScreenshotTarget =
  | { type: "library" }
  | { type: "game-cover"; groupId: string };

interface AppState {
  resourceRoot: string;
  logoSourcePath: string;
  relativeModeEnabled: boolean;
  previewMode: PreviewMode;
  imagePreviewBehavior: ImagePreviewBehavior;
  videoPreviewBehavior: VideoPreviewBehavior;
  // 视频页卡片尺寸（宽/高 px，可独立调节）与每页数量（0 = 自动按一屏算）
  videoCardWidth: number;
  videoCardHeight: number;
  videoPageSize: number;
  // 视频卡片自适应布局：true=像图片/漫画一样自动排列（默认），false=用上面的自定义宽高
  videoAutoLayout: boolean;
  // 视频卡片左上角信息块显隐
  videoShowInfo: boolean;
  // 视频预览声音控制
  videoMuted: boolean;
  videoSoundMode: VideoSoundMode;
  // 视频卡片填充方式：cover=裁剪铺满（默认）contain=完整显示（比例不符时留黑边）
  videoFitMode: VideoFitMode;
  // 统一进度条百分比（0~1），不持久化
  videoProgress: number;
  // 收藏：扁平存储 "category/itemId"
  favoriteIds: string[];
  // 内容分级显示范围：0=仅全年龄 1=含擦边R15 2=全部（默认仅全年龄，标记内容默认隐藏）
  ratingFilter: ContentRating;
  // 标签筛选：当前选中的标签（会话内，不持久化；命中需同时包含全部选中标签）
  tagFilter: string[];
  // 截图：快捷键（如 "ctrl+shift+s"）、打开状态、保存成功提示
  screenshotShortcut: string;
  screenshotOpen: boolean;
  screenshotTarget: ScreenshotTarget;
  savedToast: string | null;
  // 应用背景：空字符串=默认背景，否则为 data URL
  wallpaper: string;
  // 游戏封面刷新信号：截图设为封面后自增，通知详情页重新加载封面列表
  coverRefreshSignal: number;
  // 游戏嵌入模式：启动游戏时尝试把窗口嵌进应用窗口（失败回退独立窗口）
  gameEmbed: boolean;
  // 漫画自动播放：滚动速度（px/秒）、章节切换延迟（秒）、跳过每章开头页数（前情提要）
  autoPlaySpeed: number;
  chapterDelay: number;
  autoSkipPages: number;
  setResourceRoot: (value: string) => void;
  setLogoSourcePath: (value: string) => void;
  setRelativeModeEnabled: (value: boolean) => void;
  setPreviewMode: (value: PreviewMode) => void;
  setImagePreviewBehavior: (value: ImagePreviewBehavior) => void;
  setVideoPreviewBehavior: (value: VideoPreviewBehavior) => void;
  setVideoCardWidth: (value: number) => void;
  setVideoCardHeight: (value: number) => void;
  setVideoPageSize: (value: number) => void;
  setVideoAutoLayout: (value: boolean) => void;
  setVideoShowInfo: (value: boolean) => void;
  setVideoMuted: (value: boolean) => void;
  setVideoSoundMode: (value: VideoSoundMode) => void;
  setVideoFitMode: (value: VideoFitMode) => void;
  setVideoProgress: (value: number) => void;
  setRatingFilter: (value: ContentRating) => void;
  toggleTagFilter: (tag: string) => void;
  clearTagFilter: () => void;
  setScreenshotShortcut: (value: string) => void;
  setAutoPlaySpeed: (value: number) => void;
  setChapterDelay: (value: number) => void;
  setAutoSkipPages: (value: number) => void;
  openScreenshot: () => void;
  openGameCoverScreenshot: (groupId: string) => void;
  closeScreenshot: () => void;
  setSavedToast: (value: string | null) => void;
  setWallpaper: (value: string) => void;
  resetWallpaper: () => void;
  bumpCoverRefresh: () => void;
  setGameEmbed: (value: boolean) => void;
  toggleFavorite: (category: CategoryKey, itemId: string) => void;
  // 画板（工作台）：自由摆放、可拖拽缩放、可持久化的素材面板
  boardPanels: BoardPanel[];
  addBoardPanel: (category: CategoryKey, itemId: string) => void;
  removeBoardPanel: (id: string) => void;
  moveBoardPanel: (id: string, x: number, y: number) => void;
  resizeBoardPanel: (id: string, w: number, h: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      resourceRoot: "d:\\CatLibrary\\library",
      logoSourcePath: "",
      relativeModeEnabled: true,
      previewMode: "hover",
      imagePreviewBehavior: "loop",
      videoPreviewBehavior: "loop_30",
      videoCardWidth: 200,
      videoCardHeight: 240,
      videoPageSize: 0,
      videoAutoLayout: true,
      videoShowInfo: true,
      videoMuted: true,
      videoSoundMode: "hover",
      videoFitMode: "cover",
      videoProgress: 0,
      favoriteIds: [],
      boardPanels: [],
      ratingFilter: 0,
      tagFilter: [],
      screenshotShortcut: "ctrl+shift+s",
      screenshotOpen: false,
      screenshotTarget: { type: "library" },
      savedToast: null,
      wallpaper: "",
      coverRefreshSignal: 0,
      gameEmbed: true,
      autoPlaySpeed: 300,
      chapterDelay: 3,
      autoSkipPages: 0,
      setResourceRoot: (value) => set({ resourceRoot: value }),
      setLogoSourcePath: (value) => set({ logoSourcePath: value }),
      setRelativeModeEnabled: (value) => set({ relativeModeEnabled: value }),
      setPreviewMode: (value) => set({ previewMode: value }),
      setImagePreviewBehavior: (value) => set({ imagePreviewBehavior: value }),
      setVideoPreviewBehavior: (value) => set({ videoPreviewBehavior: value }),
      setVideoCardWidth: (value) => set({ videoCardWidth: value }),
      setVideoCardHeight: (value) => set({ videoCardHeight: value }),
      setVideoPageSize: (value) => set({ videoPageSize: value }),
      setVideoAutoLayout: (value) => set({ videoAutoLayout: value }),
      setVideoShowInfo: (value) => set({ videoShowInfo: value }),
      setVideoMuted: (value) => set({ videoMuted: value }),
      setVideoSoundMode: (value) => set({ videoSoundMode: value }),
      setVideoFitMode: (value) => set({ videoFitMode: value }),
      setVideoProgress: (value) => set({ videoProgress: value }),
      setRatingFilter: (value) => set({ ratingFilter: value }),
      toggleTagFilter: (tag) =>
        set((state) => ({
          tagFilter: state.tagFilter.includes(tag)
            ? state.tagFilter.filter((existing) => existing !== tag)
            : [...state.tagFilter, tag],
        })),
      clearTagFilter: () => set({ tagFilter: [] }),
      setScreenshotShortcut: (value) => set({ screenshotShortcut: value }),
      setAutoPlaySpeed: (value) => set({ autoPlaySpeed: value }),
      setChapterDelay: (value) => set({ chapterDelay: value }),
      setAutoSkipPages: (value) => set({ autoSkipPages: value }),
      openScreenshot: () => set({ screenshotOpen: true, screenshotTarget: { type: "library" } }),
      openGameCoverScreenshot: (groupId) =>
        set({ screenshotOpen: true, screenshotTarget: { type: "game-cover", groupId } }),
      closeScreenshot: () => set({ screenshotOpen: false }),
      setSavedToast: (value) => set({ savedToast: value }),
      setWallpaper: (value) => set({ wallpaper: value }),
      resetWallpaper: () => set({ wallpaper: "" }),
      bumpCoverRefresh: () => set((state) => ({ coverRefreshSignal: state.coverRefreshSignal + 1 })),
      setGameEmbed: (value) => set({ gameEmbed: value }),
      toggleFavorite: (category, itemId) =>
        set((state) => {
          const key = `${category}/${itemId}`;
          return {
            favoriteIds: state.favoriteIds.includes(key)
              ? state.favoriteIds.filter((existing) => existing !== key)
              : [...state.favoriteIds, key],
          };
        }),
      addBoardPanel: (category, itemId) =>
        set((state) => {
          const offset = state.boardPanels.length % 5;
          return {
            boardPanels: [
              ...state.boardPanels,
              {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                category,
                itemId,
                x: 32 + offset * 44,
                y: 32 + offset * 44,
                w: 460,
                h: 340,
              },
            ],
          };
        }),
      removeBoardPanel: (id) =>
        set((state) => ({ boardPanels: state.boardPanels.filter((panel) => panel.id !== id) })),
      moveBoardPanel: (id, x, y) =>
        set((state) => ({
          boardPanels: state.boardPanels.map((panel) => (panel.id === id ? { ...panel, x, y } : panel)),
        })),
      resizeBoardPanel: (id, w, h) =>
        set((state) => ({
          boardPanels: state.boardPanels.map((panel) => (panel.id === id ? { ...panel, w, h } : panel)),
        })),
    }),
    {
      name: "zerocat-settings",
      partialize: (state) => ({
        resourceRoot: state.resourceRoot,
        logoSourcePath: state.logoSourcePath,
        relativeModeEnabled: state.relativeModeEnabled,
        previewMode: state.previewMode,
        imagePreviewBehavior: state.imagePreviewBehavior,
        videoPreviewBehavior: state.videoPreviewBehavior,
        videoCardWidth: state.videoCardWidth,
        videoCardHeight: state.videoCardHeight,
        videoPageSize: state.videoPageSize,
        videoAutoLayout: state.videoAutoLayout,
        videoShowInfo: state.videoShowInfo,
        videoMuted: state.videoMuted,
        videoSoundMode: state.videoSoundMode,
        videoFitMode: state.videoFitMode,
        favoriteIds: state.favoriteIds,
        wallpaper: state.wallpaper,
        boardPanels: state.boardPanels,
        ratingFilter: state.ratingFilter,
        gameEmbed: state.gameEmbed,
        screenshotShortcut: state.screenshotShortcut,
        autoPlaySpeed: state.autoPlaySpeed,
        chapterDelay: state.chapterDelay,
        autoSkipPages: state.autoSkipPages,
      }),
    },
  ),
);
