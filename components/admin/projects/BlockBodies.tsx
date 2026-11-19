'use client';

/**
 * One body editor per block type (lib/schema.ts, ARCHITECTURE.md 4 and 13A). Each edits its block
 * immutably: a change returns a new block with the other keys as they were, and a value equal to
 * the stored one returns the same block (no undo step). Optional keys a body empties are removed
 * only where an empty value means the same as no value (the 3D views, a list that never existed).
 *
 * A block of a type the site does not know is shown read-only and saved unchanged.
 */
import type { ReactNode } from 'react';
import { parseEmbed } from '@/lib/media';
import type { Block, KnownBlock } from '@/lib/schema';
import { FilePickField } from '../media/index';
import type { EditOptions } from '../state/store';
import { FieldGrid } from '../ui/bits';
import { Field } from '../ui/Field';
import { CheckboxGroup, NumberField, Select, TextArea, TextField, Toggle, UrlField } from '../ui/inputs';
import { ListEditor } from '../ui/ListEditor';
import { LinksList, MediaInput, MediaListInput, StringList } from './fields';
import { withFields } from './logic';
import styles from './projects.module.css';

type Of<T extends KnownBlock['type']> = Extract<KnownBlock, { type: T }>;

export interface BodyProps<B> {
  block: B;
  /** The block's field path ("blocks[3]", "blocks[2].left[0]"). */
  path: string;
  /** The media folder for uploads: the project's slug as saved. */
  folder: string;
  onChange: (next: B, edit?: EditOptions) => void;
}

