'use client';

import { useEffect } from 'react';

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
