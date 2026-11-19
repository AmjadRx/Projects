'use client';

/**
 * One MediaRef field (a cover, an image block's media, the hero media, a headshot): the current
 * file (its picture or poster, kind, store, and address), Choose (the library, filtered to the
 * kinds the field takes), Upload (the queue; the stored file is set here when it is done), Clear
 * (D-07: the MediaRef stays with an empty `src`, so the placeholder renders), and Remove for an
 * optional field. Files can be dropped on the picture too.
 *
 * Under the file: alt text for photos and a short description for everything else (ARCHITECTURE.md
 * 13A: required for photos, models, and documents, as warnings that never block a save), the
 * caption when the field shows one, the focal point picker for photos, the captions file of a
 * video (with its own upload), and the poster, shown read-only.
 *
 * Every change the owner makes goes through `onChange` as a whole new MediaRef, so the store
 * records it and Undo brings it back. An upload is bound to this field's place, not to its
 * position (./targets.ts): when the file is stored it goes into the field where it is then (after
 * a block moved, a row was added above, or the slug was renamed), as one undo step, even while the
 * field is closed; a field removed meanwhile gets nothing and the file stays in the library.
 * Inputs carry the paths under `path` ("cover.alt", "cover.focal", "blocks[3].media.caption"), so
 * a finding or a warning scrolls to them. Must sit inside a FileScope, like every field.
 *
 * Downloads: the site offers no download link for 3D models (docs/V3_PLAN.md Q-24). The owner's
 * per-file opt-in has no schema field yet, so this field does not offer it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Eraser, FileUp, FolderOpen, Trash2 } from 'lucide-react';
import type { MediaItem } from '@/lib/admin/contract';
import { isBlobUrl, parseEmbed } from '@/lib/media';
import type { MediaRef } from '@/lib/types';
import type { EditOptions } from '../state/store';
import { useAdminStore, useScopeFile } from '../state/hooks';
import { Badge } from '../ui/bits';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { TextField } from '../ui/inputs';
import { cx } from '../ui/cx';
import { FilePicker, useFileDrop, type FilePickerHandle } from './DropZone';
import { FocalPointField } from './FocalPoint';
import {
  ACCEPT_CAPTIONS,
  acceptAttribute,
  clearedRef,
  describeKinds,
  findPosterItem,
  KIND_WORDS,
  kindWithArticle,
  mediaRefFromItem,
  refExtrasIndex,
  type MediaKind,
  type RefExtras,
} from './logic';
import styles from './media.module.css';
import { MediaPicker } from './Picker';
import { UploadQueue } from './Queue';
import { useCommitBridge, useFolderSaved, useMediaManager, useQueueItems, useTargetName } from './services';
import { fieldTarget } from './targets';
import { Thumb } from './Thumb';

export interface MediaFieldProps {
  /** The field path of this MediaRef in its file: "cover", "blocks[3].media", "settings.heroMedia". */
  path: string;
  label: string;
  value: MediaRef | undefined;
  /**
   * The new MediaRef, or undefined after Remove. `edit` carries the store's edit options from the
   * text inputs and the focal point, so typing in one input is one undo step: pass it on to the
   * store. A one-argument handler works too.
   */
  onChange: (next: MediaRef | undefined, edit?: EditOptions) => void;
  /** The media folder: "site" or the project's slug. */
  folder: string;
  /** The kinds this field takes: a cover takes image, video, and model; an image block takes image. */
  accept: readonly MediaRef['kind'][];
  /** Offer the focal point picker for images (covers, hero media, headshots). */
  focal?: boolean;
  /** Show the caption input. Alt text (photos) and the short description (models, documents) always show. */
  caption?: boolean;
  /** Offer "Clear", which keeps the MediaRef with an empty src so the placeholder renders (D-07). */
  clearable?: boolean;
  /** Offer "Remove", which removes an optional MediaRef (onChange(undefined)). */
  removable?: boolean;
  /** Offer the captions file (WebVTT) for a video. Default true; a muted cover clip can leave it out. */
  captionsFile?: boolean;
  /** One sentence under the label. */
  hint?: ReactNode;
  required?: boolean;
}

/** The words of the alt input for each kind, and the warning when it is empty (state/warnings.ts says the same). */
function altWords(kind: MediaKind): { label: string; hint: string; missing: string | null } {
  switch (kind) {
    case 'image':
      return {
        label: 'Alt text',
        hint: 'Describe what the photo shows, for people who cannot see it.',
        missing: 'This photo has no alt text. Describe what it shows for people who cannot see it.',
      };
    case 'model':
      return {
        label: 'Short description',
        hint: 'One sentence that says what the model is. The site shows 3D models without a download link.',
        missing: 'This 3D model has no short description. Say what it is in one sentence.',
      };
    case 'document':
      return {
        label: 'Short description',
        hint: 'One sentence that says what the document is.',
        missing: 'This document has no short description. Say what it is in one sentence.',
      };
    default:
      return { label: 'Short description', hint: 'Optional: read out with the player.', missing: null };
  }
}

