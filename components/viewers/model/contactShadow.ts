/**
 * The contact shadow under the model in the Realistic view: drei's ContactShadows (the model's
 * depth seen from the floor, blurred, laid on a plane at the floor), with the numbers the viewer
 * has used since Phase 4, as plain three.js the engine drives.
 *
 * drei's component draws its shadow once on its first frame and again only when React renders it.
 * The exploded view and the hero's rotor tilt now move through motion values, never a React render
 * (ModelEngine.tsx), so its shadow could keep the shape of an earlier pose. Here the engine marks
 * the shadow dirty whenever the model's shape or floor changes, and the shadow is drawn again
 * before the next Realistic frame. An orbit never redraws it: the shadow lies on the floor in the
 * model's space, so turning the camera leaves it as it is.
 */
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

/** The shadow's look: the viewer's ContactShadows props since Phase 4. */
export const SHADOW = {
  /** The square of floor it covers, in model units (the model fits a sphere of radius 1). */
  size: 4,
  /** How far above the floor a part still casts. */
  far: 1.6,
  /** The blur, in drei's units (a 256th of the target per step). */
  blur: 2.4,
  /** A second, finer blur pass (drei's `smooth`), at this share of the first. */
  smooth: 0.4,
  opacity: 0.5,
  /** The target's side, in pixels. */
  resolution: 512,
} as const;

/**
 * drei's colorized depth, in black: a fragment's alpha is how near the floor it is, so a part
 * resting on the floor casts the darkest shadow.
 */
function shadowDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'vec4( vec3( 0.0 ), 1.0 - fragCoordZ );',
    );
  };
  return material;
}

function blurMaterial(shader: typeof HorizontalBlurShader | typeof VerticalBlurShader): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.clone(shader.uniforms),
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });
  material.depthTest = false;
  return material;
}

export class ContactShadow {
  /** Add this to the scene; its position's y is the floor (setFloor). */
  readonly root = new Group();

  private readonly camera: OrthographicCamera;
  private readonly target: WebGLRenderTarget;
  private readonly blurTarget: WebGLRenderTarget;
  private readonly geometry: PlaneGeometry;
  private readonly planeMaterial: MeshBasicMaterial;
  private readonly blurPlane: Mesh;
  private readonly depthMaterial = shadowDepthMaterial();
  private readonly horizontal = blurMaterial(HorizontalBlurShader);
  private readonly vertical = blurMaterial(VerticalBlurShader);
  private dirty = true;

  constructor() {
    const { size, resolution, far, opacity } = SHADOW;
    this.target = new WebGLRenderTarget(resolution, resolution);
    this.blurTarget = new WebGLRenderTarget(resolution, resolution);
    this.target.texture.generateMipmaps = false;
    this.blurTarget.texture.generateMipmaps = false;

    // The same frame as drei's: the group turned a quarter about x, so the camera inside it looks
    // up from the floor, and the plane turned back so it lies on the floor facing up.
    this.root.rotation.x = Math.PI / 2;
    this.geometry = new PlaneGeometry(size, size).rotateX(Math.PI / 2);
    this.planeMaterial = new MeshBasicMaterial({ transparent: true, map: this.target.texture, opacity, depthWrite: false });
    const plane = new Mesh(this.geometry, this.planeMaterial);
    plane.scale.set(1, -1, 1);
    plane.rotation.set(-Math.PI / 2, 0, 0);
    plane.raycast = () => undefined;
    this.camera = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, far);
    this.root.add(plane, this.camera);

    this.blurPlane = new Mesh(this.geometry, this.horizontal);
    this.blurPlane.visible = false;
  }

  /** True until the shadow has been drawn for the model as it stands now. */
  get needsUpdate(): boolean {
    return this.dirty;
  }

  /** The model's shape changed (the exploded view, a rotor tilt, another model): draw it again. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Puts the shadow at the model's floor (world y). A new floor redraws it. */
  setFloor(y: number): void {
    if (this.root.position.y === y) return;
    this.root.position.y = y;
    this.dirty = true;
  }

  /**
   * Draws the shadow again if the model changed since it was last drawn; otherwise does nothing.
   * Call it just before a frame that shows the shadow. It leaves the renderer's target, the scene's
   * background and override material, and its own visibility as it found them.
   */
  update(gl: WebGLRenderer, scene: Scene): void {
    if (!this.dirty) return;
    this.dirty = false;
    const previousTarget = gl.getRenderTarget();
    const { background, overrideMaterial } = scene;
    const visible = this.root.visible;
    // The shadow plane must not cast into itself.
    this.root.visible = false;
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    try {
      gl.setRenderTarget(this.target);
      gl.render(scene, this.camera);
      this.blur(gl, SHADOW.blur);
      this.blur(gl, SHADOW.blur * SHADOW.smooth);
    } finally {
      gl.setRenderTarget(previousTarget);
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      this.root.visible = visible;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.blurTarget.dispose();
    this.geometry.dispose();
    this.planeMaterial.dispose();
    this.depthMaterial.dispose();
    this.horizontal.dispose();
    this.vertical.dispose();
  }

  /** One horizontal and one vertical blur pass over the shadow's target (drei's blurShadows). */
  private blur(gl: WebGLRenderer, amount: number): void {
    const { blurPlane, horizontal, vertical } = this;
    blurPlane.visible = true;
    blurPlane.material = horizontal;
    horizontal.uniforms.tDiffuse.value = this.target.texture;
    horizontal.uniforms.h.value = amount / 256;
    gl.setRenderTarget(this.blurTarget);
    gl.render(blurPlane, this.camera);
    blurPlane.material = vertical;
    vertical.uniforms.tDiffuse.value = this.blurTarget.texture;
    vertical.uniforms.v.value = amount / 256;
    gl.setRenderTarget(this.target);
    gl.render(blurPlane, this.camera);
    blurPlane.visible = false;
  }
}
