'use client';

import { useState } from 'react';
import { ArrowLeft, Copy, Star, Trash2 } from 'lucide-react';
import type { Project } from '@/lib/types';
import { slugify, uid } from '@/lib/utils';
import { AddButton, Area, Field, IconBtn, RowControls, Select, TabHeader, Text, Toggle, move } from './fields';
import { MediaField } from './media';
import BlockEditor from './BlockEditor';
import { MediaLibrary } from './media';

export interface DraftProject extends Project {
  _originalSlug?: string;
}

interface ProjectsTabProps {
  projects: DraftProject[];
  onChange: (projects: DraftProject[]) => void;
  onDelete: (slug: string) => void;
}

const STATUSES = ['in-progress', 'active', 'completed', 'shipped'] as const;

function ProjectEditor({
  project,
  projects,
  onChange,
  onBack,
}: {
  project: DraftProject;
  projects: DraftProject[];
  onChange: (p: DraftProject) => void;
  onBack: () => void;
}) {
  const set = <K extends keyof Project>(key: K, value: Project[K]) =>
    onChange({ ...project, [key]: value });
  const slugTaken = projects.some((p) => p !== project && p.slug === project.slug);
  const [showMedia, setShowMedia] = useState(false);

  return (
    <div>
      <button onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-mute hover:text-accent">
        <ArrowLeft size={14} /> All projects
      </button>
      <TabHeader title={project.title || 'Untitled project'} subtitle={`/projects/${project.slug}`} />

      <div className="flex flex-col gap-8">
        <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Slug" hint={slugTaken ? '⚠ Slug already in use' : 'Lowercase letters, numbers, dashes.'}>
            <Text value={project.slug} onChange={(v) => set('slug', slugify(v) || v)} />
          </Field>
          <Field label="Title"><Text value={project.title} onChange={(v) => set('title', v)} /></Field>
          <div className="md:col-span-2">
            <Field label="Subtitle"><Text value={project.subtitle} onChange={(v) => set('subtitle', v)} /></Field>
          </div>
          <Field label="Role"><Text value={project.role} onChange={(v) => set('role', v)} /></Field>
          <Field label="Timeframe"><Text value={project.timeframe} onChange={(v) => set('timeframe', v)} /></Field>
          <Field label="Status">
            <Select value={project.status} options={STATUSES} onChange={(v) => set('status', v)} />
          </Field>
          <Field label="Status label (optional)">
            <Text value={project.statusLabel ?? ''} onChange={(v) => set('statusLabel', v || undefined)} />
          </Field>
          <Field label="Domain"><Text value={project.domain} onChange={(v) => set('domain', v)} /></Field>
          <Field label="Tags (comma-separated)">
            <Text
              value={project.tags.join(', ')}
              onChange={(v) => set('tags', v.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle checked={project.featured} onChange={(v) => set('featured', v)} label="Featured on home" />
          </div>
        </section>

        <section>
          <MediaField label="Cover" scope={project.slug} value={project.cover} onChange={(m) => m && set('cover', m)} />
        </section>

        <section>
          <Field label="Pitch (one-liner)"><Area rows={2} value={project.pitch} onChange={(v) => set('pitch', v)} /></Field>
        </section>

        <section>
          <Field label="Highlights (one per line)">
            <Area
              rows={6}
              value={project.highlights.join('\n')}
              onChange={(v) => set('highlights', v.split('\n').filter((s) => s.trim()))}
            />
          </Field>
        </section>

        <section>
          <span className="label">Link buttons</span>
          {project.links.map((link, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <input className="input" value={link.label} onChange={(e) => set('links', project.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))} placeholder="GitHub" />
              <input className="input" value={link.url} onChange={(e) => set('links', project.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))} placeholder="https://github.com/..." />
              <RowControls
                canUp={i > 0}
                canDown={i < project.links.length - 1}
                onUp={() => set('links', move(project.links, i, i - 1))}
                onDown={() => set('links', move(project.links, i, i + 1))}
                onDelete={() => set('links', project.links.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <AddButton label="Add link" onClick={() => set('links', [...project.links, { label: '', url: '' }])} />
        </section>

        <section>
          <span className="label">Progress steps</span>
          {(project.progress?.steps ?? []).map((step, i) => {
            const steps = project.progress!.steps;
            return (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input className="input" value={step.label} onChange={(e) => set('progress', { steps: steps.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)) })} placeholder="Step" />
                <div className="w-32 shrink-0">
                  <Select value={step.state} options={['done', 'current', 'todo'] as const} onChange={(v) => set('progress', { steps: steps.map((s, j) => (j === i ? { ...s, state: v } : s)) })} />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < steps.length - 1}
                  onUp={() => set('progress', { steps: move(steps, i, i - 1) })}
                  onDown={() => set('progress', { steps: move(steps, i, i + 1) })}
                  onDelete={() => {
                    const next = steps.filter((_, j) => j !== i);
                    set('progress', next.length ? { steps: next } : undefined);
                  }}
                />
              </div>
            );
          })}
          <AddButton
            label="Add step"
            onClick={() => set('progress', { steps: [...(project.progress?.steps ?? []), { label: '', state: 'todo' }] })}
          />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <span className="label !mb-0">Content blocks</span>
          </div>
          <BlockEditor blocks={project.blocks} scope={project.slug} onChange={(blocks) => set('blocks', blocks)} />
        </section>

        <section>
          <button onClick={() => setShowMedia((v) => !v)} className="btn-ghost !min-h-0 !px-4 !py-2 text-[13px]">
            {showMedia ? 'Hide' : 'Show'} media library ({project.slug})
          </button>
          {showMedia && (
            <div className="mt-4">
              <MediaLibrary scope={project.slug} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ProjectsTab({ projects, onChange, onDelete }: ProjectsTabProps) {
  const [editing, setEditing] = useState<string | null>(null);

  const reorder = (from: number, to: number) => {
    const next = move(projects, from, to).map((p, i) => ({ ...p, order: i + 1 }));
    onChange(next);
  };

  const current = editing ? projects.find((p) => p.slug === editing) : null;
  if (current) {
    return (
      <ProjectEditor
        project={current}
        projects={projects}
        onBack={() => setEditing(null)}
        onChange={(updated) => {
          onChange(projects.map((p) => (p === current || p.slug === editing ? updated : p)));
          if (updated.slug !== editing) setEditing(updated.slug);
        }}
      />
    );
  }

  return (
    <div>
      <TabHeader title="Projects" subtitle="Reorder with the arrows; order drives every project list." />
      <div className="flex flex-col gap-3">
        {projects.map((project, i) => (
          <div key={project.slug} className="card flex items-center gap-3 p-4">
            <button
              type="button"
              onClick={() =>
                onChange(projects.map((p) => (p === project ? { ...p, featured: !p.featured } : p)))
              }
              aria-label={project.featured ? 'Unfeature' : 'Feature'}
              title="Featured"
              className={project.featured ? 'text-accent' : 'text-ink-mute hover:text-ink'}
            >
              <Star size={16} fill={project.featured ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={() => setEditing(project.slug)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{project.title || '(untitled)'}</span>
                <span className="pill !py-0.5">{project.statusLabel || project.status}</span>
              </div>
              <span className="font-mono text-[11px] text-ink-mute">/{project.slug} · order {project.order}</span>
            </button>
            <IconBtn
              label="Duplicate"
              onClick={() => {
                const copy: DraftProject = JSON.parse(JSON.stringify(project));
                copy.slug = `${project.slug}-copy`;
                copy.title = `${project.title} (copy)`;
                copy.order = projects.length + 1;
                copy.featured = false;
                delete copy._originalSlug;
                copy.blocks = copy.blocks.map((b) => ({ ...b, id: uid() }));
                onChange([...projects, copy]);
              }}
            >
              <Copy size={13} />
            </IconBtn>
            <RowControls
              canUp={i > 0}
              canDown={i < projects.length - 1}
              onUp={() => reorder(i, i - 1)}
              onDown={() => reorder(i, i + 1)}
              onDelete={() => {
                if (confirm(`Delete "${project.title}"? This removes its content file on save.`)) {
                  onDelete(project.slug);
                }
              }}
            />
          </div>
        ))}
      </div>
      <AddButton
        label="New project"
        onClick={() => {
          const stub: DraftProject = {
            slug: `new-project-${projects.length + 1}`,
            title: 'New project',
            subtitle: '',
            role: '',
            timeframe: '',
            status: 'in-progress',
            featured: false,
            order: projects.length + 1,
            domain: '',
            tags: [],
            cover: { kind: 'image', src: '', alt: '' },
            links: [],
            pitch: '',
            highlights: [],
            blocks: [{ id: uid(), type: 'text', md: '' }],
          };
          onChange([...projects, stub]);
          setEditing(stub.slug);
        }}
      />
      <p className="mt-6 font-mono text-[10px] text-ink-mute">
        Trash icon deletes a project. Deletions and slug renames apply when you press Save.
      </p>
    </div>
  );
}
