"use client";

import { useEffect, useState } from "react";

/**
 * Indique qu'un élément est sorti de l'écran. Avec l'en-tête fixe, un élément passé sous l'en-tête
 * et les onglets est considéré comme masqué. Renvoie le ref à poser sur l'élément.
 */
export function useHiddenBelowStickyHeader(stickyHeader: boolean, headerHeight: number, tabsHeight: number) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!element) {
      setVisible(true);
      return;
    }
    const hiddenTop = stickyHeader && window.matchMedia("(min-width: 1024px)").matches ? headerHeight + (tabsHeight || 72) : 0;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: `-${hiddenTop}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, stickyHeader, headerHeight, tabsHeight]);

  return [setElement, Boolean(element) && !visible] as const;
}
