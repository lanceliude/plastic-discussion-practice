// Main application logic
const TOTAL = dialogues.length;
let currentIndex = 0;
let isPlaying = false;
let isMyTurn = false;
let practiceStarted = false;
let practiceStartTime = null;
let selectedRole = 'Student A';
let practiceMode = 'read';  // 'read' or 'recite'
let playbackRate = 1.0;
let showTranslation = false;
let isHintPressed = false;

// DOM elements
const transcriptEl = document.getElementById('transcript');
const speedRange = document.getElementById('speedRange');
const speedVal = document.getElementById('speedVal');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const playBtn = document.getElementById('playBtn');
const audioBtn = document.getElementById('audioBtn');
const nextBtn = document.getElementById('nextBtn');
const statsModal = document.getElementById('statsModal');
const guideModal = document.getElementById('guideModal');
const roleSeg = document.getElementById('roleSeg');
const modeSeg = document.getElementById('modeSeg');
const myTurnBar = document.getElementById('myTurnBar');
const myTurnText = document.getElementById('myTurnText');
const translateBtn = document.getElementById('translateBtn');

function isMySentence(d) {
  return selectedRole !== 'ALL' && d.role === selectedRole;
}

// localStorage
function loadSettings() {
  try {
    const r = localStorage.getItem('dp_role');
    const s = localStorage.getItem('dp_speed');
    const t = localStorage.getItem('dp_translation');
    const m = localStorage.getItem('dp_mode');
    if (r) selectedRole = r;
    if (s) { playbackRate = parseFloat(s); speedRange.value = s; speedVal.textContent = s + 'x'; }
    if (m) practiceMode = m;
    if (t === 'true') { showTranslation = true; document.body.classList.add('show-zh'); translateBtn.classList.add('active'); }
    else { showTranslation = false; document.body.classList.remove('show-zh'); translateBtn.classList.remove('active'); }
    // speechEnabled is now fully automatic (on in recite mode + my turn, off otherwise)
    speechEnabled = true;
  } catch(e) {}
  updateRoleSegUI();
  updateModeSegUI();
}
function saveRole(v) { try { localStorage.setItem('dp_role', v); } catch(e) {} }
function saveSpeed(v) { try { localStorage.setItem('dp_speed', v); } catch(e) {} }
function saveMode(v) { try { localStorage.setItem('dp_mode', v); } catch(e) {} }

// Role segmented control
function updateRoleSegUI() {
  const btns = roleSeg.querySelectorAll('.seg-btn');
  btns.forEach(btn => {
    const r = btn.dataset.role;
    btn.classList.remove('active-A', 'active-B', 'active-C', 'active-ALL');
    if (r === selectedRole) {
      const suffix = r === 'ALL' ? 'ALL' : r.replace('Student ', '');
      btn.classList.add('active-' + suffix);
    }
  });
}

roleSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  selectedRole = btn.dataset.role;
  saveRole(selectedRole);
  updateRoleSegUI();
  renderTranscript();
  if (selectedRole === 'ALL') {
    stopSpeechRecognition();  // close mic in read-through mode
  }
  if (isMyTurn && (selectedRole === 'ALL' || !isMySentence(dialogues[currentIndex]))) {
    myTurnDone();
  }
});

// Practice mode (read/recite)
function updateModeSegUI() {
  const btns = modeSeg.querySelectorAll('.mode-btn');
  btns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === practiceMode);
  });
}

modeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  practiceMode = btn.dataset.mode;
  saveMode(practiceMode);
  updateModeSegUI();
  // If currently in my turn, re-render to switch between full text and blanks
  if (isMyTurn && dialogues[currentIndex]) {
    if (practiceMode === 'recite' && speechSupported && speechEnabled) {
      // Mic stays open, just reset matching state (no stop/start = no prompt sound)
      startSpeechRecognition(dialogues[currentIndex].text, onAllWordsMatched);
    } else {
      stopSpeechRecognition();  // close mic when switching to read mode
      renderTranscript();
    }
  } else if (practiceMode !== 'recite') {
    stopSpeechRecognition();  // close mic when switching to read mode outside my turn
  }
  updatePlayButton();
});

