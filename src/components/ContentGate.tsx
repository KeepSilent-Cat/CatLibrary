import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { CategoryKey, LibraryItem } from '@/data/library';
import { loadLibraryIndex } from '@/lib/library-source';
import { useAppStore } from '@/store/useAppStore';
export default function ContentGate({ category, children }: {
    category: CategoryKey | 'reports';
    children: ReactNode;
}) { const { itemId, reportId } = useParams(), root = useAppStore(s => s.resourceRoot), filter = useAppStore(s => s.ratingFilter), ratings = useAppStore(s => s.extraRatings); const [item, setItem] = useState<LibraryItem | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''); useEffect(() => { let live = true; if (category === 'reports') {
    setLoading(false);
    return;
} setLoading(true); setItem(null); loadLibraryIndex(root).then(i => { if (live)
    setItem(i[category].find(x => x.id === itemId) ?? null); }).catch(e => { if (live)
    setError(String(e)); }).finally(() => { if (live)
    setLoading(false); }); return () => { live = false; }; }, [root, category, itemId]); if (error)
    return <p className="p-6">{error}</p>; if (loading)
    return <p className="p-6">正在确认显示范围…</p>; const allowed = category === 'reports' ? (ratings['reports/' + reportId] ?? 2) <= filter : !!item && item.id===itemId && item.rating <= filter; if (!allowed)
    return <p className="p-6">此内容不在当前显示范围内。请前往设置解锁后查看。</p>; return <>{children}</>; }
