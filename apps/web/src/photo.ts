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
  const problem = photoFileProblem(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read this photo. Try a JPG or PNG.");
  }
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

/** Largest original file we try to process (it is resized before upload). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTOS = 6;

/** Checks the chosen file before reading it. */
export function photoFileProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "Please choose an image file.";
  if (file.size > MAX_INPUT_BYTES) return "That photo is over 25 MB. Choose a smaller one.";
  return null;
}

/** Moves the photo at `from` to `to`, keeping the others in order. */
export function movePhoto(list: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** What to save for an ordered photo list: the first photo is the main one. */
export function photoColumns(list: string[]): { photo_path: string | null; photos: string[] } {
  const clean = [...new Set(list)].slice(0, MAX_PHOTOS);
  return { photo_path: clean[0] ?? null, photos: clean };
}
