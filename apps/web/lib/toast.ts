'use client';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  duration: number;
}

const EVENT = 'frigat:toast';

export function showToast(
  message: string,
  tone: ToastTone = 'info',
  duration = 5000
): void {
  if (typeof window === 'undefined') return;
  const toast: Toast = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    tone,
    duration,
  };
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: toast }));
}

export function subscribeToToasts(handler: (toast: Toast) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<Toast>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
