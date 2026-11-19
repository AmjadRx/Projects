'use client';

/**
 * Field editors the project editor and the block bodies share: the maturity picker, the tags as
 * chips, a list of plain strings, a list of links (project links and link rows), and a media field
 * that keeps typing in its text boxes to one undo step.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { detectIcon } from '@/lib/utils';
import type { Link, MediaRef, Project } from '@/lib/types';
import { MediaField, MediaListField } from '../media/index';
import { useFieldId } from '../state/hooks';
import type { EditOptions } from '../state/store';
import { Button, IconButton } from '../ui/Button';
import { FieldGrid } from '../ui/bits';
import { Field } from '../ui/Field';
import { TextArea, TextField, UrlField } from '../ui/inputs';
import { ListEditor } from '../ui/ListEditor';
import { removeItem } from '../ui/list';
import { childPath } from '../ui/paths';
import { mediaEdit, mediaListEdit } from './edit';
import { withFields } from './logic';
import styles from './projects.module.css';

// ---------------------------------------------------------------------------------------------
// Maturity
// ---------------------------------------------------------------------------------------------

/** The five steps of the maturity scale (DESIGN_DIRECTION.md 5.3), as the picker names them. */
export const MATURITY_STEPS = ['Concept', 'Design', 'Built', 'Bench-validated', 'Fielded'] as const;

type Maturity = NonNullable<Project['maturity']>;

/**
 * Maturity as five segments (radio buttons, so the arrow keys move between them) with the label
 * the site prints beside the scale. A step needs a label; Clear removes the whole key.
 */
