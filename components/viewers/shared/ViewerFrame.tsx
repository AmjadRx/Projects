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
import type { ResolvedFile } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import DownloadLink from './DownloadLink';
import { useFocusTrap } from './hooks';

/**
 * The one frame every viewer sits in (DESIGN_DIRECTION.md 11): a media well on the night color
 * with a 1 px rule, a caption line in the data type, a full-screen button, and a plain download
 * link beside the viewer (ARCHITECTURE.md 13A).
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

export interface ViewerFrameProps {
  /** Accessible name of the viewer region, for example "3D model". */
  label: string;
  /** Width over height of the media well: reserves the space before anything loads. */
  aspect: number;
  /** The caption line under the well (the content's caption). */
  caption?: string;
  /** The text alternative for models and documents; read by assistive technology. */
  description?: string;
  /** The file for the plain download link beside the viewer. Omit to hide the link. */
  download?: ResolvedFile;
  /** Viewer controls, shown in a row under the well. */
  toolbar?: ReactNode;
  /** Show the full-screen button. */
  allowFullscreen?: boolean;
  /** Cap the well height (CSS length), for tall media on wide screens. */
  maxWellHeight?: string;
  className?: string;
  wellClassName?: string;
  /** The poster or the engine. */
  children: ReactNode;
}

export default function ViewerFrame({
  label,
  aspect,
  caption,
  description,
  download,
  toolbar,
  allowFullscreen = true,
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

  return (
    <ViewerFrameContext.Provider value={context}>
      <figure
        ref={frameRef}
        role={pseudo ? 'dialog' : 'group'}
        aria-label={label}
        aria-describedby={describedBy}
        data-fullscreen={isFullscreen ? 'true' : undefined}
        aria-modal={pseudo ? true : undefined}
        className={cn('viewer-frame', pseudo && 'viewer-frame--pseudo', className)}
      >
        <div
          className={cn('viewer-well', wellClassName)}
          style={isFullscreen ? undefined : { aspectRatio: String(aspect), maxHeight: maxWellHeight }}
        >
          {children}
        </div>
        {(toolbar || allowFullscreen) && (
          <div className="viewer-toolbar">
            <div className="viewer-toolbar__controls">{toolbar}</div>
            {allowFullscreen && (
              // The label says what a press does; a toggle that renames itself carries no pressed state.
              <button
                type="button"
                className="viewer-button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen}
                title={isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen}
              >
                {isFullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
              </button>
            )}
          </div>
        )}
        {(caption || download?.downloadHref) && (
          <figcaption className="viewer-caption">
            {caption && <span className="viewer-caption__text">{caption}</span>}
            {download?.downloadHref && <DownloadLink file={download} />}
          </figcaption>
        )}
        {description && (
          <p id={descriptionId} className="sr-only">
            {description}
          </p>
        )}
      </figure>
    </ViewerFrameContext.Provider>
  );
}
