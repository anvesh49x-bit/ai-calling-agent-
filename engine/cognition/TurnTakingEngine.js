/**
 * TurnTakingEngine — Human-like end-of-turn prediction & interruption intelligence.
 *
 * Responsibilities:
 *   1. Predict whether the user has truly finished speaking (end-of-turn confidence)
 *   2. Detect interruption/hold-on phrases → enter Listening Mode
 *   3. Detect incomplete questions / trailing fillers → extend debounce
 *   4. Sanitise LLM output before TTS (JSON leak prevention)
 *   5. Enforce dynamic response length limits
 */

// ─── Interruption Phrase Detection ─────────────────────────────────────────────
const HOLD_PATTERNS = [
  /^wait\b/i,                                  // "wait" at start only (not "I can wait")
  /\bwait wait\b/i,                            // "wait wait" anywhere
  /\bhold on\b/i,
  /\bone (second|sec|moment|minute|min)\b/i,
  /\blet me finish\b/i,
  /\bi'?m not done\b/i,
  /\bnot yet\b/i,
  /^listen\b/i,                                // "listen" at start only
  /\bi'?m (still )?talking\b/i,
  /\bdon'?t interrupt\b/i,
  /\bjust a (sec|second|moment)\b/i,
  /^stop\b/i,                                  // "stop" at start only
  /\bgive me a (sec|second|moment)\b/i
];

// ─── Trailing Filler / Incomplete Speech Patterns ──────────────────────────────
const INCOMPLETE_CONJUNCTIONS = [
  /\b(so|and|but|or|because|actually|also|like|basically|then|however)\s*\.{0,3}$/i,
  /\b(hmm|um|uh|err|ah)\s*\.{0,3}$/i,
  /,\s*$/,        // trailing comma
  /\.\.\.\s*$/,   // trailing ellipsis
  /-\s*$/          // trailing dash
];

const TRAILING_FRAGMENTS = [
  /\b(type of|going to|looking for|need to|something with|information about|instead of|out of|because of|due to)\s*\.{0,3}$/i
];

// ─── Partial Question Detection ────────────────────────────────────────────────
const QUESTION_STARTERS = [
  /^(can|could|would|will|do|does|did|is|are|was|were|have|has|had|should|may|might|what|where|when|why|how|who)\b/i
];

/**
 * Detects if the user is asking to hold / not be interrupted.
 * @param {string} text
 * @returns {boolean}
 */
export function detectHoldRequest(text) {
  const clean = text.trim().toLowerCase();
  return HOLD_PATTERNS.some(p => p.test(clean));
}

/**
 * Evaluates whether a transcript chunk looks incomplete.
 * Returns a confidence score 0–1 where higher = more likely incomplete.
 * @param {string} text - The final transcript chunk
 * @returns {{ incomplete: boolean, confidence: number, reason: string }}
 */
export function evaluateCompleteness(text) {
  const trimmed = text.trim();
  if (!trimmed) return { incomplete: false, confidence: 0, reason: "empty" };

  let score = 0;
  let reason = "complete";

  const hasQuestionMark = /\?/.test(trimmed);
  const startsAsQuestion = QUESTION_STARTERS.some(p => p.test(trimmed));

  // 1. Trailing fillers / conjunctions (almost always incomplete)
  for (const p of INCOMPLETE_CONJUNCTIONS) {
    if (p.test(trimmed)) {
      score += 0.5;
      reason = "trailing_conjunction";
      break;
    }
  }

  // 2. Trailing fragments (context-dependent)
  if (score === 0) {
    for (const p of TRAILING_FRAGMENTS) {
      if (p.test(trimmed)) {
        if (!hasQuestionMark && !startsAsQuestion && trimmed.split(/\s+/).length > 2) {
          score += 0.5;
          reason = "trailing_fragment";
        }
        break;
      }
    }
  }

  // 3. Starts like a question but has no question mark
  if (startsAsQuestion && !hasQuestionMark && trimmed.split(/\s+/).length < 6) {
    score += 0.4;
    reason = reason === "complete" ? "partial_question" : reason + "+partial_question";
  }

  // 3. Very short mid-sentence fragment (less than 4 words, no terminal punctuation)
  const words = trimmed.split(/\s+/).length;
  const hasTerminal = /[.!?]$/.test(trimmed);
  if (words < 4 && !hasTerminal && !startsAsQuestion) {
    score += 0.2;
    reason = reason === "complete" ? "short_fragment" : reason + "+short_fragment";
  }

  return {
    incomplete: score >= 0.4,
    confidence: Math.min(1, score),
    reason
  };
}

/**
 * Sanitise LLM output — strip any JSON / debug artifacts that might leak into TTS.
 * @param {string} text
 * @returns {string}
 */
export function sanitiseForSpeech(text) {
  if (!text || typeof text !== "string") return "";

  let clean = text;

  // Strip any JSON-like structures: { ... } or [ ... ]
  clean = clean.replace(/\{[^}]*\}/g, "");
  clean = clean.replace(/\[[^\]]*\]/g, "");

  // Strip common debug artefacts
  clean = clean.replace(/```[\s\S]*?```/g, "");
  clean = clean.replace(/"segments?"?\s*:/gi, "");
  clean = clean.replace(/"full_?text"?\s*:/gi, "");
  clean = clean.replace(/"text"?\s*:/gi, "");
  clean = clean.replace(/"pause_ms"?\s*:\s*\d+/gi, "");
  clean = clean.replace(/"stress"?\s*:\s*"?\w*"?/gi, "");

  // Strip leftover quotes
  clean = clean.replace(/^["']+|["']+$/g, "");

  // Collapse whitespace
  clean = clean.replace(/\s{2,}/g, " ").trim();

  return clean || "Sorry, could you say that again?";
}

/**
 * Compute dynamic max-word budget for the LLM based on conversation context.
 * Prevents the AI from producing long paragraphs in a voice conversation.
 *
 * @param {string} stage  - ConversationStage
 * @param {string} intent - Current intent
 * @param {number} complexity - 0–1
 * @returns {number} max words
 */
export function computeMaxWords(stage, intent, complexity) {
  // Greetings and closings should be brief
  if (stage === "GREETING" || stage === "CLOSING") return 15;

  // Confirmations are quick
  if (stage === "CONFIRMATION") return 20;

  // Pricing needs room for numbers + context, but not a lecture
  if (intent === "PRICING") return 45;

  // High complexity gets slightly more room
  if (complexity > 0.65) return 40;

  // Standard discovery / conversation
  return 30;
}
