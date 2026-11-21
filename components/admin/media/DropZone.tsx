'use client';

/**
 * Dropping files: `useFileDrop` gives any element the drag handlers (only drags that carry files
 * count, and the highlight survives moving over the element's children), and `DropZone` is the
 * library's dashed area with a "Choose files" button for the keyboard and for phones.
 * `FilePicker` is a hidden file input opened by a button, with the files handed over once and the
 * input emptied, so choosing the same file again still works.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { CloudUpload, FileUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import styles from './media.module.css';

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export interface FileDrop {
  over: boolean;
  props: {
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

/** Drag-and-drop handlers for files. `onFiles` receives every dropped file at once. */
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false): FileDrop {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    [disabled],
  );
  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );
  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    [disabled],
  );
  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );
  return { over, props: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

export interface FilePickerHandle {
  open: () => void;
}

export interface FilePickerProps {
  onFiles: (files: File[]) => void;
  /** The input's `accept` list; empty takes any file. */
  accept?: string;
  multiple?: boolean;
  /** The input's accessible name (it is hidden; the button that opens it is what people use). */
  label: string;
}

/** A hidden file input; call `open()` from a button. */
export const FilePicker = forwardRef<FilePickerHandle, FilePickerProps>(function FilePicker({ onFiles, accept, multiple = false, label }, ref) {
  const input = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);
  return (
    <input
      ref={input}
      type="file"
      hidden
      aria-label={label}
      accept={accept || undefined}
      multiple={multiple}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
  );
});

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  /** The hidden input's accessible name. */
  inputLabel?: string;
  className?: string;
}

/** The dashed drop area with a "Choose files" button. */
export function DropZone({ onFiles, accept, multiple = true, disabled = false, title = 'Drop files here', hint, inputLabel = 'Files to upload', className }: DropZoneProps) {
  const drop = useFileDrop(onFiles, disabled);
  const picker = useRef<FilePickerHandle | null>(null);
  return (
    <div className={cx(styles.drop, drop.over && styles.dropOver, disabled && styles.dropDisabled, className)} {...drop.props}>
      <CloudUpload size={22} aria-hidden="true" className={styles.dropIcon} />
      <p className={styles.dropTitle}>{title}</p>
      <Button size="sm" icon={<FileUp size={16} />} disabled={disabled} onClick={() => picker.current?.open()}>
        {multiple ? 'Choose files' : 'Choose a file'}
      </Button>
      {hint ? <p className={styles.dropHint}>{hint}</p> : null}
      <FilePicker ref={picker} onFiles={onFiles} accept={accept} multiple={multiple} label={inputLabel} />
    </div>
  );
}
