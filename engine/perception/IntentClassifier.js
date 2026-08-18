import { Intent } from "../types.js";

const INTENT_RULES = [
  {
    intent: Intent.GREETING,
    patterns: [/\bhello\b/i, /\bhi\b/i, /\bhey\b/i, /\bgood (morning|afternoon|evening)\b/i]
  },
  {
    intent: Intent.IDENTITY,
    patterns: [/\bwho are you\b/i, /\byour name\b/i, /\bwho am i speaking\b/i]
  },
  {
    intent: Intent.COMPANY_INFO,
    patterns: [/\bcompany\b/i, /\babout arvex\b/i, /\babout rx\b/i, /\bwho is arvex\b/i]
  },
  {
    intent: Intent.FOUNDER_INFO,
    patterns: [/\bfounder\b/i, /\bwho started\b/i, /\bwho is the founder\b/i, /\bfounded\b/i, /\bowner\b/i]
  },
  {
    intent: Intent.PRICING,
    patterns: [/\bprice\b/i, /\bcost\b/i, /\bquotation\b/i, /\bhow much\b/i, /\bbudget\b/i]
  },
  {
    intent: Intent.SERVICE_INQUIRY,
    patterns: [
      /\bwebsite\b/i,
      /\bmobile app\b/i,
      /\bapplication\b/i,
      /\bsoftware\b/i,
      /\bai voice\b/i,
      /\bautomation\b/i,
      /\berp\b/i,
      /\bservices?\b/i,
      /\bofferings?\b/i,
      /\bwhat do you do\b/i
    ]
  },
  {
    intent: Intent.DEMO_REQUEST,
    patterns: [/\bdemo\b/i, /\bmeeting\b/i, /\bschedule\b/i, /\bappointment\b/i, /\bcall back\b/i]
  },

  {
    intent: Intent.CLARIFICATION,
    patterns: [/\bwhat do you mean\b/i, /\bcan you repeat\b/i, /\bsay that again\b/i, /\bwhich one\b/i]
  },
  {
    intent: Intent.COMPLAINT,
    patterns: [/\bcomplain\b/i, /\bnot working\b/i, /\bbroken\b/i, /\bissue\b/i, /\bproblem\b/i]
  },
  {
    intent: Intent.FRUSTRATION_STOP,
    patterns: [/\bstop\b/i, /\bwrong\b/i, /\bthat'?s not what i asked\b/i, /\bwhat the fuck\b/i, /\bwhat are you saying\b/i, /\bwhat i'?m asking\b/i, /\bbullshit\b/i, /\bshut up\b/i, /\blisten\b/i]
  },
  {
    intent: Intent.WAIT_HOLD,
    patterns: [/\bwait\b/i, /\bhold on\b/i, /\bjust a sec\b/i, /\bwait a second\b/i, /\bgive me a second\b/i]
  },
  {
    intent: Intent.MEMORY_CORRECTION,
    patterns: [/\balready said\b/i, /\balready told\b/i, /\balready mentioned\b/i, /\bsaid that at the beginning\b/i, /\bdidn'?t i already\b/i]
  },
  {
    intent: Intent.CALL_END,
    patterns: [/\bhave a nice day\b/i, /\bthank you\b/i, /\bthanks\b/i, /\bthat'?s all\b/i, /\bnothing else\b/i, /\bbye\b/i, /\bgoodbye\b/i, /\btalk to you later\b/i, /\bsee you\b/i, /\bi'?ll get back to you\b/i, /\bthat'?s everything\b/i]
  }
];

export function classifyIntent(message, state = null) {
  const text = message.toLowerCase();

  for (const { intent, patterns } of INTENT_RULES) {
    // SPECIAL GUARD: Do not classify as CALL_END if there's a continuation clause
    if (intent === Intent.CALL_END) {
       const hasContinuation = /\b(but|one more|what about|how about|can i|another question)\b/i.test(text);
       if (hasContinuation) {
          continue;
       }
    }

    if (patterns.some((p) => p.test(text))) {
      return intent;
    }
  }

  // Contextual inheritance for vague/follow-up questions
  if (state && state.currentIntent && text.length < 50) {
    const prev = state.currentIntent;
    if (
      prev === Intent.SERVICE_INQUIRY ||
      prev === Intent.PRICING ||
      prev === Intent.COMPANY_INFO ||
      prev === Intent.FOUNDER_INFO
    ) {
      // Inherit intent only if it looks like a follow-up question referencing the previous topic
      if (/\b(it|this|that|these|those|they|them|he|him|she|her|his|include|cost|price|process|timeline|how long)\b/i.test(text)) {
        return prev;
      }
    }
  }

  return Intent.GENERAL;
}

export function decideAction(intent, state) {
  switch (intent) {
    case Intent.GREETING:
      return state.greetingDone ? "CONTINUE_CONVERSATION" : "GREET_CUSTOMER";
    case Intent.IDENTITY:
      return "INTRODUCE_YOURSELF";
    case Intent.COMPANY_INFO:
      return "INTRODUCE_COMPANY";
    case Intent.FOUNDER_INFO:
      return "EXPLAIN_FOUNDER";
    case Intent.SERVICE_INQUIRY:
      return "EXPLAIN_SERVICE";
    case Intent.PRICING:
      return "DISCUSS_PRICING";
    case Intent.DEMO_REQUEST:
      return "BOOK_DEMO";

    case Intent.CLARIFICATION:
      return "CLARIFY";
    case Intent.COMPLAINT:
      return "DE_ESCALATE";
    case Intent.WAIT_HOLD:
      return "WAIT";
    case Intent.FRUSTRATION_STOP:
      return "CLARIFY";
    case Intent.MEMORY_CORRECTION:
      return "ACKNOWLEDGE_CORRECTION";
    case Intent.CALL_END:
      return "CLOSE_CONVERSATION";
    default:
      return "CONTINUE_CONVERSATION";
  }
}
