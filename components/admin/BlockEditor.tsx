'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Plus } from 'lucide-react';
import type { Block, BlockState, LogEntry, MediaRef, ProjectLink } from '@/lib/types';
import { detectIcon, uid } from '@/lib/utils';
import { Area, IconBtn, RowControls, Select, Text, move } from './fields';
import { MediaField, MediaPicker } from './media';

const BLOCK_TYPES = [
  'heading', 'text', 'image', 'gallery', 'video', 'specTable',
  'bullets', 'quote', 'linkRow', 'roadmap', 'log',
] as const;

function newBlock(type: string): Block {
  const id = uid();
  switch (type) {
    case 'heading': return { id, type, text: '' };
    case 'text': return { id, type, md: '' };
    case 'image': return { id, type, media: { kind: 'image', src: '', alt: '' } };
    case 'gallery': return { id, type, items: [] };
    case 'video': return { id, type, media: { kind: 'video', src: '', alt: '' } };
    case 'specTable': return { id, type, rows: [{ label: '', value: '' }] };
    case 'bullets': return { id, type, items: [''] };
    case 'quote': return { id, type, text: '' };
    case 'linkRow': return { id, type, links: [] };
    case 'roadmap': return { id, type, stages: [] };
    case 'log': return { id, type, entries: [] };
    default: return { id, type };
  }
}

function GalleryEditor({ items, scope, onChange }: { items: MediaRef[]; scope: string; onChange: (items: MediaRef[]) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <div>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-[10px] text-ink-mute">{item.kind}</span>
            <input className="input" value={item.src} onChange={(e) => onChange(items.map((m, j) => (j === i ? { ...m, src: e.target.value } : m)))} placeholder="/media/..." />
            <input className="input" value={item.alt ?? ''} onChange={(e) => onChange(items.map((m, j) => (j === i ? { ...m, alt: e.target.value } : m)))} placeholder="Alt" />
            <RowControls
              canUp={i > 0}
              canDown={i < items.length - 1}
              onUp={() => onChange(move(items, i, i - 1))}
              onDown={() => onChange(move(items, i, i + 1))}
              onDelete={() => onChange(items.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setPicking(true)} className="btn-ghost mt-3 !min-h-0 !px-3 !py-1.5 text-[12px]">
        + Add media
      </button>
      {picking && (
        <MediaPicker scope={scope} onPick={(m) => onChange([...items, m])} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

function LinksEditor({ links, onChange }: { links: ProjectLink[]; onChange: (links: ProjectLink[]) => void }) {
  return (
    <div>
      <div className="flex flex-col gap-2">
        {links.map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input" value={link.label} onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))} placeholder="Label" />
            <input className="input" value={link.url} onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, url: e.target.value, icon: detectIcon(e.target.value) } : l)))} placeholder="https://..." />
            <RowControls
              canUp={i > 0}
              canDown={i < links.length - 1}
              onUp={() => onChange(move(links, i, i - 1))}
              onDown={() => onChange(move(links, i, i + 1))}
              onDelete={() => onChange(links.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...links, { label: '', url: '' }])} className="btn-ghost mt-3 !min-h-0 !px-3 !py-1.5 text-[12px]">
        + Add link
      </button>
    </div>
  );
}

