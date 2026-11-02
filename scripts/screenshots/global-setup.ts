import { rmSync } from "node:fs";
import { join } from "node:path";
import e2eSetup from "../../e2e/global-setup.ts";
import { createDemoHome, HOME_ENV, removeDemoHome } from "./demo-home.ts";
import { IMAGE_NAMES, IMAGES_DIR } from "./images.ts";

/**
 * Builds the front end, makes the fake home and clears last run's images, so every image
 * on disk afterwards came from this run. The teardown fails the run if it leaves anything
 * behind: a tmux socket (checked by the e2e setup) or the fake home's temp folder.
 */
export default function globalSetup(): () => void {
  const checkSockets = e2eSetup();
  for (const name of IMAGE_NAMES) rmSync(join(IMAGES_DIR, name), { force: true });
  const home = createDemoHome();
  process.env[HOME_ENV] = home;
  return () => {
    removeDemoHome(home);
    checkSockets();
  };
}
