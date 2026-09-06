// Speech Recognition + incremental word reveal (Duolingo-style)
// Mic stays open throughout recite mode to avoid repeated iOS system prompt sounds
let recognition = null;
let speechSupported = false;
let speechEnabled = true;
let isListening = false;
let recognitionActive = false;  // mic is open (even if ignoring results)
let ignoreResults = false;      // ignore results during other characters' lines
let matchedWordCount = 0;
let currentSentenceWords = [];
let finalTranscript = '';
let onAllMatched = null;
let autoContinueTimer = null;
let lastMatchedSpokenIdx = -1;  // ensures sequential matching, no look-ahead leaks

// Detect iOS Safari (has different SpeechRecognition behavior)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isIOSSafari = isIOS && isSafari;

// Detect support
(function initSpeechDetection() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    speechSupported = true;
    recognition = new SR();
    // iOS Safari: use continuous=false (continuous mode has compatibility issues on iOS Safari)
    // Auto-restart on end handles the "always listening" behavior
    recognition.continuous = !isIOSSafari;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    
    // Bind event handlers once (not per start)
    recognition.onresult = handleRecognitionResult;
    recognition.onend = handleRecognitionEnd;
    recognition.onerror = handleRecognitionError;
  }
})();

function handleRecognitionResult(event) {
  if (ignoreResults) return;  // ignore during other characters' lines
  
  // Only use FINAL results, ignore interim results.
  // Interim results can contain predicted words the user hasn't spoken yet,
  // which causes words like "plastic" to appear early.
  let final = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (event.results[i].isFinal) {
      final += event.results[i][0].transcript + ' ';
    }
  }
  if (final) {
    finalTranscript += final;
    matchWords(finalTranscript);
  }
}

function handleRecognitionEnd() {
  isListening = false;
  // Auto-restart if mic should stay active (recite mode in progress)
  if (recognitionActive && !document.hidden && speechSupported && speechEnabled) {
    try { recognition.start(); isListening = true; } catch(e) {}
  }
  updateSpeechStatus(isListening);
}

function handleRecognitionError(event) {
  console.warn('Speech recognition error:', event.error);
  if (event.error === 'not-allowed') {
    speechEnabled = false;
    recognitionActive = false;
    alert('麦克风权限被拒绝。\n\n请在：设置 > Safari > 麦克风 中允许此网站使用麦克风，然后刷新页面。');
  } else if (event.error === 'service-not-allowed') {
    speechEnabled = false;
    recognitionActive = false;
    alert('语音识别服务不可用。\n\niOS Safari 的语音识别需要网络连接。如果问题持续，建议使用 Chrome 浏览器。');
  } else if (event.error === 'language-not-supported') {
    speechEnabled = false;
    recognitionActive = false;
    alert('当前浏览器不支持英语语音识别。建议使用 Chrome 浏览器。');
  } else if (event.error === 'audio-capture') {
    speechEnabled = false;
    recognitionActive = false;
    alert('无法访问麦克风。请检查设备是否有麦克风，以及 Safari 是否有麦克风权限。');
  }
  // 'no-speech' and 'aborted' are normal, auto-restart will handle
}

// Page visibility: stop mic when hidden, restart when visible if in recite mode
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (recognition) {
      recognitionActive = false;
      try { recognition.stop(); } catch(e) {}
      isListening = false;
      updateSpeechStatus(false);
    }
  } else {
    // Restart if we were in recite mode with mic active
    if (practiceMode === 'recite' && speechEnabled && speechSupported) {
      setTimeout(() => {
        if (practiceMode === 'recite' && !isListening) {
          recognitionActive = true;
          try { recognition.start(); isListening = true; updateSpeechStatus(true); } catch(e) {}
        }
      }, 300);
    }
  }
});

window.addEventListener('pagehide', () => {
  recognitionActive = false;
  if (recognition) { try { recognition.stop(); } catch(e) {} }
});

// Levenshtein edit distance
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] :
        1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function wordsMatch(word1, word2, threshold = 0.65) {
  const w1 = word1.toLowerCase().replace(/[^a-z]/g, '');
  const w2 = word2.toLowerCase().replace(/[^a-z]/g, '');
  if (!w1 || !w2) return false;
  if (w1 === w2) return true;
  const dist = editDistance(w1, w2);
  const maxLen = Math.max(w1.length, w2.length);
  return (1 - dist / maxLen) >= threshold;
}

