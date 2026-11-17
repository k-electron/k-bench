/** PROTOTYPE, throwaway. */
import type { DemoConversation } from "./useDemoConversation";

export interface VariantProps {
  demo: DemoConversation;
  stopped: boolean;
  stopReason: string;
  onRestart: () => void;
}
