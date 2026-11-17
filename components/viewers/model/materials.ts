/**
 * Shader materials for the Blueprint and Thermal views. Both write sRGB colors straight to the
 * screen (no tone mapping, no color-space step), so the canvas shows exactly the page's colors.
 */
import { DoubleSide, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Rgb } from './palette';

/**
 * Thermal view: an illustration, not measured data. A smooth function of the surface, warmest
 * near the middle of the model and on faces turned toward the viewer, is mapped onto the seven
 * ramp stops. `uShift` undoes the exploded-view offset, so the pattern stays on its part.
 */
const THERMAL_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 world = modelMatrix * local;
    vWorld = world.xyz;
    vNormal = mat3(modelMatrix) * n;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const THERMAL_FRAGMENT = /* glsl */ `
  uniform vec3 uStops[7];
  uniform vec3 uShift;
  uniform float uDim;
  varying vec3 vWorld;
  varying vec3 vNormal;

  vec3 ramp(float t) {
    float x = clamp(t, 0.0, 1.0) * 6.0;
    vec3 color = uStops[0];
    for (int i = 0; i < 6; i++) {
      color = mix(color, uStops[i + 1], clamp(x - float(i), 0.0, 1.0));
    }
    return color;
  }

  void main() {
    vec3 p = vWorld - uShift;
    vec3 toEye = normalize(cameraPosition - vWorld);
    // Two-sided and by the normal, so a mesh with reversed triangles still reads correctly.
    float facing = abs(dot(normalize(vNormal), toEye));
    float core = 1.0 - smoothstep(0.05, 1.0, length(p * vec3(1.0, 0.9, 1.0)));
    float t = 0.06 + 0.6 * core + 0.32 * pow(facing, 1.4);
    vec3 color = ramp(t);
    color = mix(color, uStops[0], 0.7 * uDim);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface ThermalShared {
  /** The seven stops as sRGB channels, shared by every thermal material of one model. */
  stops: { value: Vector3[] };
}

export function createThermalShared(): ThermalShared {
  return { stops: { value: Array.from({ length: 7 }, () => new Vector3()) } };
}

export function setThermalStops(shared: ThermalShared, ramp: Rgb[]): void {
  shared.stops.value.forEach((stop, i) => {
    const color = ramp[i] ?? ramp[ramp.length - 1];
    stop.set(color[0], color[1], color[2]);
  });
}

export function createThermalMaterial(shared: ThermalShared): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uStops: shared.stops,
      uShift: { value: new Vector3() },
      uDim: { value: 0 },
    },
    vertexShader: THERMAL_VERTEX,
    fragmentShader: THERMAL_FRAGMENT,
    side: DoubleSide,
  });
}

/**
 * Blueprint silhouette: the surfaces that face away from the viewer, pushed outward by a fixed
 * number of screen pixels and drawn in the line color (an inverted hull). It outlines smooth
 * shapes, where crease edges alone would draw nothing; the fill in front hides all but the rim.
 * Facing is judged by the normals, not the triangle winding, so reversed triangles still work.
 */
const HULL_VERTEX = /* glsl */ `
  uniform float uThickness;
  uniform vec2 uResolution;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 viewPosition = modelViewMatrix * local;
    vViewPosition = viewPosition.xyz;
    vViewNormal = normalMatrix * n;
    vec4 clip = projectionMatrix * viewPosition;
    vec4 clipNormal = projectionMatrix * vec4(vViewNormal, 0.0);
    float len = length(clipNormal.xy);
    if (len > 1e-5) {
      clip.xy += (clipNormal.xy / len) * (uThickness * 2.0 / uResolution) * clip.w;
    }
    gl_Position = clip;
  }
`;

const HULL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    if (dot(vViewNormal, -vViewPosition) > 0.0) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

export function createHullMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Vector3(1, 1, 1) },
      uThickness: { value: 1.25 },
      uResolution: { value: new Vector2(1, 1) },
    },
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
    side: DoubleSide,
  });
}
