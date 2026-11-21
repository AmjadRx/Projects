import DownloadRow from '@/components/viewers/file/DownloadRow';
import { hasText } from '@/lib/format';
import { isSafeMediaSrc } from '@/lib/media';
import { resolveFile } from '@/lib/media-server';

/** A file row. An empty address, or one that is neither a site path nor https, renders nothing. */
export default function FileBlock({ label, src, note }: { label: string; src: string; note?: string }) {
  if (!hasText(src) || !isSafeMediaSrc(src)) return null;
  const file = resolveFile(src.trim());
  return <DownloadRow label={hasText(label) ? label : file.name} file={file} note={hasText(note) ? note : undefined} />;
}
