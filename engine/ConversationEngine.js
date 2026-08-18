import { MemoryStore } from "./cognition/MemoryStore.js";
import { planSpeech } from "./cognition/SpeechPlanner.js";
import { ResponseGenerator } from "./cognition/ResponseGenerator.js";
import { evaluateQuickReply } from "./cognition/QuickReplyEngine.js";
import { directConversation, Strategy } from "./cognition/ConversationDirector.js";
import { ActiveListeningEngine } from "./cognition/ActiveListeningEngine.js";
import { removeAIPatterns, dedupeRecentPhrases } from "./speech/AntiAIPatterns.js";
import { sanitiseForSpeech, computeMaxWords, evaluateCompleteness } from "./cognition/TurnTakingEngine.js";
import { maybePrependFiller } from "./speech/FillerController.js";
import { optimizeForSpeech } from "./speech/SpeechOptimizer.js";
import { computeRhythm, computeEndpointingDebounce, wait } from "./speech/RhythmController.js";
import { buildVoiceMetadata } from "./speech/VoiceMetadata.js";
import { CartesiaAdapter } from "./output/CartesiaAdapter.js";
import { TwilioPlayback } from "./output/TwilioPlayback.js";
import { TurnManager } from "./TurnManager.js";
import { InterruptHandler } from "./interrupt/InterruptHandler.js";

/**
 * Human conversation engine — orchestrates the full pipeline:
 * Intent → Emotion → Memory → Speech Plan → Generate → Optimize → Delay → TTS
 */
export class ConversationEngine {
  constructor(twilioWs, getStreamSid, callId) {
    this.callId = callId;
    this.twilioWs = twilioWs;
    this.memory = new MemoryStore(callId);
    this.generator = new ResponseGenerator(callId);
    this.playback = new TwilioPlayback(twilioWs, getStreamSid);
    this.tts = new CartesiaAdapter();
    this.turnManager = new TurnManager();
    this.activeListener = new ActiveListeningEngine();
    this.interruptHandler = new InterruptHandler(this.playback, this.memory, this.tts);
    this.currentAbort = null;
    this.currentTurnId = 0;
    this.greetingSent = false;

    this.turnManager.onFinalTurn = (text) => this.processTurn(text);
    this.turnManager.onBargeIn = (text) => {
      const didInterrupt = this.interruptHandler.handleBargeIn(text, this.currentAbort);
      if (didInterrupt) {
        this.turnManager.setAgentSpeaking(false);
      }
    };
  }

  handleDeepgramMessage(data) {
    const transcript = data?.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    // ── Active Listening (Backchannel) ──────────────────────────────────────
    const isFinal = data?.is_final && data?.speech_final;
    const backchannel = this.activeListener.evaluate(transcript, isFinal, this.memory.state);
    if (backchannel && !this.turnManager.agentSpeaking) {
      this._playBackchannel(backchannel);
    }
    // ────────────────────────────────────────────────────────────────────────

    this.turnManager.handleTranscript(data, transcript);
  }

  async onCallStart() {
    if (this.greetingSent) return;
    this.greetingSent = true;

    await this.deliverProactiveGreeting();
  }

  async deliverProactiveGreeting() {
    const plan = planSpeech({
      stage: "GREETING",
      intent: "GREETING",
      action: "GREET_CUSTOMER",
      emotion: { primary: "neutral" },
      complexity: 0.2,
      leadScore: 0,
      language: "English",
      recentAcknowledgements: []
    });

    const segments = optimizeForSpeech(
      [{ text: "Hello, Arvex Technologies, this is Priya.", pause_ms: 200, stress: "Priya" }],
      buildVoiceMetadata(plan, [], null)
    );

    this.currentTurnId++;
    const turnId = this.currentTurnId;
    const turnAbort = new AbortController();
    this.currentAbort = turnAbort;
    await this.speakSegments(segments, plan, "Hello, Arvex Technologies, this is Priya.", turnAbort, turnId);
  }

