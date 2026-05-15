'use client';

import type { About } from '@/lib/types';
import { Field, TabHeader } from '../Field';

export default function AboutTab({
  value,
  onChange,
}: {
  value: About;
  onChange: (v: About) => void;
}) {
  const setPara = (i: number, v: string) => {
    const next = [...value.paragraphs];
    next[i] = v;
    onChange({ ...value, paragraphs: next });
  };
  const removePara = (i: number) => {
    const next = value.paragraphs.filter((_, idx) => idx !== i);
    onChange({ ...value, paragraphs: next });
  };
  const movePara = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.paragraphs.length) return;
    const next = [...value.paragraphs];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...value, paragraphs: next });
  };
  const addPara = () => onChange({ ...value, paragraphs: [...value.paragraphs, ''] });

  return (
    <div>
      <TabHeader title="About" subtitle="The bio block on the home page." />
      <div className="space-y-5">
        <Field label="Heading">
          <input className="input" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
        </Field>
        <div>
          <div className="label">Paragraphs</div>
          <div className="space-y-3">
            {value.paragraphs.map((p, i) => (
              <div key={i} className="card p-4">
                <textarea
                  className="textarea"
                  value={p}
                  onChange={(e) => setPara(i, e.target.value)}
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => movePara(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => movePara(i, 1)} disabled={i === value.paragraphs.length - 1}>↓</button>
                  <button className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400" onClick={() => removePara(i)}>delete</button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={addPara} className="btn-secondary mt-3">+ Add paragraph</button>
        </div>
      </div>
    </div>
  );
}
