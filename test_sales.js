import { MemoryStore } from './engine/cognition/MemoryStore.js';
import { SalesReasoningEngine } from './engine/cognition/SalesReasoningEngine.js';
import { Intent } from './engine/types.js';

const mem = new MemoryStore('test_call_123');

console.log("=== Turn 1: Basic Information ===");
mem.processUserTurn("Hi, I run a restaurant and I need a new website ASAP.");
const ctx1 = mem.getContextForGeneration();
const dir1 = SalesReasoningEngine.generateDirective(ctx1);
console.log("Extracted Context:", { industry: ctx1.industry, requirement: ctx1.requirement, timeline: ctx1.timeline });
console.log("Sales Directive:\n", dir1);
console.log("---------------------------------");

console.log("=== Turn 2: Providing more details ===");
mem.state.currentIntent = Intent.PRICING; // Simulating intent
mem.processUserTurn("We want online reservations and it has to be within 50k budget because the current system is too slow.");
const ctx2 = mem.getContextForGeneration();
const dir2 = SalesReasoningEngine.generateDirective(ctx2);
console.log("Extracted Context:", { budget: ctx2.budget, features: ctx2.requiredFeatures, pain: ctx2.painPoints });
console.log("Sales Directive:\n", dir2);
console.log("---------------------------------");

console.log("=== Turn 3: Checking duplicate prevention ===");
const dir3 = SalesReasoningEngine.generateDirective(ctx2);
console.log("Duplicate Check included?:", dir3.includes("already know their budget"));
console.log("---------------------------------");
