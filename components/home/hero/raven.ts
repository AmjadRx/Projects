/**
 * Raven in plan view, the hero drawing's geometry (DESIGN_DIRECTION.md 6.1; ARCHITECTURE.md 6),
 * in the drawing's 600 by 560 units with the nose up the sheet. Every shape is the owner's, taken
 * from the Hero boards of the design canvas (Hero-1440-Rest, -Rotor, -Cruise, Hero-390-Scan and
 * -Still all draw the canvas's Main board): a simple tri-tiltrotor outline built from basic shapes,
 * tracing no aircraft (D-51). The numbers here are drawing coordinates; every number of motion is
 * in lib/motion.ts (`hero`).
 *
 * Also the pure parts of the motion: where a pointer lands in drawing units, the lens's frame, and
 * the pose of the rotors at a given tilt. No React, so tests can call everything.
 */
import { hero } from '@/lib/motion';

export const VIEW = hero.drawing;

// ---------------------------------------------------------------------------------------------
// The line layer
// ---------------------------------------------------------------------------------------------

/** The centre line, dash-dotted. */
export const AXIS = { x: 300, y1: 14, y2: 548 } as const;

/** The wings, root leading edge to tip and back to the root trailing edge; left, then right. */
export const WINGS = ['M275,170 L42,182 L42,206 L275,222', 'M325,170 L558,182 L558,206 L325,222'] as const;

/** The control surface hinge lines, thin and faint. */
export const HINGES = ['M262,214 L64,204', 'M338,214 L536,204'] as const;

/** The two wing booms that carry the tilting motors. */
export const BOOM = { xs: [143, 443], y: 112, width: 14, height: 150, rx: 7 } as const;

/** The wing rotors: hub centres, the disc's radius, the hub's radius. */
export const ROTOR = { xs: [150, 450], cy: 128, discR: 74, hubR: 4, discOpacity: 0.75 } as const;

/** One blade line across each wing disc, 20 degrees off the span, 70 units each side of the hub. */
export const BLADE = { angle: 20, half: 70, opacity: 0.9 } as const;

/**
 * The tilting motor pod at the front of each boom: a capsule `width` wide whose round caps are
 * centred at `front` and `back` at hover. As the rotor tilts, the front cap moves forward
 * (hero.rotor.podGrow) and the sides lengthen; the back cap stays put. Drawn as two caps and two
 * sides, so it stays a true capsule while its length changes by transform alone.
 */
export const POD = { xs: [150, 450], halfWidth: 9, front: 127, back: 129 } as const;

/** The fuselage outline, from the nose, clockwise. */
export const FUSELAGE =
  'M300,34 C314,34 325,62 325,104 L325,262 C325,292 310,312 307,334 L307,452 C307,458 293,458 293,452 L293,334 C290,312 275,292 275,262 L275,104 C275,62 286,34 300,34 Z';

/** The canopy, thin. */
export const CANOPY = { cx: 300, cy: 76, rx: 9, ry: 18 } as const;

/** The battery bay, thin and lighter, under the lens's rest point. */
export const BATTERY_BAY = { x: 284, y: 150, width: 32, height: 86, rx: 3, opacity: 0.7 } as const;

/** The V-tail, left and right. */
export const V_TAIL = ['M293,384 L238,410 L232,432 L293,430 Z', 'M307,384 L362,410 L368,432 L307,430 Z'] as const;

/** The tail rotor, which never tilts: its pod, disc, blade and hub. */
export const TAIL = {
  pod: { x: 296, y: 452, width: 8, height: 26, rx: 4 },
  cx: 300,
  cy: 482,
  discR: 48,
  discOpacity: 0.75,
  blade: { x1: 258, y1: 497, x2: 342, y2: 467, opacity: 0.9 },
  hubR: 4,
} as const;

// ---------------------------------------------------------------------------------------------
// The thermal layer: the same geometry filled with the ramp, warmest at the motors and the battery
// ---------------------------------------------------------------------------------------------

/** The battery's warm core. */
export const BATTERY_HEAT = { cx: 300, cy: 193, rx: 46, ry: 70 } as const;

