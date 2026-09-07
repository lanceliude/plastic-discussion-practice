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
  
  // Pause recognition during TTS playback (avoid recognizing TTS audio)
  const wasIgnoring = ignoreResults;
  pauseRecognition();
  
  // Resume recognition - with safety timeout in case onend/onerror doesn't fire
  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    if (!wasIgnoring) {
      ignoreResults = false;
      finalTranscript = '';
      lastMatchedSpokenIdx = -1;
    }
  };
  utterance.onend = resume;
  utterance.onerror = resume;
  setTimeout(resume, 5000);  // force resume after 5s max
  
  window.speechSynthesis.speak(utterance);
}

// Local fallback dictionary for common words in this script
const LOCAL_DICT = {
  'plastic': '塑料', 'pollution': '污染', 'discussion': '讨论', 'morning': '早上',
  'everyone': '大家', 'thank': '感谢', 'joining': '参加', 'today': '今天',
  'talk': '谈论', 'about': '关于', 'first': '首先', 'discuss': '讨论',
  'main': '主要的', 'sources': '来源', 'impacts': '影响', 'ecosystem': '生态系统',
  'human': '人类的', 'health': '健康', 'then': '然后', 'look': '看',
  'individuals': '个人', 'technology': '技术', 'policies': '政策', 'help': '帮助',
  'reduce': '减少', 'begin': '开始', 'who': '谁', 'would': '愿意',
  'like': '喜欢/像', 'start': '开始', 'research': '研究', 'read': '读',
  'packaging': '包装', 'major': '主要的', 'source': '来源', 'many': '许多',
  'bottles': '瓶子', 'bags': '袋子', 'food': '食物', 'containers': '容器',
  'used': '使用过的', 'only': '只', 'once': '一次', 'thrown': '扔',
  'away': '离开', 'waste': '垃圾/浪费', 'remain': '保持/剩余', 'years': '年',
  'good': '好的', 'point': '观点', 'think': '认为', 'people': '人们',
  'mainly': '主要地', 'responsible': '有责任的', 'companies': '公司',
  'also': '也', 'producing': '生产', 'too': '太', 'much': '多',
  'both': '两者都', 'choose': '选择', 'products': '产品', 'less': '更少',
  'decisions': '决定', 'how': '如何', 'packaged': '包装的', 'another': '另一个',
  'issue': '问题', 'consider': '考虑', 'poor': '差的', 'management': '管理',
  'shows': '显示', 'million': '百万', 'tonnes': '吨', 'leaked': '泄漏',
  'environment': '环境', 'because': '因为', 'collected': '收集', 'managed': '管理',
  'well': '好', 'agree': '同意', 'focus': '关注', 'large': '大的',
  'items': '物品', 'microplastics': '微塑料', 'tyre': '轮胎', 'wear': '磨损',
  'brake': '刹车', 'washing': '洗', 'synthetic': '合成的', 'clothes': '衣服',
  'release': '释放', 'tiny': '微小的', 'particles': '颗粒', 'visible': '可见的',
  'harder': '更难', 'notice': '注意', 'important': '重要的', 'different': '不同的',
  'enter': '进入', 'happen': '发生', 'gets': '得到', 'ecological': '生态的',
  'harm': '伤害', 'marine': '海洋的', 'animals': '动物', 'mistake': '误认为',
  'food': '食物', 'trapped': '困住', 'fishing': '捕鱼', 'nets': '网',
  'stop': '停止', 'feeding': '进食', 'moving': '移动', 'escaping': '逃离',
  'danger': '危险', 'exactly': '确切地', 'impact': '影响', 'limited': '有限的',
  'soil': '土壤', 'groundwater': '地下水', 'rivers': '河流', 'oceans': '海洋',
  'breaks': '分解', 'small': '小的', 'pieces': '碎片', 'chains': '链',
  'therefore': '因此', 'affect': '影响', 'balance': '平衡', 'whole': '整个的',
  'ecosystems': '生态系统', 'true': '真的', 'besides': '此外', 'contributes': '贡献',
  'climate': '气候', 'change': '变化', 'lifecycles': '生命周期', 'produce': '生产',
  'great': '大量的', 'deal': '量', 'greenhouse': '温室', 'gas': '气体',
  'emissions': '排放', 'both': '两者都', 'problem': '问题', 'yes': '是的',
  'however': '然而', 'may': '可能', 'affect': '影响', 'especially': '尤其',
  'example': '例子', 'take': '摄入', 'through': '通过', 'drinking': '喝',
  'water': '水', 'worrying': '令人担忧的', 'bodies': '身体', 'ways': '方式',
  'breathe': '呼吸', 'fibres': '纤维', 'air': '空气', 'household': '家庭的',
  'materials': '材料', 'addition': '此外', 'contain': '包含', 'harmful': '有害的',
  'chemicals': '化学物质', 'leading': '导致', 'various': '各种', 'diseases': '疾病',
  'means': '意味着', 'environmental': '环境的', 'serious': '严重的', 'concern': '关切',
  'next': '下一个', 'question': '问题', 'what': '什么', 'can': '能',
  'do': '做', 'one': '一个', 'thing': '事情', 'refusing': '拒绝',
  'unnecessary': '不必要的', 'single': '单一的', 'use': '使用', 'items': '物品',
  'bring': '带', 'reusable': '可重复使用的', 'shopping': '购物', 'coffee': '咖啡',
  'cups': '杯子', 'actions': '行动', 'seem': '似乎', 'often': '经常',
  'work': '工作', 'remember': '记得', 'buy': '买', 'loose': '散装的',
  'fruit': '水果', 'vegetables': '蔬菜', 'refill': '续装', 'options': '选项',
  'realistic': '现实的', 'everyone': '每个人', 'equally': '平等地', 'easy': '容易',
  'shops': '商店', 'available': '可用的', 'every': '每个', 'area': '地区',
  'still': '仍然', 'changes': '改变', 'such': '比如', 'reusing': '重复使用',
  'following': '遵循', 'local': '当地的', 'recycling': '回收', 'rules': '规则',
  'individual': '个人的', 'actions': '行动', 'helpful': '有帮助的', 'solve': '解决',
  'alone': '独自', 'need': '需要', 'other': '其他的', 'solutions': '解决方案',
  'innovation': '创新', 'better': '更好的', 'automated': '自动化的', 'systems': '系统',
  'identify': '识别', 'sort': '分类', 'accurately': '准确地', 'improve': '改善',
  'quality': '质量', 'recycled': '回收的', 'useful': '有用的', 'types': '类型',
  'cannot': '不能', 'always': '总是', 'together': '一起', 'microfibre': '微纤维',
  'filters': '过滤器', 'machines': '机器', 'capture': '捕获', 'before': '之前',
  'wastewater': '废水', 'waterways': '水道', 'prevention': '预防', 'trying': '尝试',
  'remove': '移除', 'reaches': '到达', 'ocean': '海洋', 'companies': '公司',
  'design': '设计', 'easier': '更容易', 'fewer': '更少', 'mixed': '混合的',
  'materials': '材料', 'technologies': '技术', 'support': '支持', 'clear': '清晰的',
  'rules': '规则', 'therefore': '因此', 'governments': '政府', 'important': '重要的',
  'role': '角色', 'zealand': '新西兰', 'phased': '逐步', 'out': '淘汰',
  'hard': '难的', 'produce': '生产', 'including': '包括', 'plates': '盘子',
  'bowls': '碗', 'cutlery': '餐具', 'bans': '禁令', 'unnecessary': '不必要的',
  'suitable': '合适的', 'alternatives': '替代品', 'create': '创造', 'difficulties': '困难',
  'small': '小的', 'businesses': '企业', 'time': '时间', 'money': '钱',
  'find': '找到', 'new': '新的', 'possible': '可能的', 'give': '给',
  'enough': '足够的', 'prepare': '准备', 'require': '要求', 'clearer': '更清晰的',
  'labels': '标签', 'approach': '方法', 'tax': '税', 'encourage': '鼓励',
  'deposit': '押金', 'return': '归还', 'scheme': '计划', 'drink': '喝',
  'could': '能', 'mention': '提到', 'international': '国际的', 'cooperation': '合作',
  'crosses': '跨越', 'national': '国家的', 'borders': '边界', 'share': '分享',
  'improve': '改善', 'lower': '更低的', 'income': '收入', 'countries': '国家',
  'without': '没有', 'still': '仍然', 'affect': '影响', 'another': '另一个',
  'country': '国家', 'summarise': '总结', 'harmful': '有害的', 'single': '单一的',
  'action': '行动', 'correctly': '正确地', 'totally': '完全地', 'agree': '同意',
  'insightful': '有见地的', 'thanks': '谢谢', 'see': '看见', 'next': '下一个'
};

