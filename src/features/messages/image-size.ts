/**
 * Display size for a photo inside a chat bubble: fits within maxWidth × maxHeight,
 * keeps the aspect ratio, never upscales. Knowing it up front avoids layout jumps.
 */
export function fitImage(
  width: number | null | undefined,
  height: number | null | undefined,
  maxWidth: number,
  maxHeight = Math.round(maxWidth * 1.25),
): { width: number; height: number } {
  if (!width || !height) return { width: maxWidth, height: maxWidth };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