  async processTurn(userMessage) {
    this.activeListener.resetTurn();
    
    // Abort any ongoing turn (generation or speech)
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    this.tts.abort();
    this.playback.abort();
    
    this.currentTurnId++;
    const turnId = this.currentTurnId;
    const turnAbort = new AbortController();
    this.currentAbort = turnAbort;

    const perf = { USER_FINAL: Date.now() };
    console.log(`\n[PERF] USER_TURN_FINAL (${perf.USER_FINAL})`);

    await this.turnManager.runTurn(turnId, async () => {
      perf.TURN_COMMITTED = Date.now();
      console.log(`[PERF] TURN_COMMITTED (${perf.TURN_COMMITTED})`);
      if (turnAbort.signal.aborted || turnId !== this.currentTurnId) return;

      const wasInterrupted = this.interruptHandler.wasInterrupted();
      const pending = this.interruptHandler.consumePendingUtterance();
      const message = pending || userMessage;

      console.log("\n🗣️ USER:", message);

      // ── Fragment Suppression (Pre-LLM Guard) ────────────────────────────────
      const cleanMessage = message.trim().replace(/[.!?]+$/, "");
      const isFragmentWord = /^(and|but|because|to|for|of|with|how|why|can|i think|i was|we need|the|actually|what)$/i.test(cleanMessage);
      const completeness = evaluateCompleteness(message);
      const words = message.trim().split(/\s+/).length;
      const hasQuestionMark = /\?/.test(message);

      if (!hasQuestionMark && ((completeness.incomplete && words <= 3) || isFragmentWord)) {
         console.log(`[TURN] INCOMPLETE_WAIT ("${message}")`);
         return;
      }
      console.log(`[TURN] COMPLETE`);
      // ────────────────────────────────────────────────────────────────────────

      // ── Quick Reply (Pre-Evaluation) ────────────────────────────────────────
      const qrResult = evaluateQuickReply(message, this.memory.state);

      // Process memory mutation
      const turnState = this.memory.processUserTurn(message);
      const context = this.memory.getContextForGeneration();

      console.log("\n🧠 TURN STATE:", {
        intent: turnState.intent,
        emotion: turnState.customerEmotion,
        stage: turnState.conversationStage,
        action: turnState.action
      });

      // ── Conversation Director ───────────────────────────────────────────────
      const directorPlan = directConversation({
        message,
        turnState,
        qrResult,
        wasInterrupted,
        context
      });

      console.log(`\n🎬 DIRECTOR [${directorPlan.strategy}] (Priority: ${directorPlan.priority})`);
      console.log(`   ↳ ${directorPlan.reason}`);

      // If Director chose QUICK_REPLY, execute immediately and return
      if (directorPlan.strategy === Strategy.QUICK_REPLY) {
        console.log(`⚡ QUICK REPLY [${qrResult.intent}] "${qrResult.text}" (confidence: ${(qrResult.confidence * 100).toFixed(0)}%)`);
        const qrPlan = this._buildQuickReplyPlan();
        const qrSegments = optimizeForSpeech(
          [{ text: qrResult.text, pause_ms: 0, stress: null }],
          buildVoiceMetadata(qrPlan, [{ text: qrResult.text, pause_ms: 0 }], null)
        );
        perf.TTS_START = Date.now();
        console.log(`[PERF] TTS_START (${perf.TTS_START})`);
        await this.speakSegments(qrSegments, qrPlan, qrResult.text, turnAbort, turnId, null, perf);
        this.interruptHandler.clear();
        return;
      } else if (directorPlan.strategy === Strategy.CLOSING) {
        this.memory.state.conversationStage = "CLOSING";
        console.log(`[LIFECYCLE] CLOSING`);
        // Fallthrough to let the LLM generate the natural goodbye, but it is strictly guided by SalesReasoningEngine
      }
      // ────────────────────────────────────────────────────────────────────────

      const speechPlan = planSpeech({
        stage: turnState.conversationStage,
        intent: turnState.intent,
        action: turnState.action,
        emotion: turnState.emotion,
        complexity: turnState.complexity,
        leadScore: turnState.leadScore,
        language: turnState.language,
        interruptedContext: context.interruptedContext,
        partialSpokenText: context.partialSpokenText,
        recentAcknowledgements: turnState.acknowledgementsUsed?.slice(-3) ?? [],
        directorStrategy: directorPlan.strategy,
        emotionAcknowledgement: directorPlan.emotion_acknowledgement
      });

      // ── Dynamic Response Length Control ────────────────────────────────────
      speechPlan.maxWords = computeMaxWords(
        turnState.conversationStage,
        turnState.intent,
        turnState.complexity
      );
      // If the customer is frustrated, shorten responses and increase listening
      if (turnState.customerEmotion === 'angry' || turnState.customerEmotion === 'impatient') {
        speechPlan.maxWords = Math.min(speechPlan.maxWords, 20);
      }

      // RhythmController: context-aware timing — no fixed caps, no random jitter.
      const enrichedTurnState = {
        ...turnState,
        messageLength: message.length,
        isQuestion: /\?/.test(message)
      };
      const { delayMs, mode } = computeRhythm(speechPlan, enrichedTurnState, wasInterrupted);
      console.log(`⏱️ RHYTHM: ${mode} (${delayMs}ms)`);

      // Sync the TurnManager debounce with the current conversation state.
      const debounce = computeEndpointingDebounce(
        turnState.conversationStage,
        turnState.customerEmotion
      );
      this.turnManager.setDebounce(debounce);

      await wait(delayMs, turnAbort.signal);

      if (turnAbort.signal?.aborted || turnId !== this.currentTurnId) return;

      // ── Concurrent Holding Phrase ───────────────────────────────────────────
      let holdPromise = Promise.resolve();
      if (directorPlan.holding_phrase) {
        console.log(`⏳ HOLDING PHRASE: "${directorPlan.holding_phrase}"`);
        const holdSegments = optimizeForSpeech(
          [{ text: directorPlan.holding_phrase, pause_ms: 0, stress: null }],
          buildVoiceMetadata(speechPlan, [{ text: directorPlan.holding_phrase, pause_ms: 0 }], null)
        );
        // Dispatch TTS immediately, do not await it yet
        holdPromise = this.speakSegments(holdSegments, speechPlan, directorPlan.holding_phrase, turnAbort, turnId);
      }
      // ────────────────────────────────────────────────────────────────────────

      let generated;
      try {
        perf.LLM_START = Date.now();
        console.log(`[PERF] LLM_START (${perf.LLM_START})`);
        generated = await this.generator.generate(message, context, speechPlan, turnAbort.signal);
        perf.LLM_COMPLETE = Date.now();
        console.log(`[PERF] LLM_COMPLETE (${perf.LLM_COMPLETE})`);
      } catch (error) {
        if (error.name === "AbortError" || turnAbort.signal?.aborted || error.message?.toLowerCase().includes("abort") || error.message?.toLowerCase().includes("cancel")) {
          console.log(`[ABORT] TURN_INVALIDATED (LLM)`);
          return;
        }
        console.error("❌ Generation error:", error.message);
        generated = {
          fullText: "Sorry, one moment... can you say that again?",
          segments: [{ text: "Sorry, one moment... can you say that again?", pause_ms: 0 }]
        };
      }

      // Wait for the holding phrase to finish before evaluating abort or speaking the generation
      await holdPromise;

      if (turnAbort.signal?.aborted || turnId !== this.currentTurnId) {
         console.log(`[ABORT] TURN_INVALIDATED (Pre-TTS)`);
         return;
      }
      if (!this.memory.state) return;

      let fullText = sanitiseForSpeech(removeAIPatterns(generated.fullText));
      fullText = dedupeRecentPhrases(fullText, this.memory.state.lastAgentPhrases);

      const fillerResult = maybePrependFiller(fullText, speechPlan, this.memory.state);
      fullText = fillerResult.text;

      let segments = generated.segments;
      if (fillerResult.used && segments.length) {
        segments = [
          { text: fillerResult.text, pause_ms: segments[0]?.pause_ms ?? 0, stress: null },
          ...segments.slice(1)
        ];
      } else {
        segments = segments.map((s, i) =>
          i === 0 ? { ...s, text: fullText.split(/(?<=[.!?])\s+/)[0] || fullText } : s
        );
        if (segments.length === 1) segments[0].text = fullText;
      }

      const voiceMetadata = buildVoiceMetadata(
        speechPlan,
        segments,
        context.customerName
      );

      segments = optimizeForSpeech(segments, voiceMetadata);

      console.log("\n🤖 AGENT:", fullText);
      console.log("🎭 SPEECH PLAN:", {
        tone: speechPlan.tone,
        speed: speechPlan.speakingSpeed,
        empathy: speechPlan.empathyLevel
      });

      perf.TTS_START = Date.now();
      console.log(`[PERF] TTS_START (${perf.TTS_START})`);

      if (turnAbort.signal?.aborted || turnId !== this.currentTurnId) {
         console.log(`[ABORT] TURN_INVALIDATED (Pre-Playback)`);
         return;
      }

      await this.speakSegments(segments, speechPlan, fullText, turnAbort, turnId, fillerResult.used, perf);

      this.interruptHandler.clear();
    });
  }

