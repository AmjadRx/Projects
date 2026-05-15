'use client';

import { useState } from 'react';
import type { Project, ProjectColor } from '@/lib/types';
import { TabHeader } from '../Field';

function JsonField<T>({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  hint?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const handle = (s: string) => {
    setText(s);
    try {
      const parsed = JSON.parse(s);
      setErr(null);
      onChange(parsed as T);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div>
      <span className="label">{label}</span>
      <textarea
        className="textarea min-h-[160px] font-mono text-xs"
        value={text}
        onChange={(e) => handle(e.target.value)}
      />
      <div className="mt-1 flex items-center justify-between">
        {hint && <span className="font-mono text-[10px] text-ink-mute">{hint}</span>}
        {err ? (
          <span className="font-mono text-[10px] text-red-400">⚠ {err}</span>
        ) : (
          <span className="font-mono text-[10px] text-cyan">✓ valid JSON</span>
        )}
      </div>
    </div>
  );
}

function ProjectEditor({
  project,
  index,
  total,
  onChange,
  onMove,
  onDelete,
}: {
  project: Project;
  index: number;
  total: number;
  onChange: (p: Project) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const upd = <K extends keyof Project>(k: K, v: Project[K]) => onChange({ ...project, [k]: v });

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className={`font-mono text-[10px] uppercase tracking-widest ${project.color === 'purple' ? 'text-purple' : 'text-cyan'}`}>
            {project.type || 'Project'}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-ink">{project.name || '(untitled)'}</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMove(index, -1); }}
            disabled={index === 0}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-30"
          >↑</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMove(index, 1); }}
            disabled={index === total - 1}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-30"
          >↓</button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${project.name}"?`)) onDelete();
            }}
            className="btn-secondary px-2 py-1 text-xs hover:!border-red-400/40 hover:!text-red-400"
          >delete</button>
          <span className="ml-2 font-mono text-xs text-ink-mute">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/8 px-5 py-5" style={{ borderTopColor: 'rgb(255 255 255 / 0.08)' }}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <span className="label">Slug</span>
              <input className="input" value={project.slug} onChange={(e) => upd('slug', e.target.value)} />
            </div>
            <div>
              <span className="label">Name</span>
              <input className="input" value={project.name} onChange={(e) => upd('name', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <span className="label">Subtitle</span>
              <input className="input" value={project.subtitle} onChange={(e) => upd('subtitle', e.target.value)} />
            </div>
            <div>
              <span className="label">Status</span>
              <input className="input" value={project.status} onChange={(e) => upd('status', e.target.value)} />
            </div>
            <div>
              <span className="label">Dates</span>
              <input className="input" value={project.dates} onChange={(e) => upd('dates', e.target.value)} />
            </div>
            <div>
              <span className="label">Type</span>
              <input className="input" value={project.type} onChange={(e) => upd('type', e.target.value)} />
            </div>
            <div>
              <span className="label">Color</span>
              <select
                className="input"
                value={project.color}
                onChange={(e) => upd('color', e.target.value as ProjectColor)}
              >
                <option value="cyan">cyan</option>
                <option value="purple">purple</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <span className="label">Tags (comma-separated)</span>
              <input
                className="input"
                value={project.tags.join(', ')}
                onChange={(e) => upd('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </div>
            <div className="md:col-span-2">
              <span className="label">Summary</span>
              <textarea
                className="textarea"
                value={project.summary}
                onChange={(e) => upd('summary', e.target.value)}
              />
            </div>
          </div>

          <JsonField
            label="Hero (pitch + highlights)"
            value={project.hero ?? { pitch: '', highlights: [] }}
            onChange={(v) => upd('hero', v as Project['hero'])}
            hint='{ "pitch": "…", "highlights": ["…", "…"] }'
          />

          <JsonField
            label="Sections"
            value={project.sections ?? []}
            onChange={(v) => upd('sections', v as Project['sections'])}
            hint='Array of { heading, body?, items? }'
          />

          <JsonField
            label="Roadmap"
            value={project.roadmap ?? []}
            onChange={(v) => upd('roadmap', v as Project['roadmap'])}
            hint='Array of { n, title, desc, status: "in-progress" | "next" | "future" }'
          />
        </div>
      )}
    </div>
  );
}

export default function ProjectsTab({
  value,
  onChange,
}: {
  value: Project[];
  onChange: (v: Project[]) => void;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const addProject = () => {
    const stub: Project = {
      slug: `new-project-${value.length + 1}`,
      name: 'New project',
      subtitle: '',
      status: 'Draft',
      dates: '',
      type: 'Project',
      color: 'cyan',
      summary: '',
      tags: [],
    };
    onChange([...value, stub]);
  };

  return (
    <div>
      <TabHeader
        title="Projects"
        subtitle="The home grid and every /projects/[slug] page. Drag-and-drop is via ↑/↓."
      />
      <div className="space-y-4">
        {value.map((p, i) => (
          <ProjectEditor
            key={`${p.slug}-${i}`}
            project={p}
            index={i}
            total={value.length}
            onChange={(next) => {
              const arr = [...value];
              arr[i] = next;
              onChange(arr);
            }}
            onMove={move}
            onDelete={() => onChange(value.filter((_, idx) => idx !== i))}
          />
        ))}
      </div>
      <button onClick={addProject} className="btn-secondary mt-5">+ Add project</button>
    </div>
  );
}
