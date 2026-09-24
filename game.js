// ===== 끄글 (끝말잇기) 핵심 로직 =====
const Game = (() => {
  let wordSet = null;
  let byFirstSyll = null; // syllable -> array of words (lazy)
  let allWords = null;

  function init() {
    if (wordSet) return;
    allWords = window.WORDS_RAW.split('\n').filter(Boolean);
    wordSet = new Set(allWords);
  }

  function firstSyll(w) { return w[0]; }
  function lastSyll(w) { return w[w.length - 1]; }

  function equivClass(syll) {
    const eq = window.EQUIV_MAP[syll];
    return eq && eq.length ? eq : [syll];
  }

  // 주어진 요구 음절(requiredSyll)에 대해 실제로 허용되는 "시작 음절" 후보군
  function acceptableStarts(requiredSyll) {
    return equivClass(requiredSyll);
  }

  // word 가 requiredSyll 로 시작하는 단어로서 유효한지 (두음법칙 동치류 포함)
  function startsWithRequirement(word, requiredSyll) {
    const starts = acceptableStarts(requiredSyll);
    return starts.includes(firstSyll(word));
  }

  function exists(word) {
    init();
    return wordSet.has(word);
  }

  // 검증: {ok:boolean, reason?:string}
  function validateMove(word, requiredSyll, usedWordsSet) {
    init();
    word = (word || '').trim();
    if (!word) return { ok: false, reason: '단어를 입력하세요.' };
    if (word.length < 2) return { ok: false, reason: '두 글자 이상의 단어를 입력하세요.' };
    if (!/^[가-힣]+$/.test(word)) return { ok: false, reason: '한글 단어만 입력할 수 있습니다.' };
    if (usedWordsSet.has(word)) return { ok: false, reason: '이미 사용된 단어입니다.' };
    if (requiredSyll && !startsWithRequirement(word, requiredSyll)) {
      return { ok: false, reason: `'${requiredSyll}'(으)로 시작하는 단어가 아닙니다.` };
    }
    if (!exists(word)) return { ok: false, reason: '사전에 없는 단어입니다.' };
    return { ok: true };
  }

  // requiredSyll 로 이어갈 수 있는 단어가 사전상 하나라도 남아있는지(막힘 판정)
  function hasAnyContinuation(requiredSyll, usedWordsSet) {
    init();
    const starts = acceptableStarts(requiredSyll);
    for (const w of allWords) {
      if (usedWordsSet.has(w)) continue;
      if (starts.includes(firstSyll(w))) return true;
    }
    return false;
  }

  function randomStartWord() {
    init();
    // 2~3글자 흔한 단어 위주로 시작하기 위해 후보를 좁힘
    const pool = allWords.filter(w => w.length >= 2 && w.length <= 3);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function hint(requiredSyll, usedWordsSet) {
    init();
    const starts = acceptableStarts(requiredSyll);
    for (const s of starts) {
      const h = window.HINT_MAP[s];
      if (h && !usedWordsSet.has(h) && exists(h)) return h;
    }
    // 힌트 사전에 없으면 사전 전체에서 탐색
    for (const w of allWords) {
      if (!usedWordsSet.has(w) && starts.includes(firstSyll(w))) return w;
    }
    return null;
  }

  return {
    init, firstSyll, lastSyll, exists, validateMove,
    hasAnyContinuation, randomStartWord, hint, equivClass
  };
})();