  async speakSegments(segments, speechPlan, fullText, turnAbort, turnId, acknowledgement = null, perf = {}) {
    const streamSid = this.playback.streamSid;
    if (!streamSid) {
      console.log("❌ No Stream SID for playback");
      return;
    }

    this.playback.beginSpeaking(turnAbort);
    this.turnManager.setAgentSpeaking(true);

    const voiceMetadata = buildVoiceMetadata(
      speechPlan,
      segments,
      this.memory.state.customerName
    );

    try {
      for (let i = 0; i < segments.length; i++) {
        if (turnAbort.signal?.aborted || turnId !== this.currentTurnId) {
           console.log(`[ABORT] TURN_INVALIDATED (Mid-Playback)`);
           break;
        }

        const segment = segments[i];
        if (i === 0) {
          perf.TTS_FIRST_AUDIO = Date.now();
          console.log(`[PERF] TTS_FIRST_AUDIO_REQUESTED (${perf.TTS_FIRST_AUDIO})`);
        }
        await this.tts.speakSegment(
          this.twilioWs,
          streamSid,
          segment,
          voiceMetadata,
          turnAbort.signal
        );
        if (i === 0) {
          perf.PLAYBACK_START = Date.now();
          console.log(`[PERF] PLAYBACK_START (${perf.PLAYBACK_START})`);
          
          // Print Summary
          console.log("\n📊 LATENCY SUMMARY:");
          console.log(`   USER_FINAL → TURN_COMMITTED : ${perf.TURN_COMMITTED - perf.USER_FINAL}ms`);
          if (perf.LLM_START) {
            console.log(`   TURN_COMMITTED → LLM_START  : ${perf.LLM_START - perf.TURN_COMMITTED}ms`);
            console.log(`   LLM_START → LLM_COMPLETE    : ${perf.LLM_COMPLETE - perf.LLM_START}ms`);
            console.log(`   LLM_COMPLETE → TTS_START    : ${perf.TTS_START - perf.LLM_COMPLETE}ms`);
          } else {
             console.log(`   TURN_COMMITTED → TTS_START  : ${perf.TTS_START - perf.TURN_COMMITTED}ms (Quick Reply/Hold)`);
          }
          console.log(`   TTS_START → TTS_FIRST_AUDIO : ${perf.TTS_FIRST_AUDIO - perf.TTS_START}ms`);
          console.log(`   USER_FINAL → FIRST_AUDIO    : ${perf.TTS_FIRST_AUDIO - perf.USER_FINAL}ms\n`);
        }

        this.playback.markSegmentSpoken(segment.text, i);

        const pauseMs = segment.pause_ms ?? 0;
        if (pauseMs > 0 && !turnAbort.signal?.aborted) {
          await wait(pauseMs, turnAbort.signal);
        }
      }

      if (!turnAbort.signal?.aborted && turnId === this.currentTurnId && this.memory.state) {
        this.memory.recordAgentSpeech(fullText, { acknowledgement });
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("❌ Playback error:");
console.error(error);
console.error(error.stack);
      }
    } finally {
      this.playback.endSpeaking();
      this.turnManager.setAgentSpeaking(false);
    }
  }

