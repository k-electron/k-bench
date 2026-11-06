/** The mark for a Claude Session in the sidebar: a small spark, with an accessible name. */
export function ClaudeGlyph({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="shrink-0 text-orange-500"
      title={label}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />
      </svg>
    </span>
  );
}
