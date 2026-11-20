import type { CSSProperties } from 'react';
import { introGoScript } from '@/lib/intro';
import { cssEasing, hero, load, toMs } from '@/lib/motion';
import { UI } from '@/lib/strings';
import DrawingStage from './DrawingStage';
import RavenDrawing from './RavenDrawing';
import { VIEW, bandWidth } from './raven';

const ms = (seconds: number) => `${toMs(seconds)}ms`;

/**
 * The numbers app/motion-drawing.css reads, from lib/motion.ts: the drawing's size in units (for
 * strokes drawn in screen pixels, and for the box's height cap), the load sequence's steps (sheet
 * 2: the stroke-in, the desktop lens fading in, the phone scan band's travel from off the left
 * edge to off the right), and the static split's line.
 */
const DRAWING_STYLE = {
  '--hd-w': String(VIEW.width),
  '--hd-h': String(VIEW.height),
  '--hd-draw-delay': ms(load.drawing.start),
  '--hd-draw-dur': ms(load.drawing.duration),
  '--hd-draw-ease': cssEasing(load.drawing.ease),
  '--hd-lens-delay': ms(load.lens.start),
  '--hd-lens-dur': ms(load.lens.duration),
  '--hd-lens-ease': cssEasing(load.lens.ease),
  '--hd-scan-delay': ms(load.scan.start),
  '--hd-scan-dur': ms(load.scan.duration),
  '--hd-scan-ease': cssEasing(load.scan.ease),
  '--hd-scan-from': `${-bandWidth(VIEW.width, load.scan.width)}px`,
  '--hd-scan-to': `${VIEW.width}px`,
  '--hd-split-line': `${hero.split.line}px`,
} as CSSProperties;

/**
 * The hero visual in `drawing` mode, and in `model` mode until the owner's model hero exists
 * (ARCHITECTURE.md 6): Raven in plan view with the thermal lens, and the fixed caption under it,
 * which never moves. The figure is the canvas's hm-hero__art; its caption names it.
 *
 * The inline script right after the svg is the load sequence's go (lib/intro.ts introGoScript):
 * on a full page load it runs once the whole drawing has been parsed, so every stroke starts
 * drawing in the same frame, and it ends the sequence when the drawing's steps have ended.
 */
export default function HeroDrawing() {
  return (
    <figure className="hm-hero__art hm-hero__art--drawing" style={DRAWING_STYLE}>
      <DrawingStage>
        <RavenDrawing label={UI.hero.drawing} />
        <script dangerouslySetInnerHTML={{ __html: introGoScript() }} />
      </DrawingStage>
      <figcaption className="hm-art__cap">{UI.heroCaption}</figcaption>
    </figure>
  );
}
