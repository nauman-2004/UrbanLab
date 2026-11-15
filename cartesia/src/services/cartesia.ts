/**
 * LIVE transport: a real Cartesia voice-agent session in the browser.
 *
 * Flow (docs.cartesia.ai, line/integrations/websocket-api):
 *   1. (after approval) open the microphone, so a denied permission never burns a session
 *   2. POST /api/cartesia/session  -> our server uses CARTESIA_API_KEY to create a
 *      single-use session {url, token, expiresAt}; the key never reaches the browser
 *   3. new WebSocket(`${url}?cartesia_version=...&access_token=<token>`)
 *   4. send `session_create` (audio config only), wait for `session_ready`
 *   5. stream mic as `audio_input` (base64 pcm_16000, ~100 ms), play `audio_output`,
 *      honour `audio_output_clear` (barge-in), build the transcript from `turn_*`
 *
 * The token is opaque and is never logged or stored.
 */
import type { ResearchContext } from "../types";
import { browserAudio, float32ToPcm16Base64, pcm16Base64ToFloat32, type AudioIO, type AudioPlayer, type MicrophoneHandle } from "./audio";
import { voiceLog } from "./logger";
import {
  audioInputMessage,
  buildAgentSocketUrl,
  clientToolErrorMessage,
  INPUT_CHUNK_SAMPLES,
  parseServerMessage,
  sessionCreateMessage,
  toTranscriptUpdate,
} from "./protocol";
import { VoiceFailure, type TransportHandlers, type VoiceTransport } from "./transport";
import type { VoiceErrorKind } from "../types";

export interface SessionGrant {
  url: string;
  token: string;
  expiresAt: string;
  callId: string | null;
}

export interface CartesiaTransportOptions {
  /** Same-origin route that mints the session (see app/api/cartesia/session). */
  sessionEndpoint?: string;
  audio?: AudioIO;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  /** Give up if `session_ready` doesn't arrive in time. */
  readyTimeoutMs?: number;
}

const SILENCE = new Float32Array(INPUT_CHUNK_SAMPLES);

export class CartesiaVoiceTransport implements VoiceTransport {
  readonly mode = "live" as const;
  private ws: WebSocket | null = null;
  private mic: MicrophoneHandle | null = null;
  private player: AudioPlayer | null = null;
  private muted = false;
  private ready = false;
  private closedLocally = false;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<Omit<CartesiaTransportOptions, "WebSocketImpl">> & { WebSocketImpl?: typeof WebSocket };

  constructor(options: CartesiaTransportOptions = {}) {
    this.opts = {
      sessionEndpoint: options.sessionEndpoint ?? "/api/cartesia/session",
      audio: options.audio ?? browserAudio,
      fetchImpl: options.fetchImpl ?? ((...a) => fetch(...a)),
      readyTimeoutMs: options.readyTimeoutMs ?? 15000,
      WebSocketImpl: options.WebSocketImpl,
    };
  }

