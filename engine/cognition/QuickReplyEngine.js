/**
 * QuickReplyEngine — sub-200ms conversational acknowledgement system.
 *
 * Decision pipeline (all steps must pass):
 *   1. Candidate check  — structural gate (length, no continuation markers)
 *   2. Intent classify  — what conversational function does this serve?
 *   3. Context validate — does the conversation history make this safe?
 *   4. Response select  — pick the most contextually appropriate reply text
 *
 * Falls back to the full LLM pipeline on ANY uncertainty.
 * Conversation quality always outranks latency.
 */

import { ConversationStage, CustomerEmotion } from "../types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CHARS       = 48;   // Messages longer than this are never quick replies
const MIN_CONFIDENCE  = 0.72; // Final confidence gate before firing

// ─── Intent Categories ───────────────────────────────────────────────────────

export const QRIntent = Object.freeze({
  CONFIRM:      "CONFIRM",
  AGREE:        "AGREE",
  ACKNOWLEDGE:  "ACKNOWLEDGE",
  REJECT:       "REJECT",
  HESITATION:   "HESITATION",
  CONTINUATION: "CONTINUATION",
  NONE:         "NONE"
});

// ─── Continuation / Abort Patterns ───────────────────────────────────────────
// If any of these appear, the user is EXTENDING their thought.
// Quick Reply must NOT fire even if the opening word is affirmative.
// e.g. "Yes, but wait..." "Yeah actually..." "Okay, except..."

const CONTINUATION_PATTERNS = [
  /\bbut\b/i,
  /\bwait\b/i,
  /\bactually\b/i,
  /\band also\b/i,
  /\bmoreover\b/i,
  /\bhowever\b/i,
  /\bexcept\b/i,
  /\bunless\b/i,
  /\bthough\b/i,
  /\bsort of\b/i,
  /\bkind of\b/i,
  /\.{3}/,       // trailing ellipsis ("Hmm..." = hesitation, not confirmation)
];

// ─── Intent Classifiers ───────────────────────────────────────────────────────
// Ordered from most to least specific.
// Patterns use start-of-string anchors to prevent substring matching.
// weight 0 = never trigger Quick Reply (e.g. hesitation).

const INTENT_CLASSIFIERS = [
  {
    intent:   QRIntent.CONFIRM,
    weight:   1.0,
    patterns: [
      /^yes\b/i,          /^yeah\b/i,       /^yep\b/i,          /^yup\b/i,
      /^sure\b/i,         /^absolutely\b/i, /^definitely\b/i,   /^of course\b/i,
      /^correct\b/i,      /^that'?s right/i,/^right\b/i,
      /^sounds good/i,    /^looks good/i,   /^works for me/i,   /^that works/i,
      /^perfect\b/i,      /^affirmative\b/i,/^indeed\b/i,
      /^great\b/i,        /^wonderful\b/i,  /^100%/
    ]
  },
  {
    intent:   QRIntent.AGREE,
    weight:   0.9,
    patterns: [
      /^exactly\b/i,      /^agreed\b/i,        /^makes sense/i,
      /^i agree\b/i,      /^fair enough/i,      /^fair point/i,
      /^that makes sense/i,                      /^true\b/i,
      /^couldn'?t agree more/i,                  /^you'?re right/i
    ]
  },
  {
    intent:   QRIntent.ACKNOWLEDGE,
    weight:   0.85,
    patterns: [
      /^okay\b/i,         /^ok\b/i,         /^alright\b/i,
      /^got it\b/i,       /^i see\b/i,      /^noted\b/i,
      /^understood\b/i,   /^fine\b/i,       /^sure\b/i,
    ]
  },
  {
    intent:   QRIntent.REJECT,
    weight:   1.0,
    patterns: [
      /^no\b/i,           /^nope\b/i,           /^nah\b/i,
      /^not really/i,     /^not quite/i,         /^no thanks/i,
      /^i don'?t think so/i, /^that won'?t work/i, /^i'?d prefer not/i,
      /^doesn'?t work/i,  /^not for me/i
    ]
  },
  {
    intent:   QRIntent.HESITATION,
    weight:   0, // Never fires Quick Reply
    patterns: [
      /^hmm\b/i,          /^uh\b/i,         /^um\b/i,
      /^well\b/i,         /^let me think/i, /^i'?m not sure/i,
      /^maybe\b/i,        /^possibly\b/i
    ]
  }
];

