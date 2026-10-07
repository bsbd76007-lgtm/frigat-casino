const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const ANALYTICS_SRC = clean(process.env.NEXT_PUBLIC_ANALYTICS_SRC);
export const ANALYTICS_DOMAIN = clean(process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN);
export const ANALYTICS_ID = clean(process.env.NEXT_PUBLIC_ANALYTICS_ID);

export const ANALYTICS_ENABLED = ANALYTICS_SRC !== undefined;
