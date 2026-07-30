import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

/** Within this many px of the bottom we treat the viewport as "pinned". */
const NEAR_BOTTOM_PX = 80;

function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

/**
 * Chat-style stick-to-bottom for a scroll container.
 *
 * - Follows the tail while the user is pinned.
 * - Unlocks when they scroll up; re-pins when they return to the bottom.
 * - Programmatic stick writes are ignored by the scroll listener (nested
 *   counter + double rAF) so fast streams cannot falsely unlock.
 * Pair with `overflow-anchor: none` on the scroller.
 */
export function useStickToBottom(
  scrollerRef: RefObject<HTMLElement | null>,
  /** Fingerprint of content that should trigger a stick pass (not idle polls). */
  contentKey: string | number,
  /** Project/session switch — re-pin and rebind the listener. */
  resetKey: string | number,
): {
  /** Call when the user intentionally wants the live tail (e.g. send). */
  pinToBottom: () => void;
} {
  const stickRef = useRef(true);
  /**
   * Nested stick writes during fast streams: count (not bool) so an early
   * clear cannot re-enable the scroll listener mid-flight of a later write.
   */
  const ignoreScrollRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    ignoreScrollRef.current += 1;
    el.scrollTop = el.scrollHeight;
    // Double rAF: let the browser dispatch scroll events from this write first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ignoreScrollRef.current = Math.max(0, ignoreScrollRef.current - 1);
      });
    });
  }, [scrollerRef]);

  const pinToBottom = useCallback(() => {
    stickRef.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => {
      if (ignoreScrollRef.current > 0) return;
      stickRef.current = nearBottom(el);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    stickRef.current = true;
    return () => el.removeEventListener("scroll", onScroll);
  }, [resetKey, scrollerRef]);

  // Stick before paint so fast chunks never leave a "not at bottom" frame.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!stickRef.current) {
      if (nearBottom(el)) stickRef.current = true;
      else return;
    }
    scrollToBottom();
  }, [contentKey, scrollToBottom, scrollerRef]);

  return { pinToBottom };
}
