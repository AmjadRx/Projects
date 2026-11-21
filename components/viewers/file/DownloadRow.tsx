import {
  Box,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import Icon from '@/components/sheet/Icon';
import { formatBytes, isRemoteUrl } from '@/lib/media';
import { UI } from '@/lib/strings';
import type { DownloadRowProps } from '../types';
import styles from './DownloadRow.module.css';

/** The icon for a file type, by extension. Anything not listed is a plain file. */
const ICONS: [LucideIcon, string[]][] = [
  [FileText, ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md']],
  [FileSpreadsheet, ['csv', 'tsv', 'xls', 'xlsx', 'ods']],
  [Presentation, ['ppt', 'pptx', 'odp', 'key']],
  [FileArchive, ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz']],
  [FileImage, ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg', 'heic', 'tif', 'tiff', 'bmp']],
  [FileVideo, ['mp4', 'm4v', 'webm', 'mov']],
  [FileAudio, ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac']],
  [Box, ['glb', 'gltf', 'stl', 'obj', '3mf', 'ply', 'step', 'stp', 'iges', 'igs']],
  [
    FileCode,
    ['c', 'h', 'cpp', 'hpp', 'ino', 'py', 'js', 'ts', 'json', 'xml', 'yaml', 'yml', 'v', 'sv', 'vhd', 'm', 'asc', 'cir', 'net', 'kicad_pcb', 'kicad_sch', 'kicad_pro'],
  ],
];

const ICON_BY_EXT = new Map<string, LucideIcon>(ICONS.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon] as [string, LucideIcon])));

/**
 * A row for any file (ARCHITECTURE.md 13A, "Anything else"), in the media frame's family: the
 * file's mark on a small night well, the label, the optional note, the type and size in the data
 * type, and a secondary Download button. Files on this site carry the `download` attribute;
 * remote files use their download address, because browsers ignore the attribute across origins
 * (docs/V3_PLAN.md D-27). Also the fallback for documents that are neither PDF nor Word. A file
 * whose bytes are not its extension's type gets no button (R-16). No script runs here.
 */
export default function DownloadRow({ label, file, note }: DownloadRowProps) {
  const details = [file.typeLabel, formatBytes(file.sizeBytes)].filter(Boolean).join(', ');
  const remote = isRemoteUrl(file.src);

  return (
    <div className="ar-mv">
      <div className={styles.row}>
        <span className={styles.mark} aria-hidden="true">
          <Icon icon={ICON_BY_EXT.get(file.ext) ?? File} size={20} strokeWidth={1.5} />
        </span>
        <div className={styles.text}>
          <p className={styles.label}>{label}</p>
          {note && <p className={styles.note}>{note}</p>}
          {details && <p className={styles.details}>{details}</p>}
        </div>
        {file.downloadHref && (
          <a
            href={file.downloadHref}
            download={remote ? undefined : file.name}
            className={`ar-btn ar-btn--secondary ${styles.button}`}
          >
            <span className="ar-btn__label">{UI.viewers.file.download}</span>
            <span className="ar-sr">{` ${file.name}`}</span>
            <Icon icon={Download} size={18} />
          </a>
        )}
      </div>
    </div>
  );
}
