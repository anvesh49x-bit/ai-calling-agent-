import { CustomerEmotion, Intent, ConversationStage } from "../types.js";

/**
 * RhythmController — the single timing authority for every conversation.
 *
 * Philosophy:
 *   - No random delays. No fixed delays. Every pause has a specific reason.
 *   - Timing communicates meaning: fast = confident, slow = thoughtful, pause = empathetic.
 *   - The goal is not to feel "quick" — the goal is to feel like a thinking human.
 *
 * Response Modes:
 *   IMMEDIATE  (40–80ms)  — barge-in recovery, one-word affirmatives, floor reclaim
 *   QUICK      (100–180ms) — greetings, simple yes/no, known short answers
 *   CONSIDERED (220–320ms) — normal conversational turns, moderate questions
 *   THOUGHTFUL (380–520ms) — complex reasoning, pricing, complaints, emotional situations
 */

const RHYTHM_MODE = {
  IMMEDIATE: "IMMEDIATE",
  QUICK: "QUICK",
  CONSIDERED: "CONSIDERED",
  THOUGHTFUL: "THOUGHTFUL"
};

// Base timing in ms for each mode. These are NOT random — they are minimum natural
// human reaction times calibrated for phone conversations.
const BASE_TIMING = {
  [RHYTHM_MODE.IMMEDIATE]: 55,
  [RHYTHM_MODE.QUICK]: 140,
  [RHYTHM_MODE.CONSIDERED]: 260,
  [RHYTHM_MODE.THOUGHTFUL]: 440
};

/**
 * Decide which rhythm mode to use based on conversation context.
 * This is a deterministic decision tree — no randomness.
 */
function decideMode(plan, turnState, wasInterrupted) {

  // Rule 1: Barge-in recovery — resume immediately to reclaim the floor naturally.
  if (wasInterrupted) return RHYTHM_MODE.IMMEDIATE;

  // Rule 2: If the emotion demands we de-escalate, a pause communicates calm.
  // An immediate reply to an angry customer reads as dismissive.
  if (plan.deEscalate) return RHYTHM_MODE.THOUGHTFUL;

  // Rule 3: Impatient or busy customers — do not make them wait.
  if (
    turnState.customerEmotion === CustomerEmotion.IMPATIENT ||
    turnState.customerEmotion === CustomerEmotion.BUSY
  ) return RHYTHM_MODE.QUICK;

  // Rule 4: Simple message — quick reply feels natural and confident.
  const messageWords = (turnState.messageLength || 0) / 5; // rough word estimate
  if (messageWords < 4 && turnState.complexity < 0.35) return RHYTHM_MODE.QUICK;

  // Rule 5: Closing or greeting exchanges — keep them light and fast.
  if (
    turnState.conversationStage === ConversationStage.GREETING ||
    turnState.intent === Intent.GREETING ||
    turnState.intent === Intent.CLOSING
  ) return RHYTHM_MODE.QUICK;

  // Rule 6: High complexity demands visible thinking time.
  if (turnState.complexity > 0.65) return RHYTHM_MODE.THOUGHTFUL;

  // Rule 7: Pricing and complaint intents need a slight deliberate pause.
  // This communicates care and prevents sounding scripted.
  if (
    turnState.intent === Intent.PRICING ||
    turnState.intent === Intent.COMPLAINT
  ) return RHYTHM_MODE.THOUGHTFUL;

  // Rule 8: Confused customer — a beat before speaking signals that you are
  // choosing words carefully, not firing off a canned response.
  if (turnState.customerEmotion === CustomerEmotion.CONFUSED) {
    return RHYTHM_MODE.THOUGHTFUL;
  }

  // Rule 9: Moderate complexity — standard conversational cadence.
  if (turnState.complexity > 0.35) return RHYTHM_MODE.CONSIDERED;

  // Default: natural conversational turn.
  return RHYTHM_MODE.CONSIDERED;
}

/**
 * Compute a micro-adjustment (in ms) on top of the base timing.
 * This is NOT jitter — every adjustment reflects a specific linguistic reason.
 * All values are deterministic from inputs.
 */
function computeAdjustment(plan, turnState) {
  let adjustment = 0;

  // Long messages took more effort to process — acknowledge that cognitively.
  const charLength = turnState.messageLength || 0;
  if (charLength > 120) adjustment += 60;
  else if (charLength > 60) adjustment += 30;

  // A question requires a moment to form an accurate answer.
  if (turnState.isQuestion) adjustment += 40;

  // Resuming from an interrupted partial speech — the AI knows where it left off.
  // Recovering quickly feels natural, not confused.
  if (plan.resumeFromPartial) adjustment -= 80;

  // Angry emotion: deliberateness communicates control. Add a beat.
  if (turnState.customerEmotion === CustomerEmotion.ANGRY) adjustment += 70;

  // Nervous customer: don't rush them. A slightly slower pace feels reassuring.
  if (turnState.customerEmotion === CustomerEmotion.NERVOUS) adjustment += 50;

  return adjustment;
}

/**
 * Main export: compute the final pre-speech delay in milliseconds.
 *
 * @param {object} plan         - Output of SpeechPlanner.planSpeech()
 * @param {object} turnState    - Enriched turn state from MemoryStore
 * @param {boolean} wasInterrupted - Was the previous agent turn cut short?
 * @returns {{ delayMs: number, mode: string }}
 */
export function computeRhythm(plan, turnState, wasInterrupted = false) {
  const mode = decideMode(plan, turnState, wasInterrupted);
  const base = BASE_TIMING[mode];
  const adjustment = computeAdjustment(plan, turnState);

  // Hard bounds per mode to prevent any edge case from creating a
  // jarring experience.
  const bounds = {
    [RHYTHM_MODE.IMMEDIATE]: [30, 90],
    [RHYTHM_MODE.QUICK]: [90, 200],
    [RHYTHM_MODE.CONSIDERED]: [200, 360],
    [RHYTHM_MODE.THOUGHTFUL]: [360, 560]
  };

  const [min, max] = bounds[mode];
  const delayMs = Math.max(min, Math.min(max, base + adjustment));

  return { delayMs, mode };
}

/**
 * Determine the dynamic endpointing hint for the TurnManager.
 * The debounce time after the user stops speaking should vary by stage.
 *
 * @param {string} stage    - Current ConversationStage
 * @param {string} emotion  - Current CustomerEmotion
 * @returns {number} recommended debounce in ms
 */
export function computeEndpointingDebounce(stage, emotion) {
  // Impatient or busy callers speak in short bursts — end their turn quickly.
  if (
    emotion === CustomerEmotion.IMPATIENT ||
    emotion === CustomerEmotion.BUSY
  ) return 380;

  // During rapid Q&A stages, shorter gaps are natural.
  if (
    stage === ConversationStage.CONFIRMATION ||
    stage === ConversationStage.CLOSING
  ) return 420;

  // During discovery or problem-solving, users often pause mid-thought.
  // Wait a beat longer before cutting them off.
  if (
    stage === ConversationStage.DISCOVERY ||
    stage === ConversationStage.PROBLEM_SOLVING
  ) return 620;

  // Standard conversational turn.
  return 520;
}

/**
 * Abortable wait utility. Used for rhythm delays and segment pauses.
 * If the AbortSignal fires, the wait resolves immediately (no rejection)
 * so the caller does not need extra try/catch for abort cases.
 *
 * @param {number} ms
 * @param {AbortSignal|null} signal
 */
export function wait(ms, signal) {
  return new Promise((resolve) => {
    if (!ms || ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(); // Resolve silently — abort is not an error, it is a redirect.
    }, { once: true });
  });
}
