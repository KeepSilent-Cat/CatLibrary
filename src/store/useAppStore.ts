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

/** 画板面板类型：素材引用 / 报道引用 / 纯文字注释 */
export type BoardPanelKind = "item" | "report" | "text";

/** 文字面板的三档字号 */
export type BoardTextStyle = "title" | "subtitle" | "caption";

export interface BoardPanel {
  id: string;
  kind: BoardPanelKind;
  /** kind=item 时：素材分类 */
  category?: CategoryKey;
  /** kind=item 时是素材 id；kind=report 时是报道 id */
  itemId?: string;
  /** kind=text 时的文字内容 */
  text?: string;
  textStyle?: BoardTextStyle;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一块画板 = 一套布局，可以建多个并随时切换 */
export interface Board {
  id: string;
  name: string;
  panels: BoardPanel[];
  createdAt: number;
  updatedAt: number;
}

/** 截图保存目标：截图库，或某游戏的封面目录 */
export type ScreenshotTarget =
  | { type: "library" }
  | { type: "game-cover"; groupId: string };

interface AppState {
  resourceRootHistory:string[];
  movedMediaPaths:Record<string,string>;
  rememberMediaMove:(from:string,to:string)=>void;
  extraRatings:Record<string,ContentRating>;
  setExtraRating:(key:string,rating:ContentRating)=>void;
  resourceRoot: string;
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
  toggleFavorite: (category: CategoryKey | "board" | "reports", itemId: string) => void;
  // 画板（工作台）：可以建多个，每个有自己的布局；面板只引用素材库/报道，或写文字
  boards: Board[];
  activeBoardId: string;
  createBoard: (name?: string) => string;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
  setActiveBoard: (id: string) => void;
  addBoardPanel: (
    kind: BoardPanelKind,
    payload: { category?: CategoryKey; itemId?: string; text?: string; textStyle?: BoardTextStyle },
  ) => void;
  removeBoardPanel: (id: string) => void;
  moveBoardPanel: (id: string, x: number, y: number) => void;
  resizeBoardPanel: (id: string, w: number, h: number) => void;
  updateBoardPanelText: (id: string, text: string) => void;
  updateBoardPanelTextStyle: (id: string, textStyle: BoardTextStyle) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      resourceRootHistory:[],
      movedMediaPaths:{},
      rememberMediaMove:(from,to)=>set(state=>({movedMediaPaths:{...state.movedMediaPaths,[from]:to}})),
      resourceRoot: "d:\\CatLibrary\\library",
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
      extraRatings:{},
      setExtraRating:(key,rating)=>set(state=>({extraRatings:{...state.extraRatings,[key]:rating}})),
      favoriteIds: [],
      boards: [],
      activeBoardId: "",
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
      setResourceRoot: (value) => set(state=>({resourceRoot:value,resourceRootHistory:[...new Set([...state.resourceRootHistory,...(state.resourceRoot!==value?[state.resourceRoot]:[])])]})),
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
      createBoard: (name) => {
        const id = `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        set((state) => ({
          boards: [
            ...state.boards,
            {
              id,
              name: (name ?? "").trim() || `画板 ${state.boards.length + 1}`,
              panels: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          activeBoardId: id,
        }));
        return id;
      },
      renameBoard: (id, name) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === id
              ? { ...board, name: name.trim() || board.name, updatedAt: Date.now() }
              : board,
          ),
        })),
      deleteBoard: (id) =>
        set((state) => {
          const boards = state.boards.filter((board) => board.id !== id);
          return {
            boards,
            activeBoardId:
              state.activeBoardId === id ? (boards[0]?.id ?? "") : state.activeBoardId,
          };
        }),
      setActiveBoard: (id) => set({ activeBoardId: id }),
      addBoardPanel: (kind, payload) =>
        set((state) => {
          const board =
            state.boards.find((entry) => entry.id === state.activeBoardId) ?? state.boards[0];
          if (!board) {
            return {};
          }

          const offset = board.panels.length % 5;
          const panel: BoardPanel = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            kind,
            category: payload.category,
            itemId: payload.itemId,
            text: payload.text ?? (kind === "text" ? "" : undefined),
            textStyle: payload.textStyle ?? (kind === "text" ? "caption" : undefined),
            x: 32 + offset * 44,
            y: 32 + offset * 44,
            w: kind === "text" ? 380 : 460,
            h: kind === "text" ? 170 : 340,
          };

          return {
            boards: state.boards.map((entry) =>
              entry.id === board.id
                ? { ...entry, panels: [...entry.panels, panel], updatedAt: Date.now() }
                : entry,
            ),
          };
        }),
      removeBoardPanel: (id) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id !== state.activeBoardId
              ? board
              : { ...board, panels: board.panels.filter((panel) => panel.id !== id), updatedAt: Date.now() },
          ),
        })),
      moveBoardPanel: (id, x, y) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id !== state.activeBoardId
              ? board
              : {
                  ...board,
                  panels: board.panels.map((panel) => (panel.id === id ? { ...panel, x, y } : panel)),
                  updatedAt: Date.now(),
                },
          ),
        })),
      resizeBoardPanel: (id, w, h) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id !== state.activeBoardId
              ? board
              : {
                  ...board,
                  panels: board.panels.map((panel) => (panel.id === id ? { ...panel, w, h } : panel)),
                  updatedAt: Date.now(),
                },
          ),
        })),
      updateBoardPanelText: (id, text) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id !== state.activeBoardId
              ? board
              : {
                  ...board,
                  panels: board.panels.map((panel) => (panel.id === id ? { ...panel, text } : panel)),
                  updatedAt: Date.now(),
                },
          ),
        })),
      updateBoardPanelTextStyle: (id, textStyle) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id !== state.activeBoardId
              ? board
              : {
                  ...board,
                  panels: board.panels.map((panel) =>
                    panel.id === id ? { ...panel, textStyle } : panel,
                  ),
                  updatedAt: Date.now(),
                },
          ),
        })),
    }),
    {
      name: "zerocat-settings",
      partialize: (state) => ({
        resourceRootHistory:state.resourceRootHistory,
        movedMediaPaths:state.movedMediaPaths,
        resourceRoot: state.resourceRoot,
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
        extraRatings:state.extraRatings,
        favoriteIds: state.favoriteIds,
        wallpaper: state.wallpaper,
        boards: state.boards,
        activeBoardId: state.activeBoardId,

        gameEmbed: state.gameEmbed,
        screenshotShortcut: state.screenshotShortcut,
        autoPlaySpeed: state.autoPlaySpeed,
        chapterDelay: state.chapterDelay,
        autoSkipPages: state.autoSkipPages,
      }),
      merge: (saved, current) => ({ ...current, ...(saved as Partial<AppState>), ratingFilter: 0 }),
      version: 2,
      // 旧版只有一个画板，面板存在 boardPanels 里；升级时包装成「画板 1」
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 2) {
          return state as never;
        }
        const legacyPanels = Array.isArray(state.boardPanels) ? state.boardPanels : [];
        const board = {
          id: `board-${Date.now().toString(36)}`,
          name: "画板 1",
          panels: (legacyPanels as Array<Record<string, unknown>>).map((panel) => ({
            ...panel,
            kind: "item",
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        delete state.boardPanels;
        return { ...state, boards: [board], activeBoardId: board.id } as never;
      },
    },
  ),
);
