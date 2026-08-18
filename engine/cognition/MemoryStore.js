import { COMPANY as company } from "../../knowledge/companyProfile.js";
import { ConversationStage, CustomerEmotion } from "../types.js";
import { classifyIntent, decideAction } from "../perception/IntentClassifier.js";
import { detectEmotion } from "../perception/EmotionDetector.js";
import { EmotionPersonalityEngine } from "./EmotionPersonalityEngine.js";

function createInitialState() {
  return {
    greetingDone: false,
    customerName: null,
    language: "unknown",
    currentIntent: null,
    previousIntent: null,
    conversationStage: ConversationStage.GREETING,
    customerEmotion: CustomerEmotion.NEUTRAL,
    emotionConfidence: 0.4,
    askedAboutCompany: false,
    askedPricing: false,
    askedServices: false,
    requestedDemo: false,
    industry: null,
    businessType: null,
    websiteType: null,
    requirement: null,
    requiredFeatures: [],
    painPoints: [],
    location: null,
    users: [],
    platform: null,
    pricingAsked: false,
    meetingRequested: false,
    businessOwner: false,
    decisionMaker: false,
    timeline: null,
    budget: null,
    priority: "Low",
    leadScore: 0,
    topicsExplained: [],
    questionsAsked: [],
    acknowledgementsUsed: [],
    lastAgentPhrases: [],
    interruptedContext: null,
    partialSpokenText: null
  };
}

