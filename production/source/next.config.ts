import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  experimental: { cpus: 1, workerThreads: false },
};
export default nextConfig;
