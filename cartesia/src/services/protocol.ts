/**
 * Cartesia Agents WebSocket protocol (v1), pure helpers.
 *
 * Source: docs.cartesia.ai, read 2026-11-15:
 *   - api-reference/agents/agent-websocket            (message types)
 *   - api-reference/agents/create-websocket-session   (server-created sessions)
 *   - line/integrations/websocket-api                 (browser connection)
 * Only documented messages and fields are used. Unknown message types are ignored, as the docs instruct.
 */
import type { TranscriptEntry, TranscriptRole } from "../types";

export const CARTESIA_API_VERSION = "2026-08-14";
/** Headerless mono signed 16-bit little-endian PCM at 16 kHz, in both directions. */
export const AUDIO_FORMAT = "pcm_16000" as const;
export const AUDIO_SAMPLE_RATE = 16000;
/** ~100 ms of audio per `audio_input` message. */
export const INPUT_CHUNK_SAMPLES = 1600;

// ----------------------------------------------------- server -> client ----

export type ServerMessage =
  | { type: "session_ready"; call_id: string; agent_id?: string }
  | { type: "audio_output"; audio: string }
  | { type: "audio_output_clear" }
  | { type: "turn_started"; turn: number; role: "user" | "assistant" }
  | { type: "turn_output_text_delta"; turn: number; role: "assistant"; text: string }
  | { type: "turn_ended"; turn: number; role: "user" | "assistant"; text: string; interrupted: boolean; ignored?: boolean }
  | { type: "client_tool_call"; tool_call_id: string; tool_name: string; expects_response: boolean }
  | { type: "error"; code: string; message: string; fatal: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isRole = (v: unknown): v is "user" | "assistant" => v === "user" || v === "assistant";

/** Parses one text frame. Returns null for malformed or unknown messages (which must be ignored). */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.type !== "string") return null;
  switch (m.type) {
    case "session_ready":
      return typeof m.call_id === "string" ? { type: "session_ready", call_id: m.call_id, agent_id: typeof m.agent_id === "string" ? m.agent_id : undefined } : null;
    case "audio_output":
      return typeof m.audio === "string" ? { type: "audio_output", audio: m.audio } : null;
    case "audio_output_clear":
      return { type: "audio_output_clear" };
    case "turn_started":
      return typeof m.turn === "number" && isRole(m.role) ? { type: "turn_started", turn: m.turn, role: m.role } : null;
    case "turn_output_text_delta":
      return typeof m.turn === "number" && typeof m.text === "string"
        ? { type: "turn_output_text_delta", turn: m.turn, role: "assistant", text: m.text }
        : null;
    case "turn_ended":
      return typeof m.turn === "number" && isRole(m.role)
        ? {
            type: "turn_ended",
            turn: m.turn,
            role: m.role,
            text: typeof m.text === "string" ? m.text : "",
            interrupted: m.interrupted === true,
            ignored: m.ignored === true,
          }
        : null;
    case "client_tool_call":
      return typeof m.tool_call_id === "string"
        ? { type: "client_tool_call", tool_call_id: m.tool_call_id, tool_name: String(m.tool_name ?? ""), expects_response: m.expects_response === true }
        : null;
    case "error":
      return { type: "error", code: String(m.code ?? "unknown"), message: String(m.message ?? "Agent error"), fatal: m.fatal === true };
    default:
      return null;
  }
}

// ----------------------------------------------------- client -> server ----

export function sessionCreateMessage(): string {
  // For server-created sessions, session_create configures audio only (docs). Unknown fields are rejected.
  return JSON.stringify({ type: "session_create", audio: { input_format: AUDIO_FORMAT } });
}

export function audioInputMessage(base64Pcm: string): string {
  return JSON.stringify({ type: "audio_input", audio: base64Pcm });
}

/** We register no client tools; answer any call with an error so the agent never waits on us. */
export function clientToolErrorMessage(toolCallId: string): string {
  return JSON.stringify({
    type: "client_tool_result",
    tool_call_id: toolCallId,
    result: "UrbanLab's voice client does not provide tools.",
    is_error: true,
  });
}

/** Browser URL per docs: `${session.url}?cartesia_version=...&access_token=<encoded token>`. */
export function buildAgentSocketUrl(sessionUrl: string, token: string, version = CARTESIA_API_VERSION): string {
  const u = new URL(sessionUrl);
  u.searchParams.set("cartesia_version", version);
  u.searchParams.set("access_token", token);
  return u.toString();
}

// ----------------------------------------------------------- transcript ----

/** Transport-neutral transcript update (live and mock transports both produce these). */
export type TranscriptUpdate =
  | { kind: "start"; turn: number; role: TranscriptRole; id?: string }
  | { kind: "delta"; turn: number; role: TranscriptRole; text: string; id?: string }
  | { kind: "end"; turn: number; role: TranscriptRole; text: string; interrupted?: boolean; id?: string }
  | { kind: "drop"; turn: number; role: TranscriptRole; id?: string };

export function toTranscriptUpdate(m: ServerMessage): TranscriptUpdate | null {
  const role = (r: "user" | "assistant"): TranscriptRole => (r === "user" ? "participant" : "agent");
  switch (m.type) {
    case "turn_started":
      return { kind: "start", turn: m.turn, role: role(m.role) };
    case "turn_output_text_delta":
      return { kind: "delta", turn: m.turn, role: "agent", text: m.text };
    case "turn_ended":
      // `ignored` user turns (noise, filtered speech) are dropped, not shown as evidence.
      return m.ignored ? { kind: "drop", turn: m.turn, role: role(m.role) } : { kind: "end", turn: m.turn, role: role(m.role), text: m.text, interrupted: m.interrupted };
    default:
      return null;
  }
}

export const entryIdFor = (u: TranscriptUpdate) => u.id ?? `turn-${u.turn}-${u.role}`;

/** Pure reducer: applies one update to the transcript. `offsetSeconds` = time since session start. */
export function applyTranscriptUpdate(
  entries: TranscriptEntry[],
  u: TranscriptUpdate,
  now: Date,
  offsetSeconds: number,
): TranscriptEntry[] {
  const id = entryIdFor(u);
  const idx = entries.findIndex((e) => e.id === id);
  if (u.kind === "drop") return idx === -1 ? entries : entries.filter((e) => e.id !== id);

  const existing = idx === -1 ? null : entries[idx];
  const base: TranscriptEntry = existing ?? {
    id,
    role: u.role,
    text: "",
    timestamp: now.toISOString(),
    offsetSeconds: Math.max(0, Math.round(offsetSeconds * 10) / 10),
    final: false,
  };
  let next: TranscriptEntry;
  if (u.kind === "start") next = base;
  // Deltas are appended verbatim (docs: do not trim or add whitespace).
  else if (u.kind === "delta") next = { ...base, text: base.text + u.text };
  // The final turn text is authoritative; keep streamed text if the final one is empty.
  else next = { ...base, text: u.text || base.text, final: true, interrupted: u.interrupted || undefined };

  if (idx === -1) return [...entries, next];
  const copy = entries.slice();
  copy[idx] = next;
  return copy;
}