  /**
   * Build a lightweight speech plan for Quick Reply segments.
   * Quick replies are always short, confident, and professionally warm.
   */
  _buildQuickReplyPlan() {
    const s = this.memory.state;
    return planSpeech({
      stage:                s?.conversationStage ?? "GREETING",
      intent:               "GENERAL",
      action:               "CONTINUE_CONVERSATION",
      emotion:              { primary: s?.customerEmotion ?? "neutral" },
      complexity:           0.05,
      leadScore:            s?.leadScore ?? 0,
      language:             s?.language ?? "English",
      recentAcknowledgements: s?.acknowledgementsUsed?.slice(-3) ?? []
    });
  }

  /**
   * Fires a lightweight backchannel ("Mm-hmm") without taking over the turn.
   * This bypasses the normal Playback/InterruptHandler logic so the user
   * can continue speaking without triggering a barge-in event.
   */
  async _playBackchannel(phrase) {
    const streamSid = this.playback.streamSid;
    if (!streamSid) return;

    console.log(`\n👂 BACKCHANNEL: "${phrase}"`);

    const plan = this._buildQuickReplyPlan(); 
    plan.speakingSpeed = 1.1; // Backchannels are slightly faster
    
    const metadata = buildVoiceMetadata(
      plan, 
      [{ text: phrase, pause_ms: 0 }], 
      this.memory.state?.customerName
    );

    try {
      // Send directly to TTS adapter. No `this.currentAbort` is registered, 
      // and `agentSpeaking` remains false.
      await this.tts.speakSegment(
        this.twilioWs,
        streamSid,
        { text: phrase, pause_ms: 0 },
        metadata,
        new AbortController().signal
      );
    } catch (e) {
      console.error("❌ Backchannel error:", e.message);
    }
  }

