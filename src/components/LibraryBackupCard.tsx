import { ArchiveRestore, Check, FolderArchive, FolderOpen, HardDriveDownload, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as selectBackup } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/useAppStore";
import "./library-preferences.css";

export default function LibraryBackupCard() {
  const root = useAppStore(state => state.resourceRoot);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<Record<string, string | null> | null>(null);
  const restoreDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (snapshot && restoreDialog.current && !restoreDialog.current.open) restoreDialog.current.showModal(); }, [snapshot]);
  const prepare = async () => {
    setBusy(true); setError(""); setNote("");
    try {
      const settings = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]));
      setNote(await invoke<string>("prepare_portable_backup", { resourceRoot: root, settingsJson: JSON.stringify(settings) }));
    } catch (e) { setError(`备份准备失败：${String(e)}`); }
    finally { setBusy(false); }
  };
  const chooseSnapshot = async () => {
    setError(""); setBusy(true);
    try {
      const path = await selectBackup({ multiple: false, filters: [{ name: "设置快照", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      setSnapshot(JSON.parse(await invoke<string>("read_backup_settings", { path })) as Record<string, string | null>);
    } catch (e) { setError(`读取快照失败：${String(e)}`); }
    finally { setBusy(false); }
  };
  const restore = () => {
    if (!snapshot) return;
    const previous = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]));
    try {
      localStorage.clear();
      for (const [key, value] of Object.entries(snapshot)) if (typeof value === "string") localStorage.setItem(key, value);
    } catch (e) {
      localStorage.clear();
      for (const [key, value] of Object.entries(previous)) if (value !== null) localStorage.setItem(key, value);
      setError(`恢复失败，已保留原设置：${String(e)}`); setSnapshot(null); return;
    }
    location.reload();
  };
  return <section className="glass-panel settings-backup-card rounded-[32px] p-6" aria-labelledby="backup-heading">
    <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/20 bg-white/8 text-sky-100"><FolderArchive size={21} strokeWidth={1.5} /></span><div><h2 id="backup-heading" className="text-lg font-semibold text-white">备份与迁移</h2><p className="mt-0.5 text-xs text-white/45">先保存配置，再带走整座藏馆</p></div></div>
    <p className="mt-5 text-sm leading-7 text-white/65">保存收藏、画板与偏好的检查点。素材不会在这里被复制，完成后会告诉你该带走哪个完整目录。</p>
    <div className="mt-5 rounded-[20px] border border-white/12 bg-white/5 px-4 py-3"><p className="mb-1.5 flex items-center gap-2 text-[11px] text-white/40"><FolderOpen size={12} />当前资源库</p><p className="break-all text-xs leading-6 text-white/75">{root}</p></div>
    <ol className="my-5 grid grid-cols-3 gap-2 text-center text-[11px] text-white/55">{["保存检查点", "退出程序", "复制完整目录"].map((step, index) => <li key={step} className="rounded-2xl bg-white/5 px-1 py-3"><span className="mb-2 block text-sky-100/60">0{index + 1}</span>{step}</li>)}</ol>
    <div className="flex flex-wrap gap-2"><button className="library-primary-button flex-1 whitespace-nowrap" disabled={busy} onClick={() => void prepare()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <HardDriveDownload size={16} />}保存备份检查点</button><button className="library-secondary-button whitespace-nowrap" disabled={busy} onClick={() => void chooseSnapshot()}><ArchiveRestore size={15} />恢复设置</button></div>
    <p className="mt-3 text-[11px] leading-6 text-white/40">换电脑后，可从 web-settings.json 恢复收藏和偏好。</p>
    {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-200/20 bg-rose-200/5 p-3 text-xs leading-6 text-rose-100">{error}</p>}
    {note && <div role="status" className="mt-4 rounded-[20px] border border-sky-100/18 bg-white/6 p-4 text-xs leading-6 text-white/70"><p className="flex items-center gap-2 text-sky-100"><Check size={14} />检查点已保存，素材尚未复制</p><p className="mt-2 break-all">{note.split('\n').find(line => line.includes('请正常退出应用后'))}</p><details className="mt-3"><summary className="cursor-pointer text-white/50">查看保存位置与迁移说明</summary><pre className="mt-3 whitespace-pre-wrap break-all font-sans text-[11px] leading-6 text-white/60">{note}</pre></details></div>}
    {snapshot && <dialog ref={restoreDialog} className="library-preference-dialog" aria-labelledby="restore-heading" onCancel={e => { e.preventDefault(); setSnapshot(null); }}><div className="relative p-8"><button className="absolute right-5 top-5 p-2 text-white/50" aria-label="取消恢复设置" onClick={() => setSnapshot(null)}><X size={17} /></button><ArchiveRestore size={28} className="mb-5 text-sky-100/80" /><h2 id="restore-heading" className="text-xl font-semibold">恢复这份设置快照？</h2><p className="mt-3 text-sm leading-7 text-white/60">收藏、画板和偏好将恢复到快照中的状态，随后重新载入界面。素材文件不会被移动或覆盖。</p><div className="mt-7 flex gap-3"><button className="library-secondary-button flex-1" onClick={() => setSnapshot(null)}>取消</button><button className="library-primary-button flex-1" onClick={restore}>确认恢复</button></div></div></dialog>}
  </section>;
}
