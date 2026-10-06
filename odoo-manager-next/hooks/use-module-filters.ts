"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { searchModules } from "@/lib/module-search";
import { normalizedModuleOrigin } from "@/lib/modules";
import type { ModuleInfo } from "@/lib/types";

export const MODULES_PER_PAGE = 50;

/** Liste paginée, ou modules regroupés par dépôt d'origine. */
export type ModuleView = "list" | "repository";
const MODULE_VIEW_STORAGE_KEY = "sdk-local-manager.modules-view";

function storedModuleView(): ModuleView {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem(MODULE_VIEW_STORAGE_KEY) === "repository" ? "repository" : "list";
  } catch {
    return "list";
  }
}

/** Recherche, filtres d'état et d'origine, pagination et vue (liste ou par dépôt) des modules d'un projet. */
export function useModuleFilters(modules: ModuleInfo[], projectName: string | undefined, database: string) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setViewState] = useState<ModuleView>(storedModuleView);

  function setView(next: ModuleView) {
    setViewState(next);
    try {
      window.localStorage.setItem(MODULE_VIEW_STORAGE_KEY, next);
    } catch {
      // Préférence de confort : sans stockage, la vue choisie vaut jusqu'à la fermeture.
    }
  }

  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    // Le titre affiché (« Ventes ») compte autant que le nom technique (sale_management), et les
    // résultats arrivent du plus pertinent au moins pertinent : l'application d'abord.
    return searchModules(modules, deferredSearch)
      .filter(
        (module) =>
          status === "all" || module.state === status || (status === "uninstalled" && module.state === "disponible"),
      )
      .filter(
        (module) =>
          origin === "all" || normalizedModuleOrigin(module.origin, module.source_path || module.path) === origin,
      );
  }, [deferredSearch, modules, status, origin]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / MODULES_PER_PAGE));
  const visible = useMemo(() => {
    const start = (page - 1) * MODULES_PER_PAGE;
    return filtered.slice(start, start + MODULES_PER_PAGE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, status, origin, database, projectName]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const active = search !== "" || status !== "all" || origin !== "all";
  function reset() {
    setSearch("");
    setStatus("all");
    setOrigin("all");
  }

  return {
    search,
    setSearch,
    status,
    setStatus,
    origin,
    setOrigin,
    page,
    setPage,
    pageCount,
    view,
    setView,
    filtered,
    visible,
    active,
    reset,
  };
}

export type ModuleFilters = ReturnType<typeof useModuleFilters>;
