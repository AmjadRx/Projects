'use client';

import type { SkillGroup, SkillTier, Skills } from '@/lib/types';
import { TabHeader } from '../Field';

export default function SkillsTab({
  value,
  onChange,
}: {
  value: Skills;
  onChange: (v: Skills) => void;
}) {
  const set = (i: number, patch: Partial<SkillGroup>) => {
    const next = [...value.groups];
    next[i] = { ...next[i], ...patch };
    onChange({ groups: next });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.groups.length) return;
    const next = [...value.groups];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ groups: next });
  };
  const remove = (i: number) =>
    onChange({ groups: value.groups.filter((_, idx) => idx !== i) });
  const add = () =>
    onChange({
      groups: [...value.groups, { title: 'New group', tier: 'strong', items: [] }],
    });

  return (
    <div>
      <TabHeader title="Skills" subtitle="Capability groups. Deep = cyan, strong = purple." />
      <div className="space-y-4">
        {value.groups.map((g, i) => (
          <div key={i} className="card p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_auto]">
              <div>
                <span className="label">Title</span>
                <input
                  className="input"
                  value={g.title}
                  onChange={(e) => set(i, { title: e.target.value })}
                />
              </div>
              <div>
                <span className="label">Tier</span>
                <select
                  className="input"
                  value={g.tier}
                  onChange={(e) => set(i, { tier: e.target.value as SkillTier })}
                >
                  <option value="deep">deep</option>
                  <option value="strong">strong</option>
                </select>
              </div>
              <div className="flex items-end gap-1">
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => move(i, 1)} disabled={i === value.groups.length - 1}>↓</button>
                <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => remove(i)}>delete</button>
              </div>
            </div>
            <div className="mt-3">
              <span className="label">Items (comma-separated)</span>
              <input
                className="input"
                value={g.items.join(', ')}
                onChange={(e) =>
                  set(i, {
                    items: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <button onClick={add} className="btn-secondary mt-4">+ Add skill group</button>
    </div>
  );
}
