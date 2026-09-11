import { type ComponentType, lazy } from "react";

const RELOAD_ATTEMPTED_KEY = "herdr:lazy-chunk-reload";

// After an in-app update, the restarted server only embeds the new build's
// hashed chunks, so a lazy import from an older open tab 404s and crashes the
// root error boundary. Reload once to fetch the fresh index.html; a repeated
// failure throws the original error instead of looping.
export async function importWithReload<T>(
  factory: () => Promise<T>,
): Promise<T> {
  try {
    const module = await factory();
    sessionStorage.removeItem(RELOAD_ATTEMPTED_KEY);
    return module;
  } catch (error) {
    if (sessionStorage.getItem(RELOAD_ATTEMPTED_KEY)) throw error;
    sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, "1");
    window.location.reload();
    // Keep the lazy boundary suspended while the page unloads.
    return new Promise<T>(() => {});
  }
}

export function lazyWithReload<C extends ComponentType<any>>(
  factory: () => Promise<{ default: C }>,
) {
  return lazy(() => importWithReload(factory));
}
