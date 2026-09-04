// Web Audio API: sample-accurate playback (no MP3 seek drift)
let audioCtx = null;
let audioBuffer = null;
let currentSource = null;
let sourceStartTime = 0;
let sourceOffset = 0;
let pausedAt = 0;
let audioReady = false;

// iOS silent mode unlock: hidden silent audio triggers Playback session category
let silentAudio = null;
let iosSessionUnlocked = false;

function unlockIOSAudioSession() {
  if (iosSessionUnlocked) return;
  if (!silentAudio) {
    silentAudio = document.getElementById('silentAudio');
    if (!silentAudio) return;
    silentAudio.src = SILENT_AUDIO_SRC;
    silentAudio.volume = 0.0001;
  }
  silentAudio.play().then(() => { iosSessionUnlocked = true; }).catch(() => {});
}

async function initAudio(audioUrl) {
  try {
    // Decode audio with a temp context (real context created in user gesture)
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();
    audioReady = true;
  } catch(e) {
    console.error('Audio decode failed:', e);
    alert('音频加载失败，请刷新页面重试');
  }
}

function stopCurrentSource() {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop(); } catch(e) {}
    currentSource = null;
  }
}

function getPlaybackPosition() {
  if (!isPlaying || !currentSource || !audioCtx) return pausedAt;
  return sourceOffset + (audioCtx.currentTime - sourceStartTime) * playbackRate;
}

function startPlayback(offset, duration) {
  stopCurrentSource();
  unlockIOSAudioSession();
  if (!audioReady || !audioBuffer) return;

  // Create AudioContext inside user gesture (iOS requirement)
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  currentSource = audioCtx.createBufferSource();
  currentSource.buffer = audioBuffer;
  currentSource.playbackRate.value = playbackRate;
  currentSource.connect(audioCtx.destination);
  sourceStartTime = audioCtx.currentTime;
  sourceOffset = offset;
  currentSource.onended = () => {
    if (isPlaying) {
      isPlaying = false;
      currentSource = null;
      setTimeout(() => { if (!isMyTurn) playSentence(currentIndex + 1); }, 150);
    }
  };
  currentSource.start(0, offset, Math.max(0.01, duration));
  isPlaying = true;
  updatePlayButton();
}