/** The radius of the heat at each motor. */
export const MOTOR_HEAT_R = 40;

/**
 * The power runs from the battery to the motors. The two wing runs end just behind each hub
 * (ROTOR.cy plus 6) and follow it as the rotor moves forward.
 */
export const CABLES = {
  left: { x1: 290, y1: 196, x2: 150, y2: 134 },
  right: { x1: 310, y1: 196, x2: 450, y2: 134 },
  tail: { x1: 300, y1: 236, x2: 300, y2: 470 },
} as const;

// ---------------------------------------------------------------------------------------------
// The lens
// ---------------------------------------------------------------------------------------------

/** The four short ticks outside the ring: they start `gap` units out and run `length` units. */
export const LENS_TICK = { gap: 4, length: 10 } as const;

/** Room around the ticks for the widest stroke the drawing gives the ring (2.2 units on narrow frames). */
const LENS_STROKE_ROOM = 2;

/** The ticks of a lens of radius `r` centred on (0, 0), as one path. */
export function lensTicks(r: number = hero.lens.radius): string {
  const a = r + LENS_TICK.gap;
  const b = a + LENS_TICK.length;
  return `M0,${-a} V${-b} M${a},0 H${b} M0,${a} V${b} M${-a},0 H${-b}`;
}

/**
 * Half the side of the square that holds a ring of radius `r`, its ticks and their stroke, in
 * drawing units: the Motion+ Cursor draws the ring in a square this size (PointerLens).
 */
export function lensBox(r: number = hero.lens.radius): number {
  return r + LENS_TICK.gap + LENS_TICK.length + LENS_STROKE_ROOM;
}

/** A point in drawing units as a point in the page (client px), given the drawing's box: toDrawing's inverse. */
export function fromDrawing(p: Point, box: { left: number; top: number; width: number; height: number }): Point {
  return { x: box.left + (p.x / VIEW.width) * box.width, y: box.top + (p.y / VIEW.height) * box.height };
}

/** One decimal, as the boards print coordinates. */
function d1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** A wing rotor's blade line through the hub at (cx, ROTOR.cy). */
export function bladePath(cx: number): string {
  const rad = (BLADE.angle * Math.PI) / 180;
  const dx = Math.cos(rad) * BLADE.half;
  const dy = Math.sin(rad) * BLADE.half;
  return `M${d1(cx - dx)},${d1(ROTOR.cy - dy)} L${d1(cx + dx)},${d1(ROTOR.cy + dy)}`;
}

/** A pod's front cap (over the front) and back cap (under the back), at hover. */
export function podCaps(cx: number): { front: string; back: string; sides: string } {
  const r = POD.halfWidth;
  const left = cx - r;
  const right = cx + r;
  return {
    front: `M${left},${POD.front} A${r},${r} 0 0 1 ${right},${POD.front}`,
    back: `M${right},${POD.back} A${r},${r} 0 0 1 ${left},${POD.back}`,
    sides: `M${left},${POD.front} V${POD.back} M${right},${POD.front} V${POD.back}`,
  };
}

/** The scan band's width in drawing units (load.scan.width of the drawing, 132). */
export function bandWidth(width: number, share: number): number {
  return Math.round(width * share);
}

// ---------------------------------------------------------------------------------------------
// Pointer to drawing units, and the lens's frame
// ---------------------------------------------------------------------------------------------

export type Point = { x: number; y: number };

/** A point in the page (client px) as drawing units, given the drawing's box on the page. */
export function toDrawing(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): Point {
  return {
    x: box.width > 0 ? ((clientX - box.left) / box.width) * VIEW.width : hero.lens.rest.x,
    y: box.height > 0 ? ((clientY - box.top) / box.height) * VIEW.height : hero.lens.rest.y,
  };
}

/** The lens's centre stays inside the inner frame (sheet 4.1: 40 to 560 across, 40 to 520 down). */
export function clampToFrame(p: Point): Point {
  const { left, right, top, bottom } = hero.lens.frame;
  return { x: Math.min(right, Math.max(left, p.x)), y: Math.min(bottom, Math.max(top, p.y)) };
}

