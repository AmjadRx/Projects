'use client';

import type { Stat } from '@/lib/types';
import { TabHeader } from '../Field';

export default function StatsTab({
  value,
  onChange,
}: {
  value: Stat[];
  onChange: (v: Stat[]) => void;
}) {
  const upd = (i: number, patch: Partial<Stat>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const add = () => onChange([...value, { label: '', value: '' }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <TabHeader title="Stats" subtitle="The numeric tiles in the stats bar." />
      <div className="space-y-3">
        {value.map((s, i) => (
          <div key={i} className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <span className="label">Label</span>
              <input className="input" value={s.label} onChange={(e) => upd(i, { label: e.target.value })} />
            </div>
            <div>
              <span className="label">Value</span>
              <input className="input" value={s.value} onChange={(e) => upd(i, { value: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, 1)} disabled={i === value.length - 1}>↓</button>
              <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => remove(i)}>delete</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="btn-secondary mt-4">+ Add stat</button>
    </div>
  );
}
