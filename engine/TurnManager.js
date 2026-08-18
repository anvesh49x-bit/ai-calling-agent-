import { detectHoldRequest, evaluateCompleteness } from "./cognition/TurnTakingEngine.js";

/**
 * Manages turn-taking: debounce, concurrent turn prevention, barge-in detection,
 * hold-request detection, and incomplete-speech handling.
 */
export class TurnManager {
  constructor() {
    this.lastTranscript = "";
    this.latestTranscript = "";
    this.accumulatedTranscript = "";
    this.currentHypothesis = "";
    this.speechTimer = null;
    this.isProcessingTurnId = null;
    this.debounceMs = 650;
    this.onFinalTurn = null;
    this.onBargeIn = null;
    this.agentSpeaking = false;

    // ── Listening Mode ────────────────────────────────────────────────────────
    // When active, the agent stays silent and waits for the user to finish.
    // Triggered by hold-request phrases ("wait", "hold on", "let me finish").
    this.listeningMode = false;
    this.listeningModeTimeout = null;
  }

  setAgentSpeaking(speaking) {
    this.agentSpeaking = speaking;
  }

  /** Allow the RhythmController to dynamically tune the endpointing window. */
  setDebounce(ms) {
    if (ms > 0 && ms !== this.debounceMs) {
      this.debounceMs = ms;
    }
  }

  /**
   * Enter Listening Mode — suppress all response generation until the user
   * explicitly resumes or a safety timeout expires (8s).
   */
  enterListeningMode(reason) {
    this.listeningMode = true;
    this.clearTimer(); // Cancel any pending turn fire

    console.log(`\n🤫 LISTENING MODE ON: "${reason}"`);

    // Safety timeout: exit after 8s if the user goes silent
    clearTimeout(this.listeningModeTimeout);
    this.listeningModeTimeout = setTimeout(() => {
      if (this.listeningMode) {
        console.log("🤫 LISTENING MODE: auto-exit (8s timeout)");
        this.listeningMode = false;
      }
    }, 8000);
  }

  exitListeningMode() {
    if (this.listeningMode) {
      console.log("🤫 LISTENING MODE OFF");
    }
    this.listeningMode = false;
    clearTimeout(this.listeningModeTimeout);
  }

  handleTranscript(data, transcript) {
    const clean = transcript.trim();
    if (!clean && !data?.is_final) return;

    const isFinal = data?.is_final;
    const isSpeechFinal = data?.speech_final;
    const isInterim = !isFinal;

    if (isInterim) {
      if (this.agentSpeaking && clean.length > 4) {
        if (detectHoldRequest(clean)) {
          this.onBargeIn?.(clean);
          this.enterListeningMode(clean);
          return;
        }
        this.onBargeIn?.(clean);
        return;
      } else if (!this.agentSpeaking && clean.length > 0) {
        // User is speaking! Clear the timer so we don't prematurely finalize the previous chunks.
        this.clearTimer();
      }
      this.currentHypothesis = clean;
      return;
    }

    this.currentHypothesis = "";

    // Accumulate finalized chunk from Deepgram
    if (clean) {
      this.accumulatedTranscript = (this.accumulatedTranscript + " " + clean).trim();
    }

    if (!this.accumulatedTranscript) return;

    // Only start the debounce timer if Deepgram detected a pause (speech_final)
    if (isSpeechFinal) {
      if (detectHoldRequest(this.accumulatedTranscript)) {
        this.enterListeningMode(this.accumulatedTranscript);
        this.accumulatedTranscript = ""; // Clear so it's not processed as a turn
        return;
      }

      if (this.listeningMode) {
        if (this.accumulatedTranscript.split(/\s+/).length >= 3) {
          this.exitListeningMode();
        } else {
          // Stay in listening mode, clear accumulated so we don't hold onto short phrases
          this.accumulatedTranscript = "";
          return;
        }
      }

      const completeness = evaluateCompleteness(this.accumulatedTranscript);
      this.latestTranscript = this.accumulatedTranscript;

      this.clearTimer();

      const effectiveDebounce = completeness.incomplete
        ? this.debounceMs + 400
        : this.debounceMs;

      if (completeness.incomplete) {
        console.log(`⏳ INCOMPLETE SPEECH (${completeness.reason}): extending debounce +400ms`);
      }

      this.speechTimer = setTimeout(() => {
        // If we are currently listening, don't fire
        if (this.listeningMode) return;
        
        this.onFinalTurn?.(this.latestTranscript);
        this.lastTranscript = this.latestTranscript;
        this.accumulatedTranscript = ""; // Reset for the next utterance
      }, effectiveDebounce);
    }
  }

  async runTurn(turnId, handler) {
    this.isProcessingTurnId = turnId;
    try {
      await handler();
      return true;
    } finally {
      if (this.isProcessingTurnId === turnId) {
        this.isProcessingTurnId = null;
      }
    }
  }

  clearTimer() {
    if (this.speechTimer) {
      clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
  }

  reset() {
    this.clearTimer();
    this.exitListeningMode();
    this.isProcessingTurnId = null;
    this.agentSpeaking = false;
    this.lastTranscript = "";
    this.latestTranscript = "";
    this.accumulatedTranscript = "";
    this.currentHypothesis = "";
  }
}
