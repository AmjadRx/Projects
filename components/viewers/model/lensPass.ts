/**
 * The thermal lens over the hero model (DESIGN_DIRECTION.md 6.1: "in the Realistic view, the lens
 * shows the Thermal view through it"; motion sheet 4.5). After the Realistic frame is drawn, the
 * part of the view under the lens is drawn again in the Thermal view, into a small multisampled
 * target the size of the lens's square (the camera's view offset narrows the frustum to that
 * square, so nothing outside it is drawn twice), then laid over the frame through the circle.
 *
 * The overlay blends with a constant alpha, the lens's opacity a: inside the circle every pixel
 * becomes thermal x a + realistic x (1 - a). At a = 1 the circle shows exactly the Thermal view,
 * the sky through its empty parts included, with no contact shadow; while the lens fades in or out
 * (150 ms) the two views cross-fade inside it. The circle's edge is hard: the lens ring, drawn by
 * the page in the line color, sits on it.
 *
 * The Thermal shader and this overlay both write the page's sRGB colors straight through (no tone
 * mapping, no color-space step: materials.ts), so the thermal pixels inside the lens are the same
 * as in the full Thermal view.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  CustomBlending,
  Mesh,
  OneFactor,
  OneMinusConstantAlphaFactor,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { lensSquare } from './orbit';

/** Samples of the lens's target: its thermal edges are as smooth as the frame's own (antialias). */
const LENS_SAMPLES = 4;

const VERTEX = /* glsl */ `
  uniform vec4 uBox;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    gl_Position = vec4(mix(uBox.xy, uBox.zw, position.xy), 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uView;
  uniform float uSide;
  uniform float uRadius;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSide;
    if (dot(p, p) > uRadius * uRadius) discard;
    gl_FragColor = texture2D(uView, vUv) * uAlpha;
  }
`;

/** Where the lens is, in CSS px of the canvas, and how much of it shows (0 to 1). */
export interface LensState {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export class LensPass {
  private target: WebGLRenderTarget | null = null;
  private readonly scene = new Scene();
  private readonly camera = new Camera();
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly clearColor = new Color();

  constructor() {
    // A unit square, two triangles; the vertex shader places it over the lens's square.
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
    );
    this.material = new ShaderMaterial({
      uniforms: {
        uBox: { value: new Vector4() },
        uView: { value: null as Texture | null },
        uSide: { value: 1 },
        uRadius: { value: 0 },
        uAlpha: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusConstantAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusConstantAlphaFactor,
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Lays the lens over the frame just drawn. `drawThermal` draws the model in the Thermal view
   * into whatever target is bound (ModelRig.withView); `size` is the canvas in CSS px.
   */
  render(
    gl: WebGLRenderer,
    camera: PerspectiveCamera,
    lens: LensState,
    size: { width: number; height: number },
    drawThermal: () => void,
  ): void {
    const square = lensSquare(lens.x, lens.y, lens.radius, size.width, size.height);
    if (!square || !(lens.alpha > 0)) return;
    const pixels = Math.max(1, Math.ceil(square.side * gl.getPixelRatio()));
    const target = this.ensureTarget(pixels);

    const previousTarget = gl.getRenderTarget();
    const previousAlpha = gl.getClearAlpha();
    const previousAutoClear = gl.autoClear;
    gl.getClearColor(this.clearColor);
    gl.autoClear = false;
    try {
      camera.setViewOffset(size.width, size.height, square.left, square.top, square.side, square.side);
      try {
        gl.setRenderTarget(target);
        gl.setClearColor(0x000000, 0);
        gl.clear(true, true, false);
        drawThermal();
      } finally {
        camera.clearViewOffset();
        gl.setRenderTarget(previousTarget);
        gl.setClearColor(this.clearColor, previousAlpha);
      }

      const uniforms = this.material.uniforms;
      (uniforms.uBox.value as Vector4).set(...square.clip);
      uniforms.uView.value = target.texture;
      uniforms.uSide.value = square.side;
      uniforms.uRadius.value = lens.radius;
      uniforms.uAlpha.value = lens.alpha;
      this.material.blendAlpha = lens.alpha;
      gl.render(this.scene, this.camera);
    } finally {
      gl.autoClear = previousAutoClear;
    }
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.geometry.dispose();
    this.material.dispose();
  }

  /** The lens's target, square, `pixels` device px a side: resized only when the lens's size changes. */
  private ensureTarget(pixels: number): WebGLRenderTarget {
    if (!this.target) {
      this.target = new WebGLRenderTarget(pixels, pixels, { samples: LENS_SAMPLES, depthBuffer: true });
    } else if (this.target.width !== pixels) {
      this.target.setSize(pixels, pixels);
    }
    return this.target;
  }
}
