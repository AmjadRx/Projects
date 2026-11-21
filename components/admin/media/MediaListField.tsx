'use client';

/**
 * An ordered list of MediaRefs (a gallery's items, a log entry's photos): add many at once from
 * the library (Choose files) or by upload (Upload files, or files dropped on the list), reorder,
 * duplicate, and remove rows (ListEditor: buttons, the drag handle, and the arrow keys), and edit
 * each item's file, alt text or short description, and caption in its row (a MediaField).
 *
 * Each upload that finishes adds its file at the end of the list as it is then, as one undo step,
 * so several files that finish together all land, and the list is found where it went if its
 * block or row moved meanwhile (./targets.ts). Every change the owner makes goes through
 * `onChange`.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import type { MediaItem } from '@/lib/admin/contract';
import { fileNameOf } from '@/lib/media';
import type { MediaRef } from '@/lib/types';
import type { EditOptions } from '../state/store';
import { useAdminStore, useScopeFile } from '../state/hooks';
import { Button } from '../ui/Button';
import { useFieldFindings } from '../ui/Field';
import { ListEditor } from '../ui/ListEditor';
import { cx } from '../ui/cx';
import { FilePicker, useFileDrop, type FilePickerHandle } from './DropZone';
import { acceptAttribute, describeKinds, mediaRefFromItem, refExtrasIndex } from './logic';
import { extrasFor, MediaField } from './MediaField';
import styles from './media.module.css';
import { MediaPicker } from './Picker';
import { UploadQueue } from './Queue';
import { useCommitBridge, useFolderSaved, useMediaManager, useQueueItems, useTargetName } from './services';
import { fieldTarget } from './targets';

export interface MediaListFieldProps {
  /** The field path of the array: "blocks[2].items", "blocks[4].entries[0].media". */
  path: string;
  label: string;
  value: MediaRef[];
  /** The whole new list. `edit` carries a row input's edit options (typing stays one undo step). */
  onChange: (next: MediaRef[], edit?: EditOptions) => void;
  folder: string;
  accept: readonly MediaRef['kind'][];
  hint?: ReactNode;
  /** Show each item's caption input. Default true. */
  caption?: boolean;
}

export function MediaListField({ path, label, value, onChange, folder, accept, hint, caption = true }: MediaListFieldProps) {
  const file = useScopeFile();
  const store = useAdminStore();
  const manager = useMediaManager();
  useCommitBridge();
  const saved = useFolderSaved(folder);
  const target = useTargetName('list', path);
  const list = value ?? [];
  const latest = useRef({ list, onChange });
  latest.current = { list, onChange };
  const [picking, setPicking] = useState(false);
  const uploader = useRef<FilePickerHandle | null>(null);
  const labelId = useId();
  const { errors, warnings } = useFieldFindings(path);

  const uploadKinds = accept.filter((kind) => kind !== 'embed');

  const queue = useQueueItems((item) => item.target === target, target);

  // The place is taken when the owner uploads; each stored file is appended to the list as it is then.
  const upload = (files: File[]) => {
    const place = fieldTarget(store, 'list', file, path, accept);
    void manager.add(files, { target: place?.name() ?? target, folder, accept: { type: 'media', kinds: uploadKinds }, place });
  };
  const drop = useFileDrop(upload, !saved || uploadKinds.length === 0);

  const choose = (picked: MediaItem[], all: readonly MediaItem[]) => {
    const doc = store.getState().doc;
    const index = doc ? refExtrasIndex(doc) : null;
    const refs = picked
      .map((item) => mediaRefFromItem(item, extrasFor(item, all, index)))
      .filter((ref): ref is MediaRef => ref !== null && accept.includes(ref.kind));
    if (refs.length > 0) onChange([...latest.current.list, ...refs]);
  };

  return (
    <div className={cx(styles.listField, errors.length > 0 && styles.listFieldInvalid)}>
      <p id={labelId} className="adm-field__label">
        {label}
      </p>
      {hint ? <p className="adm-field__hint">{hint}</p> : null}
      {errors.length > 0 || warnings.length > 0 ? (
        <div className="adm-field__msgs">
          {[...errors, ...warnings].map((finding, i) => (
            <p key={i} className={cx('adm-field__msg', finding.severity === 'error' ? 'adm-field__msg--error' : 'adm-field__msg--warning')}>
              <span>
                <span className="adm-field__rule">{finding.rule}</span> {finding.message}
              </span>
            </p>
          ))}
        </div>
      ) : null}
      <ListEditor<MediaRef>
        path={path}
        items={list}
        onChange={(items, edit) => onChange(items, edit)}
        newItem={() => ({ kind: accept[0] ?? 'image', src: '', alt: '' })}
        rowLabel={(item, i) => (item.src.trim() ? fileNameOf(item.src) : `Item ${i + 1}`)}
        label={label}
        addLabel="Add an empty item"
        emptyText="No files yet. Choose them from the library, upload them, or drop them here."
        renderRow={({ item, index, path: rowPath, update }) => (
          <MediaField
            path={rowPath}
            label={`Item ${index + 1}`}
            value={item}
            onChange={(next, edit) => {
              if (next) update(next, edit);
            }}
            folder={folder}
            accept={accept}
            caption={caption}
            clearable
          />
        )}
      />
      <div className={cx(styles.listDrop, drop.over && styles.over)} {...drop.props}>
        <div className={styles.actions}>
          <Button size="sm" icon={<FolderOpen size={16} />} disabled={!saved} onClick={() => setPicking(true)}>
            Choose files
          </Button>
          {uploadKinds.length > 0 ? (
            <Button size="sm" icon={<FileUp size={16} />} disabled={!saved} onClick={() => uploader.current?.open()}>
              Upload files
            </Button>
          ) : null}
        </div>
        <p className={styles.note}>
          {saved ? `Takes ${describeKinds(accept)}. Files dropped here are added at the end.` : 'Save the project first: its media folder is made by the first save.'}
        </p>
      </div>
      <FilePicker ref={uploader} onFiles={upload} accept={acceptAttribute(uploadKinds)} multiple label={`Upload files for ${label}`} />
      <UploadQueue items={queue} label={`Uploads for ${label}`} />
      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        folder={folder}
        kinds={uploadKinds}
        multiple
        title={`Choose files for ${label}`}
        onPick={choose}
      />
    </div>
  );
}
