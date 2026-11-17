import { Download } from 'lucide-react';
import { formatBytes, isRemoteUrl, type ResolvedFile } from '@/lib/media';
import { UI } from '@/lib/strings';

/**
 * The plain download link beside every viewer (ARCHITECTURE.md 13A): it works with no script,
 * and it names the type and, when known, the size. Same-origin files carry the `download`
 * attribute; Blob files use Blob's own download address instead (docs/V3_PLAN.md D-27).
 * Renders nothing for a file that is not offered for download (an empty `downloadHref`, R-16).
 */
/**
 * The message a viewer shows when its engine fails. It sends the visitor to the download link
 * only when the file has one.
 */
export function failureText(file: ResolvedFile): string {
  return file.downloadHref ? UI.viewers.failed : UI.viewers.failedNoDownload;
}

export default function DownloadLink({ file, label }: { file: ResolvedFile; label?: string }) {
  if (!file.downloadHref) return null;
  const size = formatBytes(file.sizeBytes);
  const details = [file.typeLabel, size].filter(Boolean).join(', ');
  return (
    <a
      href={file.downloadHref}
      download={isRemoteUrl(file.src) ? undefined : file.name}
      className="download-link"
    >
      <Download size={15} aria-hidden />
      <span>{label ?? UI.viewers.downloadFile(file.name)}</span>
      {details && <span className="download-link__meta">({details})</span>}
    </a>
  );
}
