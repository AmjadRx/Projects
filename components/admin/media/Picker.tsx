'use client';

/**
 * "Choose": a dialog over one folder's library, filtered to the kinds the field takes. One file
 * (a radio list) or many (checkboxes), with a name filter. When the field takes embedded video,
 * the dialog also takes a YouTube or Vimeo link (D-29, D-45: the only external media). The list
 * loads each time the dialog opens, and the choice starts empty.
 */
import { useId, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import type { MediaItem } from '@/lib/admin/contract';
import { formatBytes, parseEmbed } from '@/lib/media';
import { Badge, Notice } from '../ui/bits';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { describeKinds, findPosterItem, isPosterName, KIND_WORDS, kindOfName, type LibraryKind } from './logic';
import styles from './media.module.css';
import { useMediaList } from './services';
import { Thumb } from './Thumb';

export interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  folder: string;
  /** The kinds offered; null offers every file. */
  kinds: readonly LibraryKind[] | null;
  multiple?: boolean;
  title?: string;
  /** The chosen files, and the whole list (to find a poster beside a file). */
  onPick: (picked: MediaItem[], all: readonly MediaItem[]) => void;
  /** Offer a YouTube or Vimeo link too. */
  onEmbed?: (url: string) => void;
}

export function MediaPicker(props: MediaPickerProps) {
  return props.open ? <PickerDialog {...props} /> : null;
}

function PickerDialog({ onClose, folder, kinds, multiple = false, title, onPick, onEmbed }: MediaPickerProps) {
  const { files, error, loading } = useMediaList(folder);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const searchId = useId();
  const linkId = useId();
  const linkHintId = useId();
  const groupName = useId();

  const offered = useMemo(() => {
    const all = files ?? [];
    const words = query.trim().toLowerCase();
    return all.filter((item) => {
      if (kinds && !kinds.includes(kindOfName(item.name))) return false;
      return words === '' || item.name.toLowerCase().includes(words);
    });
  }, [files, kinds, query]);

  const toggle = (src: string) => {
    if (!multiple) {
      setChosen([src]);
      return;
    }
    setChosen((current) => (current.includes(src) ? current.filter((s) => s !== src) : [...current, src]));
  };

  const confirm = () => {
    const all = files ?? [];
    const picked = chosen.map((src) => all.find((item) => item.src === src)).filter((item): item is MediaItem => item !== undefined);
    if (picked.length === 0) return;
    onPick(picked, all);
    onClose();
  };

  const embed = link.trim() === '' ? null : parseEmbed(link);
  const linkIssue = link.trim() !== '' && !embed ? 'Use a YouTube or Vimeo address, such as https://www.youtube.com/watch?v=... or https://vimeo.com/...' : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title ?? (multiple ? 'Choose files' : 'Choose a file')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={chosen.length === 0} onClick={confirm}>
            {multiple ? (chosen.length > 1 ? `Add ${chosen.length} files` : 'Add the file') : 'Use this file'}
          </Button>
        </>
      }
    >
      {onEmbed ? (
        <div className={styles.embed}>
          <label htmlFor={linkId} className="adm-field__label">
            A YouTube or Vimeo link
          </label>
          <div className={styles.embedRow}>
            <input
              id={linkId}
              className="adm-input adm-input--mono"
              type="text"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={link}
              aria-invalid={linkIssue ? true : undefined}
              aria-describedby={linkIssue ? linkHintId : undefined}
              onChange={(event) => setLink(event.target.value)}
            />
            <Button
              icon={<Link2 size={16} />}
              disabled={!embed}
              onClick={() => {
                if (!embed) return;
                onEmbed(link.trim());
                onClose();
              }}
            >
              Use this link
            </Button>
          </div>
          {linkIssue ? (
            <p id={linkHintId} className="adm-field__hint">
              {linkIssue}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.pickerTools}>
        <label htmlFor={searchId} className="adm-filter__label">
          Find by name
        </label>
        <input id={searchId} className="adm-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
      </div>
      <p className={styles.note}>
        {kinds ? `Showing ${describeKinds(kinds)} in this library.` : 'Showing every file in this library.'} New files are added with Upload, or in the
        media library.
      </p>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading && !files ? <p className={styles.note}>Loading the files...</p> : null}
      {files && offered.length === 0 ? <p className={styles.note}>No files to choose here yet.</p> : null}

      {offered.length > 0 ? (
        <ul className={styles.pickGrid} role={multiple ? 'group' : 'radiogroup'} aria-label="Files">
          {offered.map((item) => {
            const kind = kindOfName(item.name);
            const selected = chosen.includes(item.src);
            const poster = findPosterItem(item, files ?? []);
            return (
              <li key={item.src}>
                <label className={cx(styles.pick, selected && styles.pickSelected)}>
                  <input
                    className={styles.pickInput}
                    type={multiple ? 'checkbox' : 'radio'}
                    name={groupName}
                    checked={selected}
                    onChange={() => toggle(item.src)}
                  />
                  <Thumb kind={kind} src={item.src} previewSrc={item.previewSrc} poster={poster?.src} size="md" className={styles.pickThumb} />
                  <span className={styles.pickName}>{item.name}</span>
                  <span className={styles.meta}>
                    <Badge>{item.store === 'blob' ? 'Blob' : 'Repository'}</Badge>
                    <span>{KIND_WORDS[kind]}</span>
                    {item.size !== undefined ? <span>{formatBytes(item.size)}</span> : null}
                    {isPosterName(item.name) ? <span>poster</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Dialog>
  );
}
