import { Download } from 'lucide-react';
import Icon from '@/components/sheet/Icon';
import { formatBytes, isRemoteUrl, type ResolvedFile } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';

/**
 * The message a viewer shows when its engine fails. It sends the visitor to the download link
 * only when the file has one.
 */
export function failureText(file: ResolvedFile): string {
  return file.downloadHref ? UI.viewers.failed : UI.viewers.failedNoDownload;
}

/**
 * The plain download link beside every viewer (ARCHITECTURE.md 13A), at the end of the frame's
 * caption line: it works with no script, and it names the type and, when known, the size. The
 * file's name completes the link's accessible name. Same-origin files carry the `download`
 * attribute; Blob files use Blob's own download address instead (docs/V3_PLAN.md D-27).
 * Renders nothing for a file that is not offered for download (an empty `downloadHref`, R-16).
 * `onNight` draws it for the lightbox's night ground.
 */
export default function DownloadLink({
  file,
  label,
  onNight = false,
}: {
  file: ResolvedFile;
  label?: string;
  onNight?: boolean;
}) {
  if (!file.downloadHref) return null;
  const size = formatBytes(file.sizeBytes);
  const details = [file.typeLabel, size].filter(Boolean).join(', ');
  return (
    <a
      href={file.downloadHref}
      download={isRemoteUrl(file.src) ? undefined : file.name}
      className={cn('ar-mv__dl', onNight && 'ar-mv__dl--night')}
    >
      <Icon icon={Download} size={16} />
      <span className="ar-mv__dl-text">{label ?? UI.viewers.download}</span>
      <span className="ar-sr">{` ${file.name}`}</span>
      {details && <span className="ar-mv__dl-meta">{details}</span>}
    </a>
  );
}
