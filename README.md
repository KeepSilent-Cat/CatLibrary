<div align="center">

# Cat Library

**把散落在磁盘里的喜欢，收进一座自己的藏馆。**

本地素材管理 · 沉浸式浏览 · Windows 桌面应用

[![版本](https://img.shields.io/badge/version-0.2.2-8eb5ae?style=flat-square)](docs/2026-11-13-random-music.md)
![Tauri 2](https://img.shields.io/badge/Tauri-2-243847?style=flat-square)
![React 18](https://img.shields.io/badge/React-18-243847?style=flat-square)
![Windows](https://img.shields.io/badge/platform-Windows-243847?style=flat-square)

[**查看介绍与下载安装 →**](https://www.echolnk.top/?page=cases&project=catlibrary) · [更新说明](docs/2026-11-13-random-music.md) · [备份与迁移](docs/备份与迁移.md)

</div>

---

不懂代码、想直接使用？请前往上方的**介绍与下载页面**。这个 GitHub 仓库提供应用源码，不附带作者的私人素材库；网站展示与源码版本可能存在更新时间差。

Cat Library 面向保存在本地磁盘上的图片、小说、漫画、音乐、视频、游戏与 Live2D。用统一的玻璃界面浏览内容，按标签、分级和收藏整理，让素材保持在自己的文件夹中。

| 浏览 | 整理 | 带走 |
| :--- | :--- | :--- |
| 首页随机轮播，手动左右切换；进入详情查看原始内容 | 单图跨合集移动、全板块收藏、画板与报道 | 保存设置检查点，再复制整个便携目录到移动硬盘 |
| 音乐详情页完整播放，离开后变为悬浮播放器 | 默认全年龄模式；解锁后查看更高分级 | 迁移说明明确标出需要复制的目录与设置恢复方法 |

应用默认负责**索引与展示**，不会自动重排原文件。只有明确确认移动、删除等整理操作时才会修改素材。内容分级和访问密码用于日常展示保护，不是文件加密；能直接访问磁盘的人仍可读取文件。

## 功能一览

| 分类 | 能力 |
| --- | --- |
| 图片 | 卡片流、悬停轮播预览、原图查看、设为应用背景 |
| 视频 | 自适应/自定义卡片尺寸、分页、封面裁剪或完整显示、悬停预览（30 秒循环/停住/完整）、声音策略 |
| 游戏 | 目录分组、自动发现 exe、**嵌入游戏窗口**（失败回退独立窗口）、Web 游戏直启、多封面 |
| 漫画 | 章节扫描、压缩包导入解压、章节重命名与链式重排、多季分组、4 种阅读模式、自动滚屏连播、整章翻译对照编辑 |
| 截图 | 全局快捷键 + 系统抓屏 + 裁剪保存，可存进截图库或某游戏封面目录 |
| 音乐 | 专辑/歌单分桶、内置播放器、自定义封面 |
| Live2D | 官方 Cubism framework 渲染、模型切换、PSD 画稿查看 |

公共能力：内容分级（全年龄 / R15 / 18+，默认隐藏标记内容）、自定义标签筛选、收藏、画板（自由摆放的素材工作台）、自定义壁纸、元数据写回资源库父目录的 `data/metadata.json`。

## 素材库目录约定

资源根目录（在「设置」里配置，默认 `d:\CatLibrary\library`）下的结构：

```
<资源根目录>
├─ images/       images_1/{cover/, source/}
├─ videos/       video_1/{cover/, source/}
├─ games/        game_1/{cover/, source/}          # source 里放游戏本体
├─ comics/       comic_1/{cover/, source/ch01/…}   # 一个章节目录一层
├─ screenshots/  screenshot_1/{cover/, source/}
├─ music/        music_1/{cover/, source/}
├─ live2d/       live2d_1/{cover/, source/psd/, source/model/}
├─ novels/       novel_1/{cover/, source/}
└─ reports/      <id>/report.json 与附带素材
```

- `cover/` 放封面图（可选，缺省会从 `source/` 里找第一张图；游戏优先找 `cover/poster/title/icon`）。
- `source/` 放真实素材；游戏可以是单个可执行文件，也可以是整个游戏目录。
- 条目编号从 1 开始自动分配，删除后空位会被复用。
- 标题、简介、标签、分级保存在资源库父目录的 `data/metadata.json` 中；报道保存在 `reports/<id>/report.json`，收藏、画板与偏好可通过设置中的检查点导出。

## 开发与构建

```bash
npm install            # 安装前端依赖
npm run dev            # 仅前端，http://localhost:1420（浏览器里没有 Tauri 能力，只能看界面）
npm run dev:tauri      # 桌面应用开发模式（推荐）
npm run check          # tsc 类型检查
npm run test           # vitest
npm run build          # 前端产物 → dist/
npm run build:tauri    # 完整打包（会先跑 npm run build）
```

> 顺序要点：`tauri build` 会把 `dist/` 嵌进 exe。如果手动分步构建，必须**先 `npm run build`，再 `cargo build --release`**，反过来 exe 里就是旧前端。

产物位置：`src-tauri/target/release/cat_library.exe`，安装包在 `src-tauri/target/release/bundle/`。

## 目录结构

```
src/
├─ App.tsx              路由（页面全部动态 import）
├─ components/          通用组件（卡片、查看器、播放器、截图层…）
├─ pages/               7 个页面
├─ store/useAppStore.ts 全局状态（zustand + localStorage 持久化）
├─ lib/library-source.ts 与 Rust 后端的数据通道
├─ live2d/              官方 Cubism 5 Web SDK（framework + sample，已适配）
└─ data/library.ts      类型与分类元数据
src-tauri/
├─ src/lib.rs           全部后端命令（扫描、导入、漫画章节、游戏启动、截图…）
└─ tauri.conf.json      窗口、CSP、asset 协议配置
```

## Live2D

渲染走 **Live2D 官方 Cubism Web Framework**（`src/live2d/`），完全不依赖 CDN：

- Core 运行时是本地文件 `public/live2dcubismcore.min.js`，由 `Live2DViewer` 在真正打开时按需注入。
- 着色器随构建产物一起打包在 `public/shaders/`。
- 模型放进 `live2d/live2d_N/source/model/`，需要包含 `xxx.model3.json` 及其引用的 moc3、贴图。
- 细节见 [LIVE2D_重构说明.md](LIVE2D_重构说明.md)。

## 安全说明

- 已配置 CSP（生产环境不含 `unsafe-inline` 脚本），开发环境走独立的 `devCsp`。
- `assetProtocol.scope` 只放行应用数据目录；素材库根目录在**运行期**由后端在扫描时动态授权（`allow_asset_root`），不再使用 `"**"` 全盘放行。
- 所有文件操作都在 Rust 侧，前端只拿 asset URL 或 base64。

## 已知限制

- 仅 Windows 验证过（截图用 GDI、游戏嵌入用 Win32 API）。
- Live2D 需要 WebGL2；启动参数已放开 GPU 黑名单并允许软件渲染兜底。
- 首次扫描大库（几万文件）有明显耗时，缩略图是首次访问时生成并缓存在应用数据目录。

## 许可

第三方 SDK 的授权见各自目录：`src/live2d/` 为 Live2D Open Software License，`ag-psd` 等为 MIT。
