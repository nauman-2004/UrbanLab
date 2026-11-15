import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CONTEXT } from "../src/mock/demo-context";
import { createCartesiaSession, parseResearchContext, readServerConfig } from "../src/server/session";
import { POST } from "../src/app/api/cartesia/session/route";

const KEY = "sk_car_TEST_SENTINEL_never_real";
const cfg = { apiKey: KEY, agentId: "agent_123", apiVersion: "2026-08-14", baseUrl: "https://api.cartesia.ai" };

describe("server config (11. key stays server-side)", () => {
  it("requires key + agent id", () => {
    const r = readServerConfig({ CARTESIA_API_KEY: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("CARTESIA_API_KEY and CARTESIA_AGENT_ID");
  });
  it("refuses to run when a NEXT_PUBLIC_*CARTESIA* variable exists", () => {
    const r = readServerConfig({ CARTESIA_API_KEY: KEY, CARTESIA_AGENT_ID: "a", NEXT_PUBLIC_CARTESIA_API_KEY: KEY });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("NEXT_PUBLIC_CARTESIA_API_KEY");
      expect(r.error.message).not.toContain(KEY);
    }
  });
});

describe("createCartesiaSession", () => {
  it("calls the documented endpoint with server-side key and per-study instructions", async () => {
    let call: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response(JSON.stringify({ call_id: "c1", url: "wss://api.cartesia.ai/v1/agents/websocket/agent_123", token: "tok", expires_at: "2026-11-15T10:04:00Z" }));
    }) as unknown as typeof fetch;
    const r = await createCartesiaSession(DEMO_CONTEXT, cfg, f);
    expect(r).toEqual({ ok: true, session: { url: "wss://api.cartesia.ai/v1/agents/websocket/agent_123", token: "tok", expiresAt: "2026-11-15T10:04:00Z", callId: "c1" } });
    expect(call!.url).toBe("https://api.cartesia.ai/v1/agents/websocket/agent_123/sessions");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(KEY);
    expect(headers["Cartesia-Version"]).toBe("2026-08-14");
    const body = JSON.parse(String(call!.init.body));
    expect(Object.keys(body)).toEqual(["config_overrides"]);
    const { instructions, initial_message } = body.config_overrides;
    expect(instructions).toContain("Houston Commerce Center");
    expect(instructions).toContain("Current charger count");
    expect(instructions).toContain("Never invent");
    expect(instructions).not.toContain("knownContext");
    expect(instructions).not.toContain("No CoStar data in the standalone demo"); // knownContext value never sent
    expect(initial_message.length).toBeLessThanOrEqual(1000);
    expect(initial_message).toMatch(/recorded for a research study/);
  });

  it.each([
    [401, "auth_failed"],
    [404, "agent_not_found"],
    [429, "rate_limited"],
    [400, "agent_error"],
    [500, "connection_failed"],
  ])("maps HTTP %i to %s without echoing the key", async (status, kind) => {
    const f = (async () => new Response(JSON.stringify({ message: "x" }), { status })) as unknown as typeof fetch;
    const r = await createCartesiaSession(DEMO_CONTEXT, cfg, f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe(kind);
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it("rejects a response without a wss url or token", async () => {
    const f = (async () => new Response(JSON.stringify({ url: "http://evil", token: "t" }))) as unknown as typeof fetch;
    expect((await createCartesiaSession(DEMO_CONTEXT, cfg, f)).ok).toBe(false);
  });
});

describe("parseResearchContext (untrusted browser input)", () => {
  it("drops knownContext and validates fields", () => {
    const r = parseResearchContext(DEMO_CONTEXT);
    expect(r.ok).toBe(true);
    if (r.ok) expect("knownContext" in r.context).toBe(false);
    expect(parseResearchContext({ ...DEMO_CONTEXT, missingEvidence: [] }).ok).toBe(false);
    expect(parseResearchContext({ ...DEMO_CONTEXT, missingEvidence: [{ key: "k", label: "l", type: "sql" }] }).ok).toBe(false);
  });
});

describe("POST /api/cartesia/session route", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost:3100/api/cartesia/session", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3100", ...headers },
      body: JSON.stringify({ context: DEMO_CONTEXT }),
    });

  it("is disabled in mock mode", async () => {
    vi.stubEnv("CARTESIA_DEMO_MODE", "mock");
    const res = await POST(req());
    expect(res.status).toBe(409);
  });

  it("rejects cross-origin requests", async () => {
    vi.stubEnv("CARTESIA_DEMO_MODE", "live");
    const res = await POST(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("reports missing config without leaking anything", async () => {
    vi.stubEnv("CARTESIA_DEMO_MODE", "live");
    vi.stubEnv("CARTESIA_API_KEY", "");
    vi.stubEnv("CARTESIA_AGENT_ID", "");
    const res = await POST(req({ origin: "http://localhost:3100" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.kind).toBe("config_missing");
  });

  it("returns only the session grant, never the API key", async () => {
    vi.stubEnv("CARTESIA_DEMO_MODE", "live");
    vi.stubEnv("CARTESIA_API_KEY", KEY);
    vi.stubEnv("CARTESIA_AGENT_ID", "agent_123");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ call_id: "c1", url: "wss://api.cartesia.ai/v1/agents/websocket/agent_123", token: "tok", expires_at: "x" })),
    );
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await POST(req({ origin: "http://localhost:3100" }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).session.token).toBe("tok");
    expect(log.mock.calls.flat().join(" ")).not.toContain("tok");
    expect(log.mock.calls.flat().join(" ")).not.toContain(KEY);
    spy.mockRestore();
    log.mockRestore();
  });
});
