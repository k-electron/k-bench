/**
 * What a Claude Agent accepts as an image, in one place for the browser (which checks before
 * uploading), the server (which checks again) and the Agent Runtime (which reads the stored
 * file). No imports, no Node APIs. The limits are Claude's own (docs/internals/agent.md).
 */

/** The media types Claude takes, and the extension each is stored under. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type ImageMediaType = keyof typeof IMAGE_TYPES;

/**
 * Largest image, measured as Claude measures it: the base64 text, which is a third bigger
 * than the file (so about 3.9 MB of file). Claude refuses an image over 5 MB this way, and
 * refusing here means the owner hears it before anything is sent.
 */
export const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

/** Longest edge, in pixels, Claude accepts. */
export const MAX_IMAGE_EDGE = 8000;

/** Most images one prompt may carry. */
export const MAX_PROMPT_IMAGES = 20;

/** An image's name in the Agent's `images/` folder: `<uuid>.<extension>`. */
export const STORED_IMAGE_NAME = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${Object.values(IMAGE_TYPES).join("|")})$`,
);

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === "string" && Object.hasOwn(IMAGE_TYPES, value);
}

/** The media type of a stored image's name, or undefined when it is not a valid name. */
export function mediaTypeOfStoredImage(name: string): ImageMediaType | undefined {
  if (!STORED_IMAGE_NAME.test(name)) return undefined;
  const extension = name.slice(name.lastIndexOf(".") + 1);
  return (Object.keys(IMAGE_TYPES) as ImageMediaType[]).find(
    (type) => IMAGE_TYPES[type] === extension,
  );
}

/** How many bytes of base64 text a file of `bytes` becomes. */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** The URL of a stored image, for showing it in a Pane. */
export function agentImagePath(sessionId: string, name: string): string {
  return `/api/sessions/${sessionId}/agent/images/${name}`;
}
