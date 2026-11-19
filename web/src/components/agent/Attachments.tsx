import { ImagePlusIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import type { Attachment } from "@/agent/useAttachments";
import { Button } from "@/components/ui/button";

/**
 * The images attached to the message being written: a thumbnail each, with a button to take
 * it off, and the reasons any image was not attached (over Claude's limits, not an image).
 * Renders nothing when there is nothing to show.
 */
export function AttachmentStrip({
  attached,
  problems,
  uploading,
  onRemove,
  onDismissProblems,
}: {
  attached: Attachment[];
  problems: string[];
  uploading: boolean;
  onRemove: (key: number) => void;
  onDismissProblems: () => void;
}) {
  if (attached.length === 0 && problems.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-2 pt-2">
      {problems.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          <ul className="min-w-0 flex-1">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0"
            onClick={onDismissProblems}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      {attached.length > 0 && (
        <ul aria-label="Attached images" className="flex flex-wrap gap-2">
          {attached.map((image) => (
            <li key={image.key} className="relative">
              <img
                src={image.preview}
                alt={`Attached: ${image.fileName}`}
                className={`size-16 rounded-md border object-cover ${image.stored ? "" : "opacity-50"}`}
              />
              <button
                type="button"
                aria-label={`Remove ${image.fileName}`}
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border bg-background shadow-xs"
                onClick={() => onRemove(image.key)}
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading && (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading…
        </p>
      )}
    </div>
  );
}

/**
 * The button that picks images: on a phone this opens the photo library (and the camera), on
 * a desktop the file chooser. The hidden input is what a test or a browser fills.
 */
export function AttachButton({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose images"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          // So choosing the same file again still counts as a change.
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Attach image"
        disabled={disabled}
        // Keeps the keyboard up on a phone, as Send does.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => input.current?.click()}
      >
        <ImagePlusIcon />
      </Button>
    </>
  );
}