export function MaturityPicker({ value, onChange }: { value: Maturity | undefined; onChange: (next: Maturity | undefined, edit?: EditOptions) => void }) {
  const name = useId();
  return (
    <>
      <Field
        path="maturity.step"
        label="Step"
        hint="Set the step no higher than the content documents."
        layout="group"
        value={value?.step}
      >
        {() => (
          <div className={styles.segments}>
            {MATURITY_STEPS.map((stepName, i) => {
              const step = i + 1;
              return (
                <label key={step} className={styles.segment}>
                  <input
                    type="radio"
                    name={name}
                    className={styles.segmentInput}
                    checked={value?.step === step}
                    onChange={() => onChange(value ? withFields(value, { step }) : { step, label: '' })}
                  />
                  <span className={styles.segmentLabel}>
                    <span className={styles.segmentStep}>{step}</span>
                    <span>{stepName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </Field>
      {value ? (
        <>
          <TextField
            path="maturity.label"
            label="Label"
            required
            hint="The content's own wording; the site prints it beside the scale."
            value={value.label}
            issue={value.label.trim() === '' ? 'A label is required when a step is set.' : null}
            onChange={(label, edit) => onChange(withFields(value, { label }), edit)}
          />
          <div className={styles.inlineActions}>
            <Button size="sm" onClick={() => onChange(undefined)}>
              Clear maturity
            </Button>
          </div>
        </>
      ) : (
        <p className="adm-muted">No maturity set. Choose a step to add one.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------

function TagChip({ tag, index, onRemove }: { tag: string; index: number; onRemove: (index: number) => void }) {
  const id = useFieldId(`tags[${index}]`);
  return (
    <li id={id} className={styles.chip}>
      <span className={styles.chipText}>{tag}</span>
      <IconButton size="sm" label={`Remove the tag ${tag}`} icon={<X size={14} />} onClick={() => onRemove(index)} />
    </li>
  );
}

/** Tags as chips: Enter (or Add tag) adds one; each chip has its own remove button. Commas stay inside a tag. */
export function TagsField({ tags, onChange }: { tags: readonly string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const value = draft.trim();
  const duplicate = value !== '' && tags.includes(value);

  const add = () => {
    if (value === '' || duplicate) return;
    onChange([...tags, value]);
    setDraft('');
  };

  const remove = (index: number) => {
    onChange(removeItem(tags, index));
    window.requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
      const next = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)];
      (next ?? inputRef.current)?.focus();
    });
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  };

  return (
    <Field path="tags" label="Tags" hint="Type a tag and press Enter. Commas stay part of a tag." layout="group" value={tags} issue={duplicate ? 'This tag is already in the list.' : null} issueTone="warning">
      {(control) => (
        <>
          {tags.length > 0 ? (
            <ul ref={listRef} className={styles.chips} aria-label="Tags">
              {tags.map((tag, i) => (
                <TagChip key={`${i}:${tag}`} tag={tag} index={i} onRemove={remove} />
              ))}
            </ul>
          ) : (
            <p className="adm-muted">No tags yet.</p>
          )}
          <div className={styles.chipAdd}>
            <input
              id={control.id}
              ref={inputRef}
              className="adm-input"
              value={draft}
              aria-label="New tag"
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <Button size="sm" onClick={add} disabled={value === '' || duplicate}>
              Add tag
            </Button>
          </div>
        </>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Lists of strings
// ---------------------------------------------------------------------------------------------

/**
 * One text box per string (highlights, bullets), with the list editor's add, move, duplicate, and
 * remove. Each box carries its string's own field path ("highlights[2]"), so a finding on it lands
 * on the box. The list editor gets the path with a "#rows" suffix, which keeps its row elements'
 * ids apart from the boxes' ids; the wrapper carries the array's own id.
 */
export function StringList({
  path,
  items,
  onChange,
  label,
  itemName,
  addLabel,
  rows = 2,
}: {
  path: string;
  items: readonly string[] | undefined;
  onChange: (items: string[], edit?: EditOptions) => void;
  label: string;
  itemName: string;
  addLabel: string;
  rows?: number;
}) {
  const id = useFieldId(path);
  return (
    <div id={id} className="adm-field">
      <p className="adm-field__label">{label}</p>
      <ListEditor
        path={`${path}#rows`}
        items={items}
        onChange={onChange}
        newItem={() => ''}
        label={label}
        addLabel={addLabel}
        collapsible={false}
        emptyText={`No ${label.toLowerCase()} yet.`}
        rowLabel={(text, i) => text.trim() || `${itemName} ${i + 1}`}
        renderRow={({ item, index, update }) => (
          <TextArea
            path={childPath(path, index)}
            label={<span className="adm-sr">{`${itemName} ${index + 1}`}</span>}
            rows={rows}
            value={item}
            onChange={(text, edit) => update(text, edit)}
          />
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/**
 * A list of links (a project's link buttons, a link row): label and address, with the icon set
 * from the address as it changes (lib/utils.ts `detectIcon`, as in v2).
 */
export function LinksList({ path, links, onChange, label }: { path: string; links: readonly Link[] | undefined; onChange: (links: Link[], edit?: EditOptions) => void; label: string }) {
  return (
    <ListEditor
      path={path}
      items={links}
      label={label}
      addLabel="Add link"
      emptyText="No links yet."
      onChange={onChange}
      newItem={() => ({ label: '', url: '' })}
      rowLabel={(link, i) => link.label || link.url || `Link ${i + 1}`}
      renderRow={({ item, path: rowPath, update }) => (
        <>
          <FieldGrid columns={2}>
            <TextField path={`${rowPath}.label`} label="Label" value={item.label} onChange={(value, edit) => update(withFields(item, { label: value }), edit)} />
            <UrlField
              path={`${rowPath}.url`}
              label="Address"
              hint="A project page, a public repository, a video, a paper, or a results page."
              value={item.url}
              onChange={(value, edit) => update(withFields(item, { url: value, icon: detectIcon(value.trim()) }), edit)}
            />
          </FieldGrid>
          <p className={styles.iconNote}>Icon: {item.icon ?? detectIcon(item.url.trim())}, set from the address.</p>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

/** An empty reference of a kind: the placeholder renders (D-07). */
export function emptyMedia(kind: MediaRef['kind']): MediaRef {
  return { kind, src: '' };
}

export interface MediaInputProps {
  path: string;
  label: string;
  value: MediaRef | undefined;
  accept: readonly MediaRef['kind'][];
  folder: string;
  onChange: (next: MediaRef, edit?: EditOptions) => void;
  caption?: boolean;
  focal?: boolean;
  hint?: string;
}

/**
 * MediaField with the project's edit rules: the reference is required, so Clear keeps it with an
 * empty address (the placeholder renders), and typing alt text or a caption (or dragging the focal
 * point) is one undo step: the field's own edit options when it gives them, else ours.
 */
export function MediaInput({ path, label, value, accept, folder, onChange, caption = false, focal = false, hint }: MediaInputProps) {
  const id = useFieldId(path);
  return (
    <MediaField
      path={path}
      label={label}
      hint={hint}
      value={value}
      folder={folder}
      accept={accept}
      caption={caption}
      focal={focal}
      clearable
      onChange={(next, edit) => onChange(next ?? emptyMedia(value?.kind ?? accept[0] ?? 'image'), edit ?? mediaEdit(id, value, next))}
    />
  );
}

/** MediaListField with the same rule for typing in one item. */
export function MediaListInput({
  path,
  label,
  value,
  accept,
  folder,
  onChange,
}: {
  path: string;
  label: string;
  value: readonly MediaRef[] | undefined;
  accept: readonly MediaRef['kind'][];
  folder: string;
  onChange: (next: MediaRef[], edit?: EditOptions) => void;
}) {
  const id = useFieldId(path);
  return (
    <MediaListField
      path={path}
      label={label}
      value={(value ?? []) as MediaRef[]}
      folder={folder}
      accept={accept}
      onChange={(next, edit) => onChange(next, edit ?? mediaListEdit(id, value, next))}
    />
  );
}
