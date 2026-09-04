// Main application logic
const TOTAL = dialogues.length;
let currentIndex = 0;
let isPlaying = false;
let isMyTurn = false;
let practiceStarted = false;
let practiceStartTime = null;
let selectedRole = 'Student A';
let playbackRate = 1.0;
let showTranslation = false;

// DOM elements
const transcriptEl = document.getElementById('transcript');
const speedRange = document.getElementById('speedRange');
const speedVal = document.getElementById('speedVal');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const settingsModal = document.getElementById('settingsModal');
const statsModal = document.getElementById('statsModal');
const guidePanel = document.getElementById('guidePanel');
const roleSeg = document.getElementById('roleSeg');
const myTurnBar = document.getElementById('myTurnBar');
const translateBtn = document.getElementById('translateBtn');
const speechToggleBtn = document.getElementById('speechToggleBtn');

function isMySentence(d) {
  return selectedRole !== 'ALL' && d.role === selectedRole;
}

// localStorage
function loadSettings() {
  try {
    const r = localStorage.getItem('dp_role');
    const s = localStorage.getItem('dp_speed');
    const t = localStorage.getItem('dp_translation');
    const sp = localStorage.getItem('dp_speech');
    if (r) { selectedRole = r; }
    if (s) { playbackRate = parseFloat(s); speedRange.value = s; speedVal.textContent = s + 'x'; }
    if (t === 'true') { showTranslation = true; document.body.classList.add('show-zh'); translateBtn.classList.add('active'); }
    else { showTranslation = false; document.body.classList.remove('show-zh'); translateBtn.classList.remove('active'); }
    if (sp === 'false') { speechEnabled = false; speechToggleBtn.classList.remove('active'); }
    else { speechEnabled = true; speechToggleBtn.classList.add('active'); }
  } catch(e) {}
  updateRoleSegUI();
}
function saveRole(v) { try { localStorage.setItem('dp_role', v); } catch(e) {} }
function saveSpeed(v) { try { localStorage.setItem('dp_speed', v); } catch(e) {} }

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
  if (isMyTurn && (selectedRole === 'ALL' || !isMySentence(dialogues[currentIndex]))) {
    myTurnDone();
  }
});

// Translation toggle
translateBtn.addEventListener('click', () => {
  showTranslation = !showTranslation;
  document.body.classList.toggle('show-zh', showTranslation);
  translateBtn.classList.toggle('active', showTranslation);
  try { localStorage.setItem('dp_translation', showTranslation); } catch(e) {}
});

// Speech recognition toggle
speechToggleBtn.addEventListener('click', () => {
  if (!speechSupported) {
    alert('当前浏览器不支持语音识别功能。请使用 Chrome 或 Safari。');
    return;
  }
  speechEnabled = !speechEnabled;
  speechToggleBtn.classList.toggle('active', speechEnabled);
  try { localStorage.setItem('dp_speech', speechEnabled); } catch(e) {}
  if (!speechEnabled) stopSpeechRecognition();
});

// Render transcript
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
    div.innerHTML = `
      <div class="sentence-meta">
        <span class="role-tag role-${roleShort}">${d.role}${mine ? '<span class="my-badge">你</span>' : ''}</span>
        <span class="sentence-num">${i+1}/${TOTAL}</span>
      </div>
      <div class="sentence-text">${d.text}</div>
      <div class="sentence-zh">${d.zh}</div>
    `;
    transcriptEl.appendChild(div);
  });
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
    // Start speech recognition for user's sentence
    if (speechSupported && speechEnabled) {
      setTimeout(() => startSpeechRecognition(d.text), 300);
    }
  } else {
    isMyTurn = false;
    stopSpeechRecognition();
    hideMyTurnBanner();
    pausedAt = d.startTime;
    startPlayback(d.startTime, d.endTime - d.startTime);
    updatePlayButton();
  }
}

// My turn banner
function showMyTurnBanner() {
  myTurnBar.classList.add('show');
  updatePlayButton();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
function hideMyTurnBanner() {
  myTurnBar.classList.remove('show');
  updatePlayButton();
}

// Toggle play/pause
function togglePlay() {
  if (isMyTurn) { myTurnDone(); return; }
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
    icon.textContent = '✅';
    label.textContent = '读完了';
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
}

function goPrev() {
  if (currentIndex > 0) {
    stopCurrentSource();
    stopSpeechRecognition();
    isPlaying = false;
    isMyTurn = false;
    hideMyTurnBanner();
    playSentence(currentIndex - 1);
  }
}
function goNext() {
  stopCurrentSource();
  stopSpeechRecognition();
  isPlaying = false;
  isMyTurn = false;
  hideMyTurnBanner();
  if (currentIndex + 1 >= TOTAL) finishPractice();
  else playSentence(currentIndex + 1);
}

function myTurnDone() {
  // Mark missed words
  if (isMyTurn && currentSentenceWords.length > 0) {
    finalizeSentenceBlanks();
  }
  stopSpeechRecognition();
  isMyTurn = false;
  hideMyTurnBanner();
  if (currentIndex + 1 >= TOTAL) finishPractice();
  else playSentence(currentIndex + 1);
}

// Finish practice
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

  document.getElementById('statTotal').textContent = TOTAL;
  document.getElementById('statMine').textContent = selectedRole === 'ALL' ? '—' : mineCount;
  document.getElementById('statTime').textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  document.getElementById('statRole').textContent = roleLabel;
  document.getElementById('statsNote').textContent = selectedRole === 'ALL'
    ? '通读模式：全程自动播放，共 ' + TOTAL + ' 句。'
    : `你扮演了 ${selectedRole}，共 ${mineCount} 句台词。继续加油！`;

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
  stopSpeechRecognition();
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
  if (e.code === 'Space') { e.preventDefault(); if (isMyTurn) myTurnDone(); else togglePlay(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); goPrev(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); if (isMyTurn) myTurnDone(); else goNext(); }
});

// Settings modal
document.getElementById('settingsBtn').addEventListener('click', () => settingsModal.classList.add('show'));
document.getElementById('settingsCancel').addEventListener('click', () => settingsModal.classList.remove('show'));
document.getElementById('settingsSave').addEventListener('click', () => settingsModal.classList.remove('show'));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('show'); });

// Stats modal
document.getElementById('statsClose').addEventListener('click', () => statsModal.classList.remove('show'));
document.getElementById('statsRestart').addEventListener('click', restartPractice);
statsModal.addEventListener('click', (e) => { if (e.target === statsModal) statsModal.classList.remove('show'); });

// Guide panel
document.getElementById('guideClose').addEventListener('click', () => guidePanel.classList.add('collapsed'));
document.getElementById('guideExpand').addEventListener('click', () => guidePanel.classList.remove('collapsed'));
document.getElementById('guideBtn').addEventListener('click', () => {
  guidePanel.classList.toggle('collapsed');
  if (!guidePanel.classList.contains('collapsed')) guidePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Button events
playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);

// Initialize
loadSettings();
initAudio('audio/full_discussion.mp3');
renderTranscript();
updateProgress();
updatePlayButton();
