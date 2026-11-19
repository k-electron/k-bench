import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** How far above the top of the conversation the next page starts to load, so it is there before the owner is. */
const PREFETCH_PX = 200;

/**
 * Scroll-back for a conversation that opens with only its latest turns: loads the earlier
 * ones as the owner scrolls up, and holds the scroll position steady while they arrive.
 *
 * - `sentinel` goes first in the scroller. When it comes into view (or is already in view
 *   after a page arrived, because the history is still short) and there is something to
 *   load, `loadEarlier` is called. It is looked at again each time `earliestSeq` changes,
 *   so loading carries on until the page is full and stops at the start.
 * - Entries arriving above what is shown push it down; the scroll position is moved by the
 *   same amount in the same frame, so what the owner was reading does not move. The
 *   browser's own scroll anchoring is off for the scroller (`overflow-anchor: none`, which
 *   the scroller sets), because Safari has none and the two must not both act.
 */
export function useScrollBack({
  scroller,
  earliestSeq,
  canLoad,
  loadEarlier,
}: {
  scroller: RefObject<HTMLElement | null>;
  /** Where the history held begins; it changes when a page of older entries is added. */
  earliestSeq: number | undefined;
  /** There is older history, none is being fetched and the connection is up. */
  canLoad: boolean;
  loadEarlier: () => void;
}): RefObject<HTMLDivElement | null> {
  const sentinel = useRef<HTMLDivElement>(null);
  const before = useRef<{ earliestSeq: number | undefined; height: number }>({
    earliestSeq: undefined,
    height: 0,
  });

  // Every commit, before the browser paints: if older entries were added above, move the
  // scroll by what they added; then remember how tall the conversation is.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const previous = before.current;
    if (
      previous.earliestSeq !== undefined &&
      earliestSeq !== undefined &&
      earliestSeq < previous.earliestSeq
    ) {
      element.scrollTop += element.scrollHeight - previous.height;
    }
    before.current = { earliestSeq, height: element.scrollHeight };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `earliestSeq` re-observes after each page, which reports again if the sentinel is still in view
  useEffect(() => {
    const root = scroller.current;
    const target = sentinel.current;
    if (!canLoad || !root || !target) return;
    // Observing reports the sentinel's state at once, so a conversation still too short to
    // scroll keeps loading until it is not (or until there is nothing earlier).
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadEarlier();
      },
      { root, rootMargin: `${PREFETCH_PX}px 0px 0px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [scroller, canLoad, earliestSeq, loadEarlier]);

  return sentinel;
}
