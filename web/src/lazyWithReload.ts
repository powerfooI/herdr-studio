import { type ComponentType, lazy } from "react";

// After an in-app update, the restarted server only embeds the new build's
// hashed chunks, so a lazy import from an older open tab 404s and crashes the
// root error boundary. Reload each lazy component once to fetch fresh assets;
// other components loading successfully must not reset its retry guard.
export async function importWithReload<T>(
  componentKey: string,
  factory: () => Promise<T>,
): Promise<T> {
  const reloadKey = `herdr:lazy-chunk-reload:${componentKey}`;
  try {
    const module = await factory();
    sessionStorage.removeItem(reloadKey);
    return module;
  } catch (error) {
    if (sessionStorage.getItem(reloadKey)) throw error;
    sessionStorage.setItem(reloadKey, "1");
    window.location.reload();
    // Keep the lazy boundary suspended while the page unloads.
    return new Promise<T>(() => {});
  }
}

export function lazyWithReload<C extends ComponentType<any>>(
  componentKey: string,
  factory: () => Promise<{ default: C }>,
) {
  return lazy(() => importWithReload(componentKey, factory));
}
