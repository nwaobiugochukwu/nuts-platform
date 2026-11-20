"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorageValue, writeLocalStorageValue } from "@/hooks/use-local-storage-value";

const RECENT_SEARCHES_KEY = "nuts-recent-searches-v1";
const MAX_RECENT_SEARCHES = 8;

export function useRecentSearches() {
  const rawValue = useLocalStorageValue(RECENT_SEARCHES_KEY);

  const searches: string[] = useMemo(() => {
    if (!rawValue) return [];
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }, [rawValue]);

  const addSearch = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      try {
        const current = searches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
        const updated = [trimmed, ...current].slice(0, MAX_RECENT_SEARCHES);
        writeLocalStorageValue(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch {
        // Storage errors handled gracefully
      }
    },
    [searches],
  );

  const removeSearch = useCallback(
    (term: string) => {
      const trimmed = term.trim().toLowerCase();
      const updated = searches.filter((item) => item.toLowerCase() !== trimmed);
      writeLocalStorageValue(RECENT_SEARCHES_KEY, updated.length > 0 ? JSON.stringify(updated) : null);
    },
    [searches],
  );

  const clearSearches = useCallback(() => {
    writeLocalStorageValue(RECENT_SEARCHES_KEY, null);
  }, []);

  return { searches, addSearch, removeSearch, clearSearches };
}
