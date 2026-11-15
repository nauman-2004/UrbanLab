import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Same convention as frontend/: the repo-root .env is the one place to configure UrbanLab.
// Next.js only reads cartesia/.env* on its own; this also loads ../.env.
// Values already set (shell, cartesia/.env.local) win.
// CARTESIA_* variables are server-only. Nothing here may be prefixed NEXT_PUBLIC_.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
