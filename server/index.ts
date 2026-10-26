import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import rtms from "@zoom/rtms";
import express from "express";
import { ScribeSession } from "./scribe.ts";
import { toScribeAudio } from "./rtms-audio.ts";
import { generateScribeToken, generateSignatureForWebApp } from "./util.ts";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ quiet: true, path: path.join(serverDir, "..", ".env") });
const sdkKey = process.env.ZM_RTMS_CLIENT;
const sdkSecret = process.env.ZM_RTMS_SECRET;
const webhookSecret = process.env.ZOOM_SECRET_TOKEN;
const scribeToken = process.env.ZOOM_ACCESS_TOKEN;
const apiKey = process.env.ZOOM_API_KEY;
const apiSecret = process.env.ZOOM_API_SECRET;
const port = Number(process.env.VITE_PORT || 3000);

if (!sdkKey || !sdkSecret || !webhookSecret || (!scribeToken && !(apiKey && apiSecret))) {
  console.error("Set ZM_RTMS_CLIENT, ZM_RTMS_SECRET, ZOOM_SECRET_TOKEN, and either ZOOM_ACCESS_TOKEN or both ZOOM_API_KEY and ZOOM_API_SECRET.");
  process.exit(1);
}

type Stream = { sessionId: string; client: InstanceType<typeof rtms.Client>; scribe: ScribeSession };
const streams = new Map<string, Stream>();

function stopStream(id: string, expected?: Stream) {
  const stream = streams.get(id);
  if (!stream || (expected && expected !== stream)) return;
  streams.delete(id);
  stream.scribe.close();
  stream.client.leave();
}

type StartedPayload = { session_id: string; rtms_stream_id: string; server_urls: string };

async function startStream(payload: StartedPayload) {
  const id = payload.rtms_stream_id;
  if (streams.has(id)) return; // Ignore webhook retries for an active stream.
  const client = new rtms.Client();
  const scribe = new ScribeSession({
    token: scribeToken || generateScribeToken(apiKey!, apiSecret!),
    onTranscript: (text) => {
      console.log(`[Scribe ${payload.session_id}] ${text}`);
      fs.appendFileSync(path.join(serverDir, "transcript.txt"), `${text}\n`);
    },
    onFailure: () => stopStream(id, stream),
  });
  const stream: Stream = { sessionId: payload.session_id, client, scribe };
  streams.set(id, stream);
  try {
    await scribe.ready;
    if (streams.get(id) !== stream) return;
    if (!client.setAudioParams({
      contentType: 2, // RAW_AUDIO
      codec: 1, // PCM/L16
      sampleRate: 1, // 16 kHz
      channel: 1, // mono
      dataOpt: 1, // mixed audio; no fabricated participant attribution
      duration: 100,
      frameSize: 1600,
    })) throw new Error("Unable to configure RTMS audio");
    client.onAudioData((data, size, timestamp, metadata) => {
      scribe.sendAudio(toScribeAudio(data, size, timestamp, { ...metadata }));
    });
    client.onJoinConfirm((reason) => {
      if (reason !== 0) {
        console.error(`RTMS join failed (${reason}) for ${id}`);
        stopStream(id, stream);
      }
    });
    client.onSessionUpdate((op) => {
      if (op === rtms.SESSION_EVENT_STOP) stopStream(id, stream);
    });
    if (!client.join({ ...payload, client: sdkKey, secret: sdkSecret })) {
      throw new Error("Unable to join RTMS stream");
    }
  } catch (error) {
    console.error(`Unable to start RTMS/Scribe stream ${id}:`, error);
    stopStream(id, stream);
  }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.get("/", (_req, res) => res.send("RTMS SDK + Scribe sample server running."));
app.post("/webhook", (req, res) => {
  const { event, payload } = req.body;
  if (event === "endpoint.url_validation" && typeof payload?.plainToken === "string") {
    return res.json({
      plainToken: payload.plainToken,
      encryptedToken: crypto.createHmac("sha256", webhookSecret).update(payload.plainToken).digest("hex"),
    });
  }
  if (event === "session.rtms_started") {
    if (!payload?.session_id || !payload?.rtms_stream_id || !payload?.server_urls) {
      return res.status(400).json({ error: "Missing RTMS connection details" });
    }
    res.sendStatus(200);
    void startStream(payload).catch((error) => console.error("RTMS startup failed:", error));
    return;
  }
  res.sendStatus(200);
  if (event === "session.rtms_stopped" || event === "session.rtms_interrupted") {
    for (const [id, stream] of streams) {
      if (payload?.rtms_stream_id ? id === payload.rtms_stream_id : stream.sessionId === payload?.session_id) {
        stopStream(id, stream);
      }
    }
  }
});
app.post("/jwt", (req, res) => {
  const { sessionName } = req.body;
  if (typeof sessionName !== "string" || !sessionName.trim()) {
    res.status(400).json({ error: "Session name is required" });
    return;
  }
  res.json({ jwt: generateSignatureForWebApp(sessionName, sdkKey, sdkSecret) });
});
app.listen(port, () => console.log(`Server is running on port ${port}`));
