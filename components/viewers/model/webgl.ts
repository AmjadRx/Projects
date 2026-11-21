let webgl2: boolean | undefined;

/** three.js needs WebGL 2. Checked once per page, on the first model viewer that tries to start. */
export function supportsWebGL2(): boolean {
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
