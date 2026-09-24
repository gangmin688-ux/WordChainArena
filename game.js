// ===== 끄글 (끝말잇기) 핵심 로직 + 설정 + 필승 분석 엔진 =====
const Game = (() => {
  const DEFAULTS = { dueum: 'full', minLen: 2, turnSeconds: 30, banHanbang: false,
                     startMode: 'random', startSyll: '', assist: true };
  let S = { ...DEFAULTS };
  let wordSet = null, allWords = null;
  const cache = {}; // `${dueum}|${minLen}` -> { ix, solved }

  const HANGUL = /^[가-힣]+$/;
  const first = w => w[0], last = w => w[w.length - 1];
  const initial = c => Math.floor((c.charCodeAt(0) - 0xAC00) / 588); // ㄴ=2 ㄹ=5 ㅇ=11

  function setSettings(o) { S = { ...DEFAULTS, ...(o || {}) }; }
  function getSettings() { return S; }

  function init() {
    if (wordSet) return;
    allWords = window.WORDS_RAW.split('\n').filter(Boolean);
    wordSet = new Set(allWords);
  }

  // 요구 음절(r)에 대해 시작 글자로 허용되는 음절 목록 (두음법칙 설정 반영)
  function acceptableStarts(r) {
    const eq = window.EQUIV_MAP[r];
    const cls = eq && eq.length ? eq : [r];
    if (S.dueum === 'full') return cls;                 // 끄글 데이터 그대로 (양방향 동치)
    if (S.dueum === 'none' || cls.length < 2) return [r];
    const ri = initial(r);                              // 표준: 한 방향만 (ㄹ→ㄴ/ㅇ, ㄴ→ㅇ)
    return cls.filter(m => m === r ||
      (ri === 5 && (initial(m) === 2 || initial(m) === 11)) ||
      (ri === 2 && initial(m) === 11));
  }

  function bucket() {
    init();
    const k = S.dueum + '|' + S.minLen;
    if (cache[k]) return cache[k];
    const ix = new Map();
    for (const w of allWords) {
      if (w.length < S.minLen || !HANGUL.test(w)) continue;
      const f = first(w);
      if (!ix.has(f)) ix.set(f, []);
      ix.get(f).push(w);
    }
    return (cache[k] = { ix, solved: null });
  }

  function exists(w) { init(); return wordSet.has(w); }

  // r 로 이어갈 수 있는 미사용 단어들
  function candidates(r, used, extra) {
    const { ix } = bucket(), out = [];
    for (const s of acceptableStarts(r))
      for (const w of ix.get(s) || []) if (!used.has(w) && w !== extra) out.push(w);
    return out;
  }
  function hasAnyContinuation(r, used, extra) {
    const { ix } = bucket();
    for (const s of acceptableStarts(r))
      for (const w of ix.get(s) || []) if (!used.has(w) && w !== extra) return true;
    return false;
  }

  function validateMove(word, requiredSyll, used) {
    init();
    word = (word || '').trim();
    if (!word) return { ok: false, reason: '단어를 입력하세요.' };
    if (word.length < S.minLen) return { ok: false, reason: `${S.minLen}글자 이상의 단어를 입력하세요.` };
    if (!HANGUL.test(word)) return { ok: false, reason: '한글 단어만 입력할 수 있습니다.' };
    if (used.has(word)) return { ok: false, reason: '이미 사용된 단어입니다.' };
    if (requiredSyll && !acceptableStarts(requiredSyll).includes(first(word)))
      return { ok: false, reason: `'${requiredSyll}'(으)로 시작하는 단어가 아닙니다.` };
    if (!exists(word)) return { ok: false, reason: '사전에 없는 단어입니다.' };
    if (S.banHanbang && !hasAnyContinuation(last(word), used, word))
      return { ok: false, reason: '한방 단어(상대가 이을 수 없는 단어)는 금지입니다.' };
    return { ok: true };
  }

  // ---- 필승 분석: 음절 그래프 후방탐색 (사용된 단어는 무시한 근사) ----
  // 결과: Map(음절 -> {r:'W'|'L', d:깊이})  ※ 해당 음절을 "받은" 사람 기준 W=필승, L=필패
  function solve() {
    const b = bucket();
    if (b.solved) return b.solved;
    const lastSets = new Map(), nodes = new Set();
    for (const [f, ws] of b.ix) {
      const s = new Set(ws.map(last));
      lastSets.set(f, s); s.forEach(x => nodes.add(x));
    }
    const T = new Map();
    const targets = s => {
      let t = T.get(s);
      if (!t) {
        t = new Set();
        for (const f of acceptableStarts(s)) (lastSets.get(f) || []).forEach(x => t.add(x));
        T.set(s, t);
      }
      return t;
    };
    const res = new Map();
    for (let round = 0, changed = true; changed && round < 500; round++) {
      changed = false;
      const add = [];
      for (const s of nodes) {
        if (res.has(s)) continue;
        const t = targets(s);
        if (!t.size) { add.push([s, 'L', 0]); continue; }
        let minL = Infinity, maxW = -1, allW = true;
        for (const x of t) {
          const v = res.get(x);
          if (v && v.r === 'L') minL = Math.min(minL, v.d);
          else if (v && v.r === 'W') maxW = Math.max(maxW, v.d);
          else allW = false;
        }
        if (minL < Infinity) add.push([s, 'W', minL + 1]);
        else if (allW) add.push([s, 'L', maxW + 1]);
      }
      add.forEach(([s, r, d]) => { res.set(s, { r, d }); changed = true; });
    }
    return (b.solved = res);
  }

  // word 다음 차례 사람이 "질 수밖에 없게" 만드는 단어들 (깊이 오름차순)
  function winWords(word, used) {
    const res = solve(), u = new Set(used || []);
    u.add(word);
    const out = [];
    for (const c of candidates(last(word), u)) {
      const l = last(c);
      if (!hasAnyContinuation(l, u, c)) { out.push({ word: c, depth: 0 }); continue; } // 즉시 한방
      const v = res.get(l);
      if (v && v.r === 'L') out.push({ word: c, depth: v.d });
    }
    return out.sort((a, b) => a.depth - b.depth || a.word.length - b.word.length || (a.word < b.word ? -1 : 1));
  }

  function newStart() {
    init();
    if (S.startMode === 'syll' && /^[가-힣]$/.test(S.startSyll || ''))
      return { word: null, syll: S.startSyll, label: '시작 글자' };
    const res = solve();
    let w;
    for (let i = 0; i < 3000; i++) {
      w = allWords[Math.floor(Math.random() * allWords.length)];
      if (w.length < S.minLen || w.length > S.minLen + 1 || !HANGUL.test(w)) continue;
      const v = res.get(last(w));
      if (v && !(v.r === 'L' && v.d === 0)) break;
    }
    return { word: w, syll: last(w), label: '시작 단어' };
  }

  function hint(r, used) {
    init();
    for (const s of acceptableStarts(r)) {
      const h = window.HINT_MAP[s];
      if (h && !used.has(h) && exists(h) && h.length >= S.minLen) return h;
    }
    return candidates(r, used)[0] || null;
  }

  return { init, setSettings, getSettings, DEFAULTS, firstSyll: first, lastSyll: last, exists,
           validateMove, hasAnyContinuation, candidates, solve, winWords, newStart, hint,
           equivClass: acceptableStarts };
})();
