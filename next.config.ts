import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/c/:short_id/:slug*',
        destination: '/',
      },
    ];
  },
};

export default nextConfig;
