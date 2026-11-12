import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { loadReports, type Report, reportTitle } from '@/lib/reports';
import { ExtraFavorite } from './ExtraFavorite';
export default function ExtraFavorites({ kind }: {
    kind: 'board' | 'reports';
}) { const navigate = useNavigate(), root = useAppStore(s => s.resourceRoot), ids = useAppStore(s => s.favoriteIds), boards = useAppStore(s => s.boards), ratings = useAppStore(s => s.extraRatings), filter = useAppStore(s => s.ratingFilter), activate = useAppStore(s => s.setActiveBoard); const [reports, setReports] = useState<Report[]>([]), [error, setError] = useState(''); useEffect(() => { if (kind === 'reports')
    loadReports(root).then(setReports).catch(e => setError(String(e))); }, [kind, root]); const entries = kind === 'board' ? boards.map(b => ({ id: b.id, title: b.name })) : reports.map(r => ({ id: r.id, title: reportTitle(r) })); const visible = entries.filter(e => ids.includes(kind + '/' + e.id) && (ratings[kind + '/' + e.id] ?? 2) <= filter); return <div className="space-y-3 p-5"><p>{error || (!visible.length ? '当前显示范围内暂无收藏' : '')}</p>{visible.map(e => <div key={e.id} className="flex gap-4 rounded-2xl border border-white/20 p-4"><button onClick={() => { if (kind === 'board')
    activate(e.id); navigate(kind === 'board' ? '/board' : '/reports/' + e.id); }}>{e.title}</button><ExtraFavorite kind={kind} id={e.id}/></div>)}</div>; }
