import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function canUseTauriWindow() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default function WindowDragBar({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const handlePointerDown = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag='true']")) {
      return;
    }

    if (!canUseTauriWindow()) {
      return;
    }

    await getCurrentWindow().startDragging();
  };

  return (
    <div
      className={className}
      data-tauri-drag-region
      onPointerDown={(event) => void handlePointerDown(event)}
    >
      {children}
    </div>
  );
}