  async connect(context: ResearchContext, h: TransportHandlers): Promise<void> {
    h.onPhase("requesting_microphone");
    this.mic = await this.opts.audio.openMicrophone();
    if (this.closedLocally) return this.release();

    h.onPhase("connecting");
    let grant: SessionGrant;
    try {
      grant = await this.requestSession(context);
    } catch (err) {
      this.release();
      throw err;
    }
    if (this.closedLocally) return this.release();

    this.player = this.opts.audio.createPlayer();
    const WS = this.opts.WebSocketImpl ?? WebSocket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (kind: VoiceErrorKind, message: string) => {
        if (settled) return;
        settled = true;
        this.release();
        reject(new VoiceFailure({ kind, message }));
      };

      let ws: WebSocket;
      try {
        ws = new WS(buildAgentSocketUrl(grant.url, grant.token));
      } catch {
        return fail("connection_failed", "Could not open the Cartesia connection.");
      }
      this.ws = ws;
      this.readyTimer = setTimeout(() => fail("connection_failed", "Cartesia did not confirm the session in time."), this.opts.readyTimeoutMs);

      ws.onopen = () => ws.send(sessionCreateMessage());

      ws.onmessage = (ev: MessageEvent) => {
        const msg = parseServerMessage(ev.data);
        if (!msg) return; // unknown/malformed: ignore (per docs)
        switch (msg.type) {
          case "session_ready":
            if (this.readyTimer) clearTimeout(this.readyTimer);
            this.ready = true;
            settled = true;
            voiceLog("VOICE SESSION STARTED", { mode: "live" });
            h.onReady({ callId: msg.call_id });
            this.startStreaming(h);
            resolve();
            break;
          case "audio_output":
            this.player?.enqueue(pcm16Base64ToFloat32(msg.audio));
            break;
          case "audio_output_clear":
            this.player?.clear();
            break;
          case "client_tool_call":
            if (msg.expects_response) ws.send(clientToolErrorMessage(msg.tool_call_id));
            break;
          case "error":
            if (!this.ready) return fail(msg.fatal ? "agent_error" : "connection_failed", `Cartesia: ${msg.message}`);
            h.onError({ kind: "agent_error", message: `Cartesia: ${msg.message}` }, msg.fatal);
            if (msg.fatal) this.release();
            break;
          default: {
            const update = toTranscriptUpdate(msg);
            if (update) h.onTranscript(update);
          }
        }
      };

      ws.onclose = (ev: CloseEvent) => {
        if (this.closedLocally) return;
        if (!this.ready) return fail("connection_failed", "The Cartesia connection closed before the session started.");
        this.release();
        // 1000 = normal closure, e.g. the agent ended the call.
        if (ev.code === 1000) h.onRemoteEnd();
        else h.onError({ kind: "disconnected", message: "The voice connection dropped unexpectedly." }, true);
      };
      // Errors are followed by a close event; handled there.
      ws.onerror = () => undefined;
    });
  }

  private async requestSession(context: ResearchContext): Promise<SessionGrant> {
    const { knownContext: _hostOnly, ...safeContext } = context; // host-only context never leaves the page
    void _hostOnly;
    let res: Response;
    try {
      res = await this.opts.fetchImpl(this.opts.sessionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: safeContext }),
        cache: "no-store",
      });
    } catch {
      throw new VoiceFailure({ kind: "connection_failed", message: "Could not reach the UrbanLab voice server." });
    }
    const body = (await res.json().catch(() => null)) as { session?: SessionGrant; error?: { kind?: VoiceErrorKind; message?: string } } | null;
    if (!res.ok || !body?.session) {
      throw new VoiceFailure({
        kind: body?.error?.kind ?? (res.status === 401 ? "auth_failed" : "connection_failed"),
        message: body?.error?.message ?? `Voice session request failed (${res.status}).`,
      });
    }
    return body.session;
  }

  private startStreaming(h: TransportHandlers): void {
    this.mic?.start((chunk) => {
      if (this.ws?.readyState !== 1) return; // OPEN
      // While muted, send silence so the session stays alive (it closes after 120 s without client events).
      this.ws.send(audioInputMessage(float32ToPcm16Base64(this.muted ? SILENCE : chunk)));
    });
    this.activityTimer = setInterval(() => {
      h.onActivity({
        inputLevel: this.muted ? 0 : (this.mic?.level ?? 0),
        outputLevel: this.player?.level ?? 0,
        agentSpeaking: this.player?.isPlaying ?? false,
      });
    }, 100);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  close(): void {
    this.closedLocally = true;
    this.release();
  }

  private release(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.readyTimer = this.activityTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
      try {
        if (ws.readyState === 0 || ws.readyState === 1) ws.close(1000);
      } catch {
        /* already closed */
      }
    }
    this.mic?.stop();
    this.player?.close();
    this.mic = this.player = null;
  }
}
