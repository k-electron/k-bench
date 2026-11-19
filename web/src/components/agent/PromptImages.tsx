import { agentImagePath } from "../../../../src/shared/agent-images.ts";

/** The images a sent prompt carried, small, above its text. Nothing when it carried none. */
export function PromptImages({
  sessionId,
  names,
}: {
  sessionId: string;
  names: string[] | undefined;
}) {
  if (!names || names.length === 0) return null;
  return (
    <ul aria-label="Images sent" className="mb-1 flex flex-wrap gap-2">
      {names.map((name) => (
        <li key={name}>
          <img
            src={agentImagePath(sessionId, name)}
            alt="Your attachment"
            className="max-h-40 max-w-full rounded-md border object-contain"
          />
        </li>
      ))}
    </ul>
  );
}
