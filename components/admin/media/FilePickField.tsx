'use client';

/**
 * The address of any stored file (the `file` block's download): choose a file from the library,
 * upload one (any accepted type; it is set here when it is stored, in this block wherever it is
 * then: ./targets.ts), or type a site path or an https address. The address input carries the
 * field's path, so a finding scrolls to it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Eraser, FileUp, FolderOpen } from 'lucide-react';
import { fileNameOf, isBlobUrl, typeLabelOf } from '@/lib/media';
import type { EditOptions } from '../state/store';
import { useAdminStore, useScopeFile } from '../state/hooks';
import { Badge } from '../ui/bits';
import { Button } from '../ui/Button';
import { UrlField } from '../ui/inputs';
import { cx } from '../ui/cx';
import { FilePicker, useFileDrop, type FilePickerHandle } from './DropZone';
import { ACCEPT_ANY, kindOfName } from './logic';
import styles from './media.module.css';
import { MediaPicker } from './Picker';
import { UploadQueue } from './Queue';
import { useCommitBridge, useFolderSaved, useMediaManager, useQueueItems, useTargetName } from './services';
import { fieldTarget } from './targets';
import { Thumb } from './Thumb';

export interface FilePickFieldProps {
  /** The field path of the address: "blocks[5].src". */
  path: string;
  label: string;
  /** A site path or an https address of any stored file (the `file` block's download). */
  value: string;
  /** The new address. `edit` carries the address input's edit options (typing stays one undo step). */
  onChange: (src: string, edit?: EditOptions) => void;
  folder: string;
  hint?: ReactNode;
}

export function FilePickField({ path, label, value, onChange, folder, hint }: FilePickFieldProps) {
  const file = useScopeFile();
  const store = useAdminStore();
  const manager = useMediaManager();
  useCommitBridge();
  const saved = useFolderSaved(folder);
  const target = useTargetName('filepick', path);
  const [picking, setPicking] = useState(false);
  const uploader = useRef<FilePickerHandle | null>(null);

  const queue = useQueueItems((item) => item.target === target, target);
  const upload = (files: File[]) => {
    const place = fieldTarget(store, 'filepick', file, path);
    void manager.add(files, { target: place?.name() ?? target, folder, accept: ACCEPT_ANY, place });
  };
  const drop = useFileDrop(upload, !saved);

  const address = (value ?? '').trim();
  const kind = address ? kindOfName(fileNameOf(address)) : 'file';

  return (
    <div className={styles.filePick}>
      <UrlField path={path} label={label} hint={hint} value={value} onChange={(next, edit) => onChange(next, edit)} />
      <div className={cx(styles.row, drop.over && styles.over)} {...drop.props}>
        {address ? <Thumb kind={kind} src={address} size="sm" /> : null}
        <div className={styles.info}>
          {address ? (
            <p className={styles.meta}>
              <span className={styles.name}>{fileNameOf(address)}</span>
              <span>{typeLabelOf(address)}</span>
              <Badge>{isBlobUrl(address) ? 'Blob' : address.startsWith('/media/') ? 'Repository' : 'Link'}</Badge>
            </p>
          ) : (
            <p className={styles.note}>No file yet. Choose one from the library, upload one, or drop one here.</p>
          )}
          {!saved ? <p className={styles.note}>Save the project first: its media folder is made by the first save.</p> : null}
          <div className={styles.actions}>
            <Button size="sm" icon={<FolderOpen size={16} />} disabled={!saved} onClick={() => setPicking(true)}>
              Choose
            </Button>
            <Button size="sm" icon={<FileUp size={16} />} disabled={!saved} onClick={() => uploader.current?.open()}>
              Upload
            </Button>
            {address ? (
              <Button size="sm" variant="ghost" icon={<Eraser size={16} />} onClick={() => onChange('')}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <FilePicker ref={uploader} onFiles={upload} label={`Upload a file for ${label}`} />
      <UploadQueue items={queue} label={`Uploads for ${label}`} />
      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        folder={folder}
        kinds={null}
        title={`Choose a file for ${label}`}
        onPick={(picked) => {
          const item = picked[0];
          if (item) onChange(item.src);
        }}
      />
    </div>
  );
}
