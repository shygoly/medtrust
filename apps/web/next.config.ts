import type { NextConfig } from "next";
import path from "path";
import manifest from "./src/nav.manifest.json";

const nextConfig: NextConfig = {
  // Standalone server bundle for Docker/Fly. outputFileTracingRoot points at the
  // monorepo root so pnpm workspace deps are traced into .next/standalone.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@medtrust/demo-scenario"],
  // 被合并页面的旧地址。映射登记在导航清单（D-UI-2），scripts/check-nav.mjs 的 N10 守护其目标与残留链接。
  async redirects() {
    return manifest.redirects.map(({ from, to }) => ({ source: from, destination: to, permanent: true }));
  },
};

export default nextConfig;
