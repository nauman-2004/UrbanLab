#!/usr/bin/env node
/**
 * Verifies that no Cartesia credential can reach the browser.
 *
 * Usage (builds with a fake sentinel key, then scans everything shipped to clients):
 *   CARTESIA_DEMO_MODE=live CARTESIA_API_KEY=sk_car_BUNDLE_SENTINEL CARTESIA_AGENT_ID=agent_sentinel npm run build
 *   CARTESIA_API_KEY=sk_car_BUNDLE_SENTINEL npm run check:bundle
 *
 * Fails if any client asset (.next/static) contains the key value, the env var
 * name, the server-only session endpoint, or the X-API-Key header name.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", ".next", "static");
const sentinel = process.env.CARTESIA_API_KEY || "sk_car_BUNDLE_SENTINEL";
const forbidden = [sentinel, "CARTESIA_API_KEY", "X-API-Key", "/v1/agents/websocket/${", "/sessions`"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const hits = [];
try {
  for (const file of walk(root)) {
    if (!/\.(js|css|html|json|map|txt)$/.test(file)) continue;
    files++;
    const text = readFileSync(file, "utf8");
    for (const f of forbidden) if (text.includes(f)) hits.push(`${path.relative(root, file)}: contains ${f === sentinel ? "the API key value" : JSON.stringify(f)}`);
  }
} catch (err) {
  console.error(`No client build found at ${root}. Run "npm run build" first.`, err.message);
  process.exit(2);
}

if (!files) {
  console.error("No client assets found; did the build run?");
  process.exit(2);
}
if (hits.length) {
  console.error(`FAIL: ${hits.length} credential leak(s) in client bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`OK: scanned ${files} client assets; no Cartesia key, key name, or server-only endpoint found.`);
