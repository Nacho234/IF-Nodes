import type { NextConfig } from 'next';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // La web habla con la API como misma-origin (/api/*) para que la cookie
  // de sesión viaje sin CORS. El rewrite apunta al NestJS local.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_INTERNAL_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
