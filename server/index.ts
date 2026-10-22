import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import WebSocket from "ws";
import { ScribeSession } from "./scribe.ts";
import { generateScribeToken, generateSignatureForWebApp, type SampleAudioPacket } from "./util.ts";
import express from "express";

const __filename = path.resolve(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);

dotenv.config({
  quiet: true,
  path: path.resolve(__dirname, "..", ".env"),
});

const PORT = process.env.VITE_PORT || 3000;
const ZoomSecretToken = process.env.ZOOM_SECRET_TOKEN as string;
const ZoomClientId = process.env.ZM_RTMS_CLIENT as string;
const ZoomClientSecret = process.env.ZM_RTMS_SECRET as string;
const ScribeToken = process.env.ZOOM_ACCESS_TOKEN as string;
const ScribeApiKey = process.env.ZOOM_API_KEY;
const ScribeApiSecret = process.env.ZOOM_API_SECRET;
type Stream = {
  sessionId: string;
  signaling: WebSocket;
  media?: WebSocket;
  scribe?: ScribeSession;
};
const streams = new Map<string, Stream>();

function stopStream(streamId: string, expected?: Stream) {
  const stream = streams.get(streamId);
  if (!stream || (expected && stream !== expected)) return;
  streams.delete(streamId);
  stream.media?.close();
  stream.signaling.close();
  stream.scribe?.close();
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
app.get("/", (_req, res) => {
  console.log("Root endpoint hit");
  res.send("RTMS for Video SDK Sample Server Running.");
});

app.post("/webhook", (req, res) => {
  const { event, payload } = req.body;
  if (event === "endpoint.url_validation" && payload?.plainToken) {
    const hash = crypto
      .createHmac("sha256", ZoomSecretToken)
      .update(payload.plainToken)
      .digest("hex");
    return res.json({
      plainToken: payload.plainToken,
      encryptedToken: hash,
    });
  }
  res.sendStatus(200);
  if (event === "session.rtms_started") {
    const { session_id, rtms_stream_id, server_urls } = payload;
    console.log("Starting RTMS for session:", { payload });
    connectToSignalingWebSocket(session_id, rtms_stream_id, server_urls);
  } else if (event === "session.rtms_stopped" || event === "session.rtms_interrupted") {
    const { session_id } = payload;
    console.log(`Stopping RTMS for Video session ${session_id}`);
    for (const [id, stream] of streams) {
      if (stream.sessionId === session_id) stopStream(id);
    }
  } else {
    console.log("Unknown event:", event);
  }
});

function generateSignature(sessionID: string, streamId: string) {
  const message = `${ZoomClientId},${sessionID},${streamId}`;
  return crypto
    .createHmac("sha256", ZoomClientSecret)
    .update(message)
    .digest("hex");
}

function connectToSignalingWebSocket(
  session_id: string,
  rtmsStreamId: string,
  serverUrls: string,
) {
  const signalingWs = new WebSocket(serverUrls, [], {
    rejectUnauthorized: false,
  });
  stopStream(rtmsStreamId);
  const stream: Stream = { sessionId: session_id, signaling: signalingWs };
  streams.set(rtmsStreamId, stream);
  signalingWs.on("open", () => {
    try {
      const handshakeMsg = {
        msg_type: 1,
        meeting_uuid: session_id,
        session_id,
        rtms_stream_id: rtmsStreamId,
        signature: generateSignature(session_id, rtmsStreamId),
      };

      signalingWs.send(JSON.stringify(handshakeMsg));
    } catch (err) {
      console.error(
        `[Signaling] Error in WebSocket open handler for ${session_id}: ${err}`,
      );
      signalingWs.close();
    }
  });

  signalingWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.msg_type !== 12) console.log("[RTMS signaling]", JSON.stringify(msg));
    if (msg.msg_type === 12) {
      // KEEP_ALIVE_REQ
      signalingWs.send(
        JSON.stringify({
          msg_type: 13, // KEEP_ALIVE_RESP
          timestamp: msg.timestamp,
        }),
      );
    } else if (msg.msg_type === 2) {
      if (msg.status_code === 0) {
        const mediaUrl = msg.media_server?.server_urls?.audio;
        void connectToMediaWebSocket(
          mediaUrl,
          session_id,
          rtmsStreamId,
          signalingWs,
          stream,
        ).catch((error) => {
          console.error("Unable to start Scribe transcription:", error);
          stopStream(rtmsStreamId, stream);
        });
      }
    }
  });

  signalingWs.on("error", (error) => {
    console.error("Signaling WebSocket error:", error);
    stopStream(rtmsStreamId, stream);
  });

  signalingWs.on("close", (code, reason) => {
    console.log("Signaling WebSocket closed:", code, reason);
    stopStream(rtmsStreamId, stream);
  });
}

