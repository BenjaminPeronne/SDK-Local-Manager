"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { moduleAuthors, moduleHasAuthor, searchModules } from "@/lib/module-search";
import { normalizeSearchText } from "@/lib/format";
import { normalizedModuleOrigin } from "@/lib/modules";
import type { ModuleInfo } from "@/lib/types";

export const MODULES_PER_PAGE = 50;

/** Liste paginée, ou modules regroupés par dépôt d'origine. */
export type ModuleView = "list" | "repository";
const MODULE_VIEW_STORAGE_KEY = "sdk-local-manager.modules-view";
const MODULE_FILTERS_STORAGE_KEY = "sdk-local-manager.module-filters";
type Filters = { search: string; status: string; origin: string; author: string };
const DEFAULT_FILTERS: Filters = { search: "", status: "all", origin: "all", author: "all" };

function storedFilters(): Record<string, Filters> {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(MODULE_FILTERS_STORAGE_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, Filters] =>
          !!entry[1] &&
          typeof entry[1] === "object" &&
          ["search", "status", "origin", "author"].every(
            (key) => typeof (entry[1] as Record<string, unknown>)[key] === "string",
          ),
      ),
    );
  } catch {
    return {};
  }
}

function storedModuleView(): ModuleView {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem(MODULE_VIEW_STORAGE_KEY) === "repository" ? "repository" : "list";
  } catch {
    return "list";
  }
}

/** Recherche, filtres d'état et d'origine, pagination et vue (liste ou par dépôt) des modules d'un projet. */
export function useModuleFilters(
  modules: ModuleInfo[],
  projectName: string | undefined,
  database: string,
  workspace: string,
) {
  const [filtersByProject, setFiltersByProject] = useState(storedFilters);
  const projectKey = JSON.stringify([workspace, projectName || ""]);
  const { search, status, origin, author } = filtersByProject[projectKey] || DEFAULT_FILTERS;
  function updateFilters(changes: Partial<Filters>) {
    setFiltersByProject((current) => {
      const next = { ...current, [projectKey]: { ...(current[projectKey] || DEFAULT_FILTERS), ...changes } };
      try {
        window.sessionStorage.setItem(MODULE_FILTERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Les filtres restent disponibles tant que l'onglet est ouvert.
      }
      return next;
    });
  }
  const setSearch = (search: string) => updateFilters({ search });
  const setStatus = (status: string) => updateFilters({ status });
  const setOrigin = (origin: string) => updateFilters({ origin });
  const setAuthor = (author: string) => updateFilters({ author });
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
  const authors = useMemo(() => {
    const names = new Map<string, string>();
    for (const module of modules) {
      for (const name of moduleAuthors(module.author)) {
        const key = normalizeSearchText(name);
        if (key && !names.has(key)) names.set(key, name);
      }
    }
    return Array.from(names, ([value, label]) => ({ value: `author:${value}`, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr"),
    );
  }, [modules]);
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
      )
      .filter((module) => author === "all" || moduleHasAuthor(module.author, author.slice("author:".length)));
  }, [deferredSearch, modules, status, origin, author]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / MODULES_PER_PAGE));
  const visible = useMemo(() => {
    const start = (page - 1) * MODULES_PER_PAGE;
    return filtered.slice(start, start + MODULES_PER_PAGE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, status, origin, author, database, projectName]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const active = search !== "" || status !== "all" || origin !== "all" || author !== "all";
  function reset() {
    updateFilters(DEFAULT_FILTERS);
  }

  return {
    search,
    setSearch,
    status,
    setStatus,
    origin,
    setOrigin,
    author,
    setAuthor,
    authors,
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
