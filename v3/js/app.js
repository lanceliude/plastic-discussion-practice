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
let isLooping = false;  // loop playback of current sentence

// === Group Practice Mode (合练模式) ===
let isGroupMode = false;
let groupMatchedWords = [];  // 2D array: [sentenceIdx][wordIdx] = true/false
let groupLastMatchedPos = -1;  // last matched position in flat word list
let groupTotalWords = 0;
let groupMatchedCount = 0;
let groupRecognitionActive = false;
let groupSelectedSentence = 0;  // currently selected/highlighted sentence for hint

// Build flat word list from all dialogues for group mode matching
function buildGroupWordList() {
  const flat = [];
  groupMatchedWords = [];
  dialogues.forEach((d, sIdx) => {
    const words = d.text.split(/\s+/).filter(w => w.length > 0);
    groupMatchedWords.push(new Array(words.length).fill(false));
    words.forEach((w, wIdx) => {
      flat.push({ sentence: sIdx, word: w, wordIdx: wIdx, clean: w.toLowerCase().replace(/[^a-z]/g, '') });
    });
  });
  groupTotalWords = flat.length;
  groupMatchedCount = 0;
  groupLastMatchedPos = -1;
  groupCurrentSentence = 0;
  groupRecentWords = [];
  return flat;
}
let groupWordList = [];

// === Group Practice: Speech Recognition Matching ===
let groupFinalTranscript = '';
let groupOrigOnResult = null;
let groupOrigOnEnd = null;
let groupCurrentSentence = 0;  // current sentence index (locked, no backtracking)
let groupRecentWords = [];  // recent spoken words for phrase matching (2-word confirmation)

function wordMatch(target, spoken) {
  if (!target || !spoken) return false;
  return target === spoken || 
         (target.length > 4 && target.startsWith(spoken)) || 
         (spoken.length > 4 && spoken.startsWith(target));
}

function getSentenceStartPos(sentenceIdx) {
  let pos = 0;
  for (let i = 0; i < sentenceIdx && i < dialogues.length; i++) {
    pos += dialogues[i].text.split(/\s+/).filter(w => w.length > 0).length;
  }
  return pos;
}

function getSentenceMatchRate(sentenceIdx) {
  if (!groupMatchedWords[sentenceIdx]) return 0;
  const total = groupMatchedWords[sentenceIdx].length;
  const matched = groupMatchedWords[sentenceIdx].filter(Boolean).length;
  return total > 0 ? matched / total : 0;
}

