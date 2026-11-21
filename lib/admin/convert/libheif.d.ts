/**
 * The part of libheif-js's WebAssembly bundle that the photo pipeline uses (lib/admin/convert/image.ts).
 * The package ships no declaration for this entry point.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    /** Decodes into `target.data` (RGBA, width x height) and calls back with it, or with null. */
    display(target: { data: Uint8ClampedArray; width: number; height: number }, callback: (result: unknown) => void): void;
    free(): void;
  }

  export interface HeifDecoderInstance {
    decode(bytes: Uint8Array): HeifImage[];
    /** The native decoding context, freed with `heif_context_free`. */
    decoder: unknown;
  }

  export interface LibHeif {
    HeifDecoder: new () => HeifDecoderInstance;
    heif_context_free(context: unknown): void;
  }

  /** Instantiates the library synchronously (the WebAssembly binary is inside the bundle). */
  export default function libheif(options?: Record<string, unknown>): LibHeif;
}
