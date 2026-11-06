/** The Launch options of a Claude Session, shared by the server and the New Claude dialog. */

/**
 * The Launch options: fixed for a Claude Session's life, and stored with it. "default" means
 * no flag at all, so the owner's own Claude Code settings apply. k-bench does not check which
 * model and advisor go together: Claude Code rejects a bad pairing at launch, and the error
 * hold shows its message.
 */
export interface LaunchOptions {
  model: "default" | "fable" | "opus" | "sonnet" | "haiku";
  effort: "default" | "low" | "medium" | "high" | "xhigh" | "max";
  advisor: "default" | "off" | "fable" | "opus" | "sonnet";
  focusView: boolean;
}

/** The choices for each Launch option; what the API accepts. */
export const LAUNCH_CHOICES = {
  model: ["default", "fable", "opus", "sonnet", "haiku"],
  effort: ["default", "low", "medium", "high", "xhigh", "max"],
  advisor: ["default", "off", "fable", "opus", "sonnet"],
} as const;

/** All Default, Focus view off: what a Claude Session gets for a Launch option not given. */
export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = {
  model: "default",
  effort: "default",
  advisor: "default",
  focusView: false,
};
