'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Icon from '@/components/sheet/Icon';
import type { ResolvedFile } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import DownloadLink from './DownloadLink';
import { useFocusTrap } from './hooks';

/**
 * The one frame every viewer sits in (bundle MediaFrame, app/sheet.css 25): a glass panel with a
 * 1 px rule, the media well on night with the flat grid and the full-screen button in its top
 * right corner, the viewer's controls on the bar under it, and the caption line in B612 Mono: the
 * kind, then the content's caption (or the file's name), then the plain download link
 * (ARCHITECTURE.md 13A).
 *
 * Full screen uses the Fullscreen API where the browser has it, and otherwise a fixed overlay
 * that behaves like the lightbox: focus stays inside and Escape closes it (docs/V3_PLAN.md D-63).
 */
export interface ViewerFrameContextValue {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  frameRef: React.RefObject<HTMLElement>;
  /**
   * The id of the text description (the content's alt text), when there is one. The engine's
   * focusable surface (the 3D canvas host, a reader's page area) adds it to its aria-describedby,
   * so the description is read when that surface takes focus.
   */
  descriptionId?: string;
}

const ViewerFrameContext = createContext<ViewerFrameContextValue | null>(null);

/** Full-screen state for the engine inside a frame (for example, to resize a canvas). */
export function useViewerFrame(): ViewerFrameContextValue {
  const value = useContext(ViewerFrameContext);
  if (!value) throw new Error('useViewerFrame must be used inside <ViewerFrame>.');
  return value;
}

/** A file offered beside the viewer, with an optional label in place of "Download". */
export interface FrameDownload {
  file: ResolvedFile;
  label?: string;
}

export interface ViewerFrameProps {
  /** Accessible name of the viewer region, for example "3D model". */
  label: string;
  /** The kind that leads the caption line ("Photo", "Video"): UI.viewers.kind. */
  kind: string;
  /** Width over height of the media well: reserves the space before anything loads. */
  aspect: number;
  /** The content's caption. Without one the caption line names the file (`fileName`). */
  caption?: string;
  /** The file's name, printed when the content gives no caption. */
  fileName?: string;
  /** The text alternative for models and documents; read by assistive technology. */
  description?: string;
  /** The files for the plain download links. A file not offered for download prints no link (R-16). */
  downloads?: FrameDownload[];
  /** Viewer controls, on the bar under the well. */
  toolbar?: ReactNode;
  /** Show the frame's own full-screen button in the well's top right corner. */
  allowFullscreen?: boolean;
  /** A control for that corner in place of the frame's own button (the video's, which needs its engine). */
  corner?: ReactNode;
  /** Cap the well height (CSS length), for tall media on wide screens. */
  maxWellHeight?: string;
  className?: string;
  wellClassName?: string;
  /** The poster or the engine. */
  children: ReactNode;
}

export default function ViewerFrame({
  label,
  kind,
  aspect,
  caption,
  fileName,
  description,
  downloads = [],
  toolbar,
  allowFullscreen = true,
  corner,
  maxWellHeight,
  className,
  wellClassName,
  children,
}: ViewerFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const [native, setNative] = useState(false);
  const [pseudo, setPseudo] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    const onChange = () => setNative(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement === frame) {
      void document.exitFullscreen();
      return;
    }
    if (pseudo) {
      setPseudo(false);
      return;
    }
    if (document.fullscreenEnabled && typeof frame.requestFullscreen === 'function') {
      frame.requestFullscreen().catch(() => setPseudo(true));
    } else {
      setPseudo(true);
    }
  }, [pseudo]);

  useFocusTrap(frameRef, pseudo, () => setPseudo(false));

  const isFullscreen = native || pseudo;
  const describedBy = description ? descriptionId : undefined;
  const context = useMemo(
    () => ({ isFullscreen, toggleFullscreen, frameRef, descriptionId: describedBy }),
    [isFullscreen, toggleFullscreen, describedBy],
  );

  const text = caption?.trim() || fileName?.trim() || '';
  const offered = downloads.filter((d) => d.file.downloadHref !== '');
  const fullscreenLabel = isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen;

  return (
    <ViewerFrameContext.Provider value={context}>
      <figure
        ref={frameRef}
        role={pseudo ? 'dialog' : 'group'}
        aria-label={label}
        aria-describedby={describedBy}
        data-fullscreen={isFullscreen ? 'true' : undefined}
        aria-modal={pseudo ? true : undefined}
        className={cn('ar-mv', className)}
      >
        <div
          className={cn('ar-mv__well', wellClassName)}
          style={isFullscreen ? undefined : { aspectRatio: String(aspect), maxHeight: maxWellHeight }}
        >
          {children}
          {corner ? (
            <span className="ar-mv__full">{corner}</span>
          ) : allowFullscreen ? (
            <span className="ar-mv__full">
              {/* The label says what a press does; a toggle that renames itself carries no pressed state. */}
              <button
                type="button"
                className="ar-mv__btn"
                onClick={toggleFullscreen}
                aria-label={fullscreenLabel}
                title={fullscreenLabel}
              >
                <Icon icon={isFullscreen ? Minimize2 : Maximize2} size={18} />
              </button>
            </span>
          ) : null}
        </div>
        {toolbar ? <div className="ar-mv__bar">{toolbar}</div> : null}
        <figcaption className="ar-mv__cap">
          <span className="ar-mv__kind">{kind}</span>
          {text ? <span className="ar-mv__text">{text}</span> : null}
          {offered.length > 0 ? (
            <span className="ar-mv__dls">
              {offered.map((d) => (
                <DownloadLink key={d.file.src} file={d.file} label={d.label} />
              ))}
            </span>
          ) : null}
        </figcaption>
        {description && (
          <p id={descriptionId} className="ar-sr">
            {description}
          </p>
        )}
      </figure>
    </ViewerFrameContext.Provider>
  );
}