function BlockBody({ block, scope, onChange }: { block: Block; scope: string; onChange: (b: Block) => void }) {
  switch (block.type) {
    case 'heading':
      return <Text value={(block as { text: string }).text} onChange={(v) => onChange({ ...block, text: v } as Block)} placeholder="Section heading" />;
    case 'text':
      return <Area rows={6} value={(block as { md: string }).md} onChange={(v) => onChange({ ...block, md: v } as Block)} />;
    case 'image':
    case 'video': {
      const media = (block as { media: MediaRef }).media;
      return (
        <div className="flex flex-col gap-3">
          <MediaField label="Media" scope={scope} value={media} onChange={(m) => m && onChange({ ...block, media: m } as Block)} />
          {block.type === 'video' && (
            <p className="font-mono text-[10px] text-ink-mute">
              Paste a YouTube/Vimeo URL via Choose → Use URL for embeds.
            </p>
          )}
          <input className="input" value={media.caption ?? ''} onChange={(e) => onChange({ ...block, media: { ...media, caption: e.target.value } } as Block)} placeholder="Caption (optional)" />
        </div>
      );
    }
    case 'gallery':
      return <GalleryEditor items={(block as { items: MediaRef[] }).items} scope={scope} onChange={(items) => onChange({ ...block, items } as Block)} />;
    case 'specTable': {
      const rows = (block as { rows: { label: string; value: string }[] }).rows;
      return (
        <div>
          {rows.map((row, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <input className="input !w-1/3" value={row.label} onChange={(e) => onChange({ ...block, rows: rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)) } as Block)} placeholder="Label" />
              <input className="input" value={row.value} onChange={(e) => onChange({ ...block, rows: rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)) } as Block)} placeholder="Value" />
              <RowControls
                canUp={i > 0}
                canDown={i < rows.length - 1}
                onUp={() => onChange({ ...block, rows: move(rows, i, i - 1) } as Block)}
                onDown={() => onChange({ ...block, rows: move(rows, i, i + 1) } as Block)}
                onDelete={() => onChange({ ...block, rows: rows.filter((_, j) => j !== i) } as Block)}
              />
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...block, rows: [...rows, { label: '', value: '' }] } as Block)} className="btn-ghost !min-h-0 !px-3 !py-1.5 text-[12px]">
            + Add row
          </button>
        </div>
      );
    }
    case 'bullets': {
      const b = block as { heading?: string; items: string[] };
      return (
        <div className="flex flex-col gap-2">
          <input className="input" value={b.heading ?? ''} onChange={(e) => onChange({ ...block, heading: e.target.value || undefined } as Block)} placeholder="Heading (optional)" />
          <Area rows={5} value={b.items.join('\n')} onChange={(v) => onChange({ ...block, items: v.split('\n').filter((s) => s.trim()) } as Block)} />
          <p className="font-mono text-[10px] text-ink-mute">One bullet per line.</p>
        </div>
      );
    }
    case 'quote': {
      const b = block as { text: string; attribution?: string };
      return (
        <div className="flex flex-col gap-2">
          <Area rows={2} value={b.text} onChange={(v) => onChange({ ...block, text: v } as Block)} />
          <input className="input" value={b.attribution ?? ''} onChange={(e) => onChange({ ...block, attribution: e.target.value || undefined } as Block)} placeholder="Attribution (optional)" />
        </div>
      );
    }
    case 'linkRow':
      return <LinksEditor links={(block as { links: ProjectLink[] }).links} onChange={(links) => onChange({ ...block, links } as Block)} />;
    case 'roadmap': {
      const stages = (block as { stages: { n: number; title: string; desc: string; status: BlockState }[] }).stages;
      return (
        <div>
          {stages.map((stage, i) => (
            <div key={i} className="mb-3 flex items-start gap-2">
              <div className="grid flex-1 grid-cols-[50px_1fr_130px] gap-2">
                <input className="input" type="number" value={stage.n} onChange={(e) => onChange({ ...block, stages: stages.map((s, j) => (j === i ? { ...s, n: Number(e.target.value) } : s)) } as Block)} />
                <input className="input" value={stage.title} onChange={(e) => onChange({ ...block, stages: stages.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) } as Block)} placeholder="Title" />
                <Select value={stage.status} options={['done', 'in-progress', 'next', 'future'] as const} onChange={(v) => onChange({ ...block, stages: stages.map((s, j) => (j === i ? { ...s, status: v } : s)) } as Block)} />
                <textarea className="textarea col-span-3 !min-h-[50px]" value={stage.desc} onChange={(e) => onChange({ ...block, stages: stages.map((s, j) => (j === i ? { ...s, desc: e.target.value } : s)) } as Block)} placeholder="Description" />
              </div>
              <RowControls
                canUp={i > 0}
                canDown={i < stages.length - 1}
                onUp={() => onChange({ ...block, stages: move(stages, i, i - 1) } as Block)}
                onDown={() => onChange({ ...block, stages: move(stages, i, i + 1) } as Block)}
                onDelete={() => onChange({ ...block, stages: stages.filter((_, j) => j !== i) } as Block)}
              />
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...block, stages: [...stages, { n: stages.length + 1, title: '', desc: '', status: 'future' as BlockState }] } as Block)} className="btn-ghost !min-h-0 !px-3 !py-1.5 text-[12px]">
            + Add stage
          </button>
        </div>
      );
    }
    case 'log': {
      const entries = (block as { entries: LogEntry[] }).entries;
      return (
        <div>
          {entries.map((entry, i) => (
            <div key={i} className="card mb-3 p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 grid-cols-[130px_1fr] gap-2">
                  <input className="input" value={entry.date} onChange={(e) => onChange({ ...block, entries: entries.map((en, j) => (j === i ? { ...en, date: e.target.value } : en)) } as Block)} placeholder="2026-07" />
                  <input className="input" value={entry.title} onChange={(e) => onChange({ ...block, entries: entries.map((en, j) => (j === i ? { ...en, title: e.target.value } : en)) } as Block)} placeholder="Milestone title" />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < entries.length - 1}
                  onUp={() => onChange({ ...block, entries: move(entries, i, i - 1) } as Block)}
                  onDown={() => onChange({ ...block, entries: move(entries, i, i + 1) } as Block)}
                  onDelete={() => onChange({ ...block, entries: entries.filter((_, j) => j !== i) } as Block)}
                />
              </div>
              <textarea className="textarea mt-2 !min-h-[60px]" value={entry.md} onChange={(e) => onChange({ ...block, entries: entries.map((en, j) => (j === i ? { ...en, md: e.target.value } : en)) } as Block)} placeholder="Markdown body" />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...block,
                entries: [
                  { date: new Date().toISOString().slice(0, 7), title: '', md: '' },
                  ...entries,
                ],
              } as Block)
            }
            className="btn-ghost !min-h-0 !px-3 !py-1.5 text-[12px]"
          >
            + New entry
          </button>
        </div>
      );
    }
    default:
      return <p className="font-mono text-xs text-ink-mute">Unknown block type: {block.type}</p>;
  }
}

