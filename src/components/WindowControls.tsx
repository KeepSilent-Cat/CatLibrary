import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function canUseTauriWindow() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function withWindow(action: (windowHandle: ReturnType<typeof getCurrentWindow>) => Promise<void>) {
  if (!canUseTauriWindow()) {
    return;
  }

  await action(getCurrentWindow());
}

function ControlButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => Promise<void>;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void onClick()}
      data-no-drag="true"
      className={className}
    >
      {children}
    </button>
  );
}

export default function WindowControls() {
  return (
    <div className="flex items-center gap-2" data-tauri-drag-region="false">
      <ControlButton
        label="最小化"
        onClick={() => withWindow((appWindow) => appWindow.minimize())}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/80 transition hover:bg-white/20"
      >
        <Minus className="h-4 w-4" />
      </ControlButton>

      <ControlButton
        label="最大化"
        onClick={() =>
          withWindow(async (appWindow) => {
            const isMaximized = await appWindow.isMaximized();
            if (isMaximized) {
              await appWindow.unmaximize();
            } else {
              await appWindow.maximize();
            }
          })
        }
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/80 transition hover:bg-white/20"
      >
        <Square className="h-3.5 w-3.5" />
      </ControlButton>

      <ControlButton
        label="关闭"
        onClick={() => withWindow((appWindow) => appWindow.close())}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-300/30 bg-rose-400/20 text-rose-50 transition hover:bg-rose-400/35"
      >
        <X className="h-4 w-4" />
      </ControlButton>
    </div>
  );
}
