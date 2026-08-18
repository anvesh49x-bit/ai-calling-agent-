/**
 * SalesReasoningEngine — Conversation Intelligence & Sales Reasoning
 *
 * Called once per turn. Receives the `context` object produced by
 * MemoryStore.getContextForGeneration() and emits a "consultative directive"
 * string that is injected verbatim into the LLM prompt.
 *
 * Property reference for `context` (from getContextForGeneration):
 *   context.intent              — current classified intent string
 *   context.stage               — ConversationStage string
 *   context.emotion             — CustomerEmotion string
 *   context.industry            — e.g. "Hospitality", "Healthcare"
 *   context.businessType        — e.g. "Restaurant/Cafe"
 *   context.websiteType         — e.g. "E-Commerce"
 *   context.requirement         — e.g. "Website", "Mobile App"
 *   context.requiredFeatures    — string[]  e.g. ["reservations","payment"]
 *   context.painPoints          — string[]  e.g. ["slow","manual"]
 *   context.decisionMaker       — boolean
 *   context.timeline            — string | null
 *   context.budget              — string | null  (raw text, e.g. "50k")
 *   context.priority            — "High" | "Low"
 *   context.leadScore           — number
 *   context.questionsAsked      — string[]
 *   context.topicsExplained     — string[]
 */

// ─── Pricing Intelligence ──────────────────────────────────────────────────────
// ALL PRICING HAS BEEN MOVED TO knowledge/companyProfile.js to prevent hallucination.
// The engine must NOT inject hardcoded prices.

// ─── Industry-Specific Feature Suggestions ────────────────────────────────────
const INDUSTRY_FEATURES = {
  Hospitality: [
    "online table reservation system",
    "digital menu with photos",
    "QR code ordering for dine-in",
    "home delivery integration",
    "WhatsApp order notifications"
  ],
  Healthcare: [
    "patient appointment booking",
    "doctor availability calendar",
    "online prescription uploads",
    "patient portal login",
    "automated appointment reminders"
  ],
  Retail: [
    "product catalogue with filters",
    "secure online payment (Razorpay/UPI)",
    "abandoned cart recovery",
    "inventory management panel",
    "GST-compliant invoicing"
  ],
  Default: [
    "mobile-responsive design",
    "enquiry / contact form",
    "Google Maps integration",
    "WhatsApp chat button",
    "basic SEO setup"
  ]
};

// ─── Main Directive Builder ────────────────────────────────────────────────────
export class SalesReasoningEngine {

