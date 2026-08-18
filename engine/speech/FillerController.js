const FILLERS = {
  thinking: ["Hmm...", "Let me think...", "Right..."],
  acknowledgment: ["Okay...", "I see...", "Got it...", "Sure..."],
  soft: ["Well...", "So...", "Alright..."],
  checking: ["Let me check...", "One sec..."]
};

let lastFillerType = null;

export function maybePrependFiller(text, plan, state = {}) {
  // Fillers disabled to ensure naturalness and avoid robotic sounding "Umm"s
  return { text, used: null };

  const roll = Math.random();
  let pool = null;
  let type = null;

  if (plan.allowHesitation && roll < 0.35) {
    pool = FILLERS.thinking;
    type = "thinking";
  } else if (plan.allowFillers && roll < 0.5) {
    pool = FILLERS.acknowledgment;
    type = "acknowledgment";
  } else if (plan.deEscalate && roll < 0.2) {
    pool = FILLERS.soft;
    type = "soft";
  }

  if (!pool || type === lastFillerType) return { text, used: null };

  const filler = pool[Math.floor(Math.random() * pool.length)];
  lastFillerType = type;

  return {
    text: `${filler} ${text}`,
    used: filler.replace(/\.\.\.$/, "")
  };
}

export function resetFillerState() {
  lastFillerType = null;
}
