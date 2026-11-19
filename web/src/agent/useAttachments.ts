import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PROMPT_IMAGES } from "../../../src/shared/agent-images.ts";
import { api } from "../api";
import { imageProblem, readBase64 } from "./images";

/** An image on its way to the next prompt. */
export interface Attachment {
  /** Local, for React and for `remove`. */
  key: number;
  fileName: string;
  /** A local URL of the file, for its thumbnail. */
  preview: string;
  /** The name the server stored it under, once it has: what the prompt carries. */
  stored: string | undefined;
}

/**
 * The images attached to the message being written in a Claude Agent's input. Each is checked
 * against Claude's limits in the browser and, if it passes, uploaded at once, so sending is
 * the same quick act with or without images and an image over the limit is never uploaded.
 * What fails, here or on the server, is not attached and is said in `problems`.
 */
export function useAttachments(sessionId: string) {
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  // Files still being checked or uploaded, which Send must wait for.
  const [working, setWorking] = useState(0);
  const current = useRef<Attachment[]>([]);
  const nextKey = useRef(0);
  const reserved = useRef(0);

  const set = useCallback((next: Attachment[]) => {
    current.current = next;
    setAttached(next);
  }, []);

  useEffect(
    () => () => {
      for (const image of current.current) URL.revokeObjectURL(image.preview);
    },
    [],
  );

  const addOne = useCallback(
    async (file: File): Promise<string | undefined> => {
      const problem = await imageProblem(file);
      if (problem) return problem;
      const preview = URL.createObjectURL(file);
      const image: Attachment = {
        key: nextKey.current++,
        fileName: file.name,
        preview,
        stored: undefined,
      };
      set([...current.current, image]);
      try {
        const { value } = await api.uploadAgentImage(sessionId, {
          mediaType: file.type,
          data: await readBase64(file),
        });
        set(
          current.current.map((one) =>
            one.key === image.key ? { ...one, stored: value.name } : one,
          ),
        );
      } catch (error) {
        URL.revokeObjectURL(preview);
        set(current.current.filter((one) => one.key !== image.key));
        return `${file.name} could not be uploaded: ${error instanceof Error ? error.message : "unknown error"}.`;
      }
      return undefined;
    },
    [sessionId, set],
  );

  const add = useCallback(
    async (files: File[]) => {
      const room = Math.max(
        0,
        MAX_PROMPT_IMAGES - current.current.length - reserved.current,
      );
      const taken = files.slice(0, room);
      const found: string[] = [];
      if (taken.length < files.length) {
        found.push(`A message takes at most ${MAX_PROMPT_IMAGES} images.`);
      }
      reserved.current += taken.length;
      setWorking((count) => count + taken.length);
      const results = await Promise.all(
        taken.map(async (file) => {
          try {
            return await addOne(file);
          } finally {
            reserved.current -= 1;
            setWorking((count) => count - 1);
          }
        }),
      );
      for (const result of results) if (result) found.push(result);
      setProblems(found);
    },
    [addOne],
  );

  const remove = useCallback(
    (key: number) => {
      const gone = current.current.find((one) => one.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      set(current.current.filter((one) => one.key !== key));
    },
    [set],
  );

  /** Forgets the images, once their message has been sent. */
  const clear = useCallback(() => {
    for (const image of current.current) URL.revokeObjectURL(image.preview);
    set([]);
    setProblems([]);
  }, [set]);

  return {
    attached,
    problems,
    /** Whether an image is still being checked or uploaded. */
    busy: working > 0,
    /** The stored names of the images ready to send, in the order attached. */
    ready: attached.flatMap((image) => (image.stored ? [image.stored] : [])),
    add,
    remove,
    clear,
    dismissProblems: () => setProblems([]),
  };
}