// Translate a word using MyMemory API (CORS-enabled, free, no API key)
async function translateWord(word) {
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanWord) return '';
  
  // Check local dictionary first
  if (LOCAL_DICT[cleanWord]) return LOCAL_DICT[cleanWord];
  
  // Check cache
  const cache = getTranslationCache();
  if (cache[cleanWord]) return cache[cleanWord];
  
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanWord)}&langpair=en|zh-CN`;
    const response = await fetch(url);
    const data = await response.json();
    const translation = data && data.responseData && data.responseData.translatedText ? data.responseData.translatedText : '';
    if (translation && translation !== cleanWord) {
      setTranslationCache(cleanWord, translation);
      return translation;
    }
    return '翻译不可用';
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
  
  // Position tooltip after browser reflow (requestAnimationFrame ensures correct positioning)
  requestAnimationFrame(() => {
    let left = clickX;
    left = Math.max(120, Math.min(left, window.innerWidth - 120));
    let top = clickY - 100;
    if (top < 10) top = clickY + 30;
    
    wordTooltip.style.left = left + 'px';
    wordTooltip.style.top = top + 'px';
  });
  
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

// Click delegation: detect clicks on word spans (ONLY within current sentence)
// Bound to transcriptEl (registered before app.js's paragraph jump listener)
// so we can stopPropagation and prevent resetting matched state.
const transcriptElForWords = document.getElementById('transcript');
if (transcriptElForWords) {
  transcriptElForWords.addEventListener('click', (e) => {
    // Only trigger word lookup within the CURRENT sentence
    // Clicking words in other sentences lets event bubble to select that paragraph
    const wordSpan = e.target.closest('.sentence.current .sentence-text span');
    if (wordSpan) {
      e.stopImmediatePropagation();  // prevent paragraph jump listener on same element
      // Prefer data-word attribute (works for blank lines too), fallback to textContent
      const word = (wordSpan.dataset.word || wordSpan.textContent || '').trim();
      if (word && !/^_+$/.test(word)) {
        const rect = wordSpan.getBoundingClientRect();
        showWordTooltip(word, rect.left + rect.width / 2, rect.top);
        // Auto-speak the word
        speakWord(word);
      }
    }
  });
}

// Click elsewhere on page: hide tooltip
document.addEventListener('click', (e) => {
  if (!e.target.closest('.word-tooltip') && !e.target.closest('.sentence.current .sentence-text span')) {
    hideWordTooltip();
  }
});

// Stop TTS when page hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
});
