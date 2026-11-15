import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo-root .env is the one place to configure UrbanLab (frontend + backend).
// Next.js only reads frontend/.env* on its own; this also loads ../.env.
// Values already set (shell, frontend/.env.local) win. Only NEXT_PUBLIC_* reach the browser.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
