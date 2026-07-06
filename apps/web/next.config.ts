import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone server bundle for Docker/Fly. outputFileTracingRoot points at the
  // monorepo root so pnpm workspace deps are traced into .next/standalone.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@medtrust/demo-scenario"],
};

export default nextConfig;
