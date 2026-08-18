import { CustomerEmotion, ConversationStage, Intent } from "../types.js";
import { QRIntent } from "./QuickReplyEngine.js";

/**
 * ConversationDirector — The central decision-making layer.
 * 
 * Determines the conversational strategy BEFORE any LLM generation occurs.
 * This guarantees the AI acts with intention (e.g. choosing to reassure an angry
 * customer before answering their question, or choosing to use a holding phrase
 * for complex lookups).
 */

export const Strategy = Object.freeze({
  QUICK_REPLY: "QUICK_REPLY",
  NORMAL_RESPONSE: "NORMAL_RESPONSE",
  FOLLOW_UP: "FOLLOW_UP",
  CLARIFICATION: "CLARIFICATION",
  SUMMARY: "SUMMARY",
  HOLDING: "HOLDING",
  CONTINUE_PREVIOUS: "CONTINUE_PREVIOUS",
  WAIT: "WAIT",
  YIELD: "YIELD",
  CLOSING: "CLOSING",
  ACKNOWLEDGE_CORRECTION: "ACKNOWLEDGE_CORRECTION"
});

/**
 * Selects a natural holding phrase based on the conversation context.
 */
function selectHoldingPhrase(intent, stage) {
  if (intent === Intent.PRICING) {
    return "Let me pull up those pricing details for you...";
  }
  if (intent === Intent.COMPLAINT) {
    return "Let me look into this right now...";
  }
  if (stage === ConversationStage.PROBLEM_SOLVING) {
    return "Just give me one second to check that...";
  }
  const generic = [
    "Let me check that for you...",
    "One moment while I look that up...",
    "Let me pull up your details..."
  ];
  return generic[Math.floor(Math.random() * generic.length)];
}

/**
 * Main evaluation function for the Conversation Director.
 * 
 * @param {object} params
 * @param {string} params.message - The user's message
 * @param {object} params.turnState - The memory turn state (emotion, intent, complexity)
 * @param {object} params.qrResult - The result from the QuickReplyEngine
 * @param {boolean} params.wasInterrupted - Whether the agent was interrupted last turn
 * @param {object} params.context - The generation context
 * @returns {object} The Conversation Plan
 */
export function directConversation({ message, turnState, qrResult, wasInterrupted, context }) {
  const { customerEmotion: emotion, intent, conversationStage: stage, complexity } = turnState;

  let emotionAck = false;
  if (emotion === CustomerEmotion.ANGRY || emotion === CustomerEmotion.NERVOUS || emotion === CustomerEmotion.FRUSTRATED) {
    emotionAck = true;
  }

  // 1. CALL_END overrides everything (even quick replies)
  if (intent === Intent.CALL_END) {
    return {
      strategy: Strategy.CLOSING,
      reason: "User ended the call.",
      holding_phrase: false,
      emotion_acknowledgement: emotionAck,
      priority: "HIGH"
    };
  }

  if (intent === Intent.MEMORY_CORRECTION) {
    return {
      strategy: Strategy.ACKNOWLEDGE_CORRECTION,
      reason: "User corrected a memory failure.",
      holding_phrase: false,
      emotion_acknowledgement: emotionAck,
      priority: "HIGH"
    };
  }

  // 2. QUICK REPLY: High priority if safe
  if (qrResult && qrResult.fire) {
    return {
      strategy: Strategy.QUICK_REPLY,
      reason: `Safe ${qrResult.intent} response`,
      holding_phrase: false,
      emotion_acknowledgement: false,
      priority: "HIGH"
    };
  }

  // 3. YIELD / WAIT: If the user interrupted us but only said a short backchannel 

  // 4. HOLDING: High complexity queries require cognitive "work".
  // Use a holding phrase to buy time and mask LLM latency naturally.
  if (complexity > 0.65 || intent === Intent.PRICING || intent === Intent.COMPLAINT) {
    // Only use holding phrases if the user actually asked a question or provided a long statement
    if (message.length > 20 || /\?/.test(message)) {
      return {
        strategy: Strategy.HOLDING,
        reason: "High complexity or data retrieval expected.",
        holding_phrase: selectHoldingPhrase(intent, stage),
        emotion_acknowledgement: emotionAck,
        priority: "NORMAL"
      };
    }
  }

  // 4.5. WAIT: Explicit wait requests from caller
  if (intent === Intent.WAIT_HOLD) {
    return {
      strategy: Strategy.WAIT,
      reason: "User explicitly asked to wait or hold.",
      holding_phrase: false,
      emotion_acknowledgement: emotionAck,
      priority: "HIGH"
    };
  }

  // 4.6. FRUSTRATION / STOP
  if (intent === Intent.FRUSTRATION_STOP) {
    return {
      strategy: Strategy.CLARIFICATION,
      reason: "User expressed frustration or asked to stop/clarify.",
      holding_phrase: false,
      emotion_acknowledgement: emotionAck || true,
      priority: "HIGH"
    };
  }

  // 5. CLARIFICATION: If the intent is completely unknown and the message is very short/ambiguous.
  if (intent === Intent.UNKNOWN && message.length < 15) {
    return {
      strategy: Strategy.CLARIFICATION,
      reason: "Message is too short and ambiguous to act upon.",
      holding_phrase: false,
      emotion_acknowledgement: emotionAck,
      priority: "NORMAL"
    };
  }

  // 6. NORMAL RESPONSE: Default fallback.
  return {
    strategy: Strategy.NORMAL_RESPONSE,
    reason: "Standard conversational turn.",
    holding_phrase: false,
    emotion_acknowledgement: emotionAck,
    priority: "NORMAL"
  };
}
