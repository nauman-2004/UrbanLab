/**
 * SERVER-ONLY. Mints a single-use Cartesia agent session for the browser.
 *
 *   POST https://api.cartesia.ai/v1/agents/websocket/{agent_id}/sessions
 *   headers: X-API-Key, Cartesia-Version: 2026-08-14
 *   body:    { config_overrides: { instructions, initial_message } }
 *   200:     { call_id, url, token, expires_at }   (token: opaque, single-use, ~4 min)
 * (docs.cartesia.ai/api-reference/agents/create-websocket-session, read 2026-11-15)
 *
 * The API key is read from process.env here and nowhere else. It is never
 * returned, logged, or placed in any NEXT_PUBLIC_* variable. Study-specific
 * instructions are set here as trusted overrides; the browser can't replace them.
 */
import { buildInitialMessage, buildInterviewerInstructions } from "../prompt/interviewer";
import { CARTESIA_API_VERSION } from "../services/protocol";
import type { ResearchContext, VoiceError, VoiceMode } from "../types";

export interface CartesiaServerConfig {
  apiKey: string;
  agentId: string;
  apiVersion: string;
  baseUrl: string;
}

type Env = Record<string, string | undefined>;

export function serverMode(env: Env = process.env): VoiceMode {
  return env.CARTESIA_DEMO_MODE === "live" ? "live" : "mock";
}

/** Any NEXT_PUBLIC_CARTESIA_* variable would be bundled into the browser. Refuse to run with one. */
export function publicCartesiaVars(env: Env = process.env): string[] {
  return Object.keys(env).filter((k) => /^NEXT_PUBLIC_.*CARTESIA/i.test(k));
}

export function readServerConfig(env: Env = process.env): { ok: true; config: CartesiaServerConfig } | { ok: false; error: VoiceError } {
  const leaked = publicCartesiaVars(env);
  if (leaked.length)
    return { ok: false, error: { kind: "config_missing", message: `Refusing to run: remove ${leaked.join(", ")}. Cartesia settings must be server-only.` } };
  const apiKey = env.CARTESIA_API_KEY?.trim();
  const agentId = env.CARTESIA_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    const missing = [!apiKey && "CARTESIA_API_KEY", !agentId && "CARTESIA_AGENT_ID"].filter(Boolean).join(" and ");
    return { ok: false, error: { kind: "config_missing", message: `Live mode needs ${missing} in the server environment (.env).` } };
  }
  return {
    ok: true,
    config: {
      apiKey,
      agentId,
      apiVersion: env.CARTESIA_API_VERSION?.trim() || CARTESIA_API_VERSION,
      baseUrl: "https://api.cartesia.ai",
    },
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);

/** Validates an untrusted ResearchContext from the browser. Drops `knownContext` entirely. */
export function parseResearchContext(input: unknown): { ok: true; context: ResearchContext } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null) return { ok: false, message: "Missing research context." };
  const c = input as Record<string, unknown>;
  const studyId = str(c.studyId, 120);
  const propertyId = str(c.propertyId, 120);
  const researchQuestion = str(c.researchQuestion, 600);
  if (!studyId || !propertyId || !researchQuestion) return { ok: false, message: "studyId, propertyId and researchQuestion are required." };
  if (!Array.isArray(c.missingEvidence) || c.missingEvidence.length === 0 || c.missingEvidence.length > 20)
    return { ok: false, message: "missingEvidence must list 1-20 fields." };
  const types = new Set(["boolean", "integer", "number", "text"]);
  const missingEvidence: ResearchContext["missingEvidence"] = [];
  for (const raw of c.missingEvidence) {
    const f = (raw ?? {}) as Record<string, unknown>;
    const key = str(f.key, 80);
    const label = str(f.label, 120);
    if (!key || !label || typeof f.type !== "string" || !types.has(f.type)) return { ok: false, message: "Each missing field needs key, label and a valid type." };
    missingEvidence.push({
      key,
      label,
      type: f.type as ResearchContext["missingEvidence"][number]["type"],
      required: f.required === true,
      description: str(f.description, 300) ?? undefined,
    });
  }
  return {
    ok: true,
    context: {
      studyId,
      propertyId,
      researchQuestion,
      propertyName: str(c.propertyName, 160) ?? undefined,
      participantRole: str(c.participantRole, 80) ?? undefined,
      missingEvidence,
    },
  };
}

export interface SessionGrantResponse {
  url: string;
  token: string;
  expiresAt: string;
  callId: string | null;
}

export type CreateSessionResult = { ok: true; session: SessionGrantResponse } | { ok: false; httpStatus: number; error: VoiceError };

export async function createCartesiaSession(
  context: ResearchContext,
  config: CartesiaServerConfig,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<CreateSessionResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/v1/agents/websocket/${encodeURIComponent(config.agentId)}/sessions`, {
      method: "POST",
      headers: {
        "Cartesia-Version": config.apiVersion,
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        config_overrides: {
          instructions: buildInterviewerInstructions(context),
          initial_message: buildInitialMessage(context),
        },
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, httpStatus: 502, error: { kind: "connection_failed", message: "Could not reach Cartesia." } };
  }

  if (!res.ok) {
    // Cartesia's error body has { message, title, ... }; surface only status-level meaning, never echo headers.
    const map: Record<number, VoiceError> = {
      400: { kind: "agent_error", message: "Cartesia rejected the session configuration (400). Check the agent ID and its settings." },
      401: { kind: "auth_failed", message: "Cartesia rejected the API key (401). Check CARTESIA_API_KEY." },
      403: { kind: "auth_failed", message: "This Cartesia API key can't use that agent (403)." },
      404: { kind: "agent_not_found", message: "Cartesia agent not found (404). Check CARTESIA_AGENT_ID." },
      429: { kind: "rate_limited", message: "Cartesia's agent concurrency limit was reached (429). Wait and retry, or use mock mode." },
    };
    const error = map[res.status] ?? { kind: "connection_failed" as const, message: `Cartesia returned ${res.status}.` };
    return { ok: false, httpStatus: res.status === 429 ? 429 : res.status >= 500 ? 502 : res.status === 401 || res.status === 403 ? 401 : 400, error };
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown; token?: unknown; expires_at?: unknown; call_id?: unknown } | null;
  if (!body || typeof body.url !== "string" || !/^wss:\/\//.test(body.url) || typeof body.token !== "string")
    return { ok: false, httpStatus: 502, error: { kind: "connection_failed", message: "Unexpected response from Cartesia." } };

  return {
    ok: true,
    session: {
      url: body.url,
      token: body.token,
      expiresAt: typeof body.expires_at === "string" ? body.expires_at : "",
      callId: typeof body.call_id === "string" ? body.call_id : null,
    },
  };
}
