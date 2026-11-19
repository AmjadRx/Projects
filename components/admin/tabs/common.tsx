'use client';

/**
 * Pieces every site tab uses:
 *
 * - `TabFrame`: the FileScope of content/site.json, the tab's one h1, and "Revert this file to
 *   published" (every site tab edits that one file).
 * - `PageLinkField`, `PageProofField`, `ProjectProofField`: a link with a page picker beside it,
 *   and the two proof pickers (a stat's proof is a page, a skill's proof is a project slug). They
 *   list the site's routes and visible projects only: a hidden project's page does not exist.
 * - `TextRows`: a list of plain strings (paragraphs, bullets), one text box per row.
 * - `SiteMediaField`: the media field bound to a MediaRef in content/site.json.
 * - `useStoredHas`: whether the stored file has a key, for optional text fields (./model.ts).
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { SITE_FILE } from '@/lib/admin/contract';
import { resolvesToPage } from '@/lib/lint';
import { TABS, type TabId } from '@/lib/admin/locate';
import type { MediaRef } from '@/lib/types';
// "/index" because '../media' resolves to the v2 components/admin/media.tsx while that file exists.
import { MediaField, type MediaFieldProps } from '../media/index';
import { RevertFileButton } from '../shell';
import { FileScope, useAdmin, useAdminStore, useFieldId } from '../state/hooks';
import type { EditOptions, ProjectEntry } from '../state/store';
import { childPath, Field, FieldGrid, ListEditor, PanelHeader, TextArea, UrlField, useSiteBinding } from '../ui';
import {
  linkIssue,
  pageChoices,
  projectChoices,
  SITE_MEDIA_FOLDER,
  storedHasKey,
  type Choice,
  type PageChoices,
  type ProjectSummary,
} from './model';

// ---------------------------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------------------------

export function TabFrame({ tab, description, children }: { tab: TabId; description: ReactNode; children: ReactNode }) {
  const title = TABS.find((t) => t.id === tab)?.label ?? tab;
  return (
    <FileScope file={SITE_FILE}>
      <PanelHeader title={title} description={description} actions={<RevertFileButton file={SITE_FILE} />} />
      {children}
    </FileScope>
  );
}

/** "Printed as: ..." under fields whose parts the site prints together. */
export function PrintedAs({ text, empty }: { text: string; empty: string }) {
  return (
    <p className="adm-muted">
      {text !== '' ? (
        <>
          Printed as: <span className="adm-mono adm-break">{text}</span>
        </>
      ) : (
        empty
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Store lookups
// ---------------------------------------------------------------------------------------------

/**
 * A function that says whether the stored content/site.json (as loaded or last saved) has the key
 * at a path. It reads the store when called, so it never re-renders anything.
 */
export function useStoredHas(): (path: string) => boolean {
  const store = useAdminStore();
  return useCallback((path: string) => storedHasKey(store.getState().info?.stored[SITE_FILE], path), [store]);
}

const NO_ENTRIES: ProjectEntry[] = [];

/** Every project's slug, title, and visibility, in display order, from the working copy. */
export function useProjectSummaries(): ProjectSummary[] {
  const entries = useAdmin((s) => s.doc?.projects ?? NO_ENTRIES);
  return useMemo(() => entries.map(({ data }) => ({ slug: data.slug, title: data.title, visible: data.visible })), [entries]);
}

function usePageChoices(): PageChoices {
  const projects = useProjectSummaries();
  return useMemo(() => pageChoices(projects), [projects]);
}

function ChoiceOptions({ choices }: { choices: readonly Choice[] }) {
  return (
    <>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </>
  );
}

function PageOptions({ choices }: { choices: PageChoices }) {
  return (
    <>
      <optgroup label="Pages">
        <ChoiceOptions choices={choices.pages} />
      </optgroup>
      {choices.projects.length > 0 ? (
        <optgroup label="Projects">
          <ChoiceOptions choices={choices.projects} />
        </optgroup>
      ) : null}
    </>
  );
}

function isListed(choices: PageChoices, value: string): boolean {
  return choices.pages.some((c) => c.value === value) || choices.projects.some((c) => c.value === value);
}

// ---------------------------------------------------------------------------------------------
// A link with a page picker
// ---------------------------------------------------------------------------------------------

/**
 * Appended to a field's path to name a helper control (the page picker beside a link, the group
 * picker of a skill), so the helper gets its own DOM id. No content path contains "#".
 */
export const HELPER = '#';

/** The picker's value while the link is an address typed by hand. */
const TYPED = 'typed:address';

export interface PageLinkFieldProps {
  /** The link's field path ("nav[2].href", "now[1].href"). */
  path: string;
  label: string;
  hint?: ReactNode;
  value: string | undefined;
  onChange: (value: string, edit: EditOptions) => void;
  /** The link may be empty: the picker offers "No link". */
  optional?: boolean;
}

/**
 * A link address with a page picker beside it. The address takes any site path or https address
 * typed by hand; the picker fills it with one of the site's routes or a visible project's page.
 */
export function PageLinkField({ path, label, hint, value, onChange, optional = false }: PageLinkFieldProps) {
  const choices = usePageChoices();
  const pickPath = `${path}${HELPER}page`;
  const pickId = useFieldId(pickPath);
  const text = value ?? '';
  const selected = isListed(choices, text) ? text : text === '' ? '' : TYPED;
  return (
    <FieldGrid columns={2}>
      <UrlField path={path} label={label} hint={hint} value={text} required={!optional} issue={linkIssue(text, choices.visible)} onChange={onChange} />
      <Field path={pickPath} label="Pick a page" value={selected}>
        {(control) => (
          <select
            {...control}
            className="adm-input adm-select"
            value={selected}
            onChange={(e) => {
              if (e.target.value !== TYPED) onChange(e.target.value, { coalesce: pickId });
            }}
          >
            {selected === TYPED ? (
              <option value={TYPED} disabled>
                Typed address
              </option>
            ) : null}
            {optional ? (
              <option value="">No link</option>
            ) : (
              <option value="" disabled>
                Choose a page
              </option>
            )}
            <PageOptions choices={choices} />
          </select>
        )}
      </Field>
    </FieldGrid>
  );
}

// ---------------------------------------------------------------------------------------------
// Proof pickers
// ---------------------------------------------------------------------------------------------

export interface ProofFieldProps {
  /** The proof's field path ("stats[2].proof", "skills.groups[1].items[3].proof"). */
  path: string;
  value: string | undefined;
  /** "" for None. */
  onChange: (proof: string, edit: EditOptions) => void;
  hint?: ReactNode;
}

/** A stat's proof: one of the site's pages, or None (ARCHITECTURE.md 4: a site path). */
export function PageProofField({ path, value, onChange, hint }: ProofFieldProps) {
  const choices = usePageChoices();
  const id = useFieldId(path);
  const current = value ?? '';
  const listed = isListed(choices, current);
  const issue =
    current !== '' && !resolvesToPage(current, choices.visible) ? 'No visible page has this address, so the readout prints without a link.' : null;
  return (
    <Field path={path} label="Proof" hint={hint} value={current} issue={issue} issueTone="warning">
      {(control) => (
        <select {...control} className="adm-input adm-select" value={current} onChange={(e) => onChange(e.target.value, { coalesce: id })}>
          <option value="">None</option>
          {current !== '' && !listed ? <option value={current}>{current}</option> : null}
          <PageOptions choices={choices} />
        </select>
      )}
    </Field>
  );
}

/** A skill's proof: a visible project, or None (ARCHITECTURE.md 4: a project slug; D-21). */
export function ProjectProofField({ path, value, onChange, hint }: ProofFieldProps) {
  const projects = useProjectSummaries();
  const choices = useMemo(() => projectChoices(projects), [projects]);
  const id = useFieldId(path);
  const current = value ?? '';
  const listed = choices.some((c) => c.value === current);
  const issue =
    current === '' || listed
      ? null
      : projects.some((p) => p.slug === current)
        ? 'This project is hidden, so the skill prints without a link.'
        : 'No project has this slug, so the skill prints without a link.';
  return (
    <Field path={path} label="Proof" hint={hint} value={current} issue={issue} issueTone="warning">
      {(control) => (
        <select {...control} className="adm-input adm-select" value={current} onChange={(e) => onChange(e.target.value, { coalesce: id })}>
          <option value="">None</option>
          {current !== '' && !listed ? <option value={current}>{current}</option> : null}
          <ChoiceOptions choices={choices} />
        </select>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------
// Lists of strings
// ---------------------------------------------------------------------------------------------

export interface TextRowsProps {
  /** The array's field path: "about.paragraphs", "experience[2].bullets". */
  path: string;
  items: readonly string[] | undefined;
  onChange: (items: string[], edit?: EditOptions) => void;
  /** The list's name, shown above it: "Paragraphs". */
  label: string;
  /** One row's name: "Paragraph" gives "Paragraph 1", "Paragraph 2". */
  itemName: string;
  addLabel: string;
  rows?: number;
}

/**
 * One text box per string, with the list editor's add, move, duplicate, and remove. Each text box
 * carries its item's own field path ("about.paragraphs[2]"), so a content-check finding on that
 * string lands on the box itself. The list editor is given the path with a "#rows" suffix, which
 * keeps its row elements' ids apart from the boxes' ids; the wrapper carries the array's own id.
 */
export function TextRows({ path, items, onChange, label, itemName, addLabel, rows = 3 }: TextRowsProps) {
  const id = useFieldId(path);
  return (
    <div id={id} className="adm-field">
      <p className="adm-field__label">{label}</p>
      <ListEditor
        path={`${path}${HELPER}rows`}
        items={items}
        onChange={onChange}
        newItem={() => ''}
        label={label}
        addLabel={addLabel}
        collapsible={false}
        emptyText={`No ${label.toLowerCase()} yet.`}
        rowLabel={(_, i) => `${itemName} ${i + 1}`}
        renderRow={({ item, index, update }) => (
          <TextArea
            path={childPath(path, index)}
            label={<span className="adm-sr">{`${itemName} ${index + 1}`}</span>}
            value={item}
            rows={rows}
            onChange={(text, edit) => update(text, edit)}
          />
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

export type SiteMediaFieldProps = Omit<MediaFieldProps, 'value' | 'onChange' | 'folder'>;

/**
 * The media field for a MediaRef in content/site.json, in the site library. The field's own edit
 * options go to the store: typing in one of its text boxes (or dragging the focal point) is one
 * undo step, and choosing, uploading, or clearing a file is a step of its own.
 */
export function SiteMediaField(props: SiteMediaFieldProps) {
  const [value, setValue] = useSiteBinding<MediaRef | undefined>(props.path);
  return <MediaField {...props} folder={SITE_MEDIA_FOLDER} value={value} onChange={(next, edit) => setValue(next, edit)} />;
}