// Translation toggle
translateBtn.addEventListener('click', () => {
  showTranslation = !showTranslation;
  document.body.classList.toggle('show-zh', showTranslation);
  translateBtn.classList.toggle('active', showTranslation);
  try { localStorage.setItem('dp_translation', showTranslation); } catch(e) {}
});

// Render transcript
// Wrap each word in a span with data-word attribute (for click-to-translate in all modes)
function wrapWords(text) {
  return text.replace(/([a-zA-Z]+(?:[''-][a-zA-Z]+)*)/g, '<span data-word="$1">$1</span>');
}

function renderTranscript() {
  transcriptEl.innerHTML = '';
  dialogues.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'sentence';
    if (i < currentIndex) div.classList.add('played');
    if (i === currentIndex) {
      div.classList.add('current');
      if (isMySentence(d)) div.classList.add('my-turn');
    }
    const roleShort = d.role.replace('Student ', '');
    const mine = isMySentence(d);
    
    // In recite mode + my turn + current sentence, show blanks (handled by speech.js)
    let textContent = d.text;
    if (i === currentIndex && isMySentence(d) && practiceMode === 'recite' && speechSupported && speechEnabled && isMyTurn) {
      // Will be replaced by speech.js renderSentenceBlanks
      textContent = d.text;
    }
    
    div.innerHTML = `
      <div class="sentence-meta">
        <span class="role-tag role-${roleShort}">${d.role}${mine ? '<span class="my-badge">你</span>' : ''}</span>
        <span class="sentence-num">${i+1}/${TOTAL}</span>
      </div>
      <div class="sentence-text">${wrapWords(textContent)}</div>
      <div class="sentence-zh">${d.zh}</div>
    `;
    transcriptEl.appendChild(div);
  });
  
  // If in recite mode and current is my turn, render blanks
  if (isMyTurn && practiceMode === 'recite' && speechSupported && speechEnabled && currentSentenceWords.length > 0) {
    renderSentenceBlanks();
  }
  
  const currentEl = transcriptEl.querySelector('.sentence.current');
  if (currentEl) {
    setTimeout(() => currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}

function updateProgress() {
  const pct = Math.round((currentIndex / TOTAL) * 100);
  progressText.textContent = `第 ${Math.min(currentIndex+1, TOTAL)} / ${TOTAL} 句`;
  progressPercent.textContent = pct + '%';
  progressFill.style.width = pct + '%';
}

// Callback when all words matched in recite mode
function onAllWordsMatched() {
  if (isMyTurn) {
    myTurnDone();
  }
}

// Play a sentence
function playSentence(index) {
  if (index >= TOTAL) { finishPractice(); return; }
  currentIndex = index;
  const d = dialogues[index];
  renderTranscript();
  updateProgress();

  if (isMySentence(d)) {
    isMyTurn = true;
    isPlaying = false;
    stopCurrentSource();
    showMyTurnBanner();
    updatePlayButton();
    
    if (practiceMode === 'recite' && speechSupported && speechEnabled) {
      startSpeechRecognition(d.text, onAllWordsMatched);
    }
  } else {
    isMyTurn = false;
    pauseRecognition();  // keep mic open but ignore results (avoids iOS prompt sound)
    hideMyTurnBanner();
    pausedAt = d.startTime;
    startPlayback(d.startTime, d.endTime - d.startTime);
    updatePlayButton();
  }
}

function showMyTurnBanner() {
  myTurnBar.classList.add('show');
  myTurnText.textContent = practiceMode === 'recite' ? '🔴 轮到你了 — 请背诵上方台词' : '🔴 轮到你了 — 请朗读上方台词';
  updatePlayButton();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
function hideMyTurnBanner() {
  myTurnBar.classList.remove('show');
  updatePlayButton();
}

function togglePlay() {
  if (isMyTurn) {
    if (practiceMode === 'recite') {
      // Hint button behavior: press and hold handled by touch/mouse events
      return;
    }
    myTurnDone();
    return;
  }
  if (isPlaying) {
    pausedAt = getPlaybackPosition();
    stopCurrentSource();
    isPlaying = false;
  } else {
    if (!practiceStarted) {
      practiceStarted = true;
      practiceStartTime = Date.now();
    }
    if (currentIndex >= TOTAL) { restartPractice(); return; }
    const d = dialogues[currentIndex];
    if (isMySentence(d)) { playSentence(currentIndex); return; }
    if (pausedAt < d.startTime || pausedAt >= d.endTime) pausedAt = d.startTime;
    startPlayback(pausedAt, d.endTime - pausedAt);
  }
  updatePlayButton();
}

function updatePlayButton() {
  const icon = playBtn.querySelector('.btn-icon');
  const label = playBtn.querySelector('span:last-child');
  playBtn.classList.remove('my-turn-mode');
  if (isMyTurn) {
    if (practiceMode === 'recite') {
      icon.textContent = '💡';
      label.textContent = '提示';
    } else {
      icon.textContent = '✅';
      label.textContent = '读完了';
    }
    playBtn.classList.add('my-turn-mode');
  } else if (isPlaying) {
    icon.textContent = '⏸';
    label.textContent = '暂停';
  } else if (!practiceStarted) {
    icon.textContent = '▶';
    label.textContent = '开始练习';
  } else if (currentIndex >= TOTAL) {
    icon.textContent = '🔄';
    label.textContent = '重新开始';
  } else {
    icon.textContent = '▶';
    label.textContent = '继续';
  }
  
  // Next button label: "跳过" in recite mode my turn, "下一句" otherwise
  const nextIcon = nextBtn.querySelector('.btn-icon');
  const nextLabel = nextBtn.querySelector('span:last-child');
  if (isMyTurn && practiceMode === 'recite') {
    nextIcon.textContent = '⏭';
    nextLabel.textContent = '跳过';
  } else {
    nextIcon.textContent = '⏭';
    nextLabel.textContent = '下一句';
  }
}

// Hint button: press and hold to show full text in recite mode
function hintPressStart(e) {
  if (isMyTurn && practiceMode === 'recite' && currentSentenceWords.length > 0) {
    e.preventDefault();
    isHintPressed = true;
    showFullSentence();
  }
}
function hintPressEnd(e) {
  if (isHintPressed) {
    isHintPressed = false;
    restoreSentenceBlanks();
  }
}

// Hint button: touch events for mobile (preventDefault only in recite mode my turn)
playBtn.addEventListener('touchstart', (e) => {
  if (isMyTurn && practiceMode === 'recite' && currentSentenceWords.length > 0) {
    e.preventDefault();
    isHintPressed = true;
    showFullSentence();
  }
}, { passive: false });
playBtn.addEventListener('touchend', hintPressEnd);
playBtn.addEventListener('touchcancel', hintPressEnd);
// Mouse events for desktop
playBtn.addEventListener('mousedown', hintPressStart);
playBtn.addEventListener('mouseup', hintPressEnd);
playBtn.addEventListener('mouseleave', hintPressEnd);

// Click handler: toggle play, except in recite mode my turn (hold for hint)
playBtn.addEventListener('click', (e) => {
  if (isMyTurn && practiceMode === 'recite') {
    return;
  }
  togglePlay();
});

// Play original audio of current sentence (for pronunciation reference)
function playCurrentSentenceAudio() {
  const d = dialogues[currentIndex];
  if (!d || !audioBuffer) return;
  
  // Pause speech recognition during audio playback (avoid recognizing the audio)
  pauseRecognition();
  
  stopCurrentSource();
  isPlaying = true;
  updatePlayButton();
  
  const duration = d.endTime - d.startTime;
  startPlayback(d.startTime, duration);
  
  // Restore recognition after playback finishes (keep matched words state)
  setTimeout(() => {
    isPlaying = false;
    updatePlayButton();
    if (isMyTurn && practiceMode === 'recite') {
      resumeRecognitionKeepState();
    }
  }, duration * 1000 + 200);
}

function goPrev() {
  if (currentIndex > 0) {
    stopCurrentSource();
    isPlaying = false;
    isMyTurn = false;
    hideMyTurnBanner();
    playSentence(currentIndex - 1);
  }
}
function goNext() {
  stopCurrentSource();
  isPlaying = false;
  isMyTurn = false;
  hideMyTurnBanner();
  if (currentIndex + 1 >= TOTAL) finishPractice();
  else playSentence(currentIndex + 1);
}

function myTurnDone() {
  if (isMyTurn && practiceMode === 'recite' && currentSentenceWords.length > 0) {
    finalizeSentenceBlanks();
  }
  // Don't stop recognition here - mic stays open throughout recite mode
  isMyTurn = false;
  hideMyTurnBanner();
  if (currentIndex + 1 >= TOTAL) finishPractice();
  else playSentence(currentIndex + 1);
}

function finishPractice() {
  stopCurrentSource();
  stopSpeechRecognition();
  isPlaying = false;
  isMyTurn = false;
  hideMyTurnBanner();
  currentIndex = TOTAL;
  renderTranscript();
  updateProgress();

  const elapsed = practiceStartTime ? Math.round((Date.now() - practiceStartTime) / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const mineCount = selectedRole === 'ALL' ? 0 : dialogues.filter(d => d.role === selectedRole).length;
  const roleLabel = selectedRole === 'ALL' ? '通读' : selectedRole.replace('Student ', '');
  const modeLabel = practiceMode === 'recite' ? '背诵' : '朗读';

  document.getElementById('statTotal').textContent = TOTAL;
  document.getElementById('statMine').textContent = selectedRole === 'ALL' ? '—' : mineCount;
  document.getElementById('statTime').textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  document.getElementById('statRole').textContent = roleLabel;
  document.getElementById('statsNote').textContent = selectedRole === 'ALL'
    ? `通读模式：全程自动播放，共 ${TOTAL} 句。`
    : `你扮演了 ${selectedRole}（${modeLabel}模式），共 ${mineCount} 句台词。继续加油！`;

  statsModal.classList.add('show');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

function restartPractice() {
  currentIndex = 0;
  isPlaying = false;
  isMyTurn = false;
  practiceStarted = false;
  practiceStartTime = null;
  statsModal.classList.remove('show');
  hideMyTurnBanner();
  stopCurrentSource();
  stopSpeechRecognition();
  pausedAt = 0;
  renderTranscript();
  updateProgress();
  updatePlayButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Click any sentence to jump
transcriptEl.addEventListener('click', (e) => {
  const sentenceEl = e.target.closest('.sentence');
  if (!sentenceEl) return;
  const idx = Array.from(transcriptEl.children).indexOf(sentenceEl);
  if (idx === -1 || idx >= TOTAL) return;
  stopCurrentSource();
  isPlaying = false;
  isMyTurn = false;
  hideMyTurnBanner();
  if (!practiceStarted) {
    practiceStarted = true;
    practiceStartTime = Date.now();
  }
  playSentence(idx);
});

// Speed control
speedRange.addEventListener('input', (e) => {
  playbackRate = parseFloat(e.target.value);
  speedVal.textContent = playbackRate.toFixed(1) + 'x';
  if (currentSource) currentSource.playbackRate.value = playbackRate;
  saveSpeed(playbackRate.toFixed(1));
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (isMyTurn && practiceMode === 'read') myTurnDone();
    else if (!isMyTurn) togglePlay();
  }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); goPrev(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); if (isMyTurn) myTurnDone(); else goNext(); }
});

// Guide modal
document.getElementById('guideBtn').addEventListener('click', () => guideModal.classList.add('show'));
document.getElementById('guideClose').addEventListener('click', () => guideModal.classList.remove('show'));
guideModal.addEventListener('click', (e) => { if (e.target === guideModal) guideModal.classList.remove('show'); });

// Button events
audioBtn.addEventListener('click', playCurrentSentenceAudio);
nextBtn.addEventListener('click', goNext);

// Stats modal
document.getElementById('statsClose').addEventListener('click', () => statsModal.classList.remove('show'));
document.getElementById('statsRestart').addEventListener('click', restartPractice);
statsModal.addEventListener('click', (e) => { if (e.target === statsModal) statsModal.classList.remove('show'); });
