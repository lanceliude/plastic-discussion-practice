// Speech Recognition + incremental word reveal (Duolingo-style)
// Mic stays open throughout recite mode to avoid repeated iOS system prompt sounds
let recognition = null;
let speechSupported = false;
let speechEnabled = true;
let isListening = false;
let recognitionActive = false;  // mic is open (even if ignoring results)
let ignoreResults = false;      // ignore results during other characters' lines
let matchedWords = [];  // array of booleans: which target words have been matched (allows skipping)
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
  
  // Use both interim (real-time) and final results for fast feedback.
  // The new matching algorithm allows skipping unrecognized words,
  // so one unclear word won't block all following words.
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
  if (combined) {
    matchWords(combined);
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
  
  finalTranscript = '';
  currentSentenceWords = sentenceText.split(/\s+/).filter(w => w.length > 0);
  matchedWords = new Array(currentSentenceWords.length).fill(false);
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

// Resume recognition without resetting matched state (after playing original audio)
function resumeRecognitionKeepState() {
  ignoreResults = false;
  finalTranscript = '';  // clear any audio recognized during playback
  lastMatchedSpokenIdx = -1;
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
  let lastSpokenIdx = lastMatchedSpokenIdx;  // track position in spoken words (must increase)
  
  // Iterate ALL target words - allow skipping words that weren't recognized clearly
  // (Duolingo-style: one missed word doesn't block all following words)
  for (let targetIdx = 0; targetIdx < currentSentenceWords.length; targetIdx++) {
    if (matchedWords[targetIdx]) continue;  // already matched
    
    const targetWord = currentSentenceWords[targetIdx];
    let found = false;
    let foundIdx = -1;
    
    // Search from after the last matched position (ensures order, allows gaps)
    const startIdx = Math.max(0, lastSpokenIdx + 1);
    const endIdx = spokenWords.length;  // search all remaining words (not limited window)
    
    for (let i = startIdx; i < endIdx; i++) {
      // 1. Single word match
      if (wordsMatch(targetWord, spokenWords[i])) {
        found = true;
        foundIdx = i;
        break;
      }
      // 2. Two-word compound (e.g. "ground water" -> "groundwater")
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
      matchedWords[targetIdx] = true;
      lastSpokenIdx = foundIdx;
      lastMatchedSpokenIdx = foundIdx;
      newMatches++;
    }
    // If not found: DON'T break, continue to next target word (allow skipping)
  }
  
  if (newMatches > 0) {
    renderSentenceBlanks();
  }
  
  // All words matched - auto continue after delay
  const allMatched = matchedWords.length > 0 && matchedWords.every(m => m);
  if (allMatched && onAllMatched && !autoContinueTimer) {
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
    if (matchedWords[i]) {
      html += `<span class="word-revealed" data-word="${word}">${word}</span> `;
    } else {
      const display = word.replace(/[a-zA-Z]/g, '_');
      html += `<span class="word-blank" data-word="${word}">${display}</span> `;
    }
  });
  currentEl.innerHTML = html;
}

function showFullSentence() {
  const currentEl = document.querySelector('.sentence.current .sentence-text');
  if (!currentEl || !currentSentenceWords.length) return;
  // Hint mode: matched words stay green, unmatched words show in orange
  // Spacing stays identical (each word occupies same space)
  let html = '';
  currentSentenceWords.forEach((word, i) => {
    if (matchedWords[i]) {
      html += `<span class="word-revealed" data-word="${word}">${word}</span> `;
    } else {
      html += `<span class="word-hint" data-word="${word}">${word}</span> `;
    }
  });
  currentEl.innerHTML = html;
}

function restoreSentenceBlanks() {
  renderSentenceBlanks();
}

function finalizeSentenceBlanks() {
  const currentEl = document.querySelector('.sentence.current .sentence-text');
  if (!currentEl || !currentSentenceWords.length) return;
  
  let html = '';
  currentSentenceWords.forEach((word, i) => {
    if (matchedWords[i]) {
      html += `<span class="word-revealed" data-word="${word}">${word}</span> `;
    } else {
      html += `<span class="word-missed" data-word="${word}">${word}</span> `;
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

// ========== Word TTS + Translation (click any word) ==========

let wordTooltip = null;
let tooltipWordEl = null;
let tooltipTranslationEl = null;
let tooltipTtsBtn = null;

// Translation cache (localStorage)
const TRANSLATION_CACHE_KEY = 'dp_word_translations';
function getTranslationCache() {
  try { return JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || '{}'); }
  catch(e) { return {}; }
}
function setTranslationCache(word, translation) {
  try {
    const cache = getTranslationCache();
    cache[word.toLowerCase()] = translation;
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch(e) {}
}

// Speak a word using browser TTS
function speakWord(word) {
  if (!word || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.85;
  window.speechSynthesis.speak(utterance);
}

// Translate a word using Google Translate free endpoint
async function translateWord(word) {
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanWord) return '';
  
  // Check cache first
  const cache = getTranslationCache();
  if (cache[cleanWord]) return cache[cleanWord];
  
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(cleanWord)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translation = data && data[0] && data[0][0] && data[0][0][0] ? data[0][0][0] : '';
    if (translation) {
      setTranslationCache(cleanWord, translation);
    }
    return translation || '翻译不可用';
  } catch(e) {
    console.warn('Translation failed:', e);
    return '翻译不可用';
  }
}

// Show word tooltip near click position
function showWordTooltip(word, clickX, clickY) {
  if (!wordTooltip) {
    wordTooltip = document.getElementById('wordTooltip');
    tooltipWordEl = document.getElementById('tooltipWord');
    tooltipTranslationEl = document.getElementById('tooltipTranslation');
    tooltipTtsBtn = document.getElementById('tooltipTtsBtn');
    
    tooltipTtsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakWord(tooltipWordEl.textContent);
    });
  }
  
  tooltipWordEl.textContent = word;
  tooltipTranslationEl.textContent = '加载中...';
  wordTooltip.style.display = 'block';
  
  // Position tooltip above the clicked word
  const tooltipWidth = 200;
  let left = clickX - tooltipWidth / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
  let top = clickY - 100;
  if (top < 10) top = clickY + 30;
  
  wordTooltip.style.left = left + 'px';
  wordTooltip.style.top = top + 'px';
  
  // Fetch translation
  translateWord(word).then(translation => {
    if (tooltipWordEl.textContent === word) {
      tooltipTranslationEl.textContent = translation;
    }
  });
}

function hideWordTooltip() {
  if (wordTooltip) {
    wordTooltip.style.display = 'none';
  }
}

// Click delegation: detect clicks on word spans
document.addEventListener('click', (e) => {
  const wordSpan = e.target.closest('.sentence-text span');
  if (wordSpan) {
    e.stopPropagation();
    // Prefer data-word attribute (works for blank lines too), fallback to textContent
    const word = (wordSpan.dataset.word || wordSpan.textContent || '').trim();
    if (word && !/^_+$/.test(word)) {
      const rect = wordSpan.getBoundingClientRect();
      showWordTooltip(word, rect.left + rect.width / 2, rect.top);
      // Auto-speak the word
      speakWord(word);
    }
    return;
  }
  // Click elsewhere: hide tooltip
  hideWordTooltip();
});

// Stop TTS when page hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
});
