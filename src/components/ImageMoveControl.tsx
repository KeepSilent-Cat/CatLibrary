import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadLibraryIndex, clearLibraryIndexCache } from '@/lib/library-source';
import type { LibraryItem } from '@/data/library';
import { useAppStore } from '@/store/useAppStore';
export default function ImageMoveControl({ paths, groupId, onMoved, initialPath }: {
    paths: string[];
    initialPath?: string;
    groupId: string;
    onMoved: () => void;
}) { const root = useAppStore(s => s.resourceRoot), filter = useAppStore(s => s.ratingFilter); const [open, setOpen] = useState(false), [items, setItems] = useState<LibraryItem[]>([]), [source, setSource] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''); useEffect(() => { if (open)
    loadLibraryIndex(root).then(i => setItems(i.images.filter(x => x.id !== groupId && x.rating <= filter))).catch(e => setMessage(String(e))); }, [open, root, groupId, filter]); return <><button className="rounded-full border border-white/20 px-3 py-1 text-xs" onClick={() => { setOpen(true); setSource(initialPath ?? ''); setMessage(''); }}>移动单张图片</button>{open && <div role="dialog" aria-label="移动图片到其他合集" className="fixed inset-0 z-[80] grid place-items-center bg-black/70"><section className="w-[560px] max-w-[95vw] space-y-4 rounded-3xl bg-slate-900 p-6"><h2>移动图片到其他合集</h2><p>实际移动本地原文件，不是复制。应用内报道引用会跟随更新；应用之外使用原路径的位置需自行调整。目标同名文件不会被覆盖。</p><select className="w-full bg-slate-800 p-2" aria-label="选择单张图片" value={source} onChange={e => setSource(e.target.value)}><option value="">请选择要移动的单张图片</option>{paths.map((p, i) => <option key={p} value={p}>{i + 1} · {p.split(/[\\/]/).pop()}</option>)}</select><select className="w-full bg-slate-800 p-2" aria-label="目标合集" value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择目标合集</option>{items.map(i => <option key={i.id} value={i.id}>{i.altName || i.title}</option>)}</select><p className="break-all text-xs">{source}</p><p role="status">{message}</p><button disabled={busy || !source || !target} onClick={async () => { setBusy(true); try {
    const movedPath=await invoke<string>('move_image_to_collection', { resourceRoot: root, sourceGroup: groupId, targetGroup: target, sourcePath: source });
    useAppStore.getState().rememberMediaMove(source,movedPath);
    clearLibraryIndexCache(root);
    setOpen(false);
    onMoved();
}
catch (e) {
    setMessage(String(e));
}
finally {
    setBusy(false);
} }}>确认移动原文件</button><button disabled={busy} className="ml-5" onClick={() => setOpen(false)}>取消</button></section></div>}</>; }
