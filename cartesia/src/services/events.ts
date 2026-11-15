/**
 * Tiny typed event emitter for `VoiceEvent`s. The host subscribes and forwards
 * events into its own architecture (see `adapters/urbanlab.ts`); this is not a
 * competing app-wide event system.
 */
import type { EvidenceValue, VoiceEvent, VoiceEventListener, VoiceResearchResult } from "../types";

export class VoiceEventBus {
  private listeners = new Set<VoiceEventListener>();

  subscribe(listener: VoiceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: VoiceEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        // A broken host listener must never break the interview.
        console.error("[cartesia] event listener failed", err instanceof Error ? err.message : err);
      }
    }
  }
}

/**
 * Called by the HOST once it accepts interview evidence into its dataset.
 * Emits EVIDENCE_ADDED. The module never writes to the dataset itself.
 */
export function acceptEvidence(
  bus: VoiceEventBus,
  result: VoiceResearchResult,
  evidence: EvidenceValue[] = result.evidence,
): void {
  bus.emit({
    type: "EVIDENCE_ADDED",
    sessionId: result.sessionId,
    studyId: result.studyId,
    propertyId: result.propertyId,
    at: new Date().toISOString(),
    evidence,
  });
}
