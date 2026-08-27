import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@entitykit/core",
    "@entitykit/postgres",
    "pg",
  ],
};

export default nextConfig;
