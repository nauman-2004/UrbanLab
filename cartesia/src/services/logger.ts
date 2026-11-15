/**
 * Concise, safe development logging for the voice module.
 *
 * Logs lifecycle milestones only (e.g. "VOICE SESSION STARTED"). Never logs
 * API keys, session/access tokens, audio, or the host's `knownContext`.
 * Anything that looks like a credential is redacted defensively.
 */

const SECRET_KEY = /token|key|secret|authorization|password|credential/i;
const SECRET_VALUE = /\bsk_car_[A-Za-z0-9_-]+|\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/g;

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]");
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

let enabled = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

export function setVoiceLogging(on: boolean): void {
  enabled = on;
}

export function voiceLog(milestone: string, details?: Record<string, unknown>): void {
  if (!enabled) return;
  if (details) console.info(`[cartesia] ${milestone}`, redact(details));
  else console.info(`[cartesia] ${milestone}`);
}
