'use client';

/**
 * The 3D model viewer (ARCHITECTURE.md 13A "ModelViewer"; DESIGN_DIRECTION.md 6.1 and 11).
 *
 * This shell is all a page ships: the poster, the toolbar, and the state. The engine
 * (ModelEngine.tsx, with three.js) loads with next/dynamic only when the viewer may run: in view
 * on a desktop with a fine pointer, on a tap on phones and tablets or on a slow connection, and
 * at once inside the lightbox. At most two 3D viewers render at a time (activeViewers.ts); a
 * viewer asked to step back unmounts its canvas and shows its poster with a resume button.
 *
 * Models carry no download link by default (docs/V3_PLAN.md Q-24): the file is the owner's
 * design geometry. The text alternative is the content's alt text.
 */
import dynamic from 'next/dynamic';
import { Box, ChevronDown, ChevronUp, Home, Play, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { aspectOf } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster from '../shared/Poster';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { claimViewerSlot, releaseViewerSlot, touchViewerSlot } from '../shared/activeViewers';
import { useDocumentVisible, useInView, useReducedMotion } from '../shared/hooks';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { ModelView, ModelViewerProps } from '../types';
import { ROTATE_STEP, ZOOM_STEP, type EngineHandle, type EnginePart } from './engine-types';

const ModelEngine = dynamic(() => import('./ModelEngine'), { ssr: false, loading: () => null });

let webgl2: boolean | undefined;

/** three.js needs WebGL 2. Checked once per page, on the first viewer that tries to start. */
function supportsWebGL2(): boolean {
  if (webgl2 === undefined) {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2');
      webgl2 = context !== null;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="viewer-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** A short message over the poster: why the engine is not running. */
function Notice({ text, onShown }: { text: string; onShown?: () => void }) {
  useEffect(() => {
    onShown?.();
  }, [onShown]);
  return (
    <p role="status" className="absolute inset-x-3 bottom-3 rounded-sm bg-well/90 px-3 py-2 font-mono text-xs text-well-ink">
      {text}
    </p>
  );
}

export default function ModelViewer({ media, views, explode: offerExplode, callouts, inLightbox = false }: ModelViewerProps) {
  const offered: ModelView[] = views.length > 0 ? views : ['realistic'];
  const slotId = useId();
  const partsLabelId = useId();
  const wellRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const { active, requiresTap, activate } = useViewerActivation(wellRef, 'view-or-tap');
  const documentVisible = useDocumentVisible();
  const inView = useInView(wellRef);
  const reducedMotion = useReducedMotion();

  const [view, setView] = useState<ModelView>(offered[0]);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [parts, setParts] = useState<EnginePart[] | null>(null);
  const [ready, setReady] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  /** The visitor pressed the load or resume button: the engine takes focus when it mounts. */
  const [focusEngine, setFocusEngine] = useState(false);

  const started = inLightbox || active;
  useEffect(() => {
    if (started && webgl === null) setWebgl(supportsWebGL2());
  }, [started, webgl]);

  const engineOn = started && webgl === true && !suspended;

  // One of at most two live 3D viewers. When another viewer needs the slot, this one steps back.
  useEffect(() => {
    if (!engineOn) return undefined;
    claimViewerSlot(slotId, () => {
      setSuspended(true);
      setReady(false);
    });
    return () => releaseViewerSlot(slotId);
  }, [engineOn, slotId]);

  const interact = useCallback(() => {
    setTouched(true);
    touchViewerSlot(slotId);
  }, [slotId]);

  const handleReady = useCallback((found: EnginePart[]) => {
    setParts(found);
    setReady(true);
  }, []);

  const handleContextLost = useCallback(() => {
    setSuspended(true);
    setReady(false);
  }, []);

  const handleFailed = useCallback(() => setFailed(true), []);

  const start = () => {
    if (!started) activate();
    if (suspended) setSuspended(false);
  };

  /** The load and resume buttons go away when pressed: focus moves to the model instead. */
  const startFromButton = () => {
    setFocusEngine(true);
    start();
  };

  const chooseView = (next: ModelView) => {
    setView(next);
    // A view button keeps focus, also when it wakes a paused viewer.
    setFocusEngine(false);
    start();
    if (ready) interact();
  };

  const command = (run: (api: EngineHandle) => void) => () => {
    const api = handleRef.current;
    if (!api) return;
    run(api);
    interact();
  };

  const onPartFocus = (id: string) => (event: FocusEvent<HTMLButtonElement>) => {
    // Keyboard focus previews the highlight; a click pins it instead.
    if (event.currentTarget.matches(':focus-visible')) setHovered(id);
  };

  const live = engineOn && !failed;
  // A hover preview cannot outlive the engine (disabled buttons get no pointer-leave).
  useEffect(() => {
    if (!live) setHovered(null);
  }, [live]);
  const controlsDisabled = !live || !ready;
  const hasParts = (parts?.length ?? 0) > 1;
  // The toolbar's height never depends on the loaded model (no shift when it arrives). When the
  // exploded view is offered, its row is there from the first paint and stays: the slider shows
  // (disabled) until the model loads, then only for a model with more than one named part
  // (ARCHITECTURE.md 13A); for any other model the row keeps its place, empty. The parts list
  // shares that row and scrolls sideways, so it never wraps onto a line of its own.
  const showPartsRow = offerExplode || hasParts;
  const explodeHidden = parts !== null && !hasParts;
  const thermalOn = view === 'thermal' && live && ready;

  const toolbar = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {offered.length > 1 && (
          <div role="group" aria-label={UI.viewers.model.views} className="flex flex-wrap items-center gap-1">
            {offered.map((option) => (
              <button
                key={option}
                type="button"
                className="viewer-button px-3"
                aria-pressed={view === option}
                disabled={failed || webgl === false}
                onClick={() => chooseView(option)}
              >
                {UI.viewers.model[option]}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <ToolButton label={UI.viewers.model.rotateLeft} disabled={controlsDisabled} onClick={command((api) => api.rotate(ROTATE_STEP, 0))}>
            <RotateCcw size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.model.rotateRight} disabled={controlsDisabled} onClick={command((api) => api.rotate(-ROTATE_STEP, 0))}>
            <RotateCw size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.model.rotateUp} disabled={controlsDisabled} onClick={command((api) => api.rotate(0, ROTATE_STEP))}>
            <ChevronUp size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.model.rotateDown} disabled={controlsDisabled} onClick={command((api) => api.rotate(0, -ROTATE_STEP))}>
            <ChevronDown size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.zoomIn} disabled={controlsDisabled} onClick={command((api) => api.zoom(1 / ZOOM_STEP))}>
            <ZoomIn size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.zoomOut} disabled={controlsDisabled} onClick={command((api) => api.zoom(ZOOM_STEP))}>
            <ZoomOut size={18} aria-hidden />
          </ToolButton>
          <ToolButton label={UI.viewers.resetView} disabled={controlsDisabled} onClick={command((api) => api.reset())}>
            <Home size={18} aria-hidden />
          </ToolButton>
        </div>
      </div>
      {showPartsRow && (
        <div className="flex min-h-[44px] min-w-0 flex-nowrap items-center gap-x-4">
          {offerExplode && (
            <label className={cn('flex min-h-[44px] shrink-0 items-center gap-2 pl-2', explodeHidden && 'invisible')}>
              <span className="font-mono text-xs text-ink-mute">{UI.viewers.model.explode}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={explodeAmount}
                disabled={controlsDisabled || explodeHidden}
                aria-valuetext={`${explodeAmount}%`}
                onChange={(event) => {
                  setExplodeAmount(Number(event.target.value));
                  interact();
                }}
                className="h-11 w-28 cursor-pointer disabled:cursor-not-allowed sm:w-40"
              />
            </label>
          )}
          {parts && hasParts && (
            // Width 0 and a share of the free space: a long list never widens the toolbar.
            <div className="flex w-0 min-w-0 flex-1 items-center gap-2 pl-2">
              <span id={partsLabelId} className="shrink-0 font-mono text-xs text-ink-mute">
                {UI.viewers.model.parts}
              </span>
              {/* The padding, offset by the margin, keeps the 2 px focus ring inside the scrolling list. */}
              <ul
                aria-labelledby={partsLabelId}
                className="-m-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto p-1 [scrollbar-width:thin]"
              >
                {parts.map((part) => (
                  <li key={part.id} className="shrink-0">
                    <button
                      type="button"
                      className="viewer-button px-3 font-mono text-xs"
                      aria-pressed={pinned === part.id}
                      disabled={controlsDisabled}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'mouse') setHovered(part.id);
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === 'mouse') setHovered(null);
                      }}
                      onFocus={onPartFocus(part.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setPinned((current) => (current === part.id ? null : part.id))}
                    >
                      {part.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ViewerFrame
      label={UI.viewers.model.modelFallback}
      aspect={aspectOf(media, 4 / 3)}
      caption={media.caption}
      description={media.alt || undefined}
      toolbar={toolbar}
    >
      <div ref={wellRef} className="absolute inset-0">
        {!(live && ready) &&
          (media.poster || !(requiresTap && !started) ? (
            <Poster media={media} />
          ) : (
            // Waiting for a tap with no poster: the plain grid, so nothing shows around the button.
            <div className="viewer-placeholder" aria-hidden />
          ))}
        {engineOn && (
          <ViewerErrorBoundary fallback={<Notice text={UI.viewers.model.failed} onShown={handleFailed} />}>
            <ModelEngine
              src={media.file.src}
              view={view}
              explode={explodeAmount / 100}
              highlight={hovered ?? pinned}
              autoTurn={!reducedMotion && !touched}
              running={documentVisible && inView}
              reducedMotion={reducedMotion}
              callouts={callouts}
              handleRef={handleRef}
              autoFocus={focusEngine}
              onReady={handleReady}
              onInteract={interact}
              onContextLost={handleContextLost}
            />
          </ViewerErrorBoundary>
        )}
        {requiresTap && !started && (
          <TapToLoad label={UI.viewers.model.load} onActivate={startFromButton} icon={<Box size={18} aria-hidden />} />
        )}
        {suspended && (
          <div className="viewer-tap px-4">
            <div className="flex max-w-xs flex-col items-center gap-3 rounded-sm bg-well/90 px-4 py-3 text-center">
              <p className="font-mono text-xs text-well-ink">{UI.viewers.model.paused}</p>
              <button type="button" className="viewer-tap__button" onClick={startFromButton}>
                <Play size={18} aria-hidden />
                <span>{UI.viewers.model.resume}</span>
              </button>
            </div>
          </div>
        )}
        {webgl === false && <Notice text={UI.viewers.model.noWebgl} />}
        {live && !ready && (
          <p role="status" className="absolute bottom-3 left-3 font-mono text-xs text-well-ink">
            {UI.viewers.loading}
          </p>
        )}
        <div aria-live="polite" className="pointer-events-none absolute left-3 top-3">
          {thermalOn && (
            <p className="rounded-sm bg-well/75 px-2 py-1 font-mono text-xs text-well-ink">
              {UI.viewers.model.thermalCaption}
            </p>
          )}
        </div>
      </div>
    </ViewerFrame>
  );
}