  /**
   * @param {object} context — from MemoryStore.getContextForGeneration()
   * @returns {string}       — multi-line directive to inject into the LLM prompt
   */
  static generateDirective(context) {
    const lines = [];

    // ── 0. CORE PERSONA & ANTI-CHATBOT RULES ──────────────────────────────────
    lines.push(
      "PERSONA: You are Priya, a senior consultant at Arvex Technologies. " +
      "You have 5+ years of experience selling technology solutions to businesses in Andhra Pradesh. " +
      "You are confident, warm, and proactive—never robotic or scripted."
    );
    lines.push(
      "ANTI-CHATBOT RULES:\n" +
      "  • NEVER ask two questions in one reply.\n" +
      "  • NEVER ask for information that has already been provided (see KNOWN INFO below).\n" +
      "  • ALWAYS acknowledge what the customer said BEFORE asking the next question or giving advice.\n" +
      "  • Use natural consultative phrases: 'Based on what you've described...', 'I'd recommend...', " +
      "    'Most clients in your industry also add...', 'With your budget, the best option would be...'"
    );

    // ── 1. KNOWN INFORMATION (prevents duplicate questions) ───────────────────
    const knownParts = [];
    if (context.industry)        knownParts.push(`Industry: ${context.industry}`);
    if (context.businessType)    knownParts.push(`Business type: ${context.businessType}`);
    if (context.requirement)     knownParts.push(`Requirement: ${context.requirement}`);
    if (context.budget)          knownParts.push(`Budget: ${context.budget}`);
    if (context.timeline)        knownParts.push(`Timeline: ${context.timeline}`);
    if (context.decisionMaker)   knownParts.push(`Decision maker: confirmed`);
    if (context.requiredFeatures?.length > 0)
      knownParts.push(`Features they want: ${context.requiredFeatures.join(", ")}`);
    if (context.painPoints?.length > 0)
      knownParts.push(`Pain points they mentioned: ${context.painPoints.join(", ")}`);

    if (knownParts.length > 0) {
      lines.push(`KNOWN INFO (DO NOT ask for these again):\n  • ${knownParts.join("\n  • ")}`);
    }

    // ── 2. MISSING INFORMATION (ask at most 1) ────────────────────────────────
    const missingPriority = [];
    if (!context.industry && !context.businessType) missingPriority.push("what type of business they run");
    if (!context.requirement && missingPriority.length === 0) missingPriority.push("what they need built (website, app, etc.)");
    if (!context.budget && missingPriority.length === 0) missingPriority.push("their approximate budget");
    if (!context.timeline && missingPriority.length === 0) missingPriority.push("their expected timeline");

    if (missingPriority.length > 0) {
      lines.push(
        `NEXT DISCOVERY (ask only this ONE thing if the conversation naturally allows it): ` +
        missingPriority[0]
      );
    } else {
      lines.push(
        "INFORMATION GATHERED: You have enough information. " +
        "Stop asking discovery questions. Move toward recommendation and closing."
      );
    }

    // ── 3. CONSULTATIVE RECOMMENDATION ───────────────────────────────────────
    if (context.requirement === "Website" || context.intent === "SERVICE_INQUIRY") {
      const industry = context.industry ?? "";
      const features = INDUSTRY_FEATURES[industry] ?? INDUSTRY_FEATURES.Default;
      const alreadyMentioned = context.requiredFeatures ?? [];
      const suggestions = features
        .filter(f => !alreadyMentioned.some(a => f.includes(a)))
        .slice(0, 3);

      if (suggestions.length > 0) {
        lines.push(
          `PROACTIVE RECOMMENDATION: Based on their ${industry || "business"} requirements, ` +
          `you should naturally suggest adding: ${suggestions.join(", ")}. ` +
          `Say this as a helpful recommendation, not as an upsell.`
        );
      }
    }

    // ── 4. PRICING GUIDANCE (triggered on PRICING intent) ────────────────────
    if (context.intent === "PRICING") {
      lines.push(
        `PRICING GUIDANCE: Be transparent. Read the exact pricing ranges from your provided business knowledge context. ` +
        `DO NOT invent prices. Explain that the final quote depends on specific features they need. ` +
        (context.budget
          ? `Their budget is ${context.budget}—assess whether this is feasible based on official pricing. `
          : "Ask for their budget range so you can give a more accurate estimate. ") +
        `Never say "it depends" without giving a range first, but only use the official ranges.`
      );
    } else {
      lines.push(
        `PRICING RULES: Do not quote prices unless the caller explicitly asks for pricing or budget details.`
      );
    }

    // ── 5. PAIN POINT RESOLUTION ──────────────────────────────────────────────
    if (context.painPoints?.length > 0) {
      lines.push(
        `PAIN POINT STRATEGY: The customer mentioned: "${context.painPoints.join(", ")}". ` +
        `Briefly acknowledge this and specifically explain how Arvex's custom solution will eliminate it ` +
        `(e.g., slow manual processes → automated workflow, losing customers → 24/7 online ordering).`
      );
    }

    // ── 6. CLOSING / DEMO STRATEGY ────────────────────────────────────────────
    if (context.leadScore >= 60 || context.stage === "CONFIRMATION" || context.stage === "CLOSING") {
      lines.push(
        `CLOSING STRATEGY: This is a qualified lead (score: ${context.leadScore}). ` +
        `Confidently propose the next step: a free 30-minute technical consultation call with our senior team. ` +
        `Offer two specific time slots (e.g. "tomorrow at 3 PM or Friday morning"). ` +
        `Do not just ask if they're interested—suggest the time and confirm.`
      );
    } else if (context.intent === "DEMO_REQUEST") {
      lines.push(
        `BOOKING STRATEGY: They asked for a demo/meeting. Confirm enthusiastically. ` +
        `Offer two concrete time slots and get their preferred contact number or email.`
      );
    }

    // ── 6. STRICT FALLBACK PREVENTION ─────────────────────────────────────────
    if (context.intent === "GENERAL" || context.intent === "UNKNOWN" || context.intent === "CLARIFICATION") {
      lines.push(
        `CRITICAL RULE: The caller asked a general, ambiguous, or factual question. ` +
        `DO NOT pivot to selling services. DO NOT offer to build websites, apps, or quote prices. ` +
        `Simply answer the question directly using your business knowledge, or if it is ambiguous, ask a short clarifying question like "Sorry, what would you like to know?".`
      );
    }

    if (context.intent === "MEMORY_CORRECTION" || speechPlan.directorStrategy === "ACKNOWLEDGE_CORRECTION") {
      lines.push(
        `CRITICAL RULE: The caller indicated they already provided information. ` +
        `DO NOT ask for it again. Apologize briefly (e.g. "You're right, I have that here.") and answer their actual question if they asked one. DO NOT ask a new follow-up question.`
      );
    }

    if (context.intent === "CALL_END" || speechPlan.directorStrategy === "CLOSING") {
      lines.push(
        `CRITICAL RULE: The caller is ending the conversation. ` +
        `Say a short goodbye (e.g. "Thanks for your time. Have a great day.") and absolutely nothing else. DO NOT ask any questions.`
      );
    }

    // ── 7. URGENCY HANDLING ───────────────────────────────────────────────────
    if (context.priority === "High" || context.timeline === "asap" || context.timeline === "urgent") {
      lines.push(
        `URGENCY NOTE: Customer has an urgent timeline (${context.timeline ?? "ASAP"}). ` +
        `Reassure them we can start within a week for most projects and fast-track delivery is available. ` +
        `Move toward scheduling immediately.`
      );
    }

    return lines.join("\n\n");
  }
}
