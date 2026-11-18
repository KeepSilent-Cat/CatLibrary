import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; title?: string; onClose?: () => void };
type State = { error: Error | null };

/**
 * 兜底错误边界：工作台这类重型界面的渲染错误不应该把整个应用变成黑屏，
 * 这里捕获后显示原因和「返回」，其余功能仍可用。
 */
export default class StudioErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[studio]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-[#0b0910] px-6 text-center text-white">
        <p className="text-sm font-semibold text-rose-200">{this.props.title ?? "界面出错了"}</p>
        <p className="max-w-xl break-all text-[11px] leading-5 text-white/45">{String(error.message)}</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onClose?.();
          }}
          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white/80 transition hover:bg-white/16"
        >
          返回
        </button>
      </div>
    );
  }
}
