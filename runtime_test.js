import { classifyIntent } from "./engine/perception/IntentClassifier.js";
import { evaluateQuickReply } from "./engine/cognition/QuickReplyEngine.js";
import { directConversation, Strategy } from "./engine/cognition/ConversationDirector.js";
import { Intent } from "./engine/types.js";

function testRuntimePath(message, turnState) {
  // 1. QuickReply
  const qrResult = evaluateQuickReply(message, turnState);
  
  // 2. Intent Classifier
  const classifiedIntent = classifyIntent(message, turnState);
  turnState.intent = classifiedIntent;
  
  // 3. Conversation Director
  const plan = directConversation({ message, turnState, qrResult, wasInterrupted: false, context: turnState });
  
  console.log(`\nInput: "${message}"`);
  console.log(`QuickReply: ${qrResult.fire ? "true" : "false"}`);
  console.log(`Intent: ${classifiedIntent}`);
  console.log(`Strategy: ${plan.strategy}`);
  
  return { intent: classifiedIntent, strategy: plan.strategy };
}

console.log("=== PHASE 6 RUNTIME INTENT TESTS ===");

const defaultState = () => ({
  customerEmotion: "neutral",
  intent: Intent.UNKNOWN,
  conversationStage: "DISCOVERY",
  complexity: 0.5,
  currentIntent: null
});

console.log("\n--- TEST A: Founder ---");
testRuntimePath("Okay. I am asking about your founder details.", defaultState());

console.log("\n--- TEST B & C: Frustration ---");
testRuntimePath("What the fuck? What I'm asking?", defaultState());
testRuntimePath("Motherfucker, stop.", defaultState());

console.log("\n--- TEST D: General vs Inherited ---");
testRuntimePath("I asked you about phone the details.", { ...defaultState(), currentIntent: Intent.SERVICE_INQUIRY });

console.log("\n--- TEST E: Founder Direct ---");
testRuntimePath("Who is your founder?", defaultState());

console.log("\n--- TEST F: Wait ---");
testRuntimePath("Yeah. Wait. I will explain.", defaultState());

console.log("\n--- TEST I: Call End ---");
testRuntimePath("Have a nice day.", defaultState());

console.log("\n--- TEST J: Memory Correction ---");
testRuntimePath("I already said at the beginning.", defaultState());

import { MemoryStore } from "./engine/cognition/MemoryStore.js";
console.log("\n=== PHASE 6 MULTI-TURN MEMORY TEST ===");
const mem = new MemoryStore("test-call-123");

const sequence = [
  "We have a logistics company in New York.",
  "We're planning an ERP.",
  "Employees and managers will use it.",
  "Customers should also have access through a portal.",
  "How much would it cost?",
  "That's all. Have a nice day."
];

for (let i = 0; i < sequence.length; i++) {
  console.log(`\nTurn ${i + 1}: "${sequence[i]}"`);
  mem.processUserTurn(sequence[i]);
  const s = mem.state;
  console.log(`Memory state:`);
  console.log(`  industry: ${s.industry}`);
  console.log(`  location: ${s.location}`);
  console.log(`  requirement: ${s.requirement}`);
  console.log(`  users: ${s.users.join(", ")}`);
  console.log(`  platform: ${s.platform}`);
  console.log(`  intent: ${s.currentIntent}`);
}

