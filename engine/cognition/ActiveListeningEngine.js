import { CustomerEmotion, ConversationStage } from "../types.js";

/**
 * ActiveListeningEngine
 * Simulates human backchanneling ("Mm-hmm", "Right") while the caller is speaking.
 */
export class ActiveListeningEngine {
  constructor() {
    this.lastBackchannelTime = 0;
    this.backchannelsThisTurn = 0;
    this.minWordsBeforeBackchannel = 15;
    this.cooldownMs = 10000; // Wait 10s between backchannels
  }

  /**
   * Resets the turn counters. Should be called when the agent takes a full turn.
   */
  resetTurn() {
    this.backchannelsThisTurn = 0;
  }

  /**
   * Evaluates if a backchannel should be played during a user's ongoing turn.
   * @param {string} transcript - The cumulative user transcript so far
   * @param {boolean} isFinal - Whether a chunk boundary was reached
   * @param {object} memoryState - The current memory state
   * @returns {string|null} The backchannel phrase to play, or null
   */
  evaluate(transcript, isFinal, memoryState) {
    if (!isFinal) return null;
    if (!transcript) return null;

    const words = transcript.trim().split(/\s+/).length;
    
    // Don't backchannel early in a turn
    if (words < this.minWordsBeforeBackchannel) return null;

    // Max 2 backchannels per user turn
    if (this.backchannelsThisTurn >= 2) return null;

    // Cooldown check
    const now = Date.now();
    if (now - this.lastBackchannelTime < this.cooldownMs) return null;

    const emotion = memoryState?.customerEmotion ?? CustomerEmotion.NEUTRAL;
    const stage = memoryState?.conversationStage ?? ConversationStage.DISCOVERY;

    let phrase = "Mm-hmm.";
    
    // Context-aware selection
    if (emotion === CustomerEmotion.ANGRY || emotion === CustomerEmotion.NERVOUS) {
      phrase = "I understand.";
    } else if (stage === ConversationStage.PROBLEM_SOLVING) {
      phrase = Math.random() > 0.5 ? "Right." : "Okay.";
    } else {
      const phrases = ["Mm-hmm.", "Yeah.", "I see.", "Right."];
      phrase = phrases[Math.floor(Math.random() * phrases.length)];
    }

    this.lastBackchannelTime = now;
    this.backchannelsThisTurn++;

    return phrase;
  }
}
