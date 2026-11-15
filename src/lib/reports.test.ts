import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

import { blocksFromMarkdown, reportFromBatchSource, type ReportAsset } from "./reports";

const assets: ReportAsset[] = [
  { name: "01.jpg", relativePath: "图片/01.jpg", path: "D:/x/图片/01.jpg", kind: "image", size: 1 },
  { name: "02.jpg", relativePath: "图片/02.jpg", path: "D:/x/图片/02.jpg", kind: "image", size: 1 },
  { name: "01.mp4", relativePath: "视频/01.mp4", path: "D:/x/视频/01.mp4", kind: "video", size: 1 },
];

describe("report markdown import", () => {
  it("把「**视频**：视频/01.mp4」变成视频块，而不是一行文本", () => {
    const blocks = blocksFromMarkdown("# 标题\n\n**视频**：视频/01.mp4\n", assets, "正文.md");
    const video = blocks.find((block) => block.type === "video");
    expect(video?.media?.path).toContain("视频/01.mp4");
    expect(blocks.some((block) => block.type === "text" && block.text?.includes("01.mp4"))).toBe(
      false,
    );
  });

  it("用图片语法引用视频时按视频出块", () => {
    const blocks = blocksFromMarkdown("![](视频/01.mp4)", assets, "正文.md");
    expect(blocks[0].type).toBe("video");
  });

  it("单独一行写媒体路径也能识别", () => {
    const blocks = blocksFromMarkdown("视频/01.mp4", assets, "正文.md");
    expect(blocks[0].type).toBe("video");
  });

  it("批量导入会把正文没引用到的视频补在末尾", () => {
    const report = reportFromBatchSource({
      reportId: "r1",
      title: "标题",
      markdown: "# 标题\n\n![](图片/01.jpg)\n",
      markdownRelativePath: "正文.md",
      root: "D:/x",
      assets,
    });
    expect(report.blocks.filter((block) => block.type === "video")).toHaveLength(1);
    expect(report.blocks.filter((block) => block.type === "image")).toHaveLength(2);
  });
});
