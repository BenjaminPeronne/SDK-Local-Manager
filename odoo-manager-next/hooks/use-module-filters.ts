"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { normalizedModuleOrigin } from "@/lib/modules";
import type { ModuleInfo } from "@/lib/types";

export const MODULES_PER_PAGE = 50;

/** Recherche, filtres d'état et d'origine, et pagination de la liste des modules d'un projet. */
export function useModuleFilters(modules: ModuleInfo[], projectName: string | undefined, database: string) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [page, setPage] = useState(1);

  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return modules
      .filter((module) => !query || module.name.toLowerCase().includes(query))
      .filter((module) => (
        status === "all" ||
        module.state === status ||
        (status === "uninstalled" && module.state === "disponible")
      ))
      .filter((module) => origin === "all" || normalizedModuleOrigin(module.origin, module.source_path || module.path) === origin);
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

  return { search, setSearch, status, setStatus, origin, setOrigin, page, setPage, pageCount, filtered, visible, active, reset };
}

export type ModuleFilters = ReturnType<typeof useModuleFilters>;
