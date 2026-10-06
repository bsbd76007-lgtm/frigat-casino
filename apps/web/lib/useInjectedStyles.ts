'use client';

import { useEffect } from 'react';

/**
 * Injects a component's stylesheet once per page, keyed by `id`.
 *
 * If a <style> with that id already exists but holds different CSS — a hot
 * reload, or a tab that stayed open across a deploy and navigated client-side
 * — its contents are replaced. Without that, the first version of a component's
 * styles stuck for the life of the tab and later fixes never showed.
 */
export function useInjectedStyles(id: string, css: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }, [id, css]);
}
