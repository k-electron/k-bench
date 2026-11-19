/**
 * The images a Claude Agent's prompts carry, kept in the Agent's folder (`images/`, owner
 * only) until the Session is deleted with it. The browser uploads one when it is attached;
 * the prompt then names it, and the Agent Runtime reads the file (docs/internals/agent.md).
 */

import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentImagesFolder, ensureOwnerOnlyFolder } from "../agent/paths.ts";
import {
  IMAGE_TYPES,
  type ImageMediaType,
  MAX_IMAGE_BASE64_BYTES,
  mediaTypeOfStoredImage,
} from "../shared/agent-images.ts";

/** An image that is refused, and why in words the owner can read. */
export class ImageError extends Error {}

/** Whether the bytes start the way the media type says: a label alone is not trusted. */
function looksLike(mediaType: ImageMediaType, bytes: Buffer): boolean {
  const starts = (...values: number[]) => values.every((byte, i) => bytes[i] === byte);
  switch (mediaType) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
  }
}

/**
 * Stores an uploaded image in the Agent's folder and returns its name. It is checked again
 * here, whatever the browser said: Claude's type and size limits, and that the bytes are what
 * the type claims. `images/` is made on the first image, without recursion, so an upload that
 * races the Session's deletion fails instead of bringing the Agent's folder back.
 */
export function storeAgentImage(
  agentFolder: string,
  mediaType: unknown,
  base64: unknown,
): string {
  if (typeof mediaType !== "string" || !Object.hasOwn(IMAGE_TYPES, mediaType)) {
    throw new ImageError("Claude takes PNG, JPEG, GIF and WebP images");
  }
  if (typeof base64 !== "string" || base64 === "") {
    throw new ImageError("The image is empty");
  }
  if (base64.length > MAX_IMAGE_BASE64_BYTES) {
    throw new ImageError("The image is over Claude's 5 MB limit");
  }
  const bytes = Buffer.from(base64, "base64");
  // Node's decoder skips what is not base64 instead of failing, so a round trip is the check.
  if (
    bytes.length === 0 ||
    bytes.toString("base64") !== base64 ||
    !looksLike(mediaType as ImageMediaType, bytes)
  ) {
    throw new ImageError(`That is not a ${mediaType.slice(6).toUpperCase()} image`);
  }
  const folder = agentImagesFolder(agentFolder);
  ensureOwnerOnlyFolder(folder);
  const name = `${randomUUID()}.${IMAGE_TYPES[mediaType as ImageMediaType]}`;
  const file = join(folder, name);
  // Through a temporary name, so a prompt never reads half a file.
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  renameSync(temporary, file);
  return name;
}

/** A stored image's bytes and media type, or undefined when the name is not one or the file is gone. */
export function readAgentImage(
  agentFolder: string,
  name: string,
): { bytes: Buffer; mediaType: ImageMediaType } | undefined {
  const mediaType = mediaTypeOfStoredImage(name);
  if (mediaType === undefined) return undefined;
  try {
    return { bytes: readFileSync(join(agentImagesFolder(agentFolder), name)), mediaType };
  } catch {
    return undefined;
  }
}
