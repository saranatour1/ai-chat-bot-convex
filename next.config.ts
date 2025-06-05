import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    ppr: false,
  },
  images: {
    remotePatterns: [
      {hostname: 'https://avatars.githubusercontent.com',
                pathname: '/u/**',
      }
    ],
  },
};

export default nextConfig;