  cleanup() {
    this.currentAbort?.abort();
    this.turnManager.reset();
    this.tts.close();
    ResponseGenerator.clearSession(this.callId);
    const { state, transcript } = MemoryStore.endSession(this.callId);
    this.logCallSummary(state, transcript);
  }

  logCallSummary(state, transcript) {
    console.log("\n=========================================");
    console.log("📞 CALL TRANSCRIPT");
    console.log("=========================================\n");

    for (const chat of transcript) {
      console.log(`${chat.speaker}: ${chat.message}\n`);
    }

    console.log("=========================================");
    console.log("📋 LEAD SUMMARY");
    console.log("=========================================\n");
    console.log(`Name            : ${state?.customerName || "Unknown"}`);
    console.log(`Industry        : ${state?.industry || "Unknown"}`);
    console.log(`Business Type   : ${state?.businessType || "Unknown"}`);
    console.log(`Website Type    : ${state?.websiteType || "N/A"}`);
    console.log(`Requirement     : ${state?.requirement || "Unknown"}`);
    console.log(`Features        : ${state?.requiredFeatures?.length > 0 ? state?.requiredFeatures.join(", ") : "None"}`);
    console.log(`Pain Points     : ${state?.painPoints?.length > 0 ? state?.painPoints.join(", ") : "None"}`);
    console.log(`Decision Maker  : ${state?.decisionMaker ? "Yes" : "Unknown"}`);
    console.log(`Budget          : ${state?.budget || "Unknown"}`);
    console.log(`Timeline        : ${state?.timeline || "Unknown"}`);
    console.log(`Priority        : ${state?.priority || "Low"}`);
    console.log(`Language        : ${state?.language || "Unknown"}`);
    console.log(`Lead Score      : ${state?.leadScore || 0}`);
    console.log(`Status          : ${(state?.leadScore ?? 0) >= 70 ? "Interested (Hot)" : "Needs Follow-up"}`);
    console.log("\n=========================================\n");
  }
}