// ---------------------------------------------------------------------------------------------
// The rotors' pose at a tilt (sheet 4.3; hero.rotor)
// ---------------------------------------------------------------------------------------------

/** Every value the tilt sets, as SVG transform strings and opacities. */
export type RotorPose = {
  /** The tilt's progress from hover (0) to cruise (1). */
  progress: number;
  /** Hubs, blades and the motors' heat: forward by hero.rotor.nacelleShift at cruise. */
  rotor: string;
  /** Each wing disc, line and thermal: forward with the rotor, folded to cos(tilt) of its height. */
  disc: string;
  /** The pod's front cap: forward by hero.rotor.podGrow at cruise. */
  podFront: string;
  /** The pod's sides: stretched forward from the back cap to meet the front cap. */
  podSides: string;
  /** The two wing power runs, sheared so their motor ends follow the hubs. */
  cableLeft: string;
  cableRight: string;
  /** Opacity of the wing blades, of the tail disc and blade, of the tail's heat. */
  blades: number;
  tail: number;
  tailHeat: number;
};

/** `places` decimals at most, and never -0, for an SVG attribute. */
function round(v: number, places: number): number {
  const k = 10 ** places;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
}

const round4 = (v: number) => round(v, 4);

/** A translation or an opacity for an SVG attribute. */
function n(v: number): string {
  return String(round4(v));
}

/**
 * Scale in y by `s` about the line y = `y0`, then move by `dy`. The offset is worked out from the
 * rounded scale, so the line y = y0 lands exactly `dy` away whatever the rounding.
 */
function scaleYAbout(y0: number, s: number, dy: number): string {
  const scale = round(s, 6);
  return `matrix(1 0 0 ${scale} 0 ${round(y0 * (1 - scale) + dy, 6)})`;
}

/**
 * Shear in y so a line from (x1, y1) keeps that end exactly and moves its (x2, y2) end by `dy`.
 */
function shearRun(run: { x1: number; x2: number }, dy: number): string {
  const k = round(dy / (run.x2 - run.x1), 6);
  return `matrix(1 ${k} 0 1 0 ${round(-k * run.x1, 6)})`;
}

/**
 * The rotors at `tiltDeg` degrees, clamped between hover and cruise: the angle is a pure function
 * of the hero's scroll progress, linear and clamped (sheet 4.3), and this turns it into the
 * drawing's transforms. The tail rotor never tilts; it only dims a little at cruise.
 */
export function rotorPose(tiltDeg: number): RotorPose {
  const { hover, cruise, nacelleShift, podGrow, fade } = hero.rotor;
  const angle = Math.min(cruise, Math.max(hover, Number.isFinite(tiltDeg) ? tiltDeg : hover));
  const progress = (angle - hover) / (cruise - hover);
  const shift = -nacelleShift * progress;
  const grow = podGrow * progress;
  const fold = Math.cos((angle * Math.PI) / 180);
  const sides = POD.back - POD.front;
  return {
    progress,
    rotor: `translate(0 ${n(shift)})`,
    disc: scaleYAbout(ROTOR.cy, fold, shift),
    podFront: `translate(0 ${n(-grow)})`,
    podSides: scaleYAbout(POD.back, (sides + grow) / sides, 0),
    cableLeft: shearRun(CABLES.left, shift),
    cableRight: shearRun(CABLES.right, shift),
    blades: round4(1 - fade.blades * progress),
    tail: round4(1 - fade.tail * progress),
    tailHeat: round4(1 - fade.tailHeat * progress),
  };
}

/** The parts the tilt moves, by their data-hd name in the drawing's markup (RavenDrawing.tsx). */
export const PART = {
  rotor: 'rotor',
  disc: 'disc',
  podFront: 'pod-front',
  podSides: 'pod-sides',
  cableLeft: 'cable-left',
  cableRight: 'cable-right',
  blade: 'blade',
  tail: 'tail',
  tailHeat: 'tail-heat',
  /** The lens: the thermal layer's clip circle and the ring, moved together. */
  lens: 'lens',
} as const;
