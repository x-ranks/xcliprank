import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@tensorflow/tfjs", "nsfwjs", "sharp"],
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
