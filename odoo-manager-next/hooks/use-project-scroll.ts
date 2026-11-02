"use client";

import { useLayoutEffect, useRef } from "react";

/** Garde seulement une position par projet et onglet, sans conserver leurs écrans montés. */
export function useProjectScroll(
  root: HTMLElement | null,
  workspace: string,
  project: string,
  tab: string,
  ready: boolean,
) {
  const positions = useRef<Record<string, number>>({});
  const active = useRef("");
  const pending = useRef(false);
  const key = JSON.stringify([workspace, project, tab]);

  useLayoutEffect(() => {
    if (active.current !== key) {
      active.current = key;
      pending.current = true;
    }
    if (!project || !ready) return;
    const target = root || window;
    const read = () => (root ? root.scrollTop : window.scrollY);
    const write = (top: number) => {
      if (root) root.scrollTo({ top, behavior: "instant" });
      else window.scrollTo({ top, behavior: "instant" });
    };
    if (pending.current) {
      write(positions.current[key] || 0);
      pending.current = false;
    }
    const save = () => {
      if (!pending.current && active.current === key) positions.current[key] = read();
    };
    target.addEventListener("scroll", save, { passive: true });
    return () => target.removeEventListener("scroll", save);
  }, [key, project, ready, root]);
}
