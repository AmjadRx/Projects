'use client';

/**
 * The full-page project editor (ARCHITECTURE.md 7, kept from v2 and extended with every field of
 * schema version 3): the warning list for this project's file first, then the slug and visibility,
 * the summary fields, maturity, the cover, the pitch and highlights, links, callouts, progress
 * steps, the blocks, and the project's media library. "Revert this file to published" sits in the
 * header; Undo and Redo are in the save bar.
 *
 * Field paths are relative to the project's file (the FileScope around this editor): "title",
 * "maturity.label", "callouts[1].value", "blocks[3].items[0].alt". Every edit goes through
 * `store.editProject` with `setIn`, which keeps every untouched object and key.
 */
import { useState, type MouseEvent } from 'react';
import { ArrowLeft, Images } from 'lucide-react';
import { slugOfProjectFile } from '@/lib/admin/contract';
import type { Project } from '@/lib/types';
import { MediaLibraryPanel } from '../media/index';
import { projectMediaFolder } from '../media/logic';
import { useFolderSaved } from '../media/services';
import { formatRoute } from '../shell/route';
import { RevertFileButton } from '../shell/RevertFile';
import { WarningsPanel } from '../shell/WarningsPanel';
import { useAdmin } from '../state/hooks';
import { pathOfEntry, type ProjectEntry } from '../state/store';
import { Badge, FieldGrid, Notice, PanelHeader, Section } from '../ui/bits';
import { Button } from '../ui/Button';
import { Select, TextArea, TextField, Toggle } from '../ui/inputs';
import { ListEditor } from '../ui/ListEditor';
import { BlockEditor } from './BlockEditor';
import { useEntry, useEntryDirty, useProjectSet } from './edit';
import { LinksList, MaturityPicker, MediaInput, StringList, TagsField } from './fields';
import { isLastVisible, LAST_VISIBLE, STATUS_OPTIONS, withFields } from './logic';
import { SlugRename } from './SlugRename';
import styles from './projects.module.css';

const NONE: ProjectEntry[] = [];

const STEP_STATES = [
  { value: 'done', label: 'Done' },
  { value: 'current', label: 'Current' },
  { value: 'todo', label: 'To do' },
] as const;

/**
 * The media folder of a project: the folder its files live in (the one most of its media addresses
 * point into), so a renamed project keeps using it; for a project with no media yet, its slug as
 * saved (the server makes the folder with the first save).
 */
export function mediaFolderOf(entry: ProjectEntry): string {
  return projectMediaFolder(entry.data, (entry.loadedFile ? slugOfProjectFile(entry.loadedFile) : null) ?? entry.data.slug);
}

export function ProjectEditor({ entryKey, onBack }: { entryKey: string; onBack: () => void }) {
  const entry = useEntry(entryKey);
  if (!entry) return null;
  return <EditorBody entry={entry} onBack={onBack} />;
}

