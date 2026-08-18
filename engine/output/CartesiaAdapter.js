import Cartesia from "@cartesia/cartesia-js";
import { env } from "../../config/env.js";

const client = new Cartesia({ apiKey: env.CARTESIA_API_KEY });

/**
 * TTS adapter — abstracts Cartesia so the engine can swap providers.
 * Cartesia Sonic lacks fine-grained SSML; we maximize expressiveness via
 * segment chunking, punctuation, and inter-chunk pauses.
 */
export class CartesiaAdapter {
  constructor() {
    this.ws = null;
    this.abortController = null;
    this._handleWsError = this._handleWsError.bind(this);
    this._handleWsClose = this._handleWsClose.bind(this);
  }

  async connect() {
    if (this.ws && this.ws.socket?.readyState === 1) return;
    if (this.ws) {
      this.close();
    }

    try {
      this.ws = await client.tts.websocket();
      if (!this.ws) {
        throw new Error("Cartesia returned a null websocket.");
      }
      console.log("🔊 Connected to Cartesia TTS.");

      this.ws.on("error", this._handleWsError);
      if (this.ws.socket?.addEventListener) {
        this.ws.socket.addEventListener("close", this._handleWsClose);
      }
    } catch (err) {
      console.error("❌ Cartesia connect failed:", err);
      this.close();
      throw err;
    }
  }

  _handleWsError(err) {
    console.error("❌ Cartesia websocket error:", err);
  }

  _handleWsClose() {
    console.warn("⚠️ Cartesia websocket closed");
  }

  async speak(twilioWs, streamSid, segments, metadata, signal) {
    await this.connect();
    this.abortController = new AbortController();

    const onAbort = () => this.abortController?.abort();
    signal?.addEventListener("abort", onAbort);

    try {
      for (const segment of segments) {
        if (signal?.aborted) break;

        await this.speakSegment(twilioWs, streamSid, segment, metadata, signal);

        const pauseMs = segment.pause_ms ?? 0;
        if (pauseMs > 0 && !signal?.aborted) {
          await abortableDelay(pauseMs, signal);
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.error("❌ CartesiaAdapter speak error:", err?.message || err);
        throw err;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async speakSegment(twilioWs, streamSid, segment, metadata, signal) {
    try {
      await this.connect();

      if (!this.ws) {
          throw new Error("this.ws is NULL before context()");
      }

      // console.log("typeof context =", typeof this.ws.context);

      const ctx = this.ws.context({
        model_id: "sonic-latest",
        voice: { mode: "id", id: env.CARTESIA_VOICE_ID },
        output_format: {
          container: "raw",
          encoding: "pcm_mulaw",
          sample_rate: 8000
        },
        language: metadata?.cartesia?.language ?? "en"
      });

      await ctx.push({ transcript: segment.text });
      await ctx.no_more_inputs();

      for await (const event of ctx.receive()) {
        if (signal?.aborted) break;

        if (event.type === "chunk" && event.audio) {
          const payload = Buffer.from(event.audio).toString("base64");
          twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload }
            })
          );
        }

        if (event.type === "error") {
          console.error("Cartesia error:", event.message);
          break;
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("❌ Cartesia speakSegment error:", err?.message || err);
      this.close();
      throw err;
    }
  }

  _removeWsListeners() {
    if (!this.ws) return;
    if (typeof this.ws.off === "function") {
      this.ws.off("error", this._handleWsError);
    }
    if (this.ws.socket?.removeEventListener) {
      this.ws.socket.removeEventListener("close", this._handleWsClose);
    }
  }

  abort() {
    this.abortController?.abort();
  }

  close() {
    try {
      this.abortController?.abort();
      this._removeWsListeners();
      this.ws?.close();
    } catch {
      /* ignore */
    } finally {
      this.ws = null;
    }
  }
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Legacy single-text API for test routes */
export async function speakToTwilio(twilioWs, streamSid, text) {
  const adapter = new CartesiaAdapter();
  await adapter.speak(
    twilioWs,
    streamSid,
    [{ text, pause_ms: 0 }],
    { cartesia: { language: "en" } },
    null
  );
  adapter.close();
}
