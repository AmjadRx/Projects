import { hero, load } from '@/lib/motion';
import {
  AXIS,
  BATTERY_BAY,
  BATTERY_HEAT,
  BLADE,
  BOOM,
  CABLES,
  CANOPY,
  FUSELAGE,
  HINGES,
  MOTOR_HEAT_R,
  PART,
  POD,
  ROTOR,
  TAIL,
  V_TAIL,
  VIEW,
  WINGS,
  bandWidth,
  bladePath,
  lensTicks,
  podCaps,
} from './raven';

const LENS_R = hero.lens.radius;
const AT_REST = `translate(${hero.lens.rest.x} ${hero.lens.rest.y})`;
const BAND = bandWidth(VIEW.width, load.scan.width);
const line = (run: { x1: number; y1: number; x2: number; y2: number }) => `M${run.x1},${run.y1} L${run.x2},${run.y2}`;

/**
 * Raven in plan view (DESIGN_DIRECTION.md 6.1; ARCHITECTURE.md 6, mode "drawing"), inline SVG
 * rendered on the server so it paints with the HTML. The geometry is in ./raven.ts.
 *
 *   svg[role=img]                the drawing's text alternative is its label
 *     defs                       the thermal layer's clip (lens circle, split half), the scan
 *                                band's clips, the ramp's gradients, the stroke-in mask
 *     g.hd-line                  the line layer, in the line color on the sheet
 *       g.hd-dash                the dashed lines (centre line, rotor discs), revealed through
 *                                the mask while the load sequence strokes the drawing in
 *     g.hd-th                    the thermal layer: the same geometry filled with the ramp,
 *                                seen through the lens (or the right half in the static split)
 *     g.hd-scan                  the phone and tablet scan band, crossing once on load
 *     g.hd-ring                  the lens ring and its four ticks
 *     path.hd-split              the 1 px line of the static split
 *
 * Everything but the line layer is decorative and hidden from assistive technology, and nothing
 * carries a number a visitor reads. Every solid stroke has pathLength 1, so the stroke-in is a
 * dash offset in CSS (app/motion-drawing.css); the parts the tilt moves are named by data-hd
 * (PART), and the lens sits at its rest point until a pointer or a finger moves it.
 */