function storeWords(ref: MediaRef): string {
  if (ref.kind === 'embed') return parseEmbed(ref.src)?.provider ?? 'Link';
  if (ref.store === 'blob' || isBlobUrl(ref.src)) return 'Blob';
  if (ref.src.startsWith('/media/')) return 'Repository';
  return 'Link';
}

/** The extras a chosen file carries: from a MediaRef that already uses it, else the poster stored beside it. */
export function extrasFor(item: MediaItem, all: readonly MediaItem[], index: Map<string, RefExtras> | null): RefExtras {
  const extras: RefExtras = { ...(index?.get(item.src) ?? {}) };
  if (!extras.poster) {
    const poster = findPosterItem(item, all);
    if (poster) extras.poster = poster.src;
  }
  return extras;
}

export function MediaField({
  path,
  label,
  value,
  onChange,
  folder,
  accept,
  focal = false,
  caption = false,
  clearable = false,
  removable = false,
  captionsFile = true,
  hint,
  required = false,
}: MediaFieldProps) {
  const file = useScopeFile();
  const store = useAdminStore();
  const manager = useMediaManager();
  useCommitBridge();
  const saved = useFolderSaved(folder);
  const target = useTargetName('field', path);
  const captionsTarget = useTargetName('captions', path);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [picking, setPicking] = useState<'file' | 'captions' | null>(null);
  const uploader = useRef<FilePickerHandle | null>(null);
  const captionsUploader = useRef<FilePickerHandle | null>(null);

  const uploadKinds = accept.filter((kind) => kind !== 'embed');
  const canUpload = uploadKinds.length > 0;

  const queue = useQueueItems((item) => item.target === target || item.target === captionsTarget, target);

  // The place is taken when the owner uploads, and the queue follows it from there. Without one
  // (no content loaded for this file) the file is still stored, and the queue says it was not placed.
  const upload = (files: File[]) => {
    const place = fieldTarget(store, 'field', file, path, accept);
    void manager.add(files, { target: place?.name() ?? target, folder, accept: { type: 'media', kinds: uploadKinds }, place });
  };
  const uploadCaptions = (files: File[]) => {
    const place = fieldTarget(store, 'captions', file, path);
    void manager.add(files, { target: place?.name() ?? captionsTarget, folder, accept: ACCEPT_CAPTIONS, place });
  };
  const drop = useFileDrop(upload, !saved || !canUpload);

  const src = value?.src ?? '';
  const hasFile = src.trim() !== '';
  const kind: MediaKind = value?.kind ?? accept[0] ?? 'image';
  const alt = altWords(kind);
  const embed = value?.kind === 'embed' ? parseEmbed(src) : null;

  /** Changes some keys of the current MediaRef. */
  const set = (patch: Partial<MediaRef>, edit?: EditOptions) => {
    const current = latest.current.value;
    if (current) latest.current.onChange({ ...current, ...patch }, edit);
  };
  const removeFocal = () => {
    const current = latest.current.value;
    if (!current || current.focal === undefined) return;
    const next = { ...current };
    delete next.focal;
    latest.current.onChange(next);
  };
  const removeCaptions = () => {
    const current = latest.current.value;
    if (!current || current.captions === undefined) return;
    const next = { ...current };
    delete next.captions;
    latest.current.onChange(next);
  };

  const choose = (picked: MediaItem[], all: readonly MediaItem[]) => {
    const item = picked[0];
    if (!item) return;
    const doc = store.getState().doc;
    const ref = mediaRefFromItem(item, extrasFor(item, all, doc ? refExtrasIndex(doc) : null));
    if (ref && accept.includes(ref.kind)) onChange(ref);
  };

  return (
    <Field path={path} label={label} hint={hint} required={required} value={value} layout="group" className={styles.mediaField}>
      {() => (
        <>
          <div className={cx(styles.row, drop.over && styles.over)} {...drop.props}>
            <Thumb kind={kind} src={hasFile ? src : null} poster={value?.poster} waveform={value?.waveform} size="lg" />
            <div className={styles.info}>
              <Field path={`${path}.src`} label="File" value={src}>
                {(control) => <input {...control} className="adm-input adm-input--mono" readOnly value={src} placeholder="No file yet" />}
              </Field>
              {value && hasFile ? (
                <p className={styles.meta}>
                  <span>{KIND_WORDS[kind]}</span>
                  <Badge>{storeWords(value)}</Badge>
                  {embed ? (
                    <a className="adm-link" href={embed.watchUrl} target="_blank" rel="noopener noreferrer">
                      Open on {embed.provider}
                      <span className="adm-sr"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                </p>
              ) : (
                <p className={styles.note}>{canUpload ? 'No file yet. Choose one from the library, upload one, or drop one here.' : 'No link yet.'}</p>
              )}
              {value && value.kind !== undefined && !accept.includes(value.kind) ? (
                <p className={styles.note}>
                  This field takes {describeKinds(accept)}, and it holds {kindWithArticle(value.kind)}. Choose another file.
                </p>
              ) : null}
              {!saved ? <p className={styles.note}>Save the project first: its media folder is made by the first save.</p> : null}
              <div className={styles.actions}>
                <Button size="sm" icon={<FolderOpen size={16} />} disabled={!saved} onClick={() => setPicking('file')}>
                  Choose
                </Button>
                {canUpload ? (
                  <Button size="sm" icon={<FileUp size={16} />} disabled={!saved} onClick={() => uploader.current?.open()}>
                    Upload
                  </Button>
                ) : null}
                {clearable && value && hasFile ? (
                  <Button size="sm" variant="ghost" icon={<Eraser size={16} />} onClick={() => onChange(clearedRef(value))}>
                    Clear
                  </Button>
                ) : null}
                {removable && value ? (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={() => onChange(undefined)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <FilePicker
            ref={uploader}
            onFiles={upload}
            accept={acceptAttribute(uploadKinds)}
            multiple={uploadKinds.includes('model')}
            label={`Upload a file for ${label}`}
          />
          <UploadQueue items={queue} label={`Uploads for ${label}`} />

          {value && hasFile ? (
            <div className={styles.sub}>
              <TextField
                path={`${path}.alt`}
                label={alt.label}
                hint={alt.hint}
                value={value.alt ?? ''}
                onChange={(next, edit) => set({ alt: next }, edit)}
                issue={alt.missing && (value.alt ?? '').trim() === '' ? alt.missing : null}
                issueTone="warning"
              />
              {caption ? <TextField path={`${path}.caption`} label="Caption" value={value.caption ?? ''} onChange={(next, edit) => set({ caption: next }, edit)} /> : null}
              {focal && kind === 'image' ? (
                <FocalPointField
                  path={`${path}.focal`}
                  src={src}
                  value={value.focal}
                  onChange={(next, edit) => (next ? set({ focal: next }, edit) : removeFocal())}
                />
              ) : null}
              {kind === 'video' && (captionsFile || value.captions) ? (
                <Field path={`${path}.captions`} label="Captions (WebVTT)" hint="Optional: a .vtt file the player offers as subtitles." value={value.captions}>
                  {(control) => (
                    <div className={styles.captions}>
                      <input {...control} className="adm-input adm-input--mono" readOnly value={value.captions ?? ''} placeholder="No captions" />
                      <div className={styles.actions}>
                        <Button size="sm" icon={<FileUp size={16} />} disabled={!saved} onClick={() => captionsUploader.current?.open()}>
                          Upload captions
                        </Button>
                        <Button size="sm" icon={<FolderOpen size={16} />} disabled={!saved} onClick={() => setPicking('captions')}>
                          Choose captions
                        </Button>
                        {value.captions ? (
                          <Button size="sm" variant="ghost" icon={<Eraser size={16} />} onClick={removeCaptions}>
                            Remove captions
                          </Button>
                        ) : null}
                      </div>
                      <FilePicker ref={captionsUploader} onFiles={uploadCaptions} accept={acceptAttribute(['captions'])} label={`Upload captions for ${label}`} />
                    </div>
                  )}
                </Field>
              ) : null}
              {value.poster && kind !== 'image' ? (
                <Field path={`${path}.poster`} label="Poster" hint="Taken from the file when it was uploaded." value={value.poster}>
                  {(control) => (
                    <div className={styles.posterRow}>
                      <Thumb kind="image" src={value.poster} size="sm" />
                      <input {...control} className="adm-input adm-input--mono" readOnly value={value.poster ?? ''} />
                    </div>
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}

          <MediaPicker
            open={picking === 'file'}
            onClose={() => setPicking(null)}
            folder={folder}
            kinds={uploadKinds}
            title={`Choose a file for ${label}`}
            onPick={choose}
            onEmbed={accept.includes('embed') ? (url) => onChange({ kind: 'embed', src: url, alt: '' }) : undefined}
          />
          <MediaPicker
            open={picking === 'captions'}
            onClose={() => setPicking(null)}
            folder={folder}
            kinds={['captions']}
            title={`Choose captions for ${label}`}
            onPick={(picked) => {
              const item = picked[0];
              if (item) set({ captions: item.src });
            }}
          />
        </>
      )}
    </Field>
  );
}
