# Video SDK transcription with the RTMS SDK and Scribe

Use of this sample app is subject to our [Terms of Use](https://explore.zoom.us/en/video-sdk-terms/).

This sample uses [Zoom Video SDK for Web](https://developers.zoom.us/docs/video-sdk/web/) to join a video session, the [Zoom RTMS SDK for Node.js](https://github.com/zoom/rtms) to receive its audio on a Node.js backend, and [Zoom Scribe Live](https://developers.zoom.us/docs/ai-services/scribe/live-mode/) to transcribe it. Completed transcripts are logged to the server console and appended to `server/transcript.txt`.

This is the `sdk` branch. The RTMS SDK manages the signaling and media WebSockets; Scribe handles speech recognition.

## Prerequisites

- Node.js compatible with Vite 7 (20.19+ or 22.12+). The native RTMS SDK supports macOS and Linux; its platform binary is installed by the package install script.
- Zoom Video SDK credentials for an account with RTMS enabled.
- Zoom AI Services credentials with access to Scribe Live. These are separate from the Video SDK credentials.
- A public HTTPS endpoint for Zoom webhooks. For local development, use a tunnel to the backend.
- Network access to Zoom RTMS servers and `wss://api.zoom.us/v2/aiservices/scribe/live`.

## Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone --branch sdk https://github.com/zoom/videosdk-rtms-transcribe-audio.git
   cd videosdk-rtms-transcribe-audio
   npm install
   ```

   You can also install dependencies with `bun install`; `@zoom/rtms` is listed in `trustedDependencies` so its native install script can run. Do not skip install scripts when preparing a live RTMS server.

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

   Fill in your credentials and choose the backend port:

   ```dotenv
   ZM_RTMS_CLIENT=your_video_sdk_key
   ZM_RTMS_SECRET=your_video_sdk_secret
   ZOOM_SECRET_TOKEN=your_webhook_secret_token
   ZOOM_API_KEY=your_ai_services_api_key
   ZOOM_API_SECRET=your_ai_services_api_secret
   VITE_PORT=4000
   ```

   `ZM_RTMS_CLIENT` and `ZM_RTMS_SECRET` sign Video SDK session tokens and RTMS handshakes. `ZOOM_SECRET_TOKEN` signs webhook endpoint-validation challenges. Obtain AI Services credentials through your Zoom app or [Platform Studio](https://platform.zoom.us/); see [Zoom AI Services authentication](https://developers.zoom.us/docs/ai-services/auth/).

   The server signs a fresh, short-lived AI Services JWT for each Scribe connection. Alternatively, set `ZOOM_ACCESS_TOKEN` to a supported bearer API key or pre-generated JWT. When set, it takes precedence over `ZOOM_API_KEY` and `ZOOM_API_SECRET`. Refresh pre-generated JWTs before they expire.

   `VITE_PORT` configures the backend port and the browser's token endpoint; it does not change Vite's web port. The backend defaults to `3000` when omitted. Restart the app after changing `.env`.

3. Start the web app and backend:

   ```bash
   npm run dev
   ```

   Alternatively, run `bun dev`. Vite normally serves the app at `http://localhost:5173`; use the URL printed in the terminal if that port is occupied. With the configuration above, the backend listens on `http://localhost:4000`.

4. In a separate terminal, start a public HTTPS tunnel to the backend. For example, with cloudflared installed:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

   Keep both the app and the tunnel running. Quick tunnels can receive a different hostname when restarted; update the Zoom webhook subscription whenever that happens.

5. The SDK branch previously used a separate webhook listener (port `8080`, path `/`). This version serves `/webhook` and `/jwt` on the same backend port; update existing tunnel and subscription settings accordingly. `ZM_RTMS_PORT` and `ZM_RTMS_PATH` no longer configure the sample’s Express listener.

6. Open the Video SDK app matching `ZM_RTMS_CLIENT` in [Zoom App Marketplace](https://marketplace.zoom.us/). Under **Event Subscription**:

   - Enable event subscriptions and add `session.rtms_started` and `session.rtms_stopped`. Optionally add `session.rtms_interrupted` for cleanup when a stream is interrupted.
   - Set the notification endpoint to `https://<your-tunnel-hostname>/webhook`.
   - Click **Validate**, confirm it succeeds, and click **Save**.
   - Allow 1–2 minutes for subscription changes to propagate, then rejoin the Video SDK session before retrying RTMS.

   The backend handles webhook requests at `/webhook`. Its `/` route is a health check; `/jwt` issues Video SDK session tokens. Point the tunnel to the backend port, not Vite's port.

## Run a live transcription

1. Open the Vite URL and click **Join Session**. Allow microphone and camera access when prompted.
2. Click **Start RTMS** and wait for **RTMS Session Started**.
3. Speak into the microphone. Completed transcripts appear in the server console and `server/transcript.txt`, one result per line.
4. Click **Stop RTMS** to stop transcription, or **Leave Session** to leave the call.

The sample uses the fixed session name `TestOne` in `web/main.ts`. Transcripts from all streams append to the same output file. Generated transcripts can contain private conversation content; keep them out of commits.

## Audio and metadata handling

Each RTMS stream gets its own Scribe connection using `zoom-scribe-multilingual` with `en-US` as the initial language. The SDK client requests **raw PCM/L16**, 16 kHz, mono audio at a 100 ms send rate. PCM/L16 requires `content_type: 2` (`RAW_AUDIO`); requesting RTP with that codec causes an `Invalid audio codec` error.

The SDK supplies raw audio through `onAudioData(buffer, size, timestamp, metadata)`. The adapter uses only the reported byte count and splits audio into binary frames of at most 3,200 bytes (100 ms). Before each frame, it sends an `input_audio_buffer.append` event with the source timestamp and metadata. SDK metadata is preserved, including custom fields. The adapter also exposes `userId` and `userName` as `user_id` and `user_name` for Scribe’s RTMS context. Mixed audio keeps `user_id: 0`; the sample does not label it with the active speaker. Source identities are not translated into a Scribe-specific participant model. The output file stores only completed transcript text, not metadata or partial captions.

When RTMS omits audio during silence, the backend sends silent PCM frames to keep the Scribe connection active. On shutdown, it requests remaining transcript results and waits for Scribe to close the session, with a 10-second fallback timeout. Fatal Scribe errors close that stream; automatic reconnection is not implemented. See [Scribe Live session limits](https://developers.zoom.us/docs/ai-services/scribe/live-mode/#session-limits) for service limits.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `NoSubscription` or `INTERNAL_ERROR` when starting RTMS | Confirm the correct Video SDK app has the RTMS events selected, the endpoint is validated, and the subscription is saved. Check that the public hostname still resolves and the backend receives the start webhook. After changes propagate, leave and rejoin the session. |
| Tunnel reports `connect: connection refused` on port 4000 | Start the backend and ensure `VITE_PORT` matches the tunnel's origin port. Test `http://localhost:4000/`; it should return the sample server's status message. |
| Tunnel hostname no longer resolves | Restart the tunnel, replace the endpoint URL in Zoom, validate it, and save the subscription. |
| Webhook URL validation fails | Check the `/webhook` path, tunnel reachability, and `ZOOM_SECRET_TOKEN`. Visiting `/webhook` with a browser GET is not a validation test; Zoom sends a POST challenge. |
| RTMS media handshake returns `Invalid audio codec` | Use `RAW_AUDIO` (`content_type: 2`) with PCM/L16 (`codec: 1`). Check RTMS SDK diagnostics and the server’s join-failure logs. |
| Scribe returns `401` | Check the AI Services credentials and access to Scribe Live. A legacy API key/secret pair needs a signed JWT; use `ZOOM_API_KEY` and `ZOOM_API_SECRET` so the server generates it. Clear an outdated `ZOOM_ACCESS_TOKEN` override. |
| No transcript after RTMS starts | Check microphone input and the backend logs for media-handshake or Scribe errors. The page displays RTMS status; transcripts are written on the backend. |

## Validation

Run the local protocol tests and build checks:

```bash
npm test
npx tsc --noEmit
npx vite build
```

The tests use a local mock WebSocket server and do not require Zoom credentials. They cover JWT signing, session configuration, SDK callback metadata and byte counts, oversized audio packets, idle audio, final-result draining, fatal errors, and stopping during setup. An end-to-end test requires valid credentials, a reachable webhook tunnel, and an active Video SDK RTMS session.

## Need help?

See the [Video SDK documentation](https://developers.zoom.us/docs/video-sdk/web/), [RTMS documentation](https://developers.zoom.us/docs/rtms/video-sdk/), and [Scribe Live documentation](https://developers.zoom.us/docs/ai-services/scribe/live-mode/). For support, visit [Developer Support](https://devsupport.zoom.us) or the [Developer Forum](https://devforum.zoom.us).

## Disclaimer

This is a local development sample. Keep credentials on the backend, use placeholders in shared configuration, and never commit `.env` or generated transcripts. Production deployments need authenticated token issuance, verification of incoming webhook signatures, appropriate access controls, and normal TLS certificate validation. The RTMS SDK uses its default certificate verification.
