import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentImagesFolder } from "../agent/paths.ts";
import { type ImageMediaType, mediaTypeOfStoredImage } from "../shared/agent-images.ts";

/** An image block, as Claude Code takes it in a message's `content`. */
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: ImageMediaType; data: string };
}

/** A text block. */
export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * The content of a prompt: the images first, then the text. With no images it is the text as
 * it is typed, a plain string, exactly what Claude Code gets from a terminal.
 *
 * Each name is a file the server stored in the Agent's `images/` folder. A name that no longer
 * reads (the file is gone) must not stop the prompt, nor take the runtime down: Claude is told
 * in its place that an image was lost, so the owner's message still gets an answer.
 */
export function promptContent(
  agentDir: string,
  text: string,
  names: readonly string[] = [],
): string | Array<ImageBlock | TextBlock> {
  if (names.length === 0) return text;
  const blocks: Array<ImageBlock | TextBlock> = [];
  for (const name of names) {
    const mediaType = mediaTypeOfStoredImage(name);
    try {
      if (mediaType === undefined) throw new Error("not a stored image name");
      const data = readFileSync(join(agentImagesFolder(agentDir), name)).toString(
        "base64",
      );
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    } catch {
      blocks.push({ type: "text", text: "[An attached image could not be read.]" });
    }
  }
  if (text.trim() !== "") blocks.push({ type: "text", text });
  return blocks;
}