// ─── Agent Context Signals ────────────────────────────────────────────────────
// These patterns in the agent's LAST utterance signal that a short user response
// is expected and safe to quick-reply to.

const AGENT_QUESTION_SIGNALS = [
  /\?$/,
  /does that work/i,
  /is that okay/i,
  /is that alright/i,
  /would you like/i,
  /shall i\b/i,
  /do you\b/i,
  /are you\b/i,
  /does that (make|sound)/i,
  /is that (correct|right|fine|clear)/i,
  /does (tomorrow|today|that time|this time)/i,
  /can i (confirm|check|ask)/i
];

// ─── Response Library ─────────────────────────────────────────────────────────
// Deterministic: every response is chosen by context, never randomly rotated.
// Variants: warm / professional / neutral
// Closing variant used when stage is CLOSING or CONFIRMATION.

const RESPONSE_LIBRARY = {
  [QRIntent.CONFIRM]: {
    warm:         ["Perfect.", "Wonderful.", "Sounds great."],
    professional: ["Absolutely.", "Certainly.", "Of course."],
    neutral:      ["Great.", "Got it.", "Sure."],
    closing:      ["Perfect, all set.", "Wonderful, sorted.", "Great, done."]
  },
  [QRIntent.AGREE]: {
    warm:         ["Absolutely.", "Couldn't agree more.", "Exactly right."],
    professional: ["Understood.", "Correct.", "Noted."],
    neutral:      ["Right.", "Exactly.", "Makes sense."],
    closing:      ["Exactly right.", "Understood.", "Right."]
  },
  [QRIntent.ACKNOWLEDGE]: {
    warm:         ["Got it.", "Sure.", "Alright then."],
    professional: ["Noted.", "Understood.", "Of course."],
    neutral:      ["Okay.", "I see.", "Alright."],
    closing:      ["Got it.", "All noted.", "Understood."]
  },
  [QRIntent.REJECT]: {
    warm:         ["Alright, no worries at all.", "Of course, absolutely fine.", "Sure, no problem."],
    professional: ["Understood, no problem.", "Of course, that's fine.", "Certainly, no issue."],
    neutral:      ["Alright, no problem.", "Okay, that's fine.", "No problem."],
    closing:      ["Understood, no problem at all.", "Of course, that's fine.", "No problem whatsoever."]
  }
};

// ─── Step 1: Candidate Check ──────────────────────────────────────────────────

function isCandidate(message) {
  const trimmed = message.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_CHARS) return false;

  // Continuation markers mean the user is extending their thought.
  for (const pattern of CONTINUATION_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Strict check: The utterance must be ALMOST ENTIRELY an acknowledgment.
  const clean = trimmed.toLowerCase().replace(/[^a-z\s]/g, "");
  const ackWords = ["okay", "ok", "great", "right", "yeah", "yes", "yep", "sure", "alright", "got it", "i see", "understood"];
  
  let remaining = clean;
  for (const word of ackWords) {
    remaining = remaining.replace(new RegExp(`\\b${word}\\b`, 'g'), "");
  }
  
  // If there are more than 2 substantive words left, it contains a follow-up request/question.
  const remainingWords = remaining.trim().split(/\s+/).filter(w => w.length > 0);
  if (remainingWords.length > 2) {
    return false;
  }

  // Must contain at least one letter.
  if (!/[a-zA-Z]/.test(trimmed)) return false;

  return true;
}

// ─── Step 2: Intent Classification ───────────────────────────────────────────

function classifyIntent(message) {
  const text = message.trim();

  for (const { intent, patterns, weight } of INTENT_CLASSIFIERS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { intent, confidence: weight };
      }
    }
  }

  return { intent: QRIntent.NONE, confidence: 0 };
}

// ─── Step 3: Context Validation ──────────────────────────────────────────────
// Produces a multiplier (0–1) that scales the intent confidence.
// Low context score → final confidence drops below threshold → fall back to LLM.

