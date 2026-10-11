import { useEffect, useState } from "react";

/**
 * Drives a slide-over that animates with a CSS transition instead of keyframes.
 *
 * Keyframe enter/exit animations flash: the panel paints one frame at its final
 * position before the animation starts, and snaps back to it for a frame once
 * the exit animation ends. A transition only has two states, so none of that
 * happens, as long as the panel is first painted closed and then opened.
 *
 * - `mounted`: render the panel (it stays through the exit transition).
 * - `shown`: apply the open position; false while entering and while leaving.
 */
export function useSlidePresence(isOpen: boolean, exitMs = 200) {
  const [mounted, setMounted] = useState(isOpen);
  const [entered, setEntered] = useState(false);

  if (isOpen && !mounted) setMounted(true);

  useEffect(() => {
    if (isOpen) {
      // Two frames, so the closed position is painted before opening.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
        setEntered(false);
      };
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [isOpen, exitMs]);

  return { mounted, shown: isOpen && entered };
}
