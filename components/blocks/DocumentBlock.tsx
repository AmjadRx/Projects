import DocumentViewer from '@/components/viewers/document/DocumentViewer';
import DownloadRow from '@/components/viewers/file/DownloadRow';
import { documentTypeOf } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';

/** PDF and Word files open in the reader; any other document is a plain download. */
export default function DocumentBlock({ media, title }: { media: MediaRef; title?: string }) {
  const resolved = resolveMedia(media);
  if (!resolved) return null;
  const docType = documentTypeOf(resolved.file.src);
  if (!docType) return <DownloadRow label={title?.trim() || resolved.file.name} file={resolved.file} />;
  return <DocumentViewer media={resolved} title={title?.trim() || undefined} docType={docType} />;
}
