import ZoomVideo, {
  event_peer_video_state_change,
  RealTimeMediaStreamsStatus,
  VideoPlayer,
  VideoQuality,
  RealTimeMediaStreamsClient,
} from "@zoom/videosdk";
import "./style.css";

const PORT = import.meta.env.VITE_PORT || 3000;
const videoContainer = document.querySelector("video-player-container") as HTMLElement;
const sessionName = "TestOne";
const username = `User-${String(new Date().getTime()).slice(6)}`;

const client = ZoomVideo.createClient();
await client.init("en-US", "Global", { patchJsMedia: false });
const RTMSClient = client.getRealTimeMediaStreamsClient() as typeof RealTimeMediaStreamsClient;

const startCall = async (token: string) => {
  client.on("peer-video-state-change", renderVideo);
  client.on("real-time-media-streams-status-change", updateUI);
  await client.join(sessionName, token, username);
  const mediaStream = client.getMediaStream();
  await mediaStream.startAudio({ mute: false });
  await mediaStream.startVideo();
  await renderVideo({
    action: "Start",
    userId: client.getCurrentUserInfo().userId,
  });
};

const renderVideo: typeof event_peer_video_state_change = async (event) => {
  const mediaStream = client.getMediaStream();
  if (event.action === "Stop") {
    const element = await mediaStream.detachVideo(event.userId);
    if (Array.isArray(element)) element.forEach((el) => el.remove());
    else if (element) element.remove();
  } else {
    const userVideo = await mediaStream.attachVideo(event.userId, VideoQuality.Video_720P);
    videoContainer.appendChild(userVideo as VideoPlayer);
  }
};

const leaveCall = async () => {
  const mediaStream = client.getMediaStream();
  for (const user of client.getAllUser()) {
    const element = await mediaStream.detachVideo(user.userId);
    if (Array.isArray(element)) element.forEach((el) => el.remove());
    else if (element) element.remove();
  }
  client.off("peer-video-state-change", renderVideo);
  client.off("real-time-media-streams-status-change", updateUI);
  await client.leave();
};

const startRTMSSession = async () => {
  if (!RTMSClient.isSupportRealTimeMediaStreams()) {
    alert("RTMS not supported. Contact Support to enable.");
    return;
  } else if (!RTMSClient.canStartRealTimeMediaStreams()) {
    alert("RTMS cannot be started by this user");
    return;
  }
  startRTMSBtn.innerHTML = "Loading...";
  startRTMSBtn.disabled = true;
  await RTMSClient.startRealTimeMediaStreams().catch((error) => {
    console.log("error", error);
  });
  startRTMSBtn.innerHTML = "Start RTMS";
  startRTMSBtn.disabled = false;
};

const stopRTMSSession = async () => {
  await RTMSClient.stopRealTimeMediaStreams();
};

// UI Logic
const startBtn = document.querySelector("#start-btn") as HTMLButtonElement;
const stopBtn = document.querySelector("#stop-btn") as HTMLButtonElement;
const startRTMSBtn = document.getElementById("start-rtms-btn") as HTMLButtonElement;
const stopRTMSBtn = document.getElementById("stop-rtms-btn") as HTMLButtonElement;
const statusContainer = document.getElementById("status-container") as HTMLDivElement;

startBtn.addEventListener("click", async () => {
  const token = await getToken();
  if (!token) {
    return;
  }
  startBtn.innerHTML = "Loading...";
  startBtn.disabled = true;
  await startCall(token);
  startBtn.innerHTML = "Connected";
  startBtn.style.display = "none";
  stopBtn.style.display = "block";
  startRTMSBtn.style.display = "block";
});

stopBtn.addEventListener("click", async () => {
  stopBtn.innerHTML = "Loading...";
  stopBtn.disabled = true;
  await leaveCall();
  startBtn.style.display = "block";
  startBtn.innerHTML = "Join Session";
  startBtn.disabled = false;
  startRTMSBtn.style.display = "none";
});

startRTMSBtn.addEventListener("click", startRTMSSession);
stopRTMSBtn.addEventListener("click", stopRTMSSession);

const updateUI = () => {
  const RTMSStatus = RTMSClient.getRealTimeMediaStreamsStatus();
  if (RTMSStatus === RealTimeMediaStreamsStatus.Start) {
    statusContainer.innerHTML = "RTMS Session Started";
    startRTMSBtn.style.display = "none";
    stopRTMSBtn.style.display = "block";
  } else {
    statusContainer.innerHTML =
      "RTMS Session Status: " + RealTimeMediaStreamsStatus[RTMSStatus];
    startRTMSBtn.style.display = "block";
    stopRTMSBtn.style.display = "none";
  }
};

const getToken = async () => {
  const token = await fetch(`http://localhost:${PORT}/jwt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionName: sessionName }),
  }).then(res => res.json()).then(data => data.jwt);
  if (!token) {
    alert("Failed to get token");
    return;
  }
  return token;
}