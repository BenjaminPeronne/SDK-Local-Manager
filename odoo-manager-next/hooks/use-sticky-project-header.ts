"use client";

import { useEffect, useRef, useState } from "react";

const TABS_BACKDROP_FADE_PX = 96;

/** En-tête de projet collant : mode compact au défilement, fondu des onglets et hauteurs mesurées. */
export function useStickyProjectHeader(stickyHeader: boolean, projectViewOpen: boolean, projectName: string | undefined) {
  const projectHeaderRef = useRef<HTMLElement>(null);
  const [projectHeaderHeight, setProjectHeaderHeight] = useState(0);
  const projectTabsRef = useRef<HTMLDivElement>(null);
  const [projectTabsHeight, setProjectTabsHeight] = useState(0);
  const [projectHeaderCompact, setProjectHeaderCompact] = useState(false);

  useEffect(() => {
    if (!stickyHeader) {
      setProjectHeaderCompact(false);
      return;
    }
    const onScroll = () => {
      // Hystérésis : le passage en mode compact réduit la hauteur de l'en-tête, sans quoi il oscillerait au seuil.
      setProjectHeaderCompact((compact) => (compact ? window.scrollY > 8 : window.scrollY > 64));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [stickyHeader]);

  useEffect(() => {
    const tabs = projectTabsRef.current;
    if (!stickyHeader || !tabs) return;
    let frame = 0;
    // Variable CSS écrite directement : un état React re-rendrait toute la page à chaque pixel défilé.
    const update = () => {
      frame = 0;
      tabs.style.setProperty("--tabs-backdrop", String(Math.min(1, Math.max(0, window.scrollY / TABS_BACKDROP_FADE_PX))));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [stickyHeader, projectName]);

  // L'en-tête et les onglets n'existent qu'avec un projet ouvert : l'application démarre sur
  // l'accueil. Mesurés une seule fois au lancement, ils restaient à 0 px, et onglets comme
  // en-tête du tableau des modules se collaient en haut de l'écran, sous l'en-tête fixe.
  useEffect(() => {
    const header = projectHeaderRef.current;
    const tabs = projectTabsRef.current;
    if (!stickyHeader || !projectViewOpen || !header) return;
    const measure = () => {
      setProjectHeaderHeight(header.offsetHeight);
      setProjectTabsHeight(tabs?.offsetHeight ?? 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (tabs) observer.observe(tabs);
    measure();
    return () => observer.disconnect();
  }, [stickyHeader, projectViewOpen]);

  return { projectHeaderRef, projectHeaderHeight, projectTabsRef, projectTabsHeight, projectHeaderCompact };
}
