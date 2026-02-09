import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import WebSocket from "ws";
import { whisper } from "whisper-node";
import { bufferToWaveFile, formatTranscript, generateSignatureForWebApp, type SampleAudioPacket, type SampleTranscript } from "./util.ts";
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
let transcriptBuffer = Buffer.alloc(0);

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
  } else if (event === "session.rtms_stopped") {
    const { session_id } = payload;
    console.log(`Stopping RTMS for Video session ${session_id}`);
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
        connectToMediaWebSocket(
          mediaUrl,
          session_id,
          rtmsStreamId,
          signalingWs,
        );
      }
    }
  });

  signalingWs.on("error", (error) => {
    console.error("Signaling WebSocket error:", error);
  });

  signalingWs.on("close", (code, reason) => {
    console.log("Signaling WebSocket closed:", code, reason);
  });
}

function connectToMediaWebSocket(
  mediaUrl: string,
  session_id: string,
  rtmsStreamId: string,
  signalingSocket: WebSocket,
) {
  const mediaWs = new WebSocket(mediaUrl, [], { rejectUnauthorized: false });

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
          content_type: 1, //RTP
          sample_rate: 1, //16k
          channel: 1, //mono
          codec: 1, //L16
          data_opt: 1, //AUDIO_MIXED_STREAM
          send_rate: 1000, //in Milliseconds
        },
      },
    };

    mediaWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.msg_type === 14) {
        // AUDIO
        if (msg.content?.data) {
          const { data: audioData } =
            msg.content as SampleAudioPacket["content"];
          const buffer = Buffer.from(audioData, "base64");
          void transcribeAudio(buffer);
        }
      } else if (msg.msg_type === 4 && msg.status_code === 0) {
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

const getTranscriptFromBuffer = async (buffer: Buffer<ArrayBuffer>) => {
  const bufferCopy = Buffer.from(buffer);
  const wavePath = await bufferToWaveFile(bufferCopy);
  const transcript: SampleTranscript = await whisper(wavePath, {
    modelName: "base.en",
  });
  console.log("*** Transcript ***\n", transcript);
  // delete file after transcribing
  fs.unlinkSync(wavePath);
  appendTranscriptToFile(transcript);
  console.log(transcript);
};

const appendTranscriptToFile = (transcript: SampleTranscript) => {
  if (!fs.existsSync(path.join(process.cwd(), "transcript.txt"))) {
    fs.writeFileSync(path.join(process.cwd(), "transcript.txt"), "");
  }
  fs.appendFileSync(
    path.join(__dirname, "transcript.txt"),
    formatTranscript(transcript),
  );
};

const transcribeAudio = async (buffer: Buffer<ArrayBuffer>) => {
  transcriptBuffer = Buffer.concat([transcriptBuffer, buffer]);
  if (transcriptBuffer.length >= 16000 * 10) {
    void getTranscriptFromBuffer(transcriptBuffer);
    transcriptBuffer = Buffer.alloc(0);
  }
};

if (!ZoomClientId || !ZoomClientSecret || !ZoomSecretToken) {
  console.error("Missing required environment variables:");
  if (!ZoomClientId) console.error("  - VITE_SDK_KEY");
  if (!ZoomClientSecret) console.error("  - VITE_SDK_SECRET");
  if (!ZoomSecretToken) console.error("  - ZOOM_SECRET_TOKEN");
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