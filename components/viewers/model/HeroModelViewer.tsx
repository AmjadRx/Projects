'use client';

/**
 * The hero's model (ARCHITECTURE.md 6, hero mode "model"; DESIGN_DIRECTION.md 6.1 "The realistic
 * hero" and 6.3; motion sheets 4.3 and 4.5; the canvas's Hero-1440-Realistic and
 * Hero-390-Realistic boards, home.css "Realistic mode"): settings.heroModel, the owner's own GLB,
 * in front of the sky and lit by it (skyLight.ts), with the views Realistic, Blueprint and Thermal
 * on a small switch, drag to orbit, the thermal lens in the Realistic view, and RotorL and RotorR
 * tilting with the hero's scroll. It shares the viewers' engine (ModelEngine.tsx).
 *
 *   figure.hm-model
 *     div.hm-model__stage     the poster, then the canvas; the lens ring; the load button
 *     p.ar-sr                 the model's alt text, which the canvas names as its description
 *     div.hm-model__bar       the view switch (glass) and "Drag to orbit"
 *     figcaption.hm-art__cap  the hero caption (the Thermal view is an illustration), last
 *
 * The home page loads this file through HeroModelLazy.tsx, as a chunk of its own.
 *
 * - The poster paints first. On desktop the engine loads after the page is interactive
 *   (useHeroActivation); on phones and tablets after a tap, and then the model turns slowly until
 *   first touched (hero.model.phoneTurn). On desktop it rests at its three-quarter view.
 * - Drag to orbit, with inertia; 1.5 s after the last input it eases back to its three-quarter
 *   view over 1,200 ms. Views cross-fade in 200 ms. There is no zoom: scrolling the page over the
 *   hero always scrolls the page.
 * - The lens (useHeroLens), in the Realistic view: the drawing's 220 px ring, at rest where the
 *   board draws it; while a mouse or a pen is over the stage it follows with the lens spring, its
 *   ring then the Motion+ Cursor, and goes back to rest with the rest spring when it leaves.
 * - Without motion (reduced motion, the pause control): no turn, no glide, no return (it stays
 *   where it is left), no tilt, no lens; views change at once; the drag still orbits.
 *
 * Like every viewer it holds one of the two live slots (activeViewers.ts) and steps back to its
 * poster with a resume button when another viewer needs it.
 */
import dynamic from 'next/dynamic';
import { Box, Play, RotateCcw } from 'lucide-react';
import { useMotionValue } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import Icon from '@/components/sheet/Icon';
import type { ResolvedMedia } from '@/lib/media';
import { cssEasing, hero as heroMotion, toMs } from '@/lib/motion';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster from '../shared/Poster';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import { claimViewerSlot, releaseViewerSlot, touchViewerSlot } from '../shared/activeViewers';
import { useDocumentVisible, useFinePointer, useInView } from '../shared/hooks';
import type { ModelView } from '../types';
import type { EngineHandle, HeroEngineInputs } from './engine-types';
import styles from './ModelViewer.module.css';
import Notice from './Notice';
import { HINT_FADE_VARS } from './orbit';
import { useHeroActivation } from './useHeroActivation';
import { lensEnabled, useHeroLens } from './useHeroLens';
import { useHeroScroll } from './useHeroScroll';
import { useModelMotion } from './useModelMotion';
import { supportsWebGL2 } from './webgl';

const ModelEngine = dynamic(() => import('./ModelEngine'), { ssr: false, loading: () => null });

/** The hero's three views, in the switch's order (DESIGN_DIRECTION.md 6.1). */
const VIEWS: ModelView[] = ['realistic', 'blueprint', 'thermal'];

/** The hero has no dimension callouts: the content gives its model none. */
const NO_CALLOUTS: { label: string; value: string }[] = [];

/** The hero's visual column (components/home/Hero.tsx): 40vw from 1024 px, 28rem from 768 px, else 90vw. */
const HERO_SIZES = '(min-width: 1024px) 40vw, (min-width: 768px) 28rem, 90vw';

/** The stage is the drawing's box, 600 by 560 (home.css .hm-model__stage). */
const STAGE_ASPECT = heroMotion.drawing.width / heroMotion.drawing.height;

/** The poster's fade under the first frame, for app/motion-model.css .hm-model__poster. */
const POSTER_OUT = {
  '--hm-poster-out': `${toMs(heroMotion.model.posterOut.duration)}ms`,
  '--hm-poster-ease': cssEasing(heroMotion.model.posterOut.ease),
} as CSSProperties;