function groupMatchWords(transcript) {
  if (!groupWordList.length) return;
  const spokenWords = transcript.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (!spokenWords.length) return;
  
  let changed = false;
  
  for (let sp = 0; sp < spokenWords.length; sp++) {
    const spoken = spokenWords[sp].replace(/[^a-z]/g, '');
    if (!spoken) continue;
    
    // Add to recent words queue (keep last 3)
    groupRecentWords.push(spoken);
    if (groupRecentWords.length > 3) groupRecentWords.shift();
    
    // Auto-advance: if current sentence is 80%+ matched, move to next sentence
    while (groupCurrentSentence < TOTAL - 1 && getSentenceMatchRate(groupCurrentSentence) >= 0.8) {
      groupCurrentSentence++;
    }
    
    // === Step 1: Try single-word match within current sentence ===
    const sentStart = getSentenceStartPos(groupCurrentSentence);
    const sentWords = dialogues[groupCurrentSentence].text.split(/\s+/).filter(w => w.length > 0);
    const sentEnd = sentStart + sentWords.length;
    
    let found = -1;
    for (let gp = sentStart; gp < sentEnd; gp++) {
      if (groupMatchedWords[groupWordList[gp].sentence][groupWordList[gp].wordIdx]) continue;
      if (wordMatch(groupWordList[gp].clean, spoken)) {
        found = gp;
        break;
      }
    }
    
    // === Step 2: If no match in current sentence, try 2-word phrase match to switch sentences ===
    if (found === -1 && groupRecentWords.length >= 2) {
      const w1 = groupRecentWords[groupRecentWords.length - 2];
      const w2 = groupRecentWords[groupRecentWords.length - 1];
      
      // Search in next 3 sentences for consecutive 2-word match
      for (let sIdx = groupCurrentSentence + 1; sIdx <= Math.min(groupCurrentSentence + 3, TOTAL - 1); sIdx++) {
        const sStart = getSentenceStartPos(sIdx);
        const sWords = dialogues[sIdx].text.split(/\s+/).filter(w => w.length > 0);
        const sEnd = sStart + sWords.length;
        
        for (let gp = sStart; gp < sEnd - 1; gp++) {
          if (groupMatchedWords[groupWordList[gp].sentence][groupWordList[gp].wordIdx]) continue;
          if (groupMatchedWords[groupWordList[gp+1].sentence][groupWordList[gp+1].wordIdx]) continue;
          
          if (wordMatch(groupWordList[gp].clean, w1) && wordMatch(groupWordList[gp+1].clean, w2)) {
            // Found 2-word phrase match! Switch to this sentence and mark both words
            groupCurrentSentence = sIdx;
            // Mark first word
            groupMatchedWords[groupWordList[gp].sentence][groupWordList[gp].wordIdx] = true;
            groupMatchedCount++;
            groupLastMatchedPos = gp;
            // Mark second word
            groupMatchedWords[groupWordList[gp+1].sentence][groupWordList[gp+1].wordIdx] = true;
            groupMatchedCount++;
            groupLastMatchedPos = gp + 1;
            changed = true;
            found = gp + 1;  // mark as found so we don't try single match again
            break;
          }
        }
        if (found !== -1) break;
      }
    }
    
    // === Step 3: If phrase match found, skip single match (already marked both words) ===
    if (found !== -1 && found >= sentEnd) {
      // Phrase match already handled, continue to next spoken word
      continue;
    }
    
    // === Step 4: Single word match found in current sentence ===
    if (found !== -1) {
      groupMatchedWords[groupWordList[found].sentence][groupWordList[found].wordIdx] = true;
      groupMatchedCount++;
      groupLastMatchedPos = found;
      changed = true;
    }
  }
  
  if (changed) {
    updateProgress();
    refreshGroupDisplay();
    if (groupMatchedCount >= groupTotalWords) {
      setTimeout(() => finishGroupPractice(), 1000);
    }
  }
}

function groupOnResult(event) {
  let interim = '';
  let final = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const transcript = event.results[i][0].transcript;
    if (event.results[i].isFinal) {
      final += transcript + ' ';
    } else {
      interim += transcript;
    }
  }
  if (final) groupFinalTranscript += final;
  const combined = (groupFinalTranscript + ' ' + interim).trim();
  if (combined) {
    groupMatchWords(combined);
  }
}

function groupOnEnd() {
  isListening = false;
  if (groupRecognitionActive && !document.hidden && speechSupported) {
    try { recognition.start(); isListening = true; } catch(e) {}
  }
  updateSpeechStatus(isListening);
}

function startGroupRecognition() {
  if (!speechSupported) {
    alert('当前浏览器不支持语音识别。建议使用 Chrome 或 Safari 浏览器。');
    return;
  }
  groupFinalTranscript = '';
  groupRecognitionActive = true;
  
  // Save original handlers and replace with group mode handlers
  groupOrigOnResult = recognition.onresult;
  groupOrigOnEnd = recognition.onend;
  recognition.onresult = groupOnResult;
  recognition.onend = groupOnEnd;
  ignoreResults = false;
  
  try {
    recognition.start();
    isListening = true;
    updateSpeechStatus(true);
  } catch(e) {
    console.warn('Group recognition start failed:', e);
  }
  
  // Show my-turn bar as "listening" indicator
  myTurnText.textContent = '🎙️ 合练中 - 正在识别';
  myTurnBar.classList.add('show');
}