function extractProfile(state, message) {
  const text = message.toLowerCase();

  state.language = /[అ-హ]/.test(message) ? "Telugu" : state.language === "Telugu" ? "Telugu" : "English";

  const namePatterns = [
    /my name is (.+)/i,
    /this is (.+)/i,
    /i am (.+)/i,
    /i'm (.+)/i,
    /call me (.+)/i
  ];

  for (const pattern of namePatterns) {
    const match = message.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/[.,!?].*$/, '').replace(/\s+(and|i|we|my|the)\b.*/i, '').trim();
      if (name && state.customerName !== name) {
        state.customerName = name;
        console.log(`[MEMORY] FACT_ADDED: name = ${name}`);
      }
      break;
    }
  }

  if (text.includes("hospital") || text.includes("clinic") || text.includes("medical") || text.includes("healthcare")) {
    if (state.industry !== "Healthcare") {
      state.industry = "Healthcare";
      state.businessType = "Medical Facility";
      state.businessOwner = true;
      state.leadScore += 30;
      console.log(`[MEMORY] FACT_ADDED: industry = Healthcare`);
    }
  }

  if (text.includes("restaurant") || text.includes("hotel") || text.includes("cafe") || text.includes("hospitality")) {
    if (state.industry !== "Hospitality") {
      state.industry = "Hospitality";
      state.businessType = "Restaurant/Cafe";
      state.businessOwner = true;
      state.leadScore += 30;
      console.log(`[MEMORY] FACT_ADDED: industry = Hospitality`);
    }
  }

  if (text.includes("logistics") || text.includes("transport") || text.includes("shipping") || text.includes("delivery company")) {
    if (state.industry !== "Logistics") {
      state.industry = "Logistics";
      state.businessType = "Logistics/Transport";
      state.businessOwner = true;
      state.leadScore += 30;
      console.log(`[MEMORY] FACT_ADDED: industry = Logistics`);
    }
  }
  
  if (text.includes("ecommerce") || text.includes("store") || text.includes("shop") || text.includes("retail")) {
    if (state.industry !== "Retail") {
      state.industry = "Retail";
      state.websiteType = "E-Commerce";
      state.businessOwner = true;
      state.leadScore += 30;
      console.log(`[MEMORY] FACT_ADDED: industry = Retail`);
    }
  }

  if (text.includes("website")) {
    if (state.requirement !== "Website") {
      state.requirement = "Website";
      state.leadScore += 20;
      console.log(`[MEMORY] FACT_ADDED: requirement = Website`);
    }
  }

  if (text.match(/\b(erp|management system)\b/i)) {
    if (state.requirement !== "ERP") {
      state.requirement = "ERP";
      state.leadScore += 30;
      console.log(`[MEMORY] FACT_ADDED: requirement = ERP`);
    }
  }

  if (text.match(/\b(portal|dashboard|platform)\b/i)) {
    if (!state.platform) {
      state.platform = "Portal";
      console.log(`[MEMORY] FACT_ADDED: platform = Portal`);
    }
  }

  const userMatches = text.match(/\b(employees?|managers?|customers?|students?|patients?|staff|clients?|admins?)\b/g) || [];
  for (const match of userMatches) {
    const key = match.replace(/s$/, ''); // singularize loosely
    const finalKey = key === 'manager' ? 'managers' : key === 'employee' ? 'employees' : key === 'customer' ? 'customers' : match;
    if (!state.users.includes(finalKey)) {
      state.users.push(finalKey);
      console.log(`[MEMORY] FACT_ADDED: users = ${finalKey}`);
    }
  }

  const locationMatch = message.match(/\b(?:in|from|at|based in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\b/);
  if (locationMatch && !state.location) {
     const loc = locationMatch[1].trim();
     if (loc.length > 2 && loc.toLowerCase() !== "the") {
       state.location = loc;
       console.log(`[MEMORY] FACT_ADDED: location = ${loc}`);
     }
  }

  if (text.match(/\b(booking|appointments?|reservations?|orders?|cart|payment|delivery|menu)\b/i)) {
    const featureMatch = message.match(/\b(booking|appointments?|reservations?|orders?|cart|payment|delivery|menu)\b/ig) || [];
    for (const feat of featureMatch) {
      const key = feat.toLowerCase().replace(/s$/, '');
      const normalised = key === 'appointment' ? 'booking' : key;
      if (!state.requiredFeatures.includes(normalised)) {
        state.requiredFeatures.push(normalised);
        console.log(`[MEMORY] FACT_ADDED: feature = ${normalised}`);
      }
    }
  }

  if (text.match(/\b(slow|expensive|manual|outdated|losing customers?|no online|no website|complicated|confusing)\b/i)) {
    const painMatches = message.match(/\b(slow|expensive|manual|outdated|losing customers?|no online|no website|complicated|confusing)\b/ig) || [];
    for (const pain of painMatches) {
      const key = pain.toLowerCase();
      if (!state.painPoints.includes(key)) {
        state.painPoints.push(key);
      }
    }
  }

  if (text.includes("i am the owner") || text.includes("my business") || text.includes("i run")) {
    state.decisionMaker = true;
  }

  if (text.includes("tomorrow") || text.includes("next week") || text.includes("asap") || text.includes("urgent")) {
    const tl = message.match(/\b(tomorrow|next week|asap|this week|urgent)\b/i)?.[0]?.toLowerCase();
    if (tl && state.timeline !== tl) {
      state.timeline = tl;
      state.priority = "High";
      console.log(`[MEMORY] FACT_ADDED: timeline = ${tl}`);
    }
  }

  if (text.includes("budget") || text.match(/\b\d+\s*(k|lakh|rupees?|thousand)\b/i)) {
    const bg = message.match(/\b\d+\s*(k|lakh|rupees?|thousand)\b/i)?.[0];
    if (bg && state.budget !== bg) {
      state.budget = bg;
      console.log(`[MEMORY] FACT_ADDED: budget = ${bg}`);
    }
  }
}

function updateStage(state, intent) {
  switch (intent) {
    case "GREETING":
      state.greetingDone = true;
      state.conversationStage = ConversationStage.INTRODUCTION;
      break;
    case "IDENTITY":
      state.conversationStage = ConversationStage.INTRODUCTION;
      break;
    case "COMPANY_INFO":
      state.askedAboutCompany = true;
      state.conversationStage = ConversationStage.DISCOVERY;
      break;
    case "SERVICE_INQUIRY":
      state.askedServices = true;
      state.conversationStage = ConversationStage.DISCOVERY;
      state.leadScore += 10;
      break;
    case "PRICING":
      state.askedPricing = true;
      state.conversationStage = ConversationStage.INFORMATION_GATHERING;
      state.leadScore += 25;
      break;
    case "DEMO_REQUEST":
      state.requestedDemo = true;
      state.conversationStage = ConversationStage.CONFIRMATION;
      state.leadScore += 50;
      break;
    case "CLOSING":
      state.conversationStage = ConversationStage.CLOSING;
      break;
    case "CLARIFICATION":
      state.conversationStage = ConversationStage.CLARIFICATION;
      break;
    case "COMPLAINT":
      state.conversationStage = ConversationStage.PROBLEM_SOLVING;
      break;
    default:
      if (state.conversationStage === ConversationStage.GREETING) {
        state.conversationStage = ConversationStage.DISCOVERY;
      }
  }
}

