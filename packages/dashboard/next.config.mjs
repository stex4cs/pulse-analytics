import path from 'node:path';

const IS_DEMO = process.env.NEXT_PUBLIC_PULSE_DEMO === '1';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8081';

/**
 * CSP.
 *
 * U demo rezimu dashboard ne sme nikuda da zove - `connect-src 'self'` to
 * i primorava, pa je izlaganje podataka nemoguce cak i ako se negde provuce
 * poziv. U produkciji se dodaje samo adresa API-ja, nista vise.
 *
 * `unsafe-inline` za stilove je Tailwind/Next zahtev; skripte ga ne dobijaju.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${IS_DEMO ? '' : ` ${API_URL}`}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 'standalone' je za Docker; Vercel ga ignorise i koristi svoj build
  output: process.env.VERCEL ? undefined : 'standalone',
  experimental: {
    // npm workspaces hoist-uje zavisnosti u koren monorepa. Bez ovoga Next
    // trazi node_modules samo unutar packages/dashboard i standalone izlaz
    // izadje bez ijedne zavisnosti.
    outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  },
  env: {
    NEXT_PUBLIC_API_URL: API_URL,
    NEXT_PUBLIC_PULSE_DEMO: IS_DEMO ? '1' : '0',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