/** A list key that was absent stays absent when the owner empties it; one that existed keeps its empty list. */
function optionalList<T>(previous: readonly T[] | undefined, next: T[]): T[] | undefined {
  return next.length === 0 && previous === undefined ? undefined : next;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

function HeadingBody({ block, path, onChange }: BodyProps<Of<'heading'>>) {
  return <TextField path={`${path}.text`} label="Heading" value={block.text} onChange={(text, edit) => onChange(withFields(block, { text }), edit)} />;
}

function TextBody({ block, path, onChange }: BodyProps<Of<'text'>>) {
  return <TextArea path={`${path}.md`} label="Text" markdown rows={6} value={block.md} onChange={(md, edit) => onChange(withFields(block, { md }), edit)} />;
}

function BulletsBody({ block, path, onChange }: BodyProps<Of<'bullets'>>) {
  return (
    <>
      <TextField path={`${path}.heading`} label="Heading (optional)" value={block.heading} onChange={(heading, edit) => onChange(withFields(block, { heading }), edit)} />
      <StringList
        path={`${path}.items`}
        items={block.items}
        label="Bullets"
        itemName="Bullet"
        addLabel="Add bullet"
        onChange={(items, edit) => onChange(withFields(block, { items }), edit)}
      />
    </>
  );
}

function QuoteBody({ block, path, onChange }: BodyProps<Of<'quote'>>) {
  return (
    <>
      <TextArea path={`${path}.text`} label="Quote" rows={3} value={block.text} onChange={(text, edit) => onChange(withFields(block, { text }), edit)} />
      <TextField
        path={`${path}.attribution`}
        label="Attribution (optional)"
        value={block.attribution}
        onChange={(attribution, edit) => onChange(withFields(block, { attribution }), edit)}
      />
    </>
  );
}

function CalloutBody({ block, path, onChange }: BodyProps<Of<'callout'>>) {
  return (
    <>
      <Select
        path={`${path}.tone`}
        label="Tone"
        hint="A note reads as an aside; a status reads as where the work stands."
        value={block.tone}
        options={[
          { value: 'note', label: 'Note' },
          { value: 'status', label: 'Status' },
        ]}
        onChange={(tone, edit) => onChange(withFields(block, { tone }), edit)}
      />
      <TextArea path={`${path}.md`} label="Text" markdown rows={4} value={block.md} onChange={(md, edit) => onChange(withFields(block, { md }), edit)} />
    </>
  );
}

function CodeBody({ block, path, onChange }: BodyProps<Of<'code'>>) {
  return (
    <>
      <TextField
        path={`${path}.language`}
        label="Language"
        mono
        spellCheck={false}
        hint="A name such as c, cpp, python, or verilog. A name the highlighter does not know shows as plain text."
        value={block.language}
        onChange={(language, edit) => onChange(withFields(block, { language }), edit)}
      />
      <TextArea path={`${path}.code`} label="Code" mono rows={8} spellCheck={false} value={block.code} onChange={(code, edit) => onChange(withFields(block, { code }), edit)} />
      <UrlField
        path={`${path}.repoUrl`}
        label="Repository address (optional)"
        allow={['https']}
        hint="A public repository the code comes from."
        value={block.repoUrl}
        onChange={(repoUrl, edit) => onChange(withFields(block, { repoUrl }), edit)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

function ImageBody({ block, path, folder, onChange }: BodyProps<Of<'image'>>) {
  return (
    <MediaInput
      path={`${path}.media`}
      label="Image"
      accept={['image']}
      caption
      folder={folder}
      value={block.media}
      onChange={(media, edit) => onChange(withFields(block, { media }), edit)}
    />
  );
}

function GalleryBody({ block, path, folder, onChange }: BodyProps<Of<'gallery'>>) {
  return (
    <MediaListInput
      path={`${path}.items`}
      label="Gallery items"
      accept={['image', 'video', 'model']}
      folder={folder}
      value={block.items}
      onChange={(items, edit) => onChange(withFields(block, { items }), edit)}
    />
  );
}

/**
 * A video file (with its captions and poster, which the media field handles) or a YouTube or Vimeo
 * link: Choose opens the library, where a link can be pasted instead of a file.
 */
function VideoBody({ block, path, folder, onChange }: BodyProps<Of<'video'>>) {
  const media = block.media;
  const embed = media.kind === 'embed';
  const embedIssue = embed && media.src.trim() !== '' && parseEmbed(media.src) === null;
  return (
    <>
      <MediaInput
        path={`${path}.media`}
        label="Video"
        hint="A video file, or a YouTube or Vimeo link (Choose, then paste the link)."
        accept={['video', 'embed']}
        caption
        folder={folder}
        value={media}
        onChange={(next, edit) => onChange(withFields(block, { media: next }), edit)}
      />
      {embedIssue ? (
        <p className="adm-field__msg adm-field__msg--warning" role="status">
          This link is not a YouTube or Vimeo video the site can play. Choose the video again with its watch address.
        </p>
      ) : null}
      {embed ? null : (
        <Toggle
          path={`${path}.scrub`}
          label="Tie playback to scrolling"
          hint="On a desktop with motion allowed, scrolling moves the video; visitors can still play it normally."
          checked={block.scrub}
          onChange={(scrub, edit) => onChange(withFields(block, { scrub }), edit)}
        />
      )}
    </>
  );
}

const MODEL_VIEWS = [
  { value: 'realistic', label: 'Realistic' },
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'thermal', label: 'Thermal (illustration)' },
] as const;

function Model3dBody({ block, path, folder, onChange }: BodyProps<Of<'model3d'>>) {
  return (
    <>
      <MediaInput path={`${path}.media`} label="3D model" accept={['model']} folder={folder} value={block.media} onChange={(media, edit) => onChange(withFields(block, { media }), edit)} />
      <CheckboxGroup
        path={`${path}.views`}
        label="Views"
        hint="With none checked, the viewer offers all three."
        values={block.views}
        options={MODEL_VIEWS}
        onChange={(views, edit) => onChange(withFields(block, { views: views.length > 0 ? views : undefined }), edit)}
      />
      <Toggle
        path={`${path}.explode`}
        label="Offer the exploded view"
        hint="Shown only when the model has more than one named part."
        checked={block.explode}
        onChange={(explode, edit) => onChange(withFields(block, { explode }), edit)}
      />
      <ListEditor
        path={`${path}.callouts`}
        items={block.callouts}
        label="Callouts"
        addLabel="Add callout"
        emptyText="No callouts. Each one is a documented number the blueprint view draws as a leader."
        onChange={(callouts, edit) => onChange(withFields(block, { callouts: optionalList(block.callouts, callouts) }), edit)}
        newItem={() => ({ label: '', value: '' })}
        rowLabel={(c, i) => `${c.label} ${c.value}`.trim() || `Callout ${i + 1}`}
        renderRow={({ item, path: rowPath, update }) => (
          <FieldGrid columns={2}>
            <TextField path={`${rowPath}.label`} label="Label" value={item.label} onChange={(label, edit) => update(withFields(item, { label }), edit)} />
            <TextField path={`${rowPath}.value`} label="Value" value={item.value} onChange={(value, edit) => update(withFields(item, { value }), edit)} />
          </FieldGrid>
        )}
      />
    </>
  );
}

function DocumentBody({ block, path, folder, onChange }: BodyProps<Of<'document'>>) {
  return (
    <>
      <TextField path={`${path}.title`} label="Title (optional)" value={block.title} onChange={(title, edit) => onChange(withFields(block, { title }), edit)} />
      <MediaInput path={`${path}.media`} label="Document" accept={['document']} folder={folder} value={block.media} onChange={(media, edit) => onChange(withFields(block, { media }), edit)} />
    </>
  );
}

function AudioBody({ block, path, folder, onChange }: BodyProps<Of<'audio'>>) {
  return (
    <>
      <TextField path={`${path}.title`} label="Title (optional)" value={block.title} onChange={(title, edit) => onChange(withFields(block, { title }), edit)} />
      <MediaInput path={`${path}.media`} label="Audio" accept={['audio']} caption folder={folder} value={block.media} onChange={(media, edit) => onChange(withFields(block, { media }), edit)} />
    </>
  );
}

function CompareBody({ block, path, folder, onChange }: BodyProps<Of<'compare'>>) {
  return (
    <FieldGrid columns={2}>
      <MediaInput path={`${path}.before`} label="Before" accept={['image']} folder={folder} value={block.before} onChange={(before, edit) => onChange(withFields(block, { before }), edit)} />
      <MediaInput path={`${path}.after`} label="After" accept={['image']} folder={folder} value={block.after} onChange={(after, edit) => onChange(withFields(block, { after }), edit)} />
    </FieldGrid>
  );
}

function PanzoomBody({ block, path, folder, onChange }: BodyProps<Of<'panzoom'>>) {
  return (
    <MediaInput
      path={`${path}.media`}
      label="Drawing or schematic"
      accept={['image', 'document']}
      caption
      folder={folder}
      value={block.media}
      onChange={(media, edit) => onChange(withFields(block, { media }), edit)}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Layout and lists
// ---------------------------------------------------------------------------------------------

function SpecTableBody({ block, path, onChange }: BodyProps<Of<'specTable'>>) {
  return (
    <ListEditor
      path={`${path}.rows`}
      items={block.rows}
      label="Rows"
      addLabel="Add row"
      emptyText="No rows yet."
      onChange={(rows, edit) => onChange(withFields(block, { rows }), edit)}
      newItem={() => ({ label: '', value: '' })}
      rowLabel={(row, i) => row.label || `Row ${i + 1}`}
      renderRow={({ item, path: rowPath, update }) => (
        <FieldGrid columns={2}>
          <TextField path={`${rowPath}.label`} label="Label" value={item.label} onChange={(label, edit) => update(withFields(item, { label }), edit)} />
          <TextField path={`${rowPath}.value`} label="Value" value={item.value} onChange={(value, edit) => update(withFields(item, { value }), edit)} />
        </FieldGrid>
      )}
    />
  );
}

function LinkRowBody({ block, path, onChange }: BodyProps<Of<'linkRow'>>) {
  return <LinksList path={`${path}.links`} links={block.links} label="Links" onChange={(links, edit) => onChange(withFields(block, { links }), edit)} />;
}

const STAGE_STATUSES = [
  { value: 'done', label: 'Done' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'next', label: 'Next' },
  { value: 'future', label: 'Future' },
] as const;

function RoadmapBody({ block, path, onChange }: BodyProps<Of<'roadmap'>>) {
  return (
    <ListEditor
      path={`${path}.stages`}
      items={block.stages}
      label="Stages"
      addLabel="Add stage"
      defaultOpen={false}
      emptyText="No stages yet."
      onChange={(stages, edit) => onChange(withFields(block, { stages }), edit)}
      newItem={() => ({ n: block.stages.length + 1, title: '', desc: '', status: 'future' as const })}
      rowLabel={(stage, i) => `${stage.n}. ${stage.title}`.trim() || `Stage ${i + 1}`}
      renderRow={({ item, path: rowPath, update }) => (
        <>
          <FieldGrid columns={3}>
            <NumberField path={`${rowPath}.n`} label="Number" integer min={0} value={item.n} onChange={(n, edit) => n !== undefined && update(withFields(item, { n }), edit)} />
            <TextField path={`${rowPath}.title`} label="Title" value={item.title} onChange={(title, edit) => update(withFields(item, { title }), edit)} />
            <Select path={`${rowPath}.status`} label="Status" value={item.status} options={STAGE_STATUSES} onChange={(status, edit) => update(withFields(item, { status }), edit)} />
          </FieldGrid>
          <TextArea path={`${rowPath}.desc`} label="Description" rows={2} value={item.desc} onChange={(desc, edit) => update(withFields(item, { desc }), edit)} />
        </>
      )}
    />
  );
}

function LogBody({ block, path, folder, onChange }: BodyProps<Of<'log'>>) {
  return (
    <ListEditor
      path={`${path}.entries`}
      items={block.entries}
      label="Entries"
      addLabel="Add entry"
      defaultOpen={false}
      emptyText="No entries yet. The site lists them newest first."
      onChange={(entries, edit) => onChange(withFields(block, { entries }), edit)}
      newItem={() => ({ date: '', title: '', md: '' })}
      rowLabel={(entry, i) => [entry.date, entry.title].filter(Boolean).join(': ') || `Entry ${i + 1}`}
      renderRow={({ item, path: rowPath, update }) => (
        <>
          <FieldGrid columns={2}>
            <TextField
              path={`${rowPath}.date`}
              label="Date"
              mono
              hint="A year and month (2026-07) or a full date (2026-08-13)."
              value={item.date}
              onChange={(date, edit) => update(withFields(item, { date }), edit)}
            />
            <TextField path={`${rowPath}.title`} label="Title" value={item.title} onChange={(title, edit) => update(withFields(item, { title }), edit)} />
          </FieldGrid>
          <TextArea path={`${rowPath}.md`} label="Text" markdown rows={3} value={item.md} onChange={(md, edit) => update(withFields(item, { md }), edit)} />
          <MediaListInput
            path={`${rowPath}.media`}
            label="Photos and videos (optional)"
            accept={['image', 'video']}
            folder={folder}
            value={item.media}
            onChange={(media, edit) => update(withFields(item, { media: optionalList(item.media, media) }), edit)}
          />
        </>
      )}
    />
  );
}

function FileBody({ block, path, folder, onChange }: BodyProps<Of<'file'>>) {
  return (
    <>
      <TextField path={`${path}.label`} label="Label" value={block.label} onChange={(label, edit) => onChange(withFields(block, { label }), edit)} />
      <FilePickField path={`${path}.src`} label="File" folder={folder} value={block.src} onChange={(src, edit) => onChange(withFields(block, { src }), edit)} />
      <TextField path={`${path}.note`} label="Note (optional)" value={block.note} onChange={(note, edit) => onChange(withFields(block, { note }), edit)} />
    </>
  );
}

const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/;

function RepoBody({ block, path, onChange }: BodyProps<Of<'repo'>>) {
  const url = block.url.trim();
  return (
    <UrlField
      path={`${path}.url`}
      label="Repository address"
      allow={['https']}
      placeholder="https://github.com/owner/name"
      hint="A public GitHub repository. The card shows its name, description, language, and last update, or a plain link."
      issue={url !== '' && !GITHUB_REPO.test(url) ? 'Use https://github.com/owner/name; anything else shows as a plain link.' : null}
      value={block.url}
      onChange={(value, edit) => onChange(withFields(block, { url: value }), edit)}
    />
  );
}

function UnknownBody({ block, path }: { block: Block; path: string }) {
  return (
    <Field path={`${path}.type`} label="Kept as is" hint={`The site does not know the block type "${block.type}", so it shows nothing for it. The block is saved unchanged.`}>
      {(control) => (
        <pre id={control.id} className={styles.raw} tabIndex={0} aria-label="The block's stored content">
          {JSON.stringify(block, null, 2)}
        </pre>
      )}
    </Field>
  );
}

/**
 * The body editor for a block. Two-column blocks render their columns through `columns`, which
 * the block editor passes in, so the column lists are block editors themselves.
 */
export function BlockBody({
  block,
  path,
  folder,
  onChange,
  columns,
}: BodyProps<Block> & { columns: (block: Of<'twoCol'>) => ReactNode }) {
  const known = block as KnownBlock;
  const change = onChange as (next: KnownBlock, edit?: EditOptions) => void;
  switch (known.type) {
    case 'heading':
      return <HeadingBody block={known} path={path} folder={folder} onChange={change} />;
    case 'text':
      return <TextBody block={known} path={path} folder={folder} onChange={change} />;
    case 'bullets':
      return <BulletsBody block={known} path={path} folder={folder} onChange={change} />;
    case 'quote':
      return <QuoteBody block={known} path={path} folder={folder} onChange={change} />;
    case 'callout':
      return <CalloutBody block={known} path={path} folder={folder} onChange={change} />;
    case 'code':
      return <CodeBody block={known} path={path} folder={folder} onChange={change} />;
    case 'image':
      return <ImageBody block={known} path={path} folder={folder} onChange={change} />;
    case 'gallery':
      return <GalleryBody block={known} path={path} folder={folder} onChange={change} />;
    case 'video':
      return <VideoBody block={known} path={path} folder={folder} onChange={change} />;
    case 'model3d':
      return <Model3dBody block={known} path={path} folder={folder} onChange={change} />;
    case 'document':
      return <DocumentBody block={known} path={path} folder={folder} onChange={change} />;
    case 'audio':
      return <AudioBody block={known} path={path} folder={folder} onChange={change} />;
    case 'compare':
      return <CompareBody block={known} path={path} folder={folder} onChange={change} />;
    case 'panzoom':
      return <PanzoomBody block={known} path={path} folder={folder} onChange={change} />;
    case 'twoCol':
      return <>{columns(known)}</>;
    case 'specTable':
      return <SpecTableBody block={known} path={path} folder={folder} onChange={change} />;
    case 'linkRow':
      return <LinkRowBody block={known} path={path} folder={folder} onChange={change} />;
    case 'roadmap':
      return <RoadmapBody block={known} path={path} folder={folder} onChange={change} />;
    case 'log':
      return <LogBody block={known} path={path} folder={folder} onChange={change} />;
    case 'file':
      return <FileBody block={known} path={path} folder={folder} onChange={change} />;
    case 'repo':
      return <RepoBody block={known} path={path} folder={folder} onChange={change} />;
    default:
      return <UnknownBody block={block} path={path} />;
  }
}
