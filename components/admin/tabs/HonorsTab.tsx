'use client';

import type { Honor } from '@/lib/types';
import { TabHeader } from '../Field';

export default function HonorsTab({
  value,
  onChange,
}: {
  value: Honor[];
  onChange: (v: Honor[]) => void;
}) {
  const set = (i: number, patch: Partial<Honor>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { title: '', year: '', note: '' }]);

  return (
    <div>
      <TabHeader title="Honors" subtitle="Awards and recognition." />
      <div className="space-y-3">
        {value.map((h, i) => (
          <div key={i} className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_120px_auto]">
            <div>
              <span className="label">Title</span>
              <input className="input" value={h.title} onChange={(e) => set(i, { title: e.target.value })} />
            </div>
            <div>
              <span className="label">Year</span>
              <input className="input" value={h.year} onChange={(e) => set(i, { year: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, 1)} disabled={i === value.length - 1}>↓</button>
              <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => remove(i)}>delete</button>
            </div>
            <div className="md:col-span-3">
              <span className="label">Note</span>
              <input className="input" value={h.note} onChange={(e) => set(i, { note: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="btn-secondary mt-4">+ Add honor</button>
    </div>
  );
}
