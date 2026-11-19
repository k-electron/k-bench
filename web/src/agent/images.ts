import {
  base64Size,
  isImageMediaType,
  MAX_IMAGE_BASE64_BYTES,
  MAX_IMAGE_EDGE,
} from "../../../src/shared/agent-images.ts";

/**
 * Why Claude would not take this image, in words for the owner, or undefined when it would:
 * its type, its size and its longest edge, checked before anything is uploaded. The server
 * checks type and size again; the pixels only the browser can count.
 */
export async function imageProblem(file: File): Promise<string | undefined> {
  if (!isImageMediaType(file.type)) {
    return `${file.name} is not a PNG, JPEG, GIF or WebP image, which are the ones Claude takes.`;
  }
  if (base64Size(file.size) > MAX_IMAGE_BASE64_BYTES) {
    return `${file.name} is over Claude's 5 MB image limit, so it was not attached.`;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    bitmap.close();
    if (edge > MAX_IMAGE_EDGE) {
      return `${file.name} is over Claude's ${MAX_IMAGE_EDGE} pixel limit, so it was not attached.`;
    }
  } catch {
    return `${file.name} could not be read as an image.`;
  }
  return undefined;
}

/** The file's bytes as base64 text. */
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** The image files among what was pasted or dropped. */
export function imageFilesIn(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));
}
