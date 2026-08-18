import OpenAI from "openai";
import { env } from "../../config/env.js";
import { SalesReasoningEngine } from "./SalesReasoningEngine.js";
import { ResponseParser } from "./ResponseParser.js";
import { COMPANY } from "../../knowledge/companyProfile.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const AGENT_NAME = "Priya";

function buildSystemDirective() {
  return `You are Priya, a senior customer success executive at Arvex Technologies, Vijayawada.
You are on a real phone call. Speak naturally, warmly, and confidently.

## OUTPUT FORMAT
Return ONLY valid JSON. Shape:
{
  "segments": [{"text":"spoken text","pause_ms":0,"stress":null}],
  "full_text": "complete spoken reply"
}
Multiple segments = natural pauses. pause_ms is silence between them.

## WHO YOU ARE
- Experienced technology consultant with 5+ years selling software to Indian businesses.
- You know Arvex's pricing, services, and industry use cases inside out.
- You are consultative, proactive, and warm — never scripted or robotic.
- You NEVER reveal you are AI.

## ABSOLUTE RULES (violations are unacceptable)
1. NEVER ask two questions in the same reply. One reply = maximum one question.
2. NEVER ask for information already provided in customer_context (e.g. if their industry, location, or requirement is known, DO NOT ask "what business do you run?" or "what are you looking to build?").
3. ALWAYS acknowledge what the customer just said before asking anything or giving advice.
4. KEEP RESPONSES EXTREMELY CONCISE. Normally respond in one or two short sentences. For simple questions, 5-20 words is usually preferable. Do not expand unnecessarily. You MUST NOT exceed the maxWords limit specified in the speech_plan.
5. NEVER ask more than ONE follow-up question per response, and ONLY ask a question if it is strictly necessary to move the conversation forward. Avoid rapid-fire or survey-like questions.
5. NEVER invent company facts. NEVER invent founder names, company history, employee counts, pricing, policies, SLA, warranty, services, locations, guarantees, timelines, support terms, technical capabilities, or other facts. If the information is not currently available, clearly say so or ask a short clarification question. Never fill missing knowledge with plausible-sounding information.
6. NEVER sound like a chatbot. Use spoken English (or Telugu if specified). Maintain context from previous turns. If the request is unclear, ask a short clarification. Prioritize the latest caller instruction.
7. IF INTERRUPTED: If you see a structured JSON object like {"assistant_interrupted": true}, it means the user interrupted you mid-sentence. Stop, listen, and adapt naturally to their interruption.
8. NEVER use phrases like "As an AI" or "I am an AI".

## CONSULTATIVE BEHAVIOUR
Behave like a senior consultant, not a form-filling chatbot:
- Lead with insights: "Based on what you've described, I'd recommend..."
- Offer proactive suggestions: "Most restaurants in our portfolio also add..."
- Relate pricing to their specific needs: "With your budget of X, the best option would be..."
- Connect features to business outcomes: "Online ordering will let you avoid 20–30% Swiggy commissions."
- Use phrases like: "One option is...", "Another approach would be...", "Since you're planning..."

## EMOTION & PERSONALITY
You will receive a STYLE_PROFILE dictating your tone, energy, empathy, and length.
- Follow the 'guidance' array strictly to adapt to the customer's emotional state.
- AVOID robotic empathy phrases like "I understand", "I appreciate", "Thank you for your patience", "I'm sorry to hear that".
- Show empathy naturally through action and tone, e.g. "Let's get this sorted out right now", "That sounds really frustrating, let's fix it."
- Match your energy and sentence length to the style profile.

## LANGUAGE
- Use simple, warm spoken Indian English unless LANGUAGE is Telugu.
- No corporate jargon. No "certainly", "absolutely", "of course".
- Short sentences. Conversational rhythm. Natural contractions ("we'll", "that's", "you'll").`;
}

export class ResponseGenerator {
  constructor(callId) {
    this.callId = callId;
  }

