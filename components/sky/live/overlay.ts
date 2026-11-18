/**
 * The drafting lines and the star name (Full tier, Blueprint): a 2D canvas above the WebGL canvas,
 * inside the scene's container. It draws what the reference draws when the pointer rests near
 * bright stars: a line through up to four of them like a survey traverse, a box round each, and
 * the IAU name of the brightest named one, in the page's data face. The line and the boxes draw
 * themselves along their length; the name fades in after them. Nothing else in the sky carries
 * text.
 */
import { SKY } from '@/lib/motion';
import { cssRgba, type Rgb } from './colors';
import type { BrightStar, DraftingSelection } from './math';

export interface OverlayStyle {
  line: Rgb;
  ink: Rgb;
  mono: string;
}

type Point = [number, number];

/** Strokes the first `length` px of a polyline. */
function strokePartial(ctx: CanvasRenderingContext2D, points: readonly Point[], length: number): void {
  if (points.length < 2 || length <= 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  let left = length;
  for (let i = 1; i < points.length && left > 0; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg <= left) {
      ctx.lineTo(x1, y1);
      left -= seg;
    } else {
      const k = seg > 0 ? left / seg : 0;
      ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      left = 0;
    }
  }
  ctx.stroke();
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

export class DraftingOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dirty = false;
  private fontAsked = '';

  constructor(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setSize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.dirty = false;
  }

  /** Clears everything at once (the pointer moved, or the tier or theme changed). */
  clear(): void {
    if (!this.dirty || !this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }

  /**
   * Draws a selection: `drawn` (0 to 1, already eased) of the line's and the boxes' length, and
   * the name at opacity `nameAlpha` (0 to 1, already eased).
   */
  draw(selection: DraftingSelection<BrightStar>, drawn: number, nameAlpha: number, style: OverlayStyle): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
    if (!selection.near.length || drawn <= 0) return;
    const { box, lineAlpha, lineWidth, nameOffset, nameSize } = SKY.drafting;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = cssRgba(style.line, lineAlpha);
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    const chain: Point[] = selection.chain.map((b) => [b.x, b.y]);
    strokePartial(ctx, chain, polylineLength(chain) * drawn);

    const half = box / 2;
    for (const b of selection.near) {
      // As the reference: whole-pixel boxes, so the 1 px strokes stay sharp.
      const x0 = Math.round(b.x - half) + 0.5;
      const y0 = Math.round(b.y - half) + 0.5;
      const square: Point[] = [
        [x0, y0],
        [x0 + box, y0],
        [x0 + box, y0 + box],
        [x0, y0 + box],
        [x0, y0],
      ];
      strokePartial(ctx, square, box * 4 * drawn);
    }

    const named = selection.named;
    if (named && named.name && nameAlpha > 0) {
      const font = `${nameSize}px ${style.mono}`;
      this.askFont(font);
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = cssRgba(style.ink, Math.max(0, Math.min(1, nameAlpha)));
      ctx.fillText(named.name, named.x + nameOffset, named.y - nameOffset);
    }
    this.dirty = true;
  }

  /** The data face is not preloaded: ask for it the first time a name is drawn (the next frames use it). */
  private askFont(font: string): void {
    if (this.fontAsked === font) return;
    this.fontAsked = font;
    try {
      void document.fonts?.load(font).catch(() => undefined);
    } catch {
      // A browser without the font loading API draws with whatever face it has.
    }
  }

  destroy(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.remove();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
