'use client';

/**
 * The 3D model viewer (bundle ModelViewer; ARCHITECTURE.md 13A "ModelViewer"; DESIGN_DIRECTION.md
 * 6.1 and 11): a 16:10 well, the views (Realistic, Blueprint, Thermal) as a pressed group on the
 * bar with the camera buttons beside it and the hint "Drag to orbit" until the first touch, then
 * the exploded-view range and the parts list. The Thermal view is labelled "Illustration, not
 * measured data." in the well's bottom left corner.
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
import { Box, ChevronDown, ChevronUp, Home, Play, RotateCcw, RotateCw, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import Icon from '@/components/sheet/Icon';
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
import styles from './ModelViewer.module.css';

const ModelEngine = dynamic(() => import('./ModelEngine'), { ssr: false, loading: () => null });

/** The well (bundle MediaFrame): 16:10. */
const MODEL_ASPECT = 16 / 10;

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
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button type="button" className="ar-mv__btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon icon={icon} size={18} />
    </button>
  );
}

/** A short line on a night plate over the poster: why the engine is not running. */
function Notice({ text, onShown }: { text: string; onShown?: () => void }) {
  useEffect(() => {
    onShown?.();
  }, [onShown]);
  return (
    <p role="status" className="ar-mv__note">
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
    <>
      <div className={styles.row}>
        {offered.length > 1 && (
          <div role="group" aria-label={UI.viewers.model.views} className="ar-mv__views">
            {offered.map((option) => (
              <button
                key={option}
                type="button"
                className="ar-mv__btn ar-mv__btn--text"
                aria-pressed={view === option}
                disabled={failed || webgl === false}
                onClick={() => chooseView(option)}
              >
                {UI.viewers.model[option]}
              </button>
            ))}
          </div>
        )}
        <div className="ar-mv__group">
          <ToolButton label={UI.viewers.model.rotateLeft} icon={RotateCcw} disabled={controlsDisabled} onClick={command((api) => api.rotate(ROTATE_STEP, 0))} />
          <ToolButton label={UI.viewers.model.rotateRight} icon={RotateCw} disabled={controlsDisabled} onClick={command((api) => api.rotate(-ROTATE_STEP, 0))} />
          <ToolButton label={UI.viewers.model.rotateUp} icon={ChevronUp} disabled={controlsDisabled} onClick={command((api) => api.rotate(0, ROTATE_STEP))} />
          <ToolButton label={UI.viewers.model.rotateDown} icon={ChevronDown} disabled={controlsDisabled} onClick={command((api) => api.rotate(0, -ROTATE_STEP))} />
          <ToolButton label={UI.viewers.zoomIn} icon={ZoomIn} disabled={controlsDisabled} onClick={command((api) => api.zoom(1 / ZOOM_STEP))} />
          <ToolButton label={UI.viewers.zoomOut} icon={ZoomOut} disabled={controlsDisabled} onClick={command((api) => api.zoom(ZOOM_STEP))} />
          <ToolButton label={UI.viewers.resetView} icon={Home} disabled={controlsDisabled} onClick={command((api) => api.reset())} />
        </div>
        {/* Until the first touch; it keeps its place after, so the bar never moves. */}
        <span className={cn('ar-mv__hint', (touched || failed || webgl === false) && styles.hintHidden)}>
          {UI.viewers.model.hint}
        </span>
      </div>
      {showPartsRow && (
        <div className={styles.partsRow}>
          {offerExplode && (
            <label className={cn('ar-mv__range', explodeHidden && styles.invisible)}>
              <span>{UI.viewers.model.explode}</span>
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
              />
            </label>
          )}
          {parts && hasParts && (
            // Width 0 and a share of the free space: a long list never widens the bar.
            <div className={styles.parts}>
              <span id={partsLabelId} className={styles.partsLabel}>
                {UI.viewers.model.parts}
              </span>
              <ul aria-labelledby={partsLabelId} className={styles.partsList}>
                {parts.map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      className={cn('ar-mv__btn ar-mv__btn--text', styles.part)}
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
    </>
  );

  return (
    <ViewerFrame
      label={UI.viewers.model.modelFallback}
      kind={UI.viewers.kind.model}
      aspect={MODEL_ASPECT}
      caption={media.caption}
      fileName={media.file.name}
      description={media.alt || undefined}
      toolbar={toolbar}
    >
      <div ref={wellRef} className={styles.well}>
        {/* Waiting for a tap with no poster: the plain grid, so nothing shows around the button. */}
        {!(live && ready) && (media.poster || !(requiresTap && !started)) && <Poster media={media} wellAspect={MODEL_ASPECT} />}
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
          <TapToLoad label={UI.viewers.model.load} onActivate={startFromButton} icon={<Icon icon={Box} size={18} />} />
        )}
        {suspended && (
          <>
            <TapToLoad label={UI.viewers.model.resume} onActivate={startFromButton} icon={<Icon icon={Play} size={18} />} />
            <p className="ar-mv__note">{UI.viewers.model.paused}</p>
          </>
        )}
        {webgl === false && <Notice text={UI.viewers.model.noWebgl} />}
        {live && !ready && (
          <p role="status" className="ar-mv__note">
            {UI.viewers.loading}
          </p>
        )}
        {/* The Thermal view's label (bundle .ar-mv__note), announced when it appears. */}
        <div aria-live="polite">
          {thermalOn && <p className="ar-mv__note">{UI.viewers.model.thermalCaption}</p>}
        </div>
      </div>
    </ViewerFrame>
  );
}