function EditorBody({ entry, onBack }: { entry: ProjectEntry; onBack: () => void }) {
  const key = entry.key;
  const p = entry.data;
  const set = useProjectSet(key);
  const projects = useAdmin((s) => s.doc?.projects ?? NONE);
  const dirty = useEntryDirty(key);
  const [visibilityNote, setVisibilityNote] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const file = pathOfEntry(entry);
  const folder = mediaFolderOf(entry);
  const saved = entry.loadedFile !== null;
  const folderSaved = useFolderSaved(folder);
  const title = p.title.trim() || 'Untitled project';

  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onBack();
  };

  const setVisible = (visible: boolean) => {
    if (!visible && isLastVisible(projects, key)) {
      setVisibilityNote(LAST_VISIBLE);
      return;
    }
    setVisibilityNote('');
    set('visible', visible);
  };

  return (
    <>
      <a className={styles.back} href={formatRoute('projects')} onClick={back}>
        <ArrowLeft size={16} aria-hidden="true" />
        All projects
      </a>
      <PanelHeader
        title={title}
        description={
          <span className={styles.headMeta}>
            <span className="adm-mono adm-break">/projects/{p.slug}</span>
            {p.visible ? <Badge tone="ok">Visible</Badge> : <Badge tone="info">Hidden</Badge>}
            {p.featured ? <Badge tone="ok">Featured</Badge> : null}
            {dirty ? <Badge tone="warning">{saved ? 'Unsaved changes' : 'New, not saved'}</Badge> : null}
          </span>
        }
        actions={<RevertFileButton file={entry.loadedFile ?? file} />}
      />

      <WarningsPanel file={file} title="Warnings for this project" />

      {!folderSaved ? (
        <Notice tone="info" title="Not saved yet">
          Save this project once before adding media: its media folder is made with its first save.
        </Notice>
      ) : null}

      <Section title="Page" description="The page's address and where the project shows.">
        <SlugRename entryKey={key} slug={p.slug} title={p.title} folder={folderSaved ? folder : null} />
        <div className={styles.toggles}>
          <Toggle
            path="visible"
            label="Visible on the site"
            hint="A hidden project appears nowhere public."
            checked={p.visible}
            onChange={(visible) => setVisible(visible)}
          />
          <Toggle path="featured" label="Featured on the home page" checked={p.featured} onChange={(featured) => set('featured', featured)} />
        </div>
        <p className={styles.status} role="status">
          {visibilityNote}
        </p>
      </Section>

      <Section title="Summary">
        <TextField
          path="title"
          label="Title"
          required
          value={p.title}
          issue={p.title.trim() === '' ? 'A title is required.' : null}
          onChange={(value, edit) => set('title', value, edit)}
        />
        <TextField path="subtitle" label="Subtitle" value={p.subtitle} onChange={(value, edit) => set('subtitle', value, edit)} />
        <FieldGrid columns={2}>
          <TextField path="role" label="Role" value={p.role} onChange={(value, edit) => set('role', value, edit)} />
          <TextField path="timeframe" label="Timeframe" value={p.timeframe} onChange={(value, edit) => set('timeframe', value, edit)} />
          <Select<Project['status']> path="status" label="Status" value={p.status} options={STATUS_OPTIONS} onChange={(value, edit) => set('status', value, edit)} />
          <TextField
            path="statusLabel"
            label="Status label (optional)"
            hint="Printed in place of the status. Leave it empty to print the status."
            value={p.statusLabel}
            onChange={(value, edit) => set('statusLabel', value, edit)}
          />
        </FieldGrid>
        <TextField
          path="domain"
          label="Domain"
          hint="Separate domains with commas; the projects page filters on them."
          value={p.domain}
          onChange={(value, edit) => set('domain', value, edit)}
        />
        <TagsField tags={p.tags} onChange={(tags) => set('tags', tags)} />
      </Section>

      <Section title="Maturity" description="A five-step scale with the content's own label beside it.">
        <MaturityPicker value={p.maturity} onChange={(maturity, edit) => set('maturity', maturity, edit)} />
      </Section>

      <Section title="Cover" description="An image, a video, or a 3D model. Without a file, the card shows the placeholder.">
        <MediaInput path="cover" label="Cover" accept={['image', 'video', 'model']} focal folder={folder} value={p.cover} onChange={(cover, edit) => set('cover', cover, edit)} />
      </Section>

      <Section title="Pitch and highlights">
        <TextArea path="pitch" label="Pitch" hint="The one line on the project's card." rows={2} value={p.pitch} onChange={(value, edit) => set('pitch', value, edit)} />
        <StringList
          path="highlights"
          items={p.highlights}
          label="Highlights"
          itemName="Highlight"
          addLabel="Add highlight"
          onChange={(highlights, edit) => set('highlights', highlights, edit)}
        />
      </Section>

      <Section title="Links" description="Buttons on the project page, each with an icon taken from its address.">
        <LinksList path="links" links={p.links} label="Links" onChange={(links, edit) => set('links', links, edit)} />
      </Section>

      <Section title="Callouts" description="Up to three documented numbers, drawn over the cover as dimension lines.">
        <ListEditor
          path="callouts"
          items={p.callouts}
          label="Callouts"
          addLabel="Add callout"
          max={3}
          emptyText="No callouts."
          onChange={(callouts, edit) => set('callouts', callouts, edit)}
          newItem={() => ({ label: '', value: '' })}
          rowLabel={(c, i) => `${c.label} ${c.value}`.trim() || `Callout ${i + 1}`}
          renderRow={({ item, path, update }) => (
            <FieldGrid columns={2}>
              <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update(withFields(item, { label }), edit)} />
              <TextField path={`${path}.value`} label="Value" value={item.value} onChange={(value, edit) => update(withFields(item, { value }), edit)} />
            </FieldGrid>
          )}
        />
      </Section>

      <Section
        title="Progress steps"
        description="The strip of steps on the project page."
        actions={
          p.progress !== undefined ? (
            <Button size="sm" onClick={() => set('progress', undefined)}>
              Clear progress steps
            </Button>
          ) : null
        }
      >
        <ListEditor
          path="progress.steps"
          items={p.progress?.steps}
          label="Progress steps"
          addLabel="Add step"
          emptyText="No progress steps."
          onChange={(steps, edit) => set('progress.steps', steps, edit)}
          newItem={() => ({ label: '', state: 'todo' as const })}
          rowLabel={(step, i) => step.label || `Step ${i + 1}`}
          renderRow={({ item, path, update }) => (
            <FieldGrid columns={2}>
              <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update(withFields(item, { label }), edit)} />
              <Select path={`${path}.state`} label="State" value={item.state} options={STEP_STATES} onChange={(state, edit) => update(withFields(item, { state }), edit)} />
            </FieldGrid>
          )}
        />
      </Section>

      <Section title="Blocks" description="The page's body, top to bottom.">
        <BlockEditor entryKey={key} folder={folder} />
      </Section>

      <Section
        title="Media library"
        description={
          folderSaved
            ? `The files in /media/${folder}/, where this project's files live. A slug rename leaves them there.`
            : 'Save this project once to make its media folder.'
        }
        actions={
          folderSaved ? (
            <Button size="sm" icon={<Images size={16} />} aria-expanded={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>
              {showLibrary ? 'Hide the media library' : 'Show the media library'}
            </Button>
          ) : null
        }
      >
        {folderSaved && showLibrary ? <MediaLibraryPanel folder={folder} title={`Media for ${title}`} level={3} /> : null}
      </Section>
    </>
  );
}
