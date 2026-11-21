/**
 * three.js alone, for the host to load (and evaluate) one task before the scene (components/sky/
 * host.ts, importLive): the two module evaluations, each a few milliseconds of the main thread,
 * then never share one long task. It names one of the classes the scene itself imports, so the
 * chunk webpack makes for three.js stays the one the scene uses.
 */
export { WebGLRenderer } from 'three';
