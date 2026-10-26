import WebSocket from "ws";
import type { SampleAudioPacket } from "./util.ts";

type Options = {
  token: string;
  onTranscript: (text: string) => void;
  onFailure: () => void;
  // Override only for local protocol tests.
  url?: string;
};

export class ScribeSession {
  readonly ready: Promise<void>;
  private socket: WebSocket;
  private configured = false;
  private closing = false;
  private timer: ReturnType<typeof setTimeout>;
  private rejectReady!: (error: Error) => void;
  private silenceTimer?: ReturnType<typeof setInterval>;
  private lastAudioAt = Date.now();

  constructor(options: Options) {
    this.socket = new WebSocket(
      options.url ?? "wss://api.zoom.us/v2/aiservices/scribe/live",
      ["live-asr"],
      { headers: { Authorization: `Bearer ${options.token}` }, handshakeTimeout: 10000 },
    );
    let resolveReady!: () => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      this.rejectReady = reject;
    });
    const fail = (error: Error) => {
      if (this.closing) return;
      console.error("[Scribe]", error.message);
      this.rejectReady(error);
      this.closing = true;
      clearTimeout(this.timer);
      clearInterval(this.silenceTimer);
      this.socket.terminate();
      options.onFailure();
    };
    this.timer = setTimeout(() => fail(new Error("Session configuration timed out")), 10000);
    this.socket.on("open", () => {
      this.socket.send(JSON.stringify({
        type: "session.update",
        config: { language: "en-US", model: "zoom-scribe-multilingual" },
        audio: { format: "pcm16" },
      }));
    });
    this.socket.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === "session.updated" && !this.closing) {
          this.configured = true;
          clearTimeout(this.timer);
          // RTMS can omit audio during silence. Keep Scribe's audio stream alive
          // so its idle timeout does not stop a session while nobody is speaking.
          if (!this.silenceTimer) this.silenceTimer = setInterval(() => {
            if (!this.closing && this.socket.readyState === WebSocket.OPEN &&
                Date.now() - this.lastAudioAt > 500 && this.socket.bufferedAmount < 3200) {
              this.socket.send(Buffer.alloc(3200)); // 100 ms of 16 kHz mono PCM16 silence
            }
          }, 100);
          resolveReady();
        } else if (event.type === "transcription.completed") {
          const text = event.transcript?.trim();
          if (text) options.onTranscript(text);
        } else if (event.type === "error") {
          const error = new Error(`${event.error?.code}: ${event.error?.message}`);
          if (event.error?.fatal || !this.configured) fail(error);
          else console.error("[Scribe]", error.message);
        } else if (event.type === "session.closed") {
          if (!this.closing) fail(new Error(`Session closed: ${event.reason}`));
          clearTimeout(this.timer);
          this.socket.close();
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.socket.on("error", fail);
    this.socket.on("close", (code, reason) => {
      clearTimeout(this.timer);
      clearInterval(this.silenceTimer);
      if (!this.closing) fail(new Error(`Connection closed (${code}): ${reason.toString()}`));
    });
  }

  sendAudio(content: SampleAudioPacket["content"]) {
    if (this.closing || !this.configured || this.socket.readyState !== WebSocket.OPEN) return;
    // Bound pending writes if the transcription service cannot keep up.
    if (this.socket.bufferedAmount > 32000 * 10) {
      this.socket.terminate();
      return;
    }
    // Preserve source identities and custom fields without translating them.
    const { data, timestamp, ...metadata } = content;
    this.lastAudioAt = Date.now();
    const audio = Buffer.from(data, "base64");
    // RTMS may batch audio despite the requested send rate. Scribe expects
    // small binary frames; keep each at most 100 ms (3200 bytes).
    for (let offset = 0; offset < audio.length; offset += 3200) {
      this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", timestamp, metadata }));
      this.socket.send(audio.subarray(offset, offset + 3200));
    }
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    clearTimeout(this.timer);
    clearInterval(this.silenceTimer);
    if (!this.configured || this.socket.readyState !== WebSocket.OPEN) {
      this.rejectReady(new Error("Session stopped before Scribe was ready"));
      this.socket.terminate();
      return;
    }
    // Keep reading final transcripts until Scribe acknowledges session.close.
    this.socket.send(JSON.stringify({ type: "session.close" }));
    this.timer = setTimeout(() => this.socket.terminate(), 10000);
  }
}
