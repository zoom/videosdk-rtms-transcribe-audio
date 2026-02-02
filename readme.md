# Video SDK transcription with RTMS

Use of this sample app is subject to our [Terms of Use](https://explore.zoom.us/en/video-sdk-terms/).

The [Zoom Video SDK for Web](https://developers.zoom.us/docs/video-sdk/web/) enables you to build custom video experiences on a webpage with Zoom's core technology. This demo showcases how to use [Video SDK RTMS Streams](https://developers.zoom.us/docs/rtms/video-sdk/) to receive real-time audio from Zoom on your backend server. The server then runs a Whisper model for transcription and outputs the result to a file.

## Installation

To get started, clone the repo:

`git clone https://github.com/zoom/zoom-rtms-transcribe-audio.git`


## Setup

1. Install the dependencies:

`bun install # or npm install`

2. Create a `.env` file in the root directory of the project, you can do this by copying the `.env.example` file (`cp .env.example .env`) and replacing the values with your own. The `.env` file should look like this, with your own Zoom Video SDK Credentials:
```
VITE_SDK_KEY=abc123XXXXXXXXXX
VITE_SDK_SECRET=abc123XXXXXXXXXX
```

3. Run the app:

`bun dev` or `npm run dev`

## Usage

1. Navigate to http://localhost:5173

2. Click "Join" to join the session

3. Click "Start RTMS" to start the RTMS session

4. As you speak, the server will receive RTMS Webhooks containing the audio with your speech. The server will then transcrive the audio to text and output the results to the console and in `/server/transcript.txt`.

For more information, check out our [Video SDK](https://developers.zoom.us/docs/video-sdk/web/) and our [RTMS docs](https://developers.zoom.us/docs/rtms/video-sdk/).

## Need help?

If you're looking for help, try [Developer Support](https://devsupport.zoom.us) or our [Developer Forum](https://devforum.zoom.us). Priority support is also available with [Premier Developer Support](https://explore.zoom.us/docs/en-us/developer-support-plans.html) plans.

## Disclaimer

Do not expose your credentials to the client, when using the Video SDK in production please make sure to use a backend service to sign the tokens. Don't store credentials in plain text, as this is a sample app we're using an `.env` for sake of simplicity.