// Start/reset recognition for a user sentence
// If mic already active, just reset matching state (no restart = no prompt sound)
function startSpeechRecognition(sentenceText, allMatchedCallback) {
  if (!speechSupported || !speechEnabled) return;
  
  matchedWordCount = 0;
  finalTranscript = '';
  currentSentenceWords = sentenceText.split(/\s+/).filter(w => w.length > 0);
  onAllMatched = allMatchedCallback;
  ignoreResults = false;
  lastMatchedSpokenIdx = -1;
  
  renderSentenceBlanks();
  
  if (!recognitionActive) {
    // First time starting - mic will open (one prompt sound)
    recognitionActive = true;
    try {
      recognition.start();
      isListening = true;
      updateSpeechStatus(true);
      console.log('Speech recognition started (iOS Safari:', isIOSSafari, ', continuous:', recognition.continuous, ')');
    } catch(e) {
      console.warn('Recognition start failed:', e);
      recognitionActive = false;
      // Don't alert here - onerror handler will show specific error
    }
  }
  // If already active, mic stays open - no prompt sound, just reset matching
}

// Pause: keep mic open but ignore results (during other characters' lines)
function pauseRecognition() {
  ignoreResults = true;
}

// Resume: start accepting results again for new sentence
function resumeRecognition(sentenceText, allMatchedCallback) {
  startSpeechRecognition(sentenceText, allMatchedCallback);
}

// Full stop: close mic (only at end of practice or mode switch)
function stopSpeechRecognition() {
  if (autoContinueTimer) {
    clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
  }
  recognitionActive = false;
  ignoreResults = false;
  if (recognition && isListening) {
    isListening = false;
    try { recognition.stop(); } catch(e) {}
    updateSpeechStatus(false);
  }
}

function matchWords(transcript) {
  if (!currentSentenceWords.length || ignoreResults) return;
  
  const spokenWords = transcript.split(/\s+/).filter(w => w.length > 0);
  if (!spokenWords.length) return;
  
  let newMatches = 0;
  const searchWindow = 3;  // only look ahead 3 words from last match position
  
  while (matchedWordCount < currentSentenceWords.length) {
    const targetWord = currentSentenceWords[matchedWordCount];
    // Start searching from after the last matched position (strictly sequential)
    const startIdx = Math.max(0, lastMatchedSpokenIdx + 1);
    const endIdx = Math.min(spokenWords.length, startIdx + searchWindow);
    let found = false;
    let foundIdx = -1;
    
    for (let i = startIdx; i < endIdx; i++) {
      // 1. Single word match
      if (wordsMatch(targetWord, spokenWords[i])) {
        found = true;
        foundIdx = i;
        break;
      }
      // 2. Two-word compound (e.g. "ground water" -> "groundwater", "single use" -> "single-use")
      if (i + 1 < spokenWords.length) {
        const compound2 = spokenWords[i] + spokenWords[i+1];
        if (wordsMatch(targetWord, compound2)) {
          found = true;
          foundIdx = i + 1;
          break;
        }
      }
      // 3. Three-word compound (e.g. "hard to recycle" -> "hard-to-recycle")
      if (i + 2 < spokenWords.length) {
        const compound3 = spokenWords[i] + spokenWords[i+1] + spokenWords[i+2];
        if (wordsMatch(targetWord, compound3)) {
          found = true;
          foundIdx = i + 2;
          break;
        }
      }
    }
    
    if (found) {
      matchedWordCount++;
      newMatches++;
      lastMatchedSpokenIdx = foundIdx;
    } else {
      break;
    }
  }
  
  if (newMatches > 0) {
    renderSentenceBlanks();
  }
  
  // All words matched - auto continue after delay
  if (matchedWordCount >= currentSentenceWords.length && onAllMatched && !autoContinueTimer) {
    autoContinueTimer = setTimeout(() => {
      autoContinueTimer = null;
      if (onAllMatched) {
        const cb = onAllMatched;
        onAllMatched = null;
        cb();
      }
    }, 800);
  }
}

function renderSentenceBlanks() {
  const currentEl = document.querySelector('.sentence.current .sentence-text');
  if (!currentEl) return;
  
  let html = '';
  currentSentenceWords.forEach((word, i) => {
    if (i < matchedWordCount) {
      html += `<span class="word-revealed">${word}</span> `;
    } else {
      const display = word.replace(/[a-zA-Z]/g, '_');
      html += `<span class="word-blank">${display}</span> `;
    }
  });
  currentEl.innerHTML = html;
}

function showFullSentence() {
  const currentEl = document.querySelector('.sentence.current .sentence-text');
  if (!currentEl || !currentSentenceWords.length) return;
  currentEl.innerHTML = currentSentenceWords.join(' ');
}

function restoreSentenceBlanks() {
  renderSentenceBlanks();
}

function finalizeSentenceBlanks() {
  const currentEl = document.querySelector('.sentence.current .sentence-text');
  if (!currentEl || !currentSentenceWords.length) return;
  
  let html = '';
  currentSentenceWords.forEach((word, i) => {
    if (i < matchedWordCount) {
      html += `<span class="word-revealed">${word}</span> `;
    } else {
      html += `<span class="word-missed">${word}</span> `;
    }
  });
  currentEl.innerHTML = html;
}

function updateSpeechStatus(listening) {
  const el = document.getElementById('speechStatus');
  if (el) {
    el.style.display = listening ? 'inline-flex' : 'none';
  }
}
