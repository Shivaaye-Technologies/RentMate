export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE = 1080;

/** Scales so the longest edge is at most maxEdge, never upscaling. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Re-encodes a photo as JPEG in the browser. Redrawing through a canvas drops
 * all EXIF metadata, including GPS location, before anything is uploaded.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not process this photo.");
  if (blob.size > MAX_PHOTO_BYTES) throw new Error("Photo is too large after resizing.");
  return blob;
}
