import { fileURLToPath } from "node:url";

/** Where the images go (the docs link to them from here). */
export const IMAGES_DIR = fileURLToPath(new URL("../../docs/images/", import.meta.url));

/** Where the committed hero recording lives. */
export const HERO_RECORDING =
  process.env.K_BENCH_HERO_RECORDING ??
  fileURLToPath(new URL("../../docs/recordings/claude-hero.json", import.meta.url));

/** Every image the script makes, so a run can clear them first and start from scratch. */
export const IMAGE_NAMES = [
  "hero.png",
  "desktop.png",
  "bell.png",
  "phone-drawer.png",
  "phone-terminal.png",
] as const;
export type ImageName = (typeof IMAGE_NAMES)[number];
