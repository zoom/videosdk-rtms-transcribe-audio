import type { Metadata } from "@zoom/rtms";
import type { SampleAudioPacket } from "./util.ts";

// Keep the SDK's original metadata and expose its participant fields under
// the RTMS wire names recognized by Scribe. Mixed audio retains user_id: 0.
export function toScribeAudio(
  data: Buffer,
  size: number,
  timestamp: number,
  metadata: Metadata & Record<string, unknown>,
): SampleAudioPacket["content"] {
  return {
    ...metadata,
    user_id: metadata.userId,
    user_name: metadata.userName,
    timestamp,
    data: data.subarray(0, size).toString("base64"),
  };
}
