import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the sidebar navigation and home overview", async () => {
    render(<App />);

    // 首页是动态 import，等待首个异步 chunk 落地（侧栏本身是同步渲染的）
    expect(await screen.findByRole("link", { name: "首页" })).toBeInTheDocument();
    expect(screen.getByText("Cat Library")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "图片" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "视频" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "游戏" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("ZeroCat 沉浸式资源索引台")).toBeInTheDocument();
  });
});
