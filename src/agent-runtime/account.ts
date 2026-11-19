import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk";

const RULE =
  "k-bench runs a Claude Agent only on a Claude subscription, never on API pricing.";

/**
 * Why a Claude Agent must not run on this login, in plain words for "Stopped: <reason>"; or
 * `undefined` when it is a Claude subscription. k-bench never costs the owner API pricing,
 * so it runs only on a first-party Claude subscription: not an API key, not another
 * provider (Bedrock, Vertex, a gateway, ...), and not a login that has no subscription type.
 *
 * It reads only what Claude Code says about its own login (`accountInfo()`); k-bench reads no
 * credential and changes no environment variable for this.
 */
export function subscriptionProblem(
  account: AccountInfo | undefined,
): string | undefined {
  if (account?.apiProvider !== undefined && account.apiProvider !== "firstParty") {
    return `Claude Code is signed in through ${account.apiProvider}, not a Claude subscription. ${RULE}`;
  }
  // A subscription login carries no key source, or says `none` or `oauth`; anything else is a key.
  const key = account?.apiKeySource;
  if (key !== undefined && key !== "none" && key !== "oauth") {
    return `Claude Code is using an API key (${key}), not a Claude subscription. ${RULE}`;
  }
  if (!account?.subscriptionType) {
    return `Claude Code is not signed in with a Claude subscription (it reports no subscription type). ${RULE}`;
  }
  return undefined;
}
