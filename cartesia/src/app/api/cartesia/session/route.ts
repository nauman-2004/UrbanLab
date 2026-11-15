/**
 * POST /api/cartesia/session : mints a single-use Cartesia agent session.
 * Server-only; CARTESIA_API_KEY never leaves this process.
 */
import { createCartesiaSession, parseResearchContext, readServerConfig, serverMode } from "@cartesia/server/session";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // Only this app's own pages may mint sessions with our key.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host)
    return json({ error: { kind: "auth_failed", message: "Cross-origin session requests are not allowed." } }, 403);

  if (serverMode() !== "live")
    return json({ error: { kind: "config_missing", message: "Live mode is off. Set CARTESIA_DEMO_MODE=live to use Cartesia." } }, 409);

  const cfg = readServerConfig();
  if (!cfg.ok) return json({ error: cfg.error }, 503);

  const body = (await request.json().catch(() => null)) as { context?: unknown } | null;
  const parsed = parseResearchContext(body?.context);
  if (!parsed.ok) return json({ error: { kind: "unknown", message: parsed.message } }, 400);

  const result = await createCartesiaSession(parsed.context, cfg.config);
  if (!result.ok) {
    console.info(`[cartesia] SESSION REQUEST FAILED (${result.error.kind})`);
    return json({ error: result.error }, result.httpStatus);
  }
  console.info("[cartesia] SESSION MINTED");
  return json({ session: result.session });
}
