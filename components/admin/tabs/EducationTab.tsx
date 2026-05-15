'use client';

import type { Education } from '@/lib/types';
import { TabHeader } from '../Field';

export default function EducationTab({
  value,
  onChange,
}: {
  value: Education[];
  onChange: (v: Education[]) => void;
}) {
  const set = (i: number, patch: Partial<Education>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([...value, { school: '', degree: '', details: '', coursework: '' }]);

  return (
    <div>
      <TabHeader title="Education" subtitle="Schools, degrees, and coursework." />
      <div className="space-y-4">
        {value.map((e, i) => (
          <div key={i} className="card p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <span className="label">School</span>
                <input className="input" value={e.school} onChange={(ev) => set(i, { school: ev.target.value })} />
              </div>
              <div>
                <span className="label">Degree</span>
                <input className="input" value={e.degree} onChange={(ev) => set(i, { degree: ev.target.value })} />
              </div>
              <div className="md:col-span-2">
                <span className="label">Details (GPA, dates, honors)</span>
                <input className="input" value={e.details} onChange={(ev) => set(i, { details: ev.target.value })} />
              </div>
              <div className="md:col-span-2">
                <span className="label">Coursework</span>
                <textarea className="textarea" value={e.coursework} onChange={(ev) => set(i, { coursework: ev.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, 1)} disabled={i === value.length - 1}>↓</button>
              <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => remove(i)}>delete</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="btn-secondary mt-4">+ Add education</button>
    </div>
  );
}