  async generate(userMessage, context, speechPlan, abortSignal = null) {
    const historyMessages = (context.recentTranscript || []).map(t => ({
      role: t.speaker === "Customer" ? "user" : "assistant",
      content: t.message
    }));

    if (context.interruptedContext && context.partialSpokenText) {
      historyMessages.splice(historyMessages.length - 1, 0, {
        role: "assistant",
        content: JSON.stringify({
          assistant_spoken: context.partialSpokenText,
          assistant_interrupted: true
        })
      });
    }

    if (historyMessages.length > 0 && historyMessages[historyMessages.length - 1].role === "user") {
      historyMessages.pop();
    }

    const messages = [
      { role: "system", content: buildSystemDirective() },
      ...historyMessages,
      {
        role: "user",
        content: JSON.stringify({
          speech_plan: speechPlan,
          customer_context: {
            name: context.customerName,
            industry: context.industry,
            business_type: context.businessType,
            website_type: context.websiteType,
            requirement: context.requirement,
            required_features: context.requiredFeatures ?? [],
            pain_points: context.painPoints ?? [],
            decision_maker: context.decisionMaker,
            timeline: context.timeline,
            budget: context.budget,
            location: context.location,
            users: context.users,
            platform: context.platform,
            priority: context.priority,
            stage: context.stage,
            intent: context.intent,
            emotion: context.emotion,
            language: context.language,
            questions_already_asked: context.questionsAsked ?? [],
            topics_already_explained: context.topicsExplained ?? [],
            interrupted: context.interruptedContext,
            partial_you_were_saying: context.partialSpokenText
          },
          consultative_directive: SalesReasoningEngine.generateDirective(context),
          style_profile: context.emotionEngine ? context.emotionEngine.getStyleProfile(context.emotion, speechPlan) : null,
          recent_agent_lines: context.recentTranscript
            ?.filter((t) => t.speaker === "Priya")
            .map((t) => t.message)
            .slice(-5),
          business: COMPANY,
          customer_said: userMessage
        })
      }
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.82,
      max_tokens: 220,
      response_format: { type: "json_object" }
    }, { signal: abortSignal });

    let parsed = ResponseParser.parse(response.choices[0].message.content);

    // Validate length and retry once if it violates strict brevity
    const wordCount = parsed.fullText.split(/\s+/).length;
    if (speechPlan.maxWords && wordCount > speechPlan.maxWords + 10) {
      console.log(`⚠️ Response too long (${wordCount} words). Retrying...`);
      messages.push({ role: "assistant", content: response.choices[0].message.content });
      messages.push({ role: "user", content: `Your previous response was too long. Rewrite it strictly under ${speechPlan.maxWords} words. Keep it short and punchy.` });
      
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.82,
        max_tokens: 220,
        response_format: { type: "json_object" }
      }, { signal: abortSignal });
      parsed = ResponseParser.parse(response.choices[0].message.content);
    }

    return parsed;
  }

  static clearSession(callId) {
    // No-op, managed by MemoryStore now
  }
}

export async function askOpenAI(callId, message, employeeState) {
  const generator = new ResponseGenerator(callId);
  const plan = {
    tone: "friendly",
    maxWords: 15,
    minWords: 3,
    allowSelfCorrection: false,
    allowFillers: false,
    allowHesitation: false,
    language: employeeState.language ?? "English"
  };
  const context = {
    customerName: employeeState.customerName,
    industry: employeeState.industry,
    requirement: employeeState.requirement,
    stage: employeeState.conversationStage,
    intent: employeeState.currentIntent,
    emotion: employeeState.customerEmotion ?? "neutral",
    language: employeeState.language,
    topicsExplained: [],
    recentTranscript: [],
    business: COMPANY,
    emotionEngine: null
  };
  const result = await generator.generate(message, context, plan);
  return result.fullText;
}

export function clearConversation(callId) {
  ResponseGenerator.clearSession(callId);
}
