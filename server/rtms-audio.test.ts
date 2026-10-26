import assert from "node:assert/strict";
import { test } from "node:test";
import { toScribeAudio } from "./rtms-audio.ts";

test("forwards valid SDK audio bytes, source timestamp, and participant metadata", () => {
  const audio = Buffer.from([0, 128, 255, 127, 42, 42]);
  const packet = toScribeAudio(audio, 4, 123456, {
    userId: 16778240,
    userName: "John Smith",
    channel_id: "123abc",
    context: { queue: "support" },
  });
  assert.deepEqual(Buffer.from(packet.data, "base64"), audio.subarray(0, 4));
  assert.equal(packet.timestamp, 123456);
  assert.equal(packet.user_id, 16778240);
  assert.equal(packet.user_name, "John Smith");
  assert.equal(packet.userId, 16778240);
  assert.equal(packet.userName, "John Smith");
  assert.equal(packet.channel_id, "123abc");
  assert.deepEqual(packet.context, { queue: "support" });
});

test("retains the mixed-stream source identifier without assigning an active speaker", () => {
  const packet = toScribeAudio(Buffer.alloc(3200), 3200, 42, { userId: 0, userName: "" });
  assert.equal(packet.user_id, 0);
  assert.equal(packet.user_name, "");
  assert.equal(packet.timestamp, 42);
});
