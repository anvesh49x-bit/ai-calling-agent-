import { classifyIntent } from "./engine/perception/IntentClassifier.js";
import { evaluateQuickReply } from "./engine/cognition/QuickReplyEngine.js";
import { directConversation, Strategy } from "./engine/cognition/ConversationDirector.js";
import { Intent } from "./engine/types.js";
import { MemoryStore } from "./engine/cognition/MemoryStore.js";

function testRuntimePath(message, turnState) {
  const qrResult = evaluateQuickReply(message, turnState);
  const classifiedIntent = classifyIntent(message, turnState);
  turnState.intent = classifiedIntent;
  const plan = directConversation({ message, turnState, qrResult, wasInterrupted: false, context: turnState });
  
  console.log(`\nInput: "${message}"`);
  console.log(`Intent: ${classifiedIntent}`);
  console.log(`Strategy: ${plan.strategy}`);
  
  return { intent: classifiedIntent, strategy: plan.strategy };
}

const defaultState = () => ({
  customerEmotion: "neutral",
  intent: Intent.UNKNOWN,
  conversationStage: "DISCOVERY",
  complexity: 0.5,
  currentIntent: null
});

console.log("=== MEMORY REGRESSION ===");
const mem2 = new MemoryStore("test-mem");
let turnS = mem2.processUserTurn("We are a hospital.");
console.log(`Turn 1 Memory: industry=${mem2.state.industry}, requirement=${mem2.state.requirement}`);
turnS = mem2.processUserTurn("We need an ERP.");
console.log(`Turn 2 Memory: industry=${mem2.state.industry}, requirement=${mem2.state.requirement}`);
turnS = mem2.processUserTurn("Actually, tell me about your founder.");
testRuntimePath("Actually, tell me about your founder.", turnS);
console.log(`Turn 3 Memory: industry=${mem2.state.industry}, requirement=${mem2.state.requirement}, intent=${mem2.state.currentIntent}`);


console.log("\n=== GOODBYE REGRESSION ===");
testRuntimePath("Thanks.", defaultState());
testRuntimePath("Thanks, but one more thing.", defaultState());
testRuntimePath("Okay, that's all.", defaultState());
testRuntimePath("Okay, but how much does it cost?", defaultState());