export default function RavenDrawing({ label }: { label: string }) {
  return (
    <svg className="hd-svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-label={label}>
      <defs>
        <clipPath id="hd-lens-clip">
          <circle className="hd-clip-lens" data-hd={PART.lens} r={LENS_R} transform={AT_REST} />
          <rect className="hd-clip-split" x={hero.split.at} y={0} width={VIEW.width - hero.split.at} height={VIEW.height} />
        </clipPath>
        <clipPath id="hd-box-clip">
          <rect width={VIEW.width} height={VIEW.height} />
        </clipPath>
        <clipPath id="hd-band-clip">
          <rect width={BAND} height={VIEW.height} />
        </clipPath>
        <radialGradient id="hd-cold" cx="50%" cy="45%" r="70%">
          <stop offset="0" className="hm-s0" />
          <stop offset="1" className="hm-sn" />
        </radialGradient>
        <radialGradient id="hd-hot">
          <stop offset="0" className="hm-s6" />
          <stop offset="0.28" className="hm-s5" />
          <stop offset="0.6" className="hm-s4" stopOpacity={0.85} />
          <stop offset="1" className="hm-s3" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="hd-bat">
          <stop offset="0" className="hm-s5" />
          <stop offset="0.45" className="hm-s4" stopOpacity={0.9} />
          <stop offset="1" className="hm-s3" stopOpacity={0} />
        </radialGradient>
        <mask id="hd-reveal" maskUnits="userSpaceOnUse" x={0} y={0} width={VIEW.width} height={VIEW.height}>
          <g className="hd-reveal">
            <line className="hd-draw" pathLength={1} x1={AXIS.x} y1={AXIS.y1} x2={AXIS.x} y2={AXIS.y2} />
            {ROTOR.xs.map((cx) => (
              <ellipse key={cx} className="hd-draw hd-ns" data-hd={PART.disc} pathLength={1} cx={cx} cy={ROTOR.cy} rx={ROTOR.discR} ry={ROTOR.discR} />
            ))}
            <circle className="hd-draw" pathLength={1} cx={TAIL.cx} cy={TAIL.cy} r={TAIL.discR} />
          </g>
        </mask>
      </defs>

      <g className="hd-line">
        <g className="hd-dash">
          <line className="hm-ln hm-ln--axis" x1={AXIS.x} y1={AXIS.y1} x2={AXIS.x} y2={AXIS.y2} />
          {ROTOR.xs.map((cx) => (
            <ellipse
              key={cx}
              className="hm-ln hm-ln--disc hd-ns"
              data-hd={PART.disc}
              cx={cx}
              cy={ROTOR.cy}
              rx={ROTOR.discR}
              ry={ROTOR.discR}
              strokeOpacity={ROTOR.discOpacity}
            />
          ))}
          <circle className="hm-ln hm-ln--disc" data-hd={PART.tail} cx={TAIL.cx} cy={TAIL.cy} r={TAIL.discR} strokeOpacity={TAIL.discOpacity} />
        </g>
        {WINGS.map((d) => (
          <path key={d} className="hm-ln hd-draw" pathLength={1} d={d} />
        ))}
        {HINGES.map((d) => (
          <path key={d} className="hm-ln hm-ln--thin hm-ln--faint hd-draw" pathLength={1} d={d} />
        ))}
        {BOOM.xs.map((x) => (
          <rect key={x} className="hm-ln hd-draw" pathLength={1} x={x} y={BOOM.y} width={BOOM.width} height={BOOM.height} rx={BOOM.rx} />
        ))}
        {POD.xs.map((cx) => {
          const caps = podCaps(cx);
          return (
            <g key={cx}>
              <path className="hm-ln hd-draw" data-hd={PART.podFront} pathLength={1} d={caps.front} />
              <path className="hm-ln hd-draw" pathLength={1} d={caps.back} />
              <path className="hm-ln hm-ln--butt hd-draw" data-hd={PART.podSides} pathLength={1} d={caps.sides} />
            </g>
          );
        })}
        {ROTOR.xs.map((cx) => (
          <g key={cx} data-hd={PART.rotor}>
            <path className="hm-ln hd-draw" data-hd={PART.blade} pathLength={1} d={bladePath(cx)} strokeOpacity={BLADE.opacity} />
            <circle className="hm-ln hd-draw" pathLength={1} cx={cx} cy={ROTOR.cy} r={ROTOR.hubR} />
          </g>
        ))}
        <path className="hm-ln hd-draw" pathLength={1} d={FUSELAGE} />
        <ellipse className="hm-ln hm-ln--thin hd-draw" pathLength={1} cx={CANOPY.cx} cy={CANOPY.cy} rx={CANOPY.rx} ry={CANOPY.ry} />
        <rect
          className="hm-ln hm-ln--thin hd-draw"
          pathLength={1}
          x={BATTERY_BAY.x}
          y={BATTERY_BAY.y}
          width={BATTERY_BAY.width}
          height={BATTERY_BAY.height}
          rx={BATTERY_BAY.rx}
          strokeOpacity={BATTERY_BAY.opacity}
        />
        {V_TAIL.map((d) => (
          <path key={d} className="hm-ln hd-draw" pathLength={1} d={d} />
        ))}
        <rect className="hm-ln hd-draw" pathLength={1} x={TAIL.pod.x} y={TAIL.pod.y} width={TAIL.pod.width} height={TAIL.pod.height} rx={TAIL.pod.rx} />
        <line
          className="hm-ln hd-draw"
          data-hd={PART.tail}
          pathLength={1}
          x1={TAIL.blade.x1}
          y1={TAIL.blade.y1}
          x2={TAIL.blade.x2}
          y2={TAIL.blade.y2}
          strokeOpacity={TAIL.blade.opacity}
        />
        <circle className="hm-ln hd-draw" pathLength={1} cx={TAIL.cx} cy={TAIL.cy} r={TAIL.hubR} />
      </g>

      <g className="hd-th" aria-hidden="true">
        <g className="hd-th__intro">
          <g clipPath="url(#hd-lens-clip)">
            <g id="hd-thermal">
              <rect width={VIEW.width} height={VIEW.height} fill="url(#hd-cold)" />
              {WINGS.map((d) => (
                <path key={d} className="hm-th-wing" d={`${d} Z`} />
              ))}
              {BOOM.xs.map((x) => (
                <rect key={x} className="hm-th-nac" x={x} y={BOOM.y} width={BOOM.width} height={BOOM.height} rx={BOOM.rx} />
              ))}
              {V_TAIL.map((d) => (
                <path key={d} className="hm-th-wing" d={d} />
              ))}
              <path className="hm-th-fus" d={FUSELAGE} />
              <path className="hm-th-cable" data-hd={PART.cableLeft} d={line(CABLES.left)} />
              <path className="hm-th-cable" data-hd={PART.cableRight} d={line(CABLES.right)} />
              <path className="hm-th-cable" d={line(CABLES.tail)} />
              <ellipse cx={BATTERY_HEAT.cx} cy={BATTERY_HEAT.cy} rx={BATTERY_HEAT.rx} ry={BATTERY_HEAT.ry} fill="url(#hd-bat)" />
              {ROTOR.xs.map((cx) => (
                <g key={cx} data-hd={PART.rotor}>
                  <circle cx={cx} cy={ROTOR.cy} r={MOTOR_HEAT_R} fill="url(#hd-hot)" />
                </g>
              ))}
              <circle data-hd={PART.tailHeat} cx={TAIL.cx} cy={TAIL.cy} r={MOTOR_HEAT_R} fill="url(#hd-hot)" />
              {ROTOR.xs.map((cx) => (
                <ellipse key={cx} className="hm-th-disc hd-ns" data-hd={PART.disc} cx={cx} cy={ROTOR.cy} rx={ROTOR.discR} ry={ROTOR.discR} />
              ))}
              <circle className="hm-th-disc" data-hd={PART.tailHeat} cx={TAIL.cx} cy={TAIL.cy} r={TAIL.discR} />
            </g>
          </g>
        </g>
      </g>

      <g clipPath="url(#hd-box-clip)" aria-hidden="true">
        <g className="hd-scan">
          <g clipPath="url(#hd-band-clip)">
            <g className="hd-scan__in">
              <use href="#hd-thermal" />
            </g>
          </g>
          <path className="hm-lens" d={`M0,0 V${VIEW.height} M${BAND},0 V${VIEW.height}`} />
        </g>
      </g>

      <g className="hd-ring" data-hd={PART.lens} transform={AT_REST} aria-hidden="true">
        <g className="hd-ring__intro">
          <circle className="hm-lens" r={LENS_R} />
          <path className="hm-lens" d={lensTicks(LENS_R)} />
        </g>
      </g>

      <path className="hd-split" d={`M${hero.split.at},0 V${VIEW.height}`} aria-hidden="true" />
    </svg>
  );
}
