import { Component, type ReactNode } from "react";

export default class ViewerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <div role="alert" className="rounded-xl border border-rose-300/30 p-5 text-sm text-rose-100"><p>查看器加载失败，其他页面仍可使用。</p><pre className="mt-3 whitespace-pre-wrap break-all">{this.state.error.message}</pre><button className="mt-4 rounded border px-3 py-2" onClick={() => window.location.reload()}>重新打开应用页面</button></div>;
    return this.props.children;
  }
}
