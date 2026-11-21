'use client';

/**
 * The upload queue as the owner sees it: one row per file with its name, size, step, and a
 * progress bar (a spinner while a step has no measure), the conversion's warnings, the question
 * a warning asks (Upload anyway or Cancel), the name collision choice (Replace or Keep both), the
 * content check's findings with their rule ids, and Cancel, Retry, and Dismiss. Finished steps
 * are announced to screen readers once, through a polite live region.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, RotateCw, TriangleAlert, X } from 'lucide-react';
import { formatBytes } from '@/lib/media';
import { FindingsList } from '../shell/FindingsList';
import { plural } from '../shell/format';
import { Badge } from '../ui/bits';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { uploadKindWords } from './logic';
import { isFinished, isUnplaced, type QueueItem } from './manager';
import styles from './media.module.css';
import { useMediaManager } from './services';

function stageTone(item: QueueItem): 'neutral' | 'info' | 'ok' | 'warning' | 'error' {
  switch (item.stage) {
    case 'done':
      return 'ok';
    case 'refused':
    case 'failed':
      return 'error';
    case 'confirm':
    case 'exists':
      return 'warning';
    case 'canceled':
      return 'neutral';
    default:
      return 'info';
  }
}

function stageBadge(item: QueueItem): string {
  switch (item.stage) {
    case 'queued':
      return 'waiting';
    case 'preparing':
      return 'preparing';
    case 'confirm':
      return 'question';
    case 'checking':
      return 'checking';
    case 'ready':
      return 'waiting';
    case 'exists':
      return 'name taken';
    case 'storing':
      return 'uploading';
    case 'done':
      return 'stored';
    case 'refused':
      return 'refused';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'cancelled';
  }
}

function announcement(item: QueueItem): string | null {
  switch (item.stage) {
    case 'done':
      return `${item.name}: ${item.stageText.toLowerCase()}.`;
    case 'refused':
      return `${item.name}: refused. ${item.message ?? ''}`;
    case 'failed':
      return `${item.name}: failed. ${item.message ?? ''}`;
    case 'confirm':
      return `${item.name} needs your answer before it is uploaded.`;
    case 'exists':
      return `${item.name}: the name is taken. Choose Replace or Keep both.`;
    default:
      return null;
  }
}

function QueueRow({ item }: { item: QueueItem }) {
  const manager = useMediaManager();
  const finished = isFinished(item.stage);
  const active = !finished && item.stage !== 'confirm' && item.stage !== 'exists';
  const dropped = formatBytes(item.size);
  const toStore = item.storedSize !== null ? formatBytes(item.storedSize) : dropped;
  const sizes = toStore !== dropped ? `${dropped}, ${toStore} to store` : dropped;
  const triangles = item.meta?.triangles;
  const confirms = item.warnings.filter((warning) => warning.confirm);
  const notes = item.warnings.filter((warning) => !warning.confirm);

  return (
    <li className={cx(styles.qItem, (item.stage === 'refused' || item.stage === 'failed') && styles.qItemError)} data-stage={item.stage}>
      <div className={styles.qHead}>
        <span className={styles.qName}>{item.name}</span>
        {item.companions > 0 ? <span className={styles.qSize}>with {plural(item.companions, 'companion file')}</span> : null}
        <span className={styles.qSize}>{sizes}</span>
        {item.kind ? <span className={styles.qSize}>{uploadKindWords(item.kind)}</span> : null}
        {typeof triangles === 'number' ? <span className={styles.qSize}>{triangles.toLocaleString('en-US')} triangles</span> : null}
        <Badge tone={stageTone(item)}>{stageBadge(item)}</Badge>
        <span className={styles.qTools}>
          {item.retryable && (item.stage === 'failed' || item.stage === 'canceled') ? (
            <IconButton label={`Try ${item.name} again`} icon={<RotateCw size={16} />} size="sm" onClick={() => manager.retry(item.id)} />
          ) : null}
          {finished ? (
            <IconButton label={`Dismiss the upload of ${item.name}`} icon={<X size={16} />} size="sm" onClick={() => manager.dismiss(item.id)} />
          ) : (
            <IconButton label={`Cancel the upload of ${item.name}`} icon={<X size={16} />} size="sm" onClick={() => manager.cancel(item.id)} />
          )}
        </span>
      </div>

      {active ? (
        item.fraction !== null ? (
          <div className={styles.qLine}>
            <progress className={styles.progress} value={item.fraction} max={1} aria-label={`${item.name}: ${item.stageText}`} />
            <span className={styles.qStep}>
              {item.stageText} {Math.round(item.fraction * 100)}%
            </span>
          </div>
        ) : (
          <p className={styles.qLine}>
            <LoaderCircle className="adm-spin" size={16} aria-hidden="true" />
            <span className={styles.qStep}>{item.stageText}</span>
          </p>
        )
      ) : null}

      {notes.length > 0 ? (
        <ul className={styles.qNotes}>
          {notes.map((warning) => (
            <li key={`${warning.code}:${warning.message}`} className={styles.qNote}>
              <TriangleAlert size={15} aria-hidden="true" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {item.stage === 'confirm' ? (
        <div className={styles.qAsk} role="group" aria-label={`Before ${item.name} is uploaded`}>
          <ul className={styles.qNotes}>
            {confirms.map((warning) => (
              <li key={`${warning.code}:${warning.message}`} className={styles.qNote}>
                <CircleAlert size={15} aria-hidden="true" />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => manager.confirm(item.id)}>
              Upload anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => manager.cancel(item.id)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {item.stage === 'exists' ? (
        <div className={styles.qAsk} role="group" aria-label={`The name of ${item.name} is taken`}>
          <p className={styles.qMsg}>{item.message}</p>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => manager.replace(item.id)}>
              Replace
            </Button>
            <Button size="sm" onClick={() => void manager.keepBoth(item.id)}>
              Keep both
            </Button>
            <Button size="sm" variant="ghost" onClick={() => manager.cancel(item.id)}>
              Cancel
            </Button>
          </div>
          <p className={styles.note}>Replace changes the file everywhere it is used. Keep both stores the new file under a numbered name.</p>
        </div>
      ) : null}

      {(item.stage === 'refused' || item.stage === 'failed') && item.message ? <p className={styles.qMsg}>{item.message}</p> : null}
      {item.findings.length > 0 ? <FindingsList findings={item.findings} label={`Content check findings for ${item.name}`} /> : null}

      {item.stage === 'done' ? (
        <>
          <p className={styles.qLine}>
            <Check size={16} aria-hidden="true" />
            <span className={styles.qStep}>
              {item.stageText}
              {item.result ? <span className={styles.qAddress}> as {item.result.main.name}</span> : null}
            </span>
          </p>
          {item.message ? <p className={styles.qMsg}>{item.message}</p> : null}
          {item.note ? <p className={styles.note}>{item.note}</p> : null}
          {!item.applied && item.result && !isUnplaced(item) ? (
            <div className={styles.actions}>
              <Button size="sm" onClick={() => manager.applyPending(item.id)}>
                {item.replaceOf ? 'Update the fields that use it' : 'Use this file'}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export interface UploadQueueProps {
  items: readonly QueueItem[];
  /** The list's accessible name. */
  label?: string;
  className?: string;
}

