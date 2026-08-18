import { CustomerEmotion } from "../types.js";

/**
 * Emotion & Personality Engine
 * 
 * Tracks the evolving emotional state of the conversation and generates a 
 * structured style profile to guide the LLM's response generation.
 * Features emotional memory (gradual decay) rather than sudden shifts.
 */
export class EmotionPersonalityEngine {
  constructor() {
    // Base personality profile - stable traits
    this.basePersonality = {
      professionalism: 0.95,
      friendliness: 0.85,
      confidence: 0.90,
      patience: 0.90
    };

    // Dynamic conversational dimensions (0.0 to 1.0)
    this.dimensions = {
      stress: 0.1,
      confusion: 0.1,
      urgency: 0.1,
      frustration: 0.1,
      engagement: 0.6,
      trust: 0.5
    };
    
    // Decay factor (how much of the previous state is retained per turn)
    this.decay = 0.7;
  }

  /**
   * Updates the emotional dimensions based on the current turn's inputs.
   */
  updateState(customerEmotion, intent, complexity) {
    // 1. Decay previous states
    for (const key in this.dimensions) {
      this.dimensions[key] *= this.decay;
    }

    // 2. Apply new signals
    switch (customerEmotion) {
      case CustomerEmotion.ANGRY:
        this.dimensions.frustration += 0.6;
        this.dimensions.stress += 0.5;
        this.dimensions.trust -= 0.2;
        break;
      case CustomerEmotion.CONFUSED:
        this.dimensions.confusion += 0.5;
        this.dimensions.stress += 0.2;
        break;
      case CustomerEmotion.NERVOUS:
        this.dimensions.stress += 0.4;
        this.dimensions.trust -= 0.1;
        break;
      case CustomerEmotion.BUSY:
      case CustomerEmotion.IMPATIENT:
        this.dimensions.urgency += 0.6;
        this.dimensions.stress += 0.3;
        break;
      case CustomerEmotion.EXCITED:
      case CustomerEmotion.HAPPY:
        this.dimensions.engagement += 0.4;
        this.dimensions.trust += 0.3;
        this.dimensions.frustration = 0;
        this.dimensions.stress *= 0.3; // rapid decay of stress
        break;
      case CustomerEmotion.CURIOUS:
        this.dimensions.engagement += 0.3;
        this.dimensions.trust += 0.1;
        break;
      case CustomerEmotion.TIRED:
        this.dimensions.engagement -= 0.2;
        break;
    }

    if (intent === "COMPLAINT") {
      this.dimensions.frustration += 0.4;
      this.dimensions.stress += 0.4;
    } else if (intent === "CLOSING") {
      this.dimensions.engagement += 0.2;
    }

    if (complexity > 0.7) {
      this.dimensions.confusion += 0.2;
      this.dimensions.stress += 0.1;
    }

    // Ensure all dimensions stay within 0.0 to 1.0 bounds
    for (const key in this.dimensions) {
      this.dimensions[key] = Math.max(0, Math.min(1, this.dimensions[key]));
    }
  }

  /**
   * Generates the structured style profile for the LLM.
   */
  getStyleProfile(customerEmotion, speechPlan) {
    const profile = {
      personality: { ...this.basePersonality },
      emotion: {
        customer: customerEmotion,
        agent_tone: speechPlan.agentEmotion || "professional"
      },
      response: {
        length: speechPlan.maxWords <= 20 ? "concise" : "detailed",
        energy: "medium",
        empathy: "medium"
      },
      guidance: []
    };

    // Dynamic adjustments based on active dimensions
    if (this.dimensions.frustration > 0.5 || this.dimensions.stress > 0.6) {
      profile.response.energy = "low";
      profile.response.empathy = "high";
      profile.personality.patience = 1.0;
      profile.guidance.push("Customer is frustrated/stressed. Be extremely patient, acknowledge their concerns directly, use shorter responses, and avoid asking unnecessary questions. Do not use generic phrases like 'I understand'.");
    } else if (this.dimensions.confusion > 0.5) {
      profile.response.energy = "medium";
      profile.response.empathy = "high";
      profile.personality.patience = 0.95;
      profile.guidance.push("Customer is confused. Speak slowly, use very simple step-by-step explanations, and provide clear guidance.");
    } else if (this.dimensions.urgency > 0.6) {
      profile.response.energy = "high";
      profile.response.length = "extremely_concise";
      profile.guidance.push("Customer is in a hurry. Be highly direct, skip pleasantries, give bottom-line recommendations, and move the conversation forward quickly.");
    } else if (this.dimensions.engagement > 0.7 && this.dimensions.trust > 0.6) {
      profile.response.energy = "high";
      profile.personality.friendliness = 0.95;
      profile.guidance.push("Customer is highly engaged and positive. Match their energy, be enthusiastic, and confidently suggest next steps or premium options.");
    } else {
      profile.guidance.push("Maintain a calm, professional, and friendly consultative tone.");
    }

    return profile;
  }
}
