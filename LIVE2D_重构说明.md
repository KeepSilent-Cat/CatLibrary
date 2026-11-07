# Live2D 渲染重构 — 交接说明

> 目标：把 Cat Library 的 Live2D 模型预览，从 pixi.js + untitled-pixi-live2d-engine（第三方引擎，
> 与 Cubism 5 模型不兼容，反复踩坑）**换成 Live2D 官方 Cubism Web Framework 原生渲染**。
> 官方代码直接用 fetch 拉模型、用 `<img>` 加载贴图，都走 Tauri asset 协议原生路径，不再依赖第三方引擎。

---

## 一、这次改了什么（一句话）

Live2D 渲染链路整体换成官方 Cubism Web Framework 5-r.5 + 官方 Sample 渲染代码，删掉 pixi.js 和 untitled 引擎。

---

## 二、文件改动清单

### 新增（官方 SDK 源码，除非懂 Cubism，否则不要手改）
```
src/live2d/framework/                    官方 Framework 源码（约 40 个 .ts）
src/live2d/sample/                       官方 Sample 渲染代码（13 个 .ts）
                                          └─ 内部的 @framework/* 已改成 ../framework/*（相对路径）
src/live2d/live2dcubismcore.d.ts         Core 全局类型声明（让 TS 认识 window.Live2DCubismCore）
public/shaders/                          13 个 WebGL shader（.frag / .vert），随 dist 打包
src/components/Live2DViewer.tsx          （重写）官方渲染版组件
```

### 修改过的官方文件（关键适配点，别人接手要理解）
```
src/live2d/sample/lappdefine.ts
  ├─ ShaderPath 改为 '/shaders/'（原来是官方 SDK 的相对路径，Tauri 下用绝对路径）
  └─ 新增 ModelEntries 动态模型配置 + setModelEntries()（替代官方写死的 ModelDir）

src/live2d/sample/lapplive2dmanager.ts
  └─ changeScene() 改用 ModelEntries[index].dir + .json（原来是 ModelDir + ResourcesPath 拼路径）

src/live2d/sample/lappdelegate.ts
  ├─ initialize(container) 接受容器参数，canvas 挂到组件容器而非 document.body
  ├─ 新增 changeModel(index) 切换模型
  └─ 新增 isModelReady() 判断模型是否加载完成

src/live2d/framework/rendering/cubismoffscreenrendertarget_webgl.ts
  └─ _gl 字段加 declare 修饰符（修 TS2612：子类字段覆盖基类字段的报错）
```

### 删除
```
scripts/patch-untitled-engine.cjs      （旧的 untitled 引擎补丁脚本）
package.json 里的 "postinstall" 脚本
dependencies 里的 pixi.js、untitled-pixi-live2d-engine
```

---

## 三、重新构建打包（精确命令，按顺序）

> 顺序绝对不能错：**先 npm build（生成 dist），再 cargo build（把 dist 嵌进 exe）**。
> 反过来会导致 exe 里是旧前端。

### 方式 A：git-bash（MSYS，本机默认 shell）

```bash
# 1) 前端构建（tsc 类型检查 + vite 打包 → dist/）
cd /cygdrive/d/mvp_project/Cat_library
cmd //c "cd /d D:\mvp_project\Cat_library && D:\nodejs\22_15_0\npm.cmd run build"

# 2) 杀掉正在运行的 exe（不杀会报 cargo 拒绝访问 / os error 5）
cmd //c "taskkill /F /IM cat_library.exe"

# 3) 后端构建（Tauri → release exe）
cd src-tauri
touch build.rs
cargo build --release
```

### 方式 B：Windows cmd / PowerShell（如果接手的人不用 git-bash）

```cmd
cd /d D:\mvp_project\Cat_library
D:\nodejs\22_15_0\npm.cmd run build
taskkill /F /IM cat_library.exe
cd src-tauri
cargo build --release
```

### 产物位置
```
D:\mvp_project\Cat_library\src-tauri\target\release\cat_library.exe
```

### 如果重装依赖（npm install）
```bash
# 必须指定 npmmirror 镜像，默认源会 ECONNRESET 卡死
cmd //c "cd /d D:\mvp_project\Cat_library && D:\nodejs\22_15_0\npm.cmd install --registry=https://registry.npmmirror.com"
```

---

## 四、路径 / 资源注意事项（最容易踩的地方）

