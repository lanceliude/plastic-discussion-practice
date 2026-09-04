// Speech Recognition + incremental word reveal (Duolingo-style)
let recognition = null;
let speechSupported = false;
let speechEnabled = true;  // can be toggled off
let isListening = false;
let matchedWordCount = 0;  // how many words of current sentence have been matched
let currentSentenceWords = [];  // words of current user sentence
let finalTranscript = '';  // accumulated stable transcript

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

// Fuzzy match: similarity > threshold counts as match
function wordsMatch(word1, word2, threshold = 0.65) {
  const w1 = word1.toLowerCase().replace(/[^a-z]/g, '');
  const w2 = word2.toLowerCase().replace(/[^a-z]/g, '');
  if (!w1 || !w2) return false;
  if (w1 === w2) return true;
  const dist = editDistance(w1, w2);
  const maxLen = Math.max(w1.length, w2.length);
  return (1 - dist / maxLen) >= threshold;
}

// Start speech recognition for a user sentence
function startSpeechRecognition(sentenceText) {
  if (!speechSupported || !speechEnabled) return;
  
  // Reset for new sentence
  matchedWordCount = 0;
  finalTranscript = '';
  currentSentenceWords = sentenceText.split(/\s+/).filter(w => w.length > 0);
  
  // Render blanks
  renderSentenceBlanks();
  
  // Start recognition
  try {
    recognition.start();
    isListening = true;
    updateSpeechStatus(true);
  } catch(e) {
    console.warn('Recognition start failed:', e);
  }
  
  // Handle results
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
  
  // Auto-restart on iOS (60s limit)
  recognition.onend = () => {
    if (isMyTurn && speechEnabled) {
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
      alert('麦克风权限被拒绝，语音识别已关闭。可在设置中重新开启。');
    }
  };
}

// Stop speech recognition
function stopSpeechRecognition() {
  if (recognition && isListening) {
    isListening = false;
    try { recognition.stop(); } catch(e) {}
    updateSpeechStatus(false);
  }
}

// Incremental word matching
function matchWords(transcript) {
  if (!currentSentenceWords.length) return;
  
  const spokenWords = transcript.split(/\s+/).filter(w => w.length > 0);
  if (!spokenWords.length) return;
  
  // Try to match more words from where we left off
  // Use a sliding window: check if next script word appears in recent spoken words
  let newMatches = 0;
  const lookahead = 5;  // look at last N spoken words for match
  
  while (matchedWordCount < currentSentenceWords.length) {
    const targetWord = currentSentenceWords[matchedWordCount];
    // Check recent spoken words for a match
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
}

// Render sentence with blanks for unmatched words
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

// When user finishes their turn, mark unmatched words
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
