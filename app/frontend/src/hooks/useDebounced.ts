import { useEffect, useState } from "react";

// 250ms default per the optimizations spec — keeps the filter inputs
// from re-fetching the customer list on every keystroke.
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
