import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ContentRating } from "@/data/library";
import "./library-preferences.css";

export default function ContentUnlockDialog({ target, onClose, onUnlock }: {
  target: ContentRating | null; onClose: () => void; onUnlock: (rating: ContentRating) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setPassword(""); setVisible(false); setError("");
    if (target !== null && dialog.current && !dialog.current.open) { dialog.current.showModal(); dialog.current.querySelector<HTMLInputElement>("input")?.focus(); }
  }, [target]);
  if (target === null) return null;
  return <dialog ref={dialog} className="library-preference-dialog" aria-labelledby="unlock-heading"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <form className="relative p-8" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError("");
      try { if (await invoke<boolean>("verify_content_password", { password })) { onUnlock(target); onClose(); } else setError("密码不正确，请再试一次。"); }
      catch { setError("暂时无法验证，请稍后重试。"); }
      finally { setBusy(false); }
    }}>
      <button type="button" aria-label="关闭密码窗口" disabled={busy} onClick={onClose} className="absolute right-5 top-5 rounded-full border border-white/15 bg-white/6 p-2 text-white/55 transition hover:bg-white/14 hover:text-white"><X size={16} /></button>
      <div className="mb-6 grid h-14 w-14 place-items-center rounded-[20px] border border-sky-100/25 bg-sky-200/10 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"><LockKeyhole size={25} strokeWidth={1.4} /></div>
      <p className="text-xs tracking-[0.18em] text-white/45">内容显示范围</p>
      <h2 id="unlock-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">{target === 2 ? "打开完整藏馆" : "查看更多馆藏"}</h2>
      <p className="mt-3 text-sm leading-7 text-white/60">输入访问密码后，展示当前隐藏的内容。<br />关闭程序后，会重新回到全年龄模式。</p>
      <label htmlFor="content-password" className="mb-2 mt-7 block text-xs text-white/60">访问密码</label>
      <div className="flex items-center gap-3 rounded-2xl border border-white/22 bg-black/12 px-4 transition focus-within:border-sky-200/55 focus-within:ring-2 focus-within:ring-sky-200/10"><KeyRound size={17} className="shrink-0 text-white/35" /><input id="content-password" autoFocus autoComplete="off" type={visible ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="输入访问密码" className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30" /><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(v => !v)} className="p-1 text-white/45 hover:text-white">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
      <p role="alert" className="mt-3 min-h-5 text-xs text-rose-200">{error}</p>
      <div className="mt-5 flex gap-3"><button type="button" disabled={busy} onClick={onClose} className="library-secondary-button flex-1">暂不打开</button><button type="submit" disabled={busy || !password} className="library-primary-button flex-1">{busy ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={15} />}{busy ? "正在验证" : "解锁藏馆"}</button></div>
    </form>
  </dialog>;
}