function validateContext(intent, memoryState) {
  const lastAgentText = memoryState.lastAgentPhrases?.slice(-1)[0] ?? "";
  const stage = memoryState.conversationStage;

  // Did the agent just ask a direct question? Strongest context signal.
  const agentAskedQuestion = AGENT_QUESTION_SIGNALS.some(p => p.test(lastAgentText));

  let contextScore = 0.5; // neutral baseline

  if (agentAskedQuestion) {
    if (intent === QRIntent.CONFIRM || intent === QRIntent.REJECT) contextScore = 1.0;
    if (intent === QRIntent.ACKNOWLEDGE) contextScore = 0.90;
    if (intent === QRIntent.AGREE)       contextScore = 0.85;
  } else {
    // No question from agent.
    // AGREE is still valid — user is affirming something the agent stated.
    if (intent === QRIntent.AGREE)        contextScore = 0.88;
    // ACKNOWLEDGE without a question is common in any conversation.
    if (intent === QRIntent.ACKNOWLEDGE)  contextScore = 0.86;
    // CONFIRM without a question is ambiguous — lower confidence, may fall back.
    if (intent === QRIntent.CONFIRM)      contextScore = 0.68;
    // REJECT without a question could mean anything — risky.
    if (intent === QRIntent.REJECT)       contextScore = 0.52;
  }

  // During greeting/intro: polite acknowledgements are always safe.
  if (stage === ConversationStage.GREETING || stage === ConversationStage.INTRODUCTION) {
    contextScore = Math.max(contextScore, 0.82);
  }

  // During closing/confirmation: confirmations are structurally expected.
  if (stage === ConversationStage.CLOSING || stage === ConversationStage.CONFIRMATION) {
    contextScore = Math.max(contextScore, 0.88);
  }

  return contextScore;
}

// ─── Step 4: Response Selection ───────────────────────────────────────────────
// Deterministic selection based on stage + emotion + recency.
// Avoids repetition by checking recent agent phrases.

function selectResponse(intent, memoryState) {
  const stage   = memoryState.conversationStage;
  const emotion = memoryState.customerEmotion;
  const recent  = (memoryState.lastAgentPhrases ?? []).slice(-4).map(s => s.toLowerCase());

  const pool = RESPONSE_LIBRARY[intent];
  if (!pool) return null;

  // Determine variant
  let variant = "neutral";

  if (stage === ConversationStage.CLOSING || stage === ConversationStage.CONFIRMATION) {
    variant = "closing";
  } else if (
    emotion === CustomerEmotion.HAPPY   ||
    emotion === CustomerEmotion.EXCITED ||
    stage === ConversationStage.GREETING
  ) {
    variant = "warm";
  } else if (
    stage === ConversationStage.INFORMATION_GATHERING ||
    stage === ConversationStage.RECOMMENDATION       ||
    stage === ConversationStage.PROBLEM_SOLVING
  ) {
    variant = "professional";
  }

  // Merge variant + neutral for fallback, dedup
  const candidates = [...new Set([...(pool[variant] ?? []), ...(pool.neutral ?? [])])];

  // Filter out responses that closely match recent agent speech.
  const fresh = candidates.filter(reply => {
    const stripped = reply.toLowerCase().replace(/[.,!?]/g, "").trim();
    return !recent.some(r => r.includes(stripped));
  });

  // Return first fresh candidate, fall back to first overall.
  return fresh[0] ?? candidates[0] ?? null;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Evaluate whether a Quick Reply should fire for this user message.
 *
 * @param {string} message     - Final STT transcript
 * @param {object} memoryState - Current MemoryStore.state (read-only snapshot)
 * @returns {{ fire: boolean, text: string|null, intent: string, confidence: number, classifyMs: number }}
 */
export function evaluateQuickReply(message, memoryState) {
  const t0 = Date.now();

  // Step 1: structural gate
  if (!isCandidate(message)) {
    return { fire: false, text: null, intent: QRIntent.NONE, confidence: 0, classifyMs: Date.now() - t0 };
  }

  // Step 2: intent classification
  const { intent, confidence: ic } = classifyIntent(message);
  if (intent === QRIntent.NONE || intent === QRIntent.HESITATION || ic === 0) {
    return { fire: false, text: null, intent, confidence: 0, classifyMs: Date.now() - t0 };
  }

  // Step 3: context validation
  const contextScore     = validateContext(intent, memoryState);
  const finalConfidence  = ic * contextScore;

  if (finalConfidence < MIN_CONFIDENCE) {
    return { fire: false, text: null, intent, confidence: finalConfidence, classifyMs: Date.now() - t0 };
  }

  // Step 4: response selection
  const text = selectResponse(intent, memoryState);
  if (!text) {
    return { fire: false, text: null, intent, confidence: finalConfidence, classifyMs: Date.now() - t0 };
  }

  const classifyMs = Date.now() - t0;
  return { fire: true, text, intent, confidence: finalConfidence, classifyMs };
}
