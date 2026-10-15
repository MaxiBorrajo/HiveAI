import { useEffect, useState } from "react";

export function useSlidePresence(isOpen: boolean, exitMs = 200) {
  const [mounted, setMounted] = useState(isOpen);
  const [entered, setEntered] = useState(false);

  if (isOpen && !mounted) setMounted(true);

  useEffect(() => {
    if (isOpen) {
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
