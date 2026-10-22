# Video SDK transcription with RTMS

Use of this sample app is subject to our [Terms of Use](https://explore.zoom.us/en/video-sdk-terms/).

The [Zoom Video SDK for Web](https://developers.zoom.us/docs/video-sdk/web/) enables you to build custom video experiences on a webpage with Zoom's core technology. This demo showcases how to use [Video SDK RTMS Streams](https://developers.zoom.us/docs/rtms/video-sdk/) to receive real-time audio from Zoom on your backend server. The server streams the audio to [Zoom Scribe Live](https://developers.zoom.us/docs/ai-services/scribe/live-mode/) for transcription and writes completed transcripts to `server/transcript.txt`. No local speech model or temporary WAV files are needed.

You can also use the [RTMS SDK](https://github.com/zoom/rtms) which makes this much simpler. The [SDK branch](https://github.com/zoom/videosdk-rtms-transcribe-audio/tree/sdk) contains the code for this project built with the RTMS SDK.

## Installation

To get started, clone the repo:

`git clone https://github.com/zoom/zoom-rtms-transcribe-audio.git`

## Setup

1. Install the dependencies:

`bun install # or npm install`

2. Create a `.env` file in the root directory of the project, you can do this by copying the `.env.example` file (`cp .env.example .env`) and replacing the values with your own. The `.env` file should look like this, with your own Zoom Video SDK and [Zoom AI Services credentials](https://developers.zoom.us/docs/ai-services/auth/):
```
ZM_RTMS_CLIENT=abc123XXXXXXXXXX
ZM_RTMS_SECRET=abc123XXXXXXXXXX
ZOOM_SECRET_TOKEN=your_webhook_secret_token
ZOOM_ACCESS_TOKEN=your_zoom_ai_services_api_key_or_jwt
```

3. Create a Zoom AI Services API key with access to Scribe Live in [Platform Studio](https://platform.zoom.us/), or use an AI Services JWT. Set it as `ZOOM_ACCESS_TOKEN`; this credential is separate from the Video SDK key and secret. Replace expiring JWTs before starting new streams.

4. Configure your Video SDK webhook subscription for `session.rtms_started` and `session.rtms_stopped`, pointing to the server's publicly reachable HTTPS `/webhook` endpoint (for example, through a development tunnel to port 3000). Set `ZOOM_SECRET_TOKEN` to the webhook secret token.

5. Run the app:

`bun dev` or `npm run dev`

## Usage

1. Navigate to http://localhost:5173

2. Click "Join" to join the session

3. Click "Start RTMS" to start the RTMS session

4. As you speak, the RTMS start webhook opens an audio WebSocket on the server. Each stream gets its own Scribe Live connection using the `zoom-scribe-multilingual` model with `en-US` as the initial language. The server forwards 16 kHz mono PCM16 audio, source timestamps, and participant metadata, then writes completed transcripts to the console and `server/transcript.txt` (one result per line).

5. Click "Stop RTMS" to stop transcription. The server requests Scribe's remaining results before closing the connection. If the service does not close within 10 seconds, the connection is terminated. Transcripts from all streams append to the same file.

Each audio packet is forwarded as a source timestamp and metadata JSON frame followed immediately by its binary PCM audio frame. All source fields other than `data` and `timestamp` pass through unchanged as metadata, including `user_id`, `user_name`, `channel_id`, and custom fields. Source identifiers are optional and are not translated into a separate participant model. Scribe can return this metadata with completed transcription events; this sample saves only the transcript text to the output file.

For more information, check out our [Video SDK](https://developers.zoom.us/docs/video-sdk/web/) and our [RTMS docs](https://developers.zoom.us/docs/rtms/video-sdk/).

## Need help?

If you're looking for help, try [Developer Support](https://devsupport.zoom.us) or our [Developer Forum](https://devforum.zoom.us). Priority support is also available with [Premier Developer Support](https://explore.zoom.us/docs/en-us/developer-support-plans.html) plans.

## Disclaimer

Do not expose your credentials to the client, when using the Video SDK in production please make sure to use a backend service to sign the tokens. Don't store credentials in plain text, as this is a sample app we're using an `.env` for sake of simplicity.
