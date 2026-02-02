import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { whisper } from "whisper-node";
import rtms, { type WebhookCallback } from "@zoom/rtms";
import { bufferToWaveFile, formatTranscript, type SampleTranscript } from "./util.ts";

dotenv.config({ quiet: true, path: path.join(import.meta.dirname, "..", ".env") });
const zmClient = process.env.VITE_SDK_KEY;
const zmSecret = process.env.VITE_SDK_SECRET
let transcriptBuffer = Buffer.alloc(0);

const RTMSCallback: WebhookCallback = ({ event, payload }) => {
  if (event !== "session.rtms_started") return;
  const client = new rtms.Client();
  client.setAudioParams({
    contentType: 2,
    codec: 1,
    sampleRate: 1,
    channel: 1,
    dataOpt: 1,
    duration: 1000,
    frameSize: 16000,
  })
  client.onAudioData((data) => transcribeAudio(data));
  client.join({ ...payload, client: zmClient, secret: zmSecret });
}
rtms.onWebhookEvent(RTMSCallback);

const getTranscriptFromBuffer = async (buffer: Buffer<ArrayBuffer>) => {
  const bufferCopy = Buffer.from(buffer);
  const wavePath = await bufferToWaveFile(bufferCopy);
  const transcript = await whisper(wavePath, { modelName: "base.en" });
  console.log("*** Transcript ***\n", transcript);
  fs.unlinkSync(wavePath);
  appendTranscriptToFile(transcript);
};

const appendTranscriptToFile = (transcript: SampleTranscript) => {
  if (!fs.existsSync(path.join(process.cwd(), "transcript.txt"))) {
    fs.writeFileSync(path.join(process.cwd(), "transcript.txt"), "");
  }
  fs.appendFileSync(
    path.join(import.meta.dirname, "transcript.txt"),
    formatTranscript(transcript),
  );
};

const transcribeAudio = async (buffer: Buffer<ArrayBufferLike>) => {
  transcriptBuffer = Buffer.concat([transcriptBuffer, buffer]);
  if (transcriptBuffer.length >= 16000 * 10) {
    void getTranscriptFromBuffer(transcriptBuffer);
    transcriptBuffer = Buffer.alloc(0);
  }
};

if (!zmClient || !zmSecret) {
  console.error("Missing Zoom SDK Key / Secret in .env file");
  process.exit(1);
}
