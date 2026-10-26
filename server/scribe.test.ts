import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocketServer, type RawData } from "ws";
import { ScribeSession } from "./scribe.ts";
import { generateScribeToken } from "./util.ts";
import crypto from "node:crypto";

test("signs short-lived Scribe JWTs with the API key as issuer", () => {
  const [header, payload, signature] = generateScribeToken("test-api-key", "test-secret").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, "test-api-key");
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.iat <= now && claims.iat >= now - 31);
  assert.ok(claims.exp > now && claims.exp <= now + 1800);
  assert.equal(signature, crypto.createHmac("sha256", "test-secret").update(`${header}.${payload}`).digest("base64url"));
});

async function mockScribe() {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `ws://127.0.0.1:${address.port}` };
}

test("keeps an idle audio stream alive with PCM silence", { timeout: 5000 }, async (t) => {
  const { server, url } = await mockScribe();
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  const connection = once(server, "connection");
  const session = new ScribeSession({ token: "test", url, onTranscript: () => {}, onFailure: () => assert.fail("Unexpected failure") });
  t.after(() => session.close());
  const [socket] = await connection;
  await once(socket, "message");
  socket.send(JSON.stringify({ type: "session.updated" }));
  await session.ready;
  const [data, binary] = await once(socket, "message");
  assert.equal(binary, true);
  assert.deepEqual(Buffer.from(data), Buffer.alloc(3200));
  const closeRequest = once(socket, "message");
  session.close();
  assert.equal(JSON.parse((await closeRequest)[0].toString()).type, "session.close");
  socket.send(JSON.stringify({ type: "session.closed" }));
  await once(socket, "close");
});

test("configures Scribe, forwards binary audio and metadata, and drains final results", { timeout: 5000 }, async (t) => {
  const { server, url } = await mockScribe();
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  const connection = once(server, "connection");
  const transcripts: string[] = [];
  let failures = 0;
  const session = new ScribeSession({ token: "test-key", url, onTranscript: (text) => transcripts.push(text), onFailure: () => failures++ });
  t.after(() => session.close());
  const [socket, request] = await connection;
  assert.equal(request.headers.authorization, "Bearer test-key");
  assert.equal(request.headers["sec-websocket-protocol"], "live-asr");
  const [config] = await once(socket, "message");
  assert.deepEqual(JSON.parse(config.toString()), {
    type: "session.update",
    config: { language: "en-US", model: "zoom-scribe-multilingual" },
    audio: { format: "pcm16" },
  });
  socket.send(JSON.stringify({ type: "session.updated" }));
  await session.ready;
  const sources = [
    { user_id: 0 },
    { user_id: 16778240, user_name: "John Smith" },
    { channel_id: "123abc", custom_context: { queue: "support" } },
    {},
  ];
  const pcm = Buffer.alloc(70000, 42); // Larger than Scribe's 64 KiB frame limit
  const chunks = Math.ceil(pcm.length / 3200);
  const frames: { data: Buffer; binary: boolean }[] = [];
  const received = new Promise<void>((resolve) => socket.on("message", (data: RawData, binary: boolean) => {
    frames.push({ data: Buffer.from(data as Buffer), binary });
    if (frames.length === sources.length * chunks * 2) resolve();
  }));
  for (const source of sources) {
    session.sendAudio({ data: pcm.toString("base64"), timestamp: 123456, ...source });
  }
  await received;
  for (const [index, source] of sources.entries()) {
    const receivedAudio: Buffer[] = [];
    for (let chunk = 0; chunk < chunks; chunk++) {
      const frameIndex = (index * chunks + chunk) * 2;
      const metadataFrame = frames[frameIndex];
      const audioFrame = frames[frameIndex + 1];
      assert.equal(metadataFrame.binary, false);
      assert.deepEqual(JSON.parse(metadataFrame.data.toString()), {
        type: "input_audio_buffer.append", timestamp: 123456, metadata: source,
      });
      assert.equal(audioFrame.binary, true);
      assert.ok(audioFrame.data.length <= 3200);
      receivedAudio.push(audioFrame.data);
    }
    assert.deepEqual(Buffer.concat(receivedAudio), pcm);
  }
  const closeRequest = once(socket, "message");
  session.close();
  session.close();
  assert.deepEqual(JSON.parse((await closeRequest)[0].toString()), { type: "session.close" });
  socket.send(JSON.stringify({ type: "transcription.delta", delta: "partial" }));
  socket.send(JSON.stringify({ type: "transcription.completed", transcript: " Final result. " }));
  socket.send(JSON.stringify({ type: "session.closed" }));
  await once(socket, "close");
  assert.deepEqual(transcripts, ["Final result."]);
  assert.equal(failures, 0);
});

test("rejects readiness and reports fatal configuration errors", { timeout: 5000 }, async (t) => {
  const { server, url } = await mockScribe();
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  const connection = once(server, "connection");
  let failures = 0;
  const session = new ScribeSession({ token: "invalid", url, onTranscript: () => assert.fail("Unexpected transcript"), onFailure: () => failures++ });
  const rejected = assert.rejects(session.ready, /unauthorized/);
  const [socket] = await connection;
  await once(socket, "message");
  socket.send(JSON.stringify({ type: "error", error: { code: "unauthorized", message: "Invalid credential", fatal: true } }));
  await rejected;
  assert.equal(failures, 1);
});

test("stopping during setup rejects readiness without waiting for configuration", { timeout: 5000 }, async (t) => {
  const { server, url } = await mockScribe();
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  const connection = once(server, "connection");
  const session = new ScribeSession({ token: "test", url, onTranscript: () => {}, onFailure: () => assert.fail("Intentional stop is not a failure") });
  const rejected = assert.rejects(session.ready, /stopped before Scribe was ready/);
  const [socket] = await connection;
  await once(socket, "message");
  session.close();
  await rejected;
});
