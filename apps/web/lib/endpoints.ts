const DEFAULT_API_URL = 'https://frigat-master.onrender.com';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : undefined;
}

function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http(s?):\/\//i, 'ws$1://');
}

function withWebSocketPath(origin: string): string {
  const trimmed = origin.replace(/\/+$/, '');
  return /\/ws$/i.test(trimmed) ? trimmed : `${trimmed}/ws`;
}

export const API_URL: string =
  clean(process.env.NEXT_PUBLIC_API_URL) ??
  clean(process.env.API_URL) ??
  DEFAULT_API_URL;

export const WS_URL: string = withWebSocketPath(
  clean(process.env.NEXT_PUBLIC_WS_URL) ?? toWebSocketOrigin(API_URL)
);
