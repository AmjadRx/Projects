'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { MediaRef } from '@/lib/types';
import { MediaPlaceholder } from '@/components/MediaView';
import { IconBtn } from './fields';

export interface MediaFile {
  name: string;
  src: string;
  size: number;
}

/** Client-side image compression: resize to ≤2560px and encode WebP before upload. */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size < 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
  } catch {
    return file;
  }
}

export function useMediaList(scope: string) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/upload?scope=${scope}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFiles(data.files ?? []);
    } catch (err) {
      setFiles([]);
      setListError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { files, loading, listError, refresh };
}

export async function uploadFile(file: File, scope: string): Promise<{ src: string; kind: 'image' | 'video' }> {
  const prepared = await compressImage(file);
  const form = new FormData();
  form.append('file', prepared);
  form.append('scope', scope);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Upload failed');
  return data;
}

function Thumb({ file }: { file: MediaFile }) {
  const isVideo = /\.(mp4|webm|mov)$/i.test(file.name);
  if (isVideo) {
    return <video src={file.src} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={file.src} alt={file.name} className="h-full w-full object-cover" loading="lazy" />;
}

/** Per-scope media library: grid, dropzone upload, delete. */
export function MediaLibrary({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect?: (file: MediaFile) => void;
}) {
  const { files, loading, listError, refresh } = useMediaList(scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = async (list: FileList | File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        await uploadFile(file, scope);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file: MediaFile) => {
    if (!confirm(`Delete ${file.name}?`)) return;
    await fetch('/api/upload', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ src: file.src }),
    });
    await refresh();
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className="flex flex-col items-center justify-center gap-2 rounded-md py-8 text-center transition-colors"
        style={{
          border: `1px dashed ${dragging ? 'rgb(var(--accent))' : 'var(--line)'}`,
          background: dragging ? 'rgb(var(--accent) / 0.05)' : 'transparent',
        }}
      >
        <Upload size={18} className="text-ink-mute" />
        <p className="text-sm text-ink-dim">
          {busy ? 'Uploading…' : 'Drop files here, or'}
        </p>
        {!busy && (
          <label className="btn-ghost !min-h-0 cursor-pointer !px-4 !py-1.5 text-[13px]">
            Browse
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </label>
        )}
        <p className="font-mono text-[10px] text-ink-mute">
          Images ≤ 8 MB (auto-compressed) · video ≤ 25 MB · larger video: paste a YouTube link
        </p>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-red-400">{error}</p>}
      {listError && <p className="mt-2 font-mono text-xs text-red-400">⚠ {listError}</p>}

      {loading ? (
        <p className="mt-4 font-mono text-xs text-ink-mute">Loading media…</p>
      ) : files.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-4">
          {files.map((file) => (
            <div key={file.src} className="group relative aspect-square overflow-hidden rounded-sm" style={{ border: '1px solid var(--line)' }}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(file)} className="h-full w-full" title={`Select ${file.name}`}>
                  <Thumb file={file} />
                </button>
              ) : (
                <Thumb file={file} />
              )}
              <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                <IconBtn onClick={() => remove(file)} label={`Delete ${file.name}`} danger>
                  <X size={12} />
                </IconBtn>
              </div>
              <span className="absolute inset-x-0 bottom-0 truncate bg-bg/80 px-1.5 py-0.5 font-mono text-[9px] text-ink-dim backdrop-blur">
                {file.name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 font-mono text-xs text-ink-mute">No media yet for this scope.</p>
      )}
    </div>
  );
}

/** Modal picker: choose from library, upload, or paste an external URL. */
export function MediaPicker({
  scope,
  onPick,
  onClose,
}: {
  scope: string;
  onPick: (media: MediaRef) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');

  const pickFile = (file: MediaFile) => {
    const isVideo = /\.(mp4|webm|mov)$/i.test(file.name);
    onPick({ kind: isVideo ? 'video' : 'image', src: file.src, alt: '' });
    onClose();
  };

  const pickUrl = () => {
    if (!url) return;
    const isEmbed = /youtube\.com|youtu\.be|vimeo\.com/.test(url);
    const isVideo = /\.(mp4|webm|mov)($|\?)/i.test(url);
    onPick({ kind: isEmbed ? 'embed' : isVideo ? 'video' : 'image', src: url, alt: '' });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 p-4 backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5 md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">Select media · {scope}</h3>
          <IconBtn onClick={onClose} label="Close">
            <X size={14} />
          </IconBtn>
        </div>
        <div className="mb-5 flex gap-2">
          <input
            className="input"
            placeholder="Or paste a URL (image, video, YouTube, Vimeo)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" onClick={pickUrl} className="btn-ghost !min-h-0 shrink-0 !px-4 !py-2 text-[13px]">
            Use URL
          </button>
        </div>
        <MediaLibrary scope={scope} onSelect={pickFile} />
      </div>
    </div>
  );
}

/** Inline media field: preview + pick/clear. */
export function MediaField({
  label,
  scope,
  value,
  onChange,
  allowClear,
}: {
  label: string;
  scope: string;
  value?: MediaRef;
  onChange: (media: MediaRef | undefined) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-sm" style={{ border: '1px solid var(--line)' }}>
          {value?.src ? (
            value.kind === 'video' ? (
              <video src={value.src} muted className="h-full w-full object-cover" />
            ) : value.kind === 'embed' ? (
              <div className="flex h-full w-full items-center justify-center font-mono text-[9px] text-ink-mute">
                embed
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.src} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <MediaPlaceholder />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate font-mono text-[11px] text-ink-mute">{value?.src || 'None'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(true)} className="btn-ghost !min-h-0 !px-3 !py-1 text-[12px]">
              Choose
            </button>
            {allowClear && value && (
              <button type="button" onClick={() => onChange(undefined)} className="btn-ghost !min-h-0 !px-3 !py-1 text-[12px]">
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      {value && (
        <input
          className="input mt-2"
          placeholder="Alt text"
          value={value.alt ?? ''}
          onChange={(e) => onChange({ ...value, alt: e.target.value })}
        />
      )}
      {open && <MediaPicker scope={scope} onPick={(m) => onChange(m)} onClose={() => setOpen(false)} />}
    </div>
  );
}
