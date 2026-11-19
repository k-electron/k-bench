import { createContext, useContext } from "react";

/**
 * Lets a row of the conversation offer Open in terminal without being handed the Session.
 * `AgentPane` provides it; an Unsupported row (#153, #155) is the one that asks for it. Without
 * a provider there is nothing to open, and the row offers no button.
 */
const OpenInTerminalContext = createContext<(() => void) | undefined>(undefined);
export const OpenInTerminalProvider = OpenInTerminalContext.Provider;
export function useOpenInTerminalAction(): (() => void) | undefined {
  return useContext(OpenInTerminalContext);
}
