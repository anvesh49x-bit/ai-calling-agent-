/**
 * ResponseParser
 * Ensures LLM outputs are safely parsed, stripped of JSON/markdown artifacts,
 * and always return valid spoken text to prevent TTS crashes.
 */
export class ResponseParser {
  /**
   * Safely parses the LLM output string.
   * @param {string} rawText The raw string from the LLM
   * @returns {{ segments: Array<{text: string, pause_ms: number}>, fullText: string }}
   */
  static parse(rawText) {
    if (!rawText || typeof rawText !== "string") {
      return this.fallback();
    }

    let text = rawText.trim();

    // 1. Strip markdown code blocks
    text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsedObj = null;

    // 3. Fallback to regex extraction for broken/partial JSON
    try {
      parsedObj = JSON.parse(text);
    } catch (e) {
      parsedObj = this.extractFromPartial(text);
    }

    if (Array.isArray(parsedObj)) {
      const texts = parsedObj.map(s => s.text || s.full_text).filter(Boolean);
      if (texts.length > 0) {
        parsedObj = { segments: parsedObj, full_text: texts.join(" ") };
      }
    }

    // 4. If we still don't have a valid object, treat the raw string as plain text
    if (!parsedObj || typeof parsedObj !== "object" || Array.isArray(parsedObj)) {
      parsedObj = { full_text: text };
    }

    // 5. Clean up the extracted text
    const fullText = this.cleanSpokenText(
      parsedObj.full_text ||
      (Array.isArray(parsedObj.segments) ? parsedObj.segments.map(s => s.text).join(" ") : text)
    );

    if (!fullText) {
      return this.fallback();
    }

    // 6. Normalize segments
    let segments = [];
    if (Array.isArray(parsedObj.segments) && parsedObj.segments.length > 0) {
      segments = parsedObj.segments.map(s => ({
        text: this.cleanSpokenText(s.text || ""),
        pause_ms: Number(s.pause_ms) || 0,
        stress: s.stress || null
      })).filter(s => s.text.length > 0);
    }

    if (segments.length === 0) {
      segments = [{ text: fullText, pause_ms: 0, stress: null }];
    }

    return { segments, fullText };
  }

  static extractFromPartial(text) {
    // Attempt to extract "full_text": "..." or "text": "..." using regex
    const fullTextMatch = text.match(/"full_text"\s*:\s*"([^"]+)"/i);
    if (fullTextMatch) {
      return { full_text: fullTextMatch[1] };
    }

    const segments = [];
    const textRegex = /"text"\s*:\s*"([^"]+)"/gi;
    let match;
    while ((match = textRegex.exec(text)) !== null) {
      segments.push({ text: match[1], pause_ms: 0 });
    }

    if (segments.length > 0) {
      return { segments, full_text: segments.map(s => s.text).join(" ") };
    }

    return null;
  }

  static cleanSpokenText(text) {
    if (!text || typeof text !== "string") return "";

    let clean = text;

    // Strip JSON structure artifacts that might have leaked
    clean = clean.replace(/"segments"\s*:/gi, "");
    clean = clean.replace(/"full_?text"\s*:/gi, "");
    clean = clean.replace(/"text"\s*:/gi, "");
    clean = clean.replace(/"pause_ms"\s*:\s*\d+/gi, "");
    clean = clean.replace(/[\{\}\[\]]/g, ""); // strip raw braces/brackets
    clean = clean.replace(/\n/g, " "); // replace actual newlines
    clean = clean.replace(/\\n/g, " "); // replace literal \n
    
    // Strip punctuation usually seen in broken JSON
    clean = clean.replace(/["']/g, ""); // Remove all quotes
    clean = clean.replace(/^[,]+/g, ""); // Leading commas
    clean = clean.replace(/[,]+$/g, ""); // Trailing commas
    
    // Remove markdown
    clean = clean.replace(/[*_#`~>]/g, "");

    // Clean multiple spaces
    clean = clean.replace(/\s{2,}/g, " ").trim();

    return clean;
  }

  static fallback() {
    const text = "Sorry, could you repeat that?";
    return {
      segments: [{ text, pause_ms: 0, stress: null }],
      fullText: text
    };
  }
}
