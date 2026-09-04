// Speech Recognition + incremental word reveal (Duolingo-style)
let recognition = null;
let speechSupported = false;
let speechEnabled = true;
let isListening = false;
let matchedWordCount = 0;
let currentSentenceWords = [];
let finalTranscript = '';
let onAllMatched = null;  // callback when all words matched
let autoContinueTimer = null;

// Detect support
(function initSpeechDetection() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    speechSupported = true;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
  }
})();

// Mic on-demand: stop when page hidden, restart when visible and still my turn
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page hidden (switched to another app) - stop mic immediately
    if (isListening && recognition) {
      try { recognition.stop(); } catch(e) {}
      isListening = false;
      updateSpeechStatus(false);
    }
  } else {
    // Page visible again - restart mic if still in recite mode my turn
    if (isMyTurn && practiceMode === 'recite' && speechEnabled && speechSupported) {
      setTimeout(() => {
        if (isMyTurn && !isListening) {
          try { recognition.start(); isListening = true; updateSpeechStatus(true); } catch(e) {}
        }
      }, 300);
    }
  }
});

// Also stop on page unload
window.addEventListener('pagehide', () => {
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

function startSpeechRecognition(sentenceText, allMatchedCallback) {
  if (!speechSupported || !speechEnabled) return;
  
  matchedWordCount = 0;
  finalTranscript = '';
  currentSentenceWords = sentenceText.split(/\s+/).filter(w => w.length > 0);
  onAllMatched = allMatchedCallback;
  
  renderSentenceBlanks();
  
  try {
    recognition.start();
    isListening = true;
    updateSpeechStatus(true);
  } catch(e) {
    console.warn('Recognition start failed:', e);
  }
  
  recognition.onresult = (event) => {
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
    if (final) finalTranscript += final;
    const combined = (finalTranscript + ' ' + interim).trim();
    matchWords(combined);
  };
  
  // Auto-restart ONLY if page is visible and still my turn
  recognition.onend = () => {
    if (isMyTurn && practiceMode === 'recite' && speechEnabled && !document.hidden) {
      try { recognition.start(); } catch(e) {}
    } else {
      isListening = false;
      updateSpeechStatus(false);
    }
  };
  
  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      speechEnabled = false;
      alert('麦克风权限被拒绝，语音识别已关闭。可在显示选项中重新开启。');
    }
  };
}

function stopSpeechRecognition() {
  if (autoContinueTimer) {
    clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
  }
  if (recognition && isListening) {
    isListening = false;
    try { recognition.onend = null; recognition.stop(); } catch(e) {}
    updateSpeechStatus(false);
  }
}

function matchWords(transcript) {
  if (!currentSentenceWords.length) return;
  
  const spokenWords = transcript.split(/\s+/).filter(w => w.length > 0);
  if (!spokenWords.length) return;
  
  let newMatches = 0;
  const lookahead = 5;
  
  while (matchedWordCount < currentSentenceWords.length) {
    const targetWord = currentSentenceWords[matchedWordCount];
    const startIdx = Math.max(0, spokenWords.length - lookahead - newMatches);
    let found = false;
    for (let i = startIdx; i < spokenWords.length; i++) {
      if (wordsMatch(targetWord, spokenWords[i])) {
        found = true;
        break;
      }
    }
    if (found) {
      matchedWordCount++;
      newMatches++;
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
