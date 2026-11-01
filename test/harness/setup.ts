import { afterEach } from "vitest";
import { disposeAllTestInstances } from "./instance.ts";

afterEach(async () => {
  await disposeAllTestInstances();
});
