"use client";

import { useEffect,useState } from "react";

/** Keeps typing responsive while avoiding a request for every keystroke. */
export function useDebouncedValue<T>(value: T, delay = 160) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
