"use client";

import { useCallback, useSyncExternalStore } from "react";

const localStorageEvent = "nuts-local-storage";

export function writeLocalStorageValue(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(localStorageEvent, { detail: key }));
  } catch {
    // Storage can be disabled by browser privacy settings or quota limits.
  }
}

export function useLocalStorageValue(key: string): string | null {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== key) return;
      if (event instanceof CustomEvent && event.detail !== key) return;
      onStoreChange();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(localStorageEvent, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(localStorageEvent, handleStorage);
    };
  }, [key]);

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