async function connectToMediaWebSocket(
  mediaUrl: string,
  session_id: string,
  rtmsStreamId: string,
  signalingSocket: WebSocket,
  stream: Stream,
) {
  if (stream.scribe) return;
  const scribe = new ScribeSession({
    token: ScribeToken || generateScribeToken(ScribeApiKey!, ScribeApiSecret!),
    onTranscript: (text) => {
      console.log(`[Scribe ${session_id}] ${text}`);
      fs.appendFileSync(path.join(__dirname, "transcript.txt"), `${text}\n`);
    },
    onFailure: () => stopStream(rtmsStreamId, stream),
  });
  stream.scribe = scribe;
  await scribe.ready;
  if (streams.get(rtmsStreamId) !== stream) return;
  const mediaWs = new WebSocket(mediaUrl, [], { rejectUnauthorized: false });

  stream.media = mediaWs;
  mediaWs.on("error", (error) => {
    console.error("Media WebSocket error:", error);
    stopStream(rtmsStreamId, stream);
  });
  mediaWs.on("close", () => stopStream(rtmsStreamId, stream));
  mediaWs.on("open", () => {
    const handshakeMsg = {
      msg_type: 3, // DATA_HAND_SHAKE_REQ
      protocol_version: 1,
      sequence: 0,
      meeting_uuid: session_id,
      rtms_stream_id: rtmsStreamId,
      signature: generateSignature(session_id, rtmsStreamId),
      media_type: 1, // AUDIO
      payload_encryption: false,
      media_params: {
        audio: {
          content_type: 2, // RAW_AUDIO: PCM/L16 requires raw audio, not RTP
          sample_rate: 1, //16k
          channel: 1, //mono
          codec: 1, //L16
          data_opt: 1, //AUDIO_MIXED_STREAM
          send_rate: 100, //in Milliseconds
        },
      },
    };

    mediaWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.msg_type !== 14 && msg.msg_type !== 12) {
        console.log("[RTMS media]", JSON.stringify(msg));
      }
      if (msg.msg_type === 14) {
        // AUDIO
        if (msg.content?.data) {
          scribe.sendAudio(msg.content as SampleAudioPacket["content"]);
        }
      } else if (msg.msg_type === 4) {
        if (msg.status_code !== 0) {
          console.error(`RTMS media handshake failed (${msg.status_code}): ${msg.reason}`);
          stopStream(rtmsStreamId, stream);
          return;
        }
        signalingSocket.send(
          JSON.stringify({
            msg_type: 7, // CLIENT_READY_ACK
            rtms_stream_id: rtmsStreamId,
          }),
        );
      } else if (msg.msg_type === 12) {
        // KEEP_ALIVE_REQ
        mediaWs.send(
          JSON.stringify({
            msg_type: 13, // KEEP_ALIVE_ACK
            timestamp: msg.timestamp,
          }),
        );
      }
    });
    mediaWs.send(JSON.stringify(handshakeMsg));
  });
}

if (!ZoomClientId || !ZoomClientSecret || !ZoomSecretToken || (!ScribeToken && !(ScribeApiKey && ScribeApiSecret))) {
  console.error("Missing required environment variables:");
  if (!ZoomClientId) console.error("  - ZM_RTMS_CLIENT");
  if (!ZoomClientSecret) console.error("  - ZM_RTMS_SECRET");
  if (!ZoomSecretToken) console.error("  - ZOOM_SECRET_TOKEN");
  if (!ScribeToken && !(ScribeApiKey && ScribeApiSecret)) {
    console.error("  - ZOOM_ACCESS_TOKEN or both ZOOM_API_KEY and ZOOM_API_SECRET");
  }
  process.exit(1);
}

app.post("/jwt", (req, res) => {
  const { sessionName } = req.body;
  if (!sessionName) {
    res.status(400).json({ error: "Session name is required" });
    return;
  }
  res.json({ jwt: generateSignatureForWebApp(sessionName, ZoomClientId, ZoomClientSecret) });
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
