'use client';

import type { ExperienceItem } from '@/lib/types';
import { TabHeader } from '../Field';

export default function ExperienceTab({
  value,
  onChange,
}: {
  value: ExperienceItem[];
  onChange: (v: ExperienceItem[]) => void;
}) {
  const set = (i: number, patch: Partial<ExperienceItem>) => {
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
  const add = () =>
    onChange([
      ...value,
      { company: '', role: '', location: '', dates: '', bullets: [] },
    ]);

  return (
    <div>
      <TabHeader title="Experience" subtitle="Roles in the timeline." />
      <div className="space-y-4">
        {value.map((e, i) => (
          <div key={i} className="card p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <span className="label">Company</span>
                <input className="input" value={e.company} onChange={(ev) => set(i, { company: ev.target.value })} />
              </div>
              <div>
                <span className="label">Role</span>
                <input className="input" value={e.role} onChange={(ev) => set(i, { role: ev.target.value })} />
              </div>
              <div>
                <span className="label">Location</span>
                <input className="input" value={e.location} onChange={(ev) => set(i, { location: ev.target.value })} />
              </div>
              <div>
                <span className="label">Dates</span>
                <input className="input" value={e.dates} onChange={(ev) => set(i, { dates: ev.target.value })} />
              </div>
            </div>
            <div className="mt-3">
              <span className="label">Bullets (one per line)</span>
              <textarea
                className="textarea min-h-[120px]"
                value={e.bullets.join('\n')}
                onChange={(ev) =>
                  set(i, {
                    bullets: ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, 1)} disabled={i === value.length - 1}>↓</button>
              <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => remove(i)}>delete</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="btn-secondary mt-4">+ Add role</button>
    </div>
  );
}