/** The queue rows for some items (a field's own uploads, or a library folder's). Nothing when empty. */
export function UploadQueue({ items, label = 'Uploads', className }: UploadQueueProps) {
  const manager = useMediaManager();
  const [said, setSaid] = useState('');
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    for (const item of items) {
      const previous = seen.current.get(item.id);
      seen.current.set(item.id, item.stage);
      if (previous === item.stage) continue;
      const words = announcement(item);
      if (words && previous !== undefined) setSaid(words);
    }
  }, [items]);

  if (items.length === 0) return <span className="adm-sr" role="status" aria-live="polite">{said}</span>;
  const running = items.filter((item) => !isFinished(item.stage)).length;
  const finished = items.length - running;
  const ids = new Set(items.map((item) => item.id));

  return (
    <div className={cx(styles.queue, className)}>
      <div className={styles.queueHead}>
        <span className={styles.queueCount}>
          {running > 0 ? `${plural(running, 'file')} in progress` : 'Uploads finished'}
          {finished > 0 && running > 0 ? `, ${finished} finished` : ''}
        </span>
        {finished > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => manager.clearFinished((item) => ids.has(item.id))}>
            Clear finished
          </Button>
        ) : null}
      </div>
      <ul className={styles.queueList} aria-label={label}>
        {items.map((item) => (
          <QueueRow key={item.id} item={item} />
        ))}
      </ul>
      <span className="adm-sr" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}