const sessions = new Map();
const transcripts = new Map();
const emotionEngines = new Map();

export class MemoryStore {
  constructor(callId) {
    this.callId = callId;
    if (!sessions.has(callId)) {
      sessions.set(callId, createInitialState());
      transcripts.set(callId, []);
      emotionEngines.set(callId, new EmotionPersonalityEngine());
    }
  }

  get state() {
    return sessions.get(this.callId);
  }

  get transcript() {
    return transcripts.get(this.callId) || [];
  }

  get businessContext() {
    return company;
  }

  get emotionEngine() {
    return emotionEngines.get(this.callId);
  }

  processUserTurn(message) {
    const state = this.state;
    const intent = classifyIntent(message, state);
    const emotion = detectEmotion(message, state.customerEmotion);

    state.previousIntent = state.currentIntent;
    state.currentIntent = intent;
    state.customerEmotion = emotion.primary;
    state.emotionConfidence = emotion.confidence;

    extractProfile(state, message);
    updateStage(state, intent);

    const action = decideAction(intent, state);
    const complexity = estimateComplexity(message, state);
    
    this.emotionEngine.updateState(emotion.primary, intent, complexity);

    this.addTurn("Customer", message);

    return {
      ...state,
      intent,
      action,
      emotion,
      complexity
    };
  }

  addTurn(speaker, message) {
    transcripts.get(this.callId).push({ speaker, message, at: Date.now() });
  }

  recordAgentSpeech(text, metadata = {}) {
    this.addTurn("Priya", text);
    const state = this.state;
    state.lastAgentPhrases = [...state.lastAgentPhrases, text].slice(-8);
    if (metadata.acknowledgement) {
      state.acknowledgementsUsed.push(metadata.acknowledgement);
    }
  }

  setInterruptedContext(partialText, userInterruption) {
    this.state.partialSpokenText = partialText;
    this.state.interruptedContext = userInterruption;
  }

  clearInterruptContext() {
    this.state.partialSpokenText = null;
    this.state.interruptedContext = null;
  }

  hasExplained(topic) {
    return this.state.topicsExplained.includes(topic);
  }

  markExplained(topic) {
    if (!this.hasExplained(topic)) {
      this.state.topicsExplained.push(topic);
    }
  }

  alreadyAsked(questionKey) {
    return this.state.questionsAsked.includes(questionKey);
  }

  markAsked(questionKey) {
    if (!this.alreadyAsked(questionKey)) {
      this.state.questionsAsked.push(questionKey);
    }
  }

  getContextForGeneration() {
    const s = this.state;
    return {
      customerName: s.customerName,
      industry: s.industry,
      businessType: s.businessType,
      websiteType: s.websiteType,
      requirement: s.requirement,
      requiredFeatures: s.requiredFeatures,
      painPoints: s.painPoints,
      decisionMaker: s.decisionMaker,
      timeline: s.timeline,
      budget: s.budget,
      priority: s.priority,
      location: s.location,
      users: s.users,
      platform: s.platform,
      language: s.language,
      stage: s.conversationStage,
      intent: s.currentIntent,
      emotion: s.customerEmotion,
      leadScore: s.leadScore,
      topicsExplained: s.topicsExplained,
      questionsAsked: s.questionsAsked,
      interruptedContext: s.interruptedContext,
      partialSpokenText: s.partialSpokenText,
      recentTranscript: this.transcript.slice(-6),
      business: this.businessContext,
      emotionEngine: this.emotionEngine
    };
  }

  static endSession(callId) {
    const state = sessions.get(callId);
    const transcript = transcripts.get(callId) || [];
    sessions.delete(callId);
    transcripts.delete(callId);
    emotionEngines.delete(callId);
    return { state, transcript };
  }
}

function estimateComplexity(message, state) {
  let score = 0.3;
  if (message.split(/\s+/).length > 12) score += 0.2;
  if (/\?/.test(message)) score += 0.15;
  if (state.currentIntent === "PRICING" || state.currentIntent === "SERVICE_INQUIRY") score += 0.2;
  if (state.customerEmotion === CustomerEmotion.CONFUSED) score += 0.15;
  return Math.min(1, score);
}