export default function BlockEditor({
  blocks,
  scope,
  onChange,
}: {
  blocks: Block[];
  scope: string;
  onChange: (blocks: Block[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div>
      <div className="flex flex-col gap-3">
        {blocks.map((block, i) => {
          const isOpen = open[block.id] ?? false;
          return (
            <div key={block.id} className="card">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [block.id]: !isOpen }))}
                  className="flex flex-1 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={14} className="text-ink-mute" /> : <ChevronRight size={14} className="text-ink-mute" />}
                  <span className="pill !py-0.5">{block.type}</span>
                  <span className="truncate font-mono text-[11px] text-ink-mute">
                    {'text' in block && typeof block.text === 'string' ? block.text.slice(0, 60) : ''}
                    {'md' in block && typeof block.md === 'string' ? (block.md as string).slice(0, 60) : ''}
                  </span>
                </button>
                <IconBtn
                  label="Duplicate"
                  onClick={() => {
                    const copy = JSON.parse(JSON.stringify(block)) as Block;
                    copy.id = uid();
                    const next = [...blocks];
                    next.splice(i + 1, 0, copy);
                    onChange(next);
                  }}
                >
                  <Copy size={13} />
                </IconBtn>
                <RowControls
                  canUp={i > 0}
                  canDown={i < blocks.length - 1}
                  onUp={() => onChange(move(blocks, i, i - 1))}
                  onDown={() => onChange(move(blocks, i, i + 1))}
                  onDelete={() => {
                    if (confirm(`Delete this ${block.type} block?`)) {
                      onChange(blocks.filter((b) => b.id !== block.id));
                    }
                  }}
                />
              </div>
              {isOpen && (
                <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="pt-4">
                    <BlockBody
                      block={block}
                      scope={scope}
                      onChange={(b) => onChange(blocks.map((x) => (x.id === b.id ? b : x)))}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative mt-4">
        <button type="button" onClick={() => setMenuOpen((v) => !v)} className="btn-ghost !min-h-0 !px-4 !py-2 text-[13px]">
          <Plus size={14} /> Add block
        </button>
        {menuOpen && (
          <div className="card absolute z-20 mt-2 flex w-56 flex-col p-1.5">
            {BLOCK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  const block = newBlock(type);
                  onChange([...blocks, block]);
                  setOpen((o) => ({ ...o, [block.id]: true }));
                  setMenuOpen(false);
                }}
                className="rounded-sm px-3 py-1.5 text-left font-mono text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
