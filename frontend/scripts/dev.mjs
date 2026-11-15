// One command for the whole app: starts the LangChain agent backend, waits until it is up,
// then starts the frontend connected to it. Both logs stream here; Ctrl+C stops both.
//
//   npm run dev            real models via the Google Gemini API (~30 requests per study)
//   npm run dev:fake       scripted test model: no API key, no quota
//   npm run dev:demo       frontend only, replaying a recorded study
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "live";
if (!["live", "fake", "demo"].includes(mode)) {
  console.error("usage: node scripts/dev.mjs [live|fake|demo]");
  process.exit(1);
}
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(frontend, "..", "backend");
const PORT = process.env.URBANLAB_BACKEND_PORT ?? "8000";
const API = `http://localhost:${PORT}`;
const children = [];

function run(name, color, cmd, args, opts) {
  const child = spawn(cmd, args, { shell: true, ...opts });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${tag}exited (${code ?? "signal"})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode != null) continue;
    // shell: true wraps the process; kill the whole tree so uvicorn / next don't linger.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function healthy() {
  try {
    const r = await fetch(`${API}/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

if (mode !== "demo") {
  if (mode === "live") {
    const env = existsSync(path.resolve(frontend, "..", ".env")) ? readFileSync(path.resolve(frontend, "..", ".env"), "utf8") : "";
    if (!/^GOOGLE_API_KEY=\S/m.test(env)) {
      console.warn("⚠ GOOGLE_API_KEY is empty in the repo-root .env. Add your Gemini API key, or run `npm run dev:fake`.");
    }
  }
  const running = await healthy();
  if (running) {
    // A backend left over from an earlier session keeps its old code and .env; restart it to pick up changes.
    console.log(`Agent backend already running at ${API}; using it (CoStar source: ${running.costar_source}).`);
    console.log("  If you changed backend code or .env, stop that process and run this again.");
  } else {
    const app = mode === "fake" ? "tests.fake_server:app" : "main:app";
    console.log(`Starting the agent backend (${app})...`);
    run("agent", "35", "uv", ["run", "uvicorn", app, "--port", PORT], { cwd: backend });
    let info = null;
    for (let i = 0; i < 120 && !info && !stopping; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      info = await healthy();
    }
    if (!info) {
      console.error(`The agent backend didn't come up on ${API} within 2 minutes.`);
      shutdown(1);
    }
    console.log(`Agent backend ready · model ${info.model} · CoStar source: ${info.costar_source}`);
  }
}

console.log("Starting the frontend...");
run("web", "36", "npx", ["next", "dev", "--port", "3000"], {
  cwd: frontend,
  env: { ...process.env, NEXT_PUBLIC_STUDY_SOURCE: mode === "demo" ? "replay" : "live", NEXT_PUBLIC_API_BASE: API },
});
console.log(`\n  ➜ Open http://localhost:3000 and click "Run study" (${mode === "demo" ? "recorded demo" : `agent: ${mode}`})\n`);
