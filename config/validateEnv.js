import { env } from "./env.js";

export function validateEnv() {
  const requiredVars = [
    "DEEPGRAM_API_KEY",
    "ANTHROPIC_API_KEY",
    "CARTESIA_API_KEY",
    "CARTESIA_VOICE_ID"
  ];

  const missingVars = requiredVars.filter(
    (key) => !env[key]
  );

  if (missingVars.length > 0) {
    console.error("\n❌ Missing environment variables:");
    
    missingVars.forEach((variable) => {
      console.error(`- ${variable}`);
    });

    process.exit(1);
  }

  console.log("✅ Environment validation passed");
}