export default function HeroModelViewer({ media, caption }: { media: ResolvedMedia; caption: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const slotId = useId();
  const descriptionId = useId();
  const motion = useModelMotion();
  const fine = useFinePointer();
  const documentVisible = useDocumentVisible();
  const inView = useInView(stageRef);
  const { active, requiresTap, byTap, activate } = useHeroActivation(stageRef);
  const rotor = useHeroScroll(stageRef);
  const explode = useMotionValue(0);

  const [view, setView] = useState<ModelView>('realistic');
  const [ready, setReady] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  /** The visitor pressed the load or resume button: the engine takes focus when it mounts. */
  const [focusEngine, setFocusEngine] = useState(false);

  useEffect(() => {
    if (active && webgl === null) setWebgl(supportsWebGL2());
  }, [active, webgl]);

  const engineOn = active && webgl === true && !suspended;
  const live = engineOn && !failed;
  const lens = useHeroLens(stageRef, lensEnabled({ motion, finePointer: fine, engineReady: live && ready, view }));

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

  const handleReady = useCallback(() => setReady(true), []);

  const handleContextLost = useCallback(() => {
    setSuspended(true);
    setReady(false);
  }, []);

  const handleFailed = useCallback(() => setFailed(true), []);

  const start = () => {
    if (!active) activate();
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

  const posterAspect = media.width && media.height ? media.width / media.height : undefined;
  const heroInputs = useMemo<HeroEngineInputs>(
    () => ({ rotor, lens: lens.values, posterAspect }),
    [lens.values, posterAspect, rotor],
  );

  // The poster gives way to the first frame (hero.model.posterOut), and comes back with the poster
  // state (the viewer stepped back, or the engine failed).
  const engineShown = live && ready;
  const [posterGone, setPosterGone] = useState(false);
  useEffect(() => {
    if (!engineShown) {
      setPosterGone(false);
      return undefined;
    }
    if (!motion) {
      setPosterGone(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPosterGone(true), toMs(heroMotion.model.posterOut.duration));
    return () => window.clearTimeout(timer);
  }, [engineShown, motion]);

  return (
    <figure className="hm-model">
      <div ref={stageRef} className="hm-model__stage" {...lens.handlers}>
        {/* Waiting for a tap with no poster: nothing over the sky but the button. */}
        {!posterGone && (media.poster || !(requiresTap && !active)) && (
          <div className={cn('hm-model__poster', engineShown && 'is-out')} style={POSTER_OUT}>
            <Poster media={media} priority sizes={HERO_SIZES} wellAspect={STAGE_ASPECT} />
          </div>
        )}
        {engineOn && (
          <ViewerErrorBoundary fallback={<Notice text={UI.viewers.model.failed} onShown={handleFailed} />}>
            <ModelEngine
              src={media.file.src}
              view={view}
              explode={explode}
              highlight={null}
              autoTurn={motion && byTap && !touched}
              running={documentVisible && inView}
              motion={motion}
              fullscreen={false}
              descriptionId={media.alt ? descriptionId : undefined}
              callouts={NO_CALLOUTS}
              handleRef={handleRef}
              autoFocus={focusEngine}
              onReady={handleReady}
              onInteract={interact}
              onContextLost={handleContextLost}
              hero={heroInputs}
            />
          </ViewerErrorBoundary>
        )}
        <span ref={lens.ringRef} className="hm-model__ring" aria-hidden="true" />
        {/* While the lens follows a mouse or a pen, its ring is the Motion+ Cursor (portalled to the body). */}
        {lens.follow}
        {requiresTap && !active && (
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
      </div>
      {/* The model's text description, read with the canvas; before the bar, so the caption stays the figure's last child. */}
      {media.alt ? (
        <p id={descriptionId} className="ar-sr">
          {media.alt}
        </p>
      ) : null}
      <div className="hm-model__bar">
        <div role="group" aria-label={UI.viewers.model.views} className="ar-mv__views">
          {VIEWS.map((option) => (
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
        {/* Until the first touch, then it fades; it keeps its place after, so the bar never moves. */}
        <span
          className={cn('hm-model__hint', styles.hint, (touched || failed || webgl === false) && styles.hintHidden)}
          style={motion ? (HINT_FADE_VARS as CSSProperties) : undefined}
        >
          <Icon icon={RotateCcw} size={16} />
          {UI.viewers.model.hint}
        </span>
      </div>
      <figcaption className="hm-art__cap">{caption}</figcaption>
    </figure>
  );
}
