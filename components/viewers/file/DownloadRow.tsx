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
import { formatBytes, isRemoteUrl } from '@/lib/media';
import { UI } from '@/lib/strings';
import type { DownloadRowProps } from '../types';

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
 * A row for any file (ARCHITECTURE.md 13A, "Anything else"): the label, the optional note, the
 * type and size in the data type, and a download button. Files on this site carry the `download`
 * attribute; remote files use their download address, because browsers ignore the attribute
 * across origins (docs/V3_PLAN.md D-27). Also the fallback for documents that are neither PDF
 * nor Word. No script runs here.
 */
export default function DownloadRow({ label, file, note }: DownloadRowProps) {
  const Icon = ICON_BY_EXT.get(file.ext) ?? File;
  const details = [file.typeLabel, formatBytes(file.sizeBytes)].filter(Boolean).join(', ');
  const remote = isRemoteUrl(file.src);

  return (
    <div className="viewer-frame">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:p-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-well text-well-ink">
          <Icon size={20} strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1 basis-44">
          <p className="font-medium text-ink [overflow-wrap:anywhere]">{label}</p>
          {note && <p className="mt-0.5 text-sm text-ink-dim">{note}</p>}
          {details && <p className="data mt-1 text-xs text-ink-mute">{details}</p>}
        </div>
        {file.downloadHref && (
          <a href={file.downloadHref} download={remote ? undefined : file.name} className="btn-ghost shrink-0">
            <Download size={16} aria-hidden />
            <span>{UI.viewers.file.download}</span>
            <span className="sr-only">{` ${file.name}`}</span>
          </a>
        )}
      </div>
    </div>
  );
}
