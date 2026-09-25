"use client";

import { useCallback, useRef, useState } from "react";
import { ApiUnavailableError } from "@/lib/api";

/** Service local injoignable : signalé après deux échecs de connexion de suite, effacé au premier succès. */
export function useApiAvailability() {
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const consecutiveApiFailures = useRef(0);

  const markApiSuccess = useCallback(() => {
    consecutiveApiFailures.current = 0;
    setApiUnavailable(false);
  }, []);

  /** Compte l'échec s'il vient de la connexion ; vrai au moment précis où le service devient indisponible. */
  const markApiFailure = useCallback((error: unknown) => {
    if (!(error instanceof ApiUnavailableError)) return false;
    consecutiveApiFailures.current += 1;
    if (consecutiveApiFailures.current >= 2) setApiUnavailable(true);
    return consecutiveApiFailures.current === 2;
  }, []);

  return { apiUnavailable, markApiSuccess, markApiFailure };
}