function stopGroupRecognition() {
  groupRecognitionActive = false;
  try { recognition.stop(); } catch(e) {}
  isListening = false;
  updateSpeechStatus(false);
  
  // Restore original handlers
  if (groupOrigOnResult) recognition.onresult = groupOrigOnResult;
  if (groupOrigOnEnd) recognition.onend = groupOrigOnEnd;
  groupOrigOnResult = null;
  groupOrigOnEnd = null;
  
  myTurnBar.classList.remove('show');
}

function refreshGroupDisplay() {
  // Update all sentences' word display without full re-render (preserves scroll)
  const sentenceEls = transcriptEl.querySelectorAll('.sentence');
  sentenceEls.forEach((div, i) => {
    if (i >= dialogues.length) return;
    const d = dialogues[i];
    const words = d.text.split(/\s+/).filter(w => w.length > 0);
    
    // Update words only (no per-sentence percentage - users don't look at screen during group practice)
    const textEl = div.querySelector('.sentence-text');
    if (textEl) {
      let wordsHtml = '';
      words.forEach((w, wIdx) => {
        const isMatched = groupMatchedWords[i] && groupMatchedWords[i][wIdx];
        if (isMatched) {
          wordsHtml += `<span data-word="${w}" class="word-matched">${w}</span> `;
        } else {
          const blankLen = Math.max(3, w.replace(/[^a-zA-Z]/g, '').length);
          wordsHtml += `<span data-word="${w}" class="word-blank">${'_'.repeat(blankLen)}</span> `;
        }
      });
      textEl.innerHTML = wordsHtml;
    }
  });
}

function updateGroupRoleProgress() {
  const summary = document.getElementById('groupRoleSummary');
  if (!summary) return;
  if (!isGroupMode) { summary.style.display = 'none'; return; }
  summary.style.display = 'flex';
  
  const roleStats = { 'Student A': { matched: 0, total: 0 }, 'Student B': { matched: 0, total: 0 }, 'Student C': { matched: 0, total: 0 } };
  dialogues.forEach((d, i) => {
    const role = d.role;
    if (!roleStats[role]) roleStats[role] = { matched: 0, total: 0 };
    const words = d.text.split(/\s+/).filter(w => w.length > 0);
    roleStats[role].total += words.length;
    roleStats[role].matched += groupMatchedWords[i] ? groupMatchedWords[i].filter(Boolean).length : 0;
  });
  
  for (const [role, stats] of Object.entries(roleStats)) {
    const pct = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
    const suffix = role.replace('Student ', '');
    const el = document.getElementById('groupPct' + suffix);
    if (el) el.textContent = pct + '%';
  }
}

function finishGroupPractice() {
  stopGroupRecognition();
  practiceStarted = false;
  updatePlayButton();
  
  // Calculate per-role stats
  const roleStats = {};
  dialogues.forEach((d, i) => {
    const role = d.role;
    if (!roleStats[role]) roleStats[role] = { matched: 0, total: 0 };
    const words = d.text.split(/\s+/).filter(w => w.length > 0);
    roleStats[role].total += words.length;
    roleStats[role].matched += groupMatchedWords[i] ? groupMatchedWords[i].filter(Boolean).length : 0;
  });
  
  let roleHtml = '';
  for (const [role, stats] of Object.entries(roleStats)) {
    const pct = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
    const color = role === 'Student A' ? '#e74c3c' : (role === 'Student B' ? '#3498db' : '#f39c12');
    roleHtml += `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
      <span style="color:${color};font-weight:600;">${role}</span>
      <span>${stats.matched}/${stats.total} 词 · ${pct}%</span>
    </div>`;
  }
  
  const totalPct = groupTotalWords > 0 ? Math.round((groupMatchedCount / groupTotalWords) * 100) : 0;
  const elapsed = practiceStartTime ? Math.floor((Date.now() - practiceStartTime) / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  
  document.getElementById('statTotal').textContent = groupTotalWords;
  document.getElementById('statMine').textContent = groupMatchedCount;
  document.getElementById('statTime').textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  document.getElementById('statRole').textContent = '合练模式';
  document.getElementById('statsNote').innerHTML = `总说对率：${totalPct}%<br><br><b>各角色完成度：</b><br>${roleHtml}`;
  
  statsModal.classList.add('show');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

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
  if (isGroupMode) return false;
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
  
  isGroupMode = (selectedRole === 'GROUP');
  if (isGroupMode) {
    groupWordList = buildGroupWordList();
    document.body.classList.add('group-mode');
  } else {
    document.body.classList.remove('group-mode');
  }
  
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
    btn.classList.remove('active-A', 'active-B', 'active-C', 'active-ALL', 'active-GROUP');
    if (r === selectedRole) {
      const suffix = r === 'ALL' ? 'ALL' : (r === 'GROUP' ? 'GROUP' : r.replace('Student ', ''));
      btn.classList.add('active-' + suffix);
    }
  });
}

roleSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  selectedRole = btn.dataset.role;
  isGroupMode = (selectedRole === 'GROUP');
  saveRole(selectedRole);
  updateRoleSegUI();
  
  // Reset state when switching modes
  stopCurrentSource();
  stopSpeechRecognition();
  isPlaying = false;
  isLooping = false;
  isMyTurn = false;
  hideMyTurnBanner();
  practiceStarted = false;
  currentIndex = 0;
  
  if (isGroupMode) {
    groupWordList = buildGroupWordList();
  }
  
  renderTranscript();
  updateProgress();
  updatePlayButton();
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
  
  // === Group Practice Mode ===
  if (isGroupMode) {
    dialogues.forEach((d, i) => {
      const div = document.createElement('div');
      div.className = 'sentence';
      if (i === groupSelectedSentence) div.classList.add('current');
      
      const roleShort = d.role.replace('Student ', '');
      const words = d.text.split(/\s+/).filter(w => w.length > 0);
      
      // Build word HTML: matched = green, unmatched = blank line
      let wordsHtml = '';
      words.forEach((w, wIdx) => {
        const isMatched = groupMatchedWords[i] && groupMatchedWords[i][wIdx];
        if (isMatched) {
          wordsHtml += `<span data-word="${w}" class="word-matched">${w}</span> `;
        } else {
          const blankLen = Math.max(3, w.replace(/[^a-zA-Z]/g, '').length);
          wordsHtml += `<span data-word="${w}" class="word-blank">${'_'.repeat(blankLen)}</span> `;
        }
      });
      
      div.innerHTML = `
        <div class="sentence-meta">
          <span class="role-tag role-${roleShort}">${d.role}</span>
        </div>
        <div class="sentence-text">${wordsHtml}</div>
        <div class="sentence-zh">${d.zh}</div>
      `;
      transcriptEl.appendChild(div);
    });
    
    const currentEl = transcriptEl.querySelector('.sentence.current');
    if (currentEl) {
      setTimeout(() => currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
    return;
  }
  
  // === Normal Mode ===
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
  if (isGroupMode) {
    const pct = groupTotalWords > 0 ? Math.round((groupMatchedCount / groupTotalWords) * 100) : 0;
    progressText.textContent = `已说对 ${groupMatchedCount} / ${groupTotalWords} 词`;
    progressPercent.textContent = pct + '%';
    progressFill.style.width = pct + '%';
    return;
  }
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
  // === Group Practice Mode ===
  if (isGroupMode) {
    if (groupRecognitionActive) {
      // Stop group practice
      finishGroupPractice();
    } else {
      // Start group practice: reset and begin recognition
      groupWordList = buildGroupWordList();
      groupFinalTranscript = '';
      practiceStarted = true;
      practiceStartTime = Date.now();
      renderTranscript();
      updateProgress();
      startGroupRecognition();
    }
    updatePlayButton();
    return;
  }
  
  // === Normal Mode ===
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
    isLooping = false;
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
  
  // === Group Practice Mode ===
  if (isGroupMode) {
    if (groupRecognitionActive) {
      icon.textContent = '⏹';
      label.textContent = '结束合练';
    } else {
      icon.textContent = '🎙️';
      label.textContent = '开始合练';
    }
    return;
  }
  
  // === Normal Mode ===
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
  
  // Audio button: 🔊原音 in recite mode my turn, 🔁复读/⏹停止 otherwise
  const audioIcon = audioBtn.querySelector('.btn-icon');
  const audioLabel = audioBtn.querySelector('span:last-child');
  if (isMyTurn && practiceMode === 'recite') {
    audioIcon.textContent = '🔊';
    audioLabel.textContent = '原音';
  } else if (isLooping) {
    audioIcon.textContent = '⏹';
    audioLabel.textContent = '停止';
  } else {
    audioIcon.textContent = '🔁';
    audioLabel.textContent = '复读';
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
  
  // Recite mode + my turn: play original audio once (no loop)
  if (isMyTurn && practiceMode === 'recite') {
    pauseRecognition();
    stopCurrentSource();
    isPlaying = true;
    isLooping = false;
    updatePlayButton();
    
    const duration = d.endTime - d.startTime;
    startPlayback(d.startTime, duration);
    
    setTimeout(() => {
      isPlaying = false;
      updatePlayButton();
      if (isMyTurn && practiceMode === 'recite') {
        resumeRecognitionKeepState();
      }
    }, duration * 1000 + 200);
    return;
  }
  
  // Other cases: toggle loop playback of current sentence
  if (isLooping) {
    // Stop looping
    isLooping = false;
    stopCurrentSource();
    isPlaying = false;
    updatePlayButton();
  } else {
    // Start looping
    isLooping = true;
    stopCurrentSource();
    isPlaying = true;
    updatePlayButton();
    
    const duration = d.endTime - d.startTime;
    startPlayback(d.startTime, duration);
    // Loop handled in startPlayback's onended callback
  }
}

function goPrev() {
  if (currentIndex > 0) {
    stopCurrentSource();
    isPlaying = false;
    isLooping = false;
    isMyTurn = false;
    hideMyTurnBanner();
    playSentence(currentIndex - 1);
  }
}
function goNext() {
  stopCurrentSource();
  isPlaying = false;
  isLooping = false;
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
  isLooping = false;
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

// === Group Practice: long press removed (fully automatic, no manual操作) ===

// Click any sentence to jump
transcriptEl.addEventListener('click', (e) => {
  const sentenceEl = e.target.closest('.sentence');
  if (!sentenceEl) return;
  const idx = Array.from(transcriptEl.children).indexOf(sentenceEl);
  if (idx === -1 || idx >= TOTAL) return;
  
  // === Group Practice Mode: do nothing (fully automatic) ===
  if (isGroupMode) return;
  
  // === Normal Mode: select and stop playback ===
  // Only select the sentence, don't auto-play (user must press play button)
  stopCurrentSource();
  stopSpeechRecognition();
  isPlaying = false;
  isLooping = false;
  isMyTurn = false;
  hideMyTurnBanner();
  currentIndex = idx;
  renderTranscript();
  updateProgress();
  updatePlayButton();
  // Scroll to selected sentence
  setTimeout(() => sentenceEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
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
audioBtn.addEventListener('click', () => {
  if (isGroupMode) {
    // Play original audio of selected sentence
    const d = dialogues[groupSelectedSentence];
    if (!d || !audioBuffer) return;
    stopCurrentSource();
    isPlaying = true;
    const duration = d.endTime - d.startTime;
    startPlayback(d.startTime, duration);
    setTimeout(() => { isPlaying = false; }, duration * 1000 + 200);
  } else {
    playCurrentSentenceAudio();
  }
});

nextBtn.addEventListener('click', () => {
  if (isGroupMode) {
    // Reset group practice
    if (groupRecognitionActive) stopGroupRecognition();
    groupWordList = buildGroupWordList();
    groupFinalTranscript = '';
    practiceStarted = false;
    groupSelectedSentence = 0;
    renderTranscript();
    updateProgress();
    updatePlayButton();
  } else {
    goNext();
  }
});

// Stats modal
document.getElementById('statsClose').addEventListener('click', () => statsModal.classList.remove('show'));
document.getElementById('statsRestart').addEventListener('click', restartPractice);
statsModal.addEventListener('click', (e) => { if (e.target === statsModal) statsModal.classList.remove('show'); });
