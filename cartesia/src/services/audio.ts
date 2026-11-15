/**
 * Browser audio I/O for the live Cartesia session: microphone capture (16 kHz
 * PCM chunks) and playback of the agent's PCM audio. Pure conversion helpers are
 * exported separately so they can be unit-tested in Node.
 *
 * Nothing here runs until the transport calls `openMicrophone()`, which only
 * happens after human approval.
 */
import { AUDIO_SAMPLE_RATE, INPUT_CHUNK_SAMPLES } from "./protocol";
import { VoiceFailure } from "./transport";

// --------------------------------------------------------- pure helpers ----

export function float32ToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function pcm16Base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const n = Math.floor(bin.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/** Linear-interpolation resampler (adequate for speech at 16 kHz). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/** Collects variable-size frames and emits fixed ~100 ms chunks. */
export class ChunkBuffer {
  private buf = new Float32Array(0);
  constructor(private readonly size = INPUT_CHUNK_SAMPLES) {}
  push(frame: Float32Array, emit: (chunk: Float32Array) => void): void {
    const merged = new Float32Array(this.buf.length + frame.length);
    merged.set(this.buf);
    merged.set(frame, this.buf.length);
    let off = 0;
    while (merged.length - off >= this.size) {
      emit(merged.slice(off, off + this.size));
      off += this.size;
    }
    this.buf = merged.slice(off);
  }
}

// ------------------------------------------------------ browser classes ----

export interface MicrophoneHandle {
  /** Starts delivering 16 kHz mono chunks. */
  start(onChunk: (chunk: Float32Array) => void): void;
  readonly level: number;
  stop(): void;
}

export interface AudioPlayer {
  enqueue(samples: Float32Array): void;
  /** Barge-in: drop everything queued. */
  clear(): void;
  readonly isPlaying: boolean;
  readonly level: number;
  close(): void;
}

export interface AudioIO {
  openMicrophone(): Promise<MicrophoneHandle>;
  createPlayer(): AudioPlayer;
}

const WORKLET = `class UrbanLabCapture extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("urbanlab-capture", UrbanLabCapture);`;

function micError(err: unknown): VoiceFailure {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new VoiceFailure({ kind: "microphone_denied", message: "Microphone permission was denied. Allow microphone access for this site and try again." });
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new VoiceFailure({ kind: "microphone_unavailable", message: "No microphone was found." });
  if (name === "NotReadableError")
    return new VoiceFailure({ kind: "microphone_unavailable", message: "The microphone is in use by another application." });
  return new VoiceFailure({ kind: "microphone_unavailable", message: "Could not open the microphone." });
}

export const browserAudio: AudioIO = {
  async openMicrophone() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
      throw new VoiceFailure({ kind: "microphone_unavailable", message: "Microphone access needs a secure context (https or localhost)." });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      throw micError(err);
    }
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "urbanlab-capture");
    const chunks = new ChunkBuffer();
    let level = 0;
    return {
      start(onChunk) {
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          const frame = resample(e.data, ctx.sampleRate, AUDIO_SAMPLE_RATE);
          level = level * 0.6 + rms(frame) * 0.4;
          chunks.push(frame, onChunk);
        };
        source.connect(node);
      },
      get level() {
        return level;
      },
      stop() {
        node.port.onmessage = null;
        try {
          source.disconnect();
          node.disconnect();
        } catch {
          /* already disconnected */
        }
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      },
    };
  },

  createPlayer() {
    const ctx = new AudioContext();
    let playhead = 0;
    let level = 0;
    const sources = new Set<AudioBufferSourceNode>();
    return {
      enqueue(samples) {
        if (!samples.length) return;
        if (ctx.state === "suspended") void ctx.resume();
        const buffer = ctx.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
        buffer.copyToChannel(new Float32Array(samples), 0);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        playhead = Math.max(playhead, ctx.currentTime + 0.03);
        node.start(playhead);
        playhead += buffer.duration;
        level = level * 0.5 + rms(samples) * 0.5;
        sources.add(node);
        node.onended = () => sources.delete(node);
      },
      clear() {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            /* not started */
          }
        }
        sources.clear();
        playhead = ctx.currentTime;
        level = 0;
      },
      get isPlaying() {
        return ctx.currentTime < playhead - 0.02;
      },
      get level() {
        return ctx.currentTime < playhead ? level : 0;
      },
      close() {
        this.clear();
        void ctx.close();
      },
    };
  },
};
