/** What a touch scroll moves: whole lines, the way the wheel does. */
export interface ScrollTarget {
  /** The height in CSS pixels of one line. */
  lineHeight(): number;
  /** Positive scrolls down towards the live screen, negative up into History. */
  scroll(lines: number): void;
}

/** How far back the finger's speed is measured from when it lifts. */
const VELOCITY_WINDOW_MS = 100;
/** A finger that rested this long before lifting was placed, not flicked. */
const REST_BEFORE_LIFT_MS = 50;
/** Slower than this (px/ms) a lift doesn't glide, and a glide comes to a stop. */
const MIN_GLIDE_SPEED = 0.05;
/** The share of speed a glide keeps each millisecond: iOS's normal deceleration. */
const DECELERATION_PER_MS = 0.998;
/** A flick this soon after touching down during a glide adds to the glide's speed. */
const STACK_WITHIN_MS = 300;
const FRAME_MS = 1000 / 60;

interface Sample {
  time: number;
  y: number;
}

/**
 * Scrolls `target` by one-finger drags on `element` that follow the finger line by line,
 * and keeps a flick gliding after the finger lifts, slowing as iOS lists do. Another flick
 * the same way while gliding adds to the speed, capped at a screenful of lines per frame.
 * A touch during a glide stops it and is otherwise swallowed: no tap reaches the terminal.
 * Returns a function that stops listening and ends any glide.
 */
export function touchScrolls(element: HTMLElement, target: ScrollTarget): () => void {
  /** Pixels scrolled but not yet a whole line, carried from drag into glide. */
  let carry = 0;
  let samples: Sample[] = [];
  let lastY: number | undefined;
  let touchedAt = 0;

  let glideSpeed = 0; // px/ms, in `scroll`'s direction
  let glideFrame: number | undefined;
  let lastFrameAt = 0;
  /** The speed of a glide the current touch stopped, for stacking a flick onto. */
  let stoppedSpeed = 0;

  const move = (pixels: number) => {
    carry += pixels;
    const height = target.lineHeight();
    const lines = Math.trunc(carry / height);
    if (lines === 0) return;
    carry -= lines * height;
    target.scroll(lines);
  };

  const maxSpeed = () => element.clientHeight / FRAME_MS;

  const stopGlide = () => {
    if (glideFrame !== undefined) cancelAnimationFrame(glideFrame);
    glideFrame = undefined;
    glideSpeed = 0;
  };

  const glide = (now: number) => {
    const elapsed = Math.min(now - lastFrameAt, 4 * FRAME_MS);
    lastFrameAt = now;
    glideSpeed *= DECELERATION_PER_MS ** elapsed;
    if (Math.abs(glideSpeed) < MIN_GLIDE_SPEED) {
      stopGlide();
      return;
    }
    move(glideSpeed * elapsed);
    glideFrame = requestAnimationFrame(glide);
  };

  const startGlide = (speed: number) => {
    const cap = maxSpeed();
    glideSpeed = Math.max(-cap, Math.min(cap, speed));
    lastFrameAt = performance.now();
    glideFrame = requestAnimationFrame(glide);
  };

  /** The finger's speed as it lifted, in px/ms in `scroll`'s direction; 0 if it rested. */
  const releaseSpeed = (now: number): number => {
    const recent = samples.filter((sample) => now - sample.time <= VELOCITY_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (!first || !last || first === last || now - last.time > REST_BEFORE_LIFT_MS) {
      return 0;
    }
    return (first.y - last.y) / Math.max(last.time - first.time, 1);
  };

  const onStart = (event: TouchEvent) => {
    stoppedSpeed = 0;
    if (glideFrame !== undefined) {
      stoppedSpeed = glideSpeed;
      stopGlide();
      event.preventDefault(); // no tap, focus or keyboard from a touch that stops a glide
    }
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    lastY = touch?.clientY;
    touchedAt = performance.now();
    samples = touch ? [{ time: touchedAt, y: touch.clientY }] : [];
  };

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (lastY === undefined || !touch || event.touches.length !== 1) return;
    event.preventDefault();
    // Dragging down pulls earlier lines into view, as the wheel does when rolled up.
    move(lastY - touch.clientY);
    lastY = touch.clientY;
    const now = performance.now();
    samples.push({ time: now, y: touch.clientY });
    samples = samples.filter((sample) => now - sample.time <= VELOCITY_WINDOW_MS);
  };

  const onEnd = (event: TouchEvent) => {
    if (lastY === undefined || event.touches.length > 0) return;
    lastY = undefined;
    const now = performance.now();
    let speed = releaseSpeed(now);
    const stacks =
      Math.sign(speed) === Math.sign(stoppedSpeed) && now - touchedAt <= STACK_WITHIN_MS;
    if (stacks) speed += stoppedSpeed;
    stoppedSpeed = 0;
    if (Math.abs(speed) >= MIN_GLIDE_SPEED) startGlide(speed);
  };

  const onCancel = () => {
    lastY = undefined;
    stoppedSpeed = 0;
  };

  element.addEventListener("touchstart", onStart, { passive: false });
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd);
  element.addEventListener("touchcancel", onCancel);
  return () => {
    stopGlide();
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onCancel);
  };
}
