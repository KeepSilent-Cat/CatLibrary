import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ViewerErrorBoundary from "./ViewerErrorBoundary";

describe("viewer loading isolation", () => {
  it("can import the viewer before Cubism Core exists", async () => {
    expect(window.Live2DCubismCore).toBeUndefined();
    const module = await import("./Live2DViewer");
    expect(typeof module.default).toBe("function");
  });
  it("contains renderer failures instead of unmounting the page", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never { throw new Error("renderer unavailable"); }
    try {
      render(<div><nav>资料导航</nav><ViewerErrorBoundary><Broken /></ViewerErrorBoundary></div>);
      expect(screen.getByRole("alert").textContent).toContain("renderer unavailable");
      expect(screen.getByText("资料导航")).toBeTruthy();
    } finally { log.mockRestore(); }
  });
});
