import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@forgit/auth",
    "@forgit/db",
    "@forgit/domain",
    "@forgit/git-client",
    "@forgit/github-compat",
    "@forgit/mcp",
    "@forgit/observability",
  ],
};

export default nextConfig;