1. **模型路径必须走 convertFileSrc，且 %5C 换成 /**
   - Tauri 的 `convertFileSrc()` 会把 Windows 反斜杠 `\` 编码成 `%5C`，会破坏后续拼接。
   - `Live2DViewer.tsx` 里的 `parseModelPath()` 已经处理：`convertFileSrc(path).replace(/%5C/gi, "/")`。
   - 目录 URL 是从「完整文件 URL」里切出来的（保证 dir + 文件名 恒等于原始 URL），不要改成单独对目录调用 convertFileSrc。

2. **shader 路径是 `/shaders/`（绝对路径，相对 dist 根）**
   - `lappdefine.ts` 里 `ShaderPath = '/shaders/'`。
   - 13 个 shader 在 `public/shaders/`，vite 会自动复制到 `dist/shaders/`。
   - 如果 shader 加载失败（模型透明/不显示），先检查 `dist/shaders/` 是否真有 13 个文件。

3. **Cubism Core 用 public 里的现成文件，按需注入**
   - `public/live2dcubismcore.min.js` 是官方 5-r.5 完整版（228042 字节）。
   - 它**不再**写在 `index.html` 里（那会让每次启动都白白解析 228 KB），改由 `Live2DViewer` 在真正打开模型页时动态插入 `<script src="/live2dcubismcore.min.js">`，见 `ensureCubismCore()`。
   - 这个文件不要删、不要换版本（模型是 Cubism 5 / MOC3 06，必须配 5.x Core）。

4. **模型数据在 `D:\CatLibrary\library` 里（见下节），不是项目里的文件**
   - 项目里没有任何模型文件，模型靠运行时从 library 目录读。

---

## 五、数据保留（⚠️ 最重要，绝对不能动）

```
D:\CatLibrary\library\    ← 用户的全部数据（图片/漫画/视频/Live2D/截图等所有条目），
                            这是数据库 + 资源库，构建、改代码、重装依赖都跟它无关，
                            任何情况下都不要删除、移动、改名、清空它。

示例模型（数据的一部分，别动）：
D:\CatLibrary\library\live2d\live2d_1\source\model\demo3_step7.model3.json
```

- 构建/打包只影响 `D:\mvp_project\Cat_library\` 下的 `dist\` 和 `src-tauri\target\`，可以随便删了重建。
- `cargo clean`、`npm run build`、`npm install` 都不会碰 `D:\CatLibrary\library`。
- 但如果接手的人写代码涉及文件删除/移动，务必确认路径前缀不是 `D:\CatLibrary\`。

---

## 六、关键数据流（别人要扩展功能时看这里）

```
Live2DPanel.tsx
  └─ invoke("list_live2d_sources") → 返回 model3[]（.model3.json 完整 Windows 路径数组）
      └─ <Live2DViewer modelPaths={model3} />

Live2DViewer.tsx（由 Live2DPanel 通过 React.lazy 懒加载）
  └─ toModelEntry()：把每个路径拆成 { dir: '…/目录/', json: 'xxx.model3.json', label }
  └─ ensureCubismCore()：按需注入 /live2dcubismcore.min.js（无 CDN）
  └─ setModelEntries(entries)  →  注入官方渲染
  └─ LAppDelegate.getInstance().initialize(container)  →  建 canvas + WebGL
  └─ LAppDelegate.getInstance().run()  →  渲染循环
  └─ 切换模型：LAppDelegate.changeModel(index)
  └─ 轮询 isModelReady() 判断加载完成（20 秒超时提示）
  └─ 卸载：LAppDelegate.releaseInstance() + 清空容器
```

官方渲染链：`LAppDelegate` → `LAppSubdelegate`（WebGL 上下文）→ `LAppLive2DManager`（模型管理）→ `LAppModel`（单个模型加载 + 绘制）。

---

## 七、常见错误排查

| 现象 | 原因 | 排查方向 |
|------|------|----------|
| 模型完全黑屏/透明 | shader 没加载 | 检查 `dist/shaders/` 是否有 13 个文件；ShaderPath 是否 `/shaders/` |
| 报 `Live2DCubismCore` 找不到 | Core 没加载 | 检查 `public/live2dcubismcore.min.js` 是否存在、`dist/` 里有没有同名文件；看控制台是否报 `/live2dcubismcore.min.js` 加载失败 |
| 模型不显示但无报错 | 模型路径 404 | 打开 DevTools 看 fetch 请求，确认 asset URL 能返回 200 |
| 贴图加载失败 | 路径拼接被 %5C 破坏 | 确认走的是 `convertFileSrc(...).replace(/%5C/gi, "/")` |
| 模型能显示但点击/拖拽位置偏 | 官方 Sample 用 document 全局事件 + offsetLeft | 后续可把事件监听从 document 改到 canvas，用 getBoundingClientRect 算坐标 |
| tsc 报 TS2612 字段覆盖 | 官方代码与 TS 5.8 + useDefineForClassFields 冲突 | 子类重声明基类字段时加 `declare` 修饰符 |

---

## 八、遗留 / 可继续做的事

1. **动作播放列表**：现在只有官方自带的「点击播动作」，没有 UI 上的动作下拉列表。要加的话在 `LAppModel` 上暴露 motion 列表（`_modelSetting.getMotionGroupName()/getMotionCount()`），参考旧版 Live2DViewer 的解析逻辑。
2. **缩放/重置视角**：官方 Sample 通过 `LAppView` 的 viewMatrix 缩放，需要暴露接口；目前没接。
3. **交互坐标**：官方 Sample 的 pointer 事件挂在 document 上（全局），在 Tauri 里坐标可能偏移，建议改成监听 canvas 本身。
4. ~~模型切换时清除旧模型~~：已处理，`LAppLive2DManager.releaseAllModel()` 现在会调用 `model.release()`（包了 try/catch，加载中的模型失败也不影响切换）。

> 2026-11 补充：`Live2DViewer.tsx` 已彻底改写为官方 framework 版本（原文件一度还是 pixi + CDN 的旧实现，与本文档描述不符）。
> 同时修掉了几个会直接崩的官方 Sample 适配问题：`lappglmanager` 的 `alert()`、`lappview` 在缺样例图时的空引用、
> `lappdelegate` 的 rAF 循环在 React StrictMode 重挂载后仍继续跑（新增 `_released` 标记）。
