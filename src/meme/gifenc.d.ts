declare module 'gifenc' {
  const api: { GIFEncoder: typeof GIFEncoder; quantize: typeof quantize; applyPalette: typeof applyPalette };
  export default api;
  export function GIFEncoder(): { writeFrame(data: Uint8Array, width: number, height: number, opts: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
  export function quantize(data: Uint8ClampedArray, colors: number, opts?: {format: string}): number[][];
  export function applyPalette(data: Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
