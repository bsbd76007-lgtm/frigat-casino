const FORBIDDEN_PUBLIC = /^NEXT_PUBLIC_.*(SECRET|PRIVATE|TOKEN|PASSWORD|CREDENTIAL|_KEY)$/i;
const PUBLIC_KEY_ALLOWLIST = new Set(['NEXT_PUBLIC_TURNSTILE_SITE_KEY']);

const leaked = Object.keys(process.env).filter(
  (name) => FORBIDDEN_PUBLIC.test(name) && !PUBLIC_KEY_ALLOWLIST.has(name)
);

if (leaked.length > 0) {
  throw new Error(
    `Refusing to build: ${leaked.join(', ')} would be inlined into the client ` +
      `bundle and served to every visitor. Drop the NEXT_PUBLIC_ prefix so the ` +
      `value stays server-side, or rename it if it is genuinely public.`
  );
}

const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@frigat/shared'],
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
