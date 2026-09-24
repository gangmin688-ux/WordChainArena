// ===== 화면 전환 =====
function goScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}
document.querySelectorAll('[data-go]').forEach(el => {
  el.addEventListener('click', () => {
    stopAllLoops();
    goScreen(el.dataset.go);
  });
});

let LAST_MODE = null; // 'local' | 'cpu' | 'online' (다시 플레이용)
let CURRENT_MODE = null; // 'local' | 'online' | null

function stopAllLoops() {
  if (LOCAL.timerHandle) clearInterval(LOCAL.timerHandle);
  if (ONLINE.pollHandle) clearInterval(ONLINE.pollHandle);
  if (ONLINE.tickHandle) clearInterval(ONLINE.tickHandle);
  ONLINE.pollHandle = null;
  ONLINE.tickHandle = null;
  LOCAL.timerHandle = null;
  CURRENT_MODE = null;
}

Game.init();

// ============================================================
// 로컬 (한 기기) 모드
// ============================================================
const LOCAL = {
  players: [],
  turnIndex: 0,
  currentSyllable: null,
  usedWords: new Set(),
  history: [],
  turnSeconds: 30,
  remaining: 30,
  timerHandle: null
};

function buildLocalNameFields() {
  const count = Math.max(2, Math.min(6, parseInt(document.getElementById('local-count').value) || 2));
  document.getElementById('local-count').value = count;
  const wrap = document.getElementById('local-name-fields');
  wrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = `<label>플레이어 ${i + 1}</label>
      <input type="text" class="local-name" maxlength="10" placeholder="플레이어 ${i + 1}" value="플레이어${i + 1}">`;
    wrap.appendChild(div);
  }
}
document.getElementById('local-name-refresh').addEventListener('click', buildLocalNameFields);
buildLocalNameFields();

document.getElementById('local-start-btn').addEventListener('click', () => {
  const names = Array.from(document.querySelectorAll('.local-name')).map(i => i.value.trim() || '플레이어');
  LOCAL.players = names.map((name, i) => ({ id: 'L' + i, name, alive: true }));
  LOCAL.turnIndex = 0;
  LOCAL.usedWords = new Set();
  Game.setSettings(readSettings('ls'));
  LOCAL.turnSeconds = Game.getSettings().turnSeconds;
  const st = Game.newStart();
  if (st.word) LOCAL.usedWords.add(st.word);
  LOCAL.currentSyllable = st.syll;
  LOCAL.history = [{ who: st.label, word: st.word || st.syll }];
  CURRENT_MODE = 'local'; LAST_MODE = 'local';
  document.getElementById('word-input').disabled = false;
  document.getElementById('submit-word-btn').disabled = false;
  startLocalTurn();
  goScreen('game');
  renderGameCommon(LOCAL.players, LOCAL.turnIndex, LOCAL.currentSyllable, LOCAL.history);
});

function startLocalTurn() {
  clearInterval(LOCAL.timerHandle);
  LOCAL.remaining = LOCAL.turnSeconds;
  updateLocalTimerUI();
  LOCAL.timerHandle = setInterval(() => {
    LOCAL.remaining -= 0.2;
    updateLocalTimerUI();
    if (LOCAL.remaining <= 0) {
      clearInterval(LOCAL.timerHandle);
      localEliminateCurrent();
    }
  }, 200);
}

function updateLocalTimerUI() {
  const pct = Math.max(0, (LOCAL.remaining / LOCAL.turnSeconds) * 100);
  const bar = document.getElementById('timer-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('warn', pct < 30);
  const cur = LOCAL.players[LOCAL.turnIndex];
  document.getElementById('turn-status').textContent =
    `${cur.name}님 차례입니다 (남은 시간 ${Math.ceil(LOCAL.remaining)}초)`;
  document.getElementById('turn-status').classList.add('mine');
}

function nextAliveIdx(players, fromIdx) {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (players[idx].alive) return idx;
  }
  return fromIdx;
}

function localEliminateCurrent() {
  const cur = LOCAL.players[LOCAL.turnIndex];
  cur.alive = false;
  LOCAL.history.push({ who: '탈락', word: `${cur.name}님 시간 초과로 탈락` });
  const alive = LOCAL.players.filter(p => p.alive);
  if (alive.length <= 1) {
    endGame(alive[0] ? alive[0].name : '무승부', LOCAL.history);
    return;
  }
  LOCAL.turnIndex = nextAliveIdx(LOCAL.players, LOCAL.turnIndex);
  startLocalTurn();
  renderGameCommon(LOCAL.players, LOCAL.turnIndex, LOCAL.currentSyllable, LOCAL.history);
}

function localSubmit(word) {
  const v = Game.validateMove(word, LOCAL.currentSyllable, LOCAL.usedWords);
  if (!v.ok) { showWordError(v.reason); return; }
  const cur = LOCAL.players[LOCAL.turnIndex];
  LOCAL.usedWords.add(word);
  LOCAL.history.push({ who: cur.name, word });
  LOCAL.currentSyllable = Game.lastSyll(word);
  LOCAL.turnIndex = nextAliveIdx(LOCAL.players, LOCAL.turnIndex);
  startLocalTurn();
  renderGameCommon(LOCAL.players, LOCAL.turnIndex, LOCAL.currentSyllable, LOCAL.history);
  clearWordInput();
  maybeCpu();
}

// ============================================================
// 온라인 모드
// ============================================================
const ONLINE = {
  myId: null,
  myName: '',
  code: null,
  room: null,
  pollHandle: null,
  tickHandle: null,
  eliminating: false
};

function ensureMyId() {
  // 탭/접속마다 고유 ID (localStorage 공유 시 방장과 참가자 ID가 같아지는 버그 방지)
  ONLINE.myId = FB.uid();
  return ONLINE.myId;
}
ensureMyId();

document.getElementById('create-room-btn').addEventListener('click', async () => {
  const name = document.getElementById('create-name').value.trim();
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = '닉네임을 입력하세요.'; return; }
  try {
    const room = await FB.createRoom(name, ONLINE.myId, readSettings('cs'));
    ONLINE.code = room.code;
    ONLINE.myName = name;
    ONLINE.room = room;
    enterLobby(true);
  } catch (e) {
    errEl.textContent = e.message;
  }
});

document.getElementById('join-room-btn').addEventListener('click', async () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim();
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';
  if (!name || !code) { errEl.textContent = '닉네임과 방 코드를 모두 입력하세요.'; return; }
  try {
    const room = await FB.joinRoom(code, name, ONLINE.myId);
    ONLINE.code = code;
    ONLINE.myName = name;
    ONLINE.room = room;
    enterLobby(false);
  } catch (e) {
    errEl.textContent = e.message;
  }
});

function enterLobby(isHost) {
  CURRENT_MODE = 'online'; LAST_MODE = 'online'; ONLINE.resultShown = false;
  goScreen('lobby');
  document.getElementById('lobby-code').textContent = ONLINE.code;
  document.getElementById('lobby-start-btn').style.display = isHost ? 'block' : 'none';
  document.getElementById('lobby-wait-msg').style.display = isHost ? 'none' : 'block';
  renderLobby(ONLINE.room);
  clearInterval(ONLINE.pollHandle);
  ONLINE.pollHandle = setInterval(pollOnlineRoom, 1200);
  pollOnlineRoom();
}

async function pollOnlineRoom() {
  if (!ONLINE.code) return;
  try {
    const room = await FB.getRoom(ONLINE.code);
    if (!room) return;
    ONLINE.room = room;
    if (room.settings) Game.setSettings(room.settings);
    if (room.status === 'waiting') {
      if (!document.getElementById('screen-lobby').classList.contains('active')) goScreen('lobby');   // 다시 플레이 → 대기실
      const isHost = room.hostId === ONLINE.myId;
      document.getElementById('lobby-start-btn').style.display = isHost ? 'block' : 'none';
      document.getElementById('lobby-wait-msg').style.display = isHost ? 'none' : 'block';
      document.getElementById('lobby-code').textContent = ONLINE.code;
      ONLINE.resultShown = false; ONLINE.eliminating = false;
      renderLobby(room);
    } else if (room.status === 'playing') {
      if (!document.getElementById('screen-game').classList.contains('active')) {
        goScreen('game');
        clearInterval(ONLINE.tickHandle);
        ONLINE.tickHandle = setInterval(onlineTick, 200);
      }
      renderOnlineGame(room);
    } else if (room.status === 'finished') {
      clearInterval(ONLINE.tickHandle);   // 폴링은 유지 (방장이 다시 플레이를 누르면 대기실로 복귀)
      if (!ONLINE.resultShown) {
        ONLINE.resultShown = true;
        const winnerName = room.winnerId && room.players[room.winnerId] ? room.players[room.winnerId].name : '무승부';
        const hist = (room.history || []).map(h => ({ who: h.name, word: h.word }));
        endGame(winnerName, hist, true);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

document.getElementById('lobby-start-btn').addEventListener('click', async () => {
  if (!ONLINE.room || Object.keys(ONLINE.room.players).length < 2) {
    alert('최소 2명 이상 모여야 시작할 수 있습니다.');
    return;
  }
  await FB.startGame(ONLINE.code, ONLINE.room);
});

document.getElementById('lobby-leave-btn').addEventListener('click', () => {
  stopAllLoops();
  goScreen('menu');
});

function renderLobby(room) {
  const players = room.players || {};
  const ids = Object.keys(players);
  document.getElementById('lobby-count').textContent = ids.length;
  const ul = document.getElementById('lobby-players');
  ul.innerHTML = '';
  ids.forEach(pid => {
    const li = document.createElement('li');
    li.textContent = players[pid].name + (pid === room.hostId ? ' (방장)' : '');
    ul.appendChild(li);
  });
}

function onlineTick() {
  const room = ONLINE.room;
  if (!room || room.status !== 'playing') return;
  const total = (room.turnSeconds || 20) * 1000;
  const elapsed = Date.now() - (room.turnStartedAt || Date.now());
  const remaining = Math.max(0, total - elapsed);
  const pct = (remaining / total) * 100;
  const bar = document.getElementById('timer-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('warn', pct < 30);

  const curPid = (room.order || [])[room.turnIndex];
  const isMine = curPid === ONLINE.myId;
  const curName = room.players[curPid] ? room.players[curPid].name : '?';
  const statusEl = document.getElementById('turn-status');
  statusEl.textContent = isMine
    ? `내 차례입니다! (남은 시간 ${Math.ceil(remaining / 1000)}초)`
    : `${curName}님 차례 (남은 시간 ${Math.ceil(remaining / 1000)}초)`;
  statusEl.classList.toggle('mine', isMine);
  document.getElementById('word-input').disabled = !isMine;
  document.getElementById('submit-word-btn').disabled = !isMine;

  if (remaining <= 0 && !ONLINE.eliminating) {
    ONLINE.eliminating = true;
    FB.eliminateCurrentPlayer(ONLINE.code, room).finally(() => {
      setTimeout(() => { ONLINE.eliminating = false; }, 1500);
    });
  }
}

function renderOnlineGame(room) {
  const order = room.order || [];
  const playersArr = order.map(pid => ({
    id: pid,
    name: room.players[pid] ? room.players[pid].name : '?',
    alive: room.players[pid] ? room.players[pid].alive : false
  }));
  renderPlayerList(playersArr, room.turnIndex);
  document.getElementById('game-syllable').textContent = room.currentSyllable || '-';
  const hist = (room.history || []).map(h => ({ who: h.name, word: h.word }));
  setLastWord(hist);
  renderHistory(hist);
}

async function onlineSubmit(word) {
  const room = ONLINE.room;
  const usedSet = new Set(room.usedWords || []);
  const v = Game.validateMove(word, room.currentSyllable, usedSet);
  if (!v.ok) { showWordError(v.reason); return; }
  const curPid = (room.order || [])[room.turnIndex];
  if (curPid !== ONLINE.myId) { showWordError('내 차례가 아닙니다.'); return; }
  await FB.submitWord(ONLINE.code, room, ONLINE.myId, ONLINE.myName, word);
  clearWordInput();
}

// ============================================================
// 공통 UI 헬퍼
// ============================================================
function setLastWord(history) {
  const el = document.getElementById('game-lastword');
  let w = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (['탈락', '시스템', '시작 글자'].includes(history[i].who)) continue;
    w = history[i].word; break;
  }
  el.innerHTML = w ? '직전 단어: ' + w.slice(0, -1) + '<b>' + w.slice(-1) + '</b>' : '';
}

function renderGameCommon(players, turnIndex, syllable, history) {
  setLastWord(history);
  renderPlayerList(players, turnIndex);
  document.getElementById('game-syllable').textContent = syllable || '-';
  renderHistory(history);
}

function renderPlayerList(players, turnIndex) {
  const ul = document.getElementById('game-players');
  ul.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (i === turnIndex && p.alive) li.classList.add('turn');
    if (!p.alive) { li.classList.add('dead'); li.textContent += ' (탈락)'; }
    ul.appendChild(li);
  });
}

function renderHistory(history) {
  const el = document.getElementById('game-history');
  el.innerHTML = '';
  history.forEach(h => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<span>${h.word}</span><span class="who">${h.who}</span>`;
    el.appendChild(div);
  });
}

function showWordError(msg) {
  const el = document.getElementById('word-error');
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500);
}

function clearWordInput() {
  document.getElementById('word-input').value = '';
  document.getElementById('word-error').textContent = '';
}

document.getElementById('submit-word-btn').addEventListener('click', submitCurrentWord);
document.getElementById('word-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCurrentWord();
});

function submitCurrentWord() {
  const word = document.getElementById('word-input').value.trim();
  if (!word) return;
  if (activeMode() === 'local') localSubmit(word);
  else onlineSubmit(word);
}

function activeMode() {
  return CURRENT_MODE || 'local';
}

document.getElementById('giveup-btn').addEventListener('click', () => {
  if (activeMode() === 'local') {
    if (LOCAL.players[LOCAL.turnIndex].cpu) return;
    clearInterval(LOCAL.timerHandle);
    localEliminateCurrent();
  } else {
    const room = ONLINE.room;
    const curPid = (room.order || [])[room.turnIndex];
    if (curPid !== ONLINE.myId) { showWordError('내 차례가 아닙니다.'); return; }
    FB.eliminateCurrentPlayer(ONLINE.code, room);
  }
});

function endGame(winnerName, history, keepPoll) {
  if (!keepPoll) stopAllLoops();
  const rb = document.getElementById('replay-btn'), note = document.getElementById('replay-note');
  if (LAST_MODE === 'online') {
    const host = ONLINE.room && ONLINE.room.hostId === ONLINE.myId;
    rb.style.display = host ? 'block' : 'none';
    note.textContent = host ? '' : '방장이 다시 플레이를 누르면 대기실로 이동합니다.';
  } else { rb.style.display = 'block'; note.textContent = ''; }
  document.getElementById('result-winner').textContent = `🏆 ${winnerName}`;
  const el = document.getElementById('result-history');
  el.innerHTML = '';
  history.forEach(h => {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `<span>${h.word}</span><span class="who">${h.who}</span>`;
    el.appendChild(div);
  });
  goScreen('result');
}

// ============================================================
// 게임 설정 UI / 단어 찾기
// ============================================================
function currentCtx() {
  if (activeMode() === 'local') return { syll: LOCAL.currentSyllable, used: LOCAL.usedWords };
  const r = ONLINE.room || {};
  return { syll: r.currentSyllable, used: new Set(r.usedWords || []) };
}

function settingsHTML(p, defSec) {
  return `<div class="set-title">⚙️ 게임 설정</div>
  <label>두음법칙</label>
  <select id="${p}-dueum">
    <option value="full">적용 – 기본 방식 (양방향: 나↔라, 여↔려↔녀)</option>
    <option value="std">적용 – 표준 (라→나, 려·녀→여 한 방향만)</option>
    <option value="none">적용 안 함 (글자 그대로)</option>
  </select>
  <label>제한 시간 (초)</label>
  <input type="number" id="${p}-sec" min="5" max="120" value="${defSec}">
  <div style="display:flex; gap:10px;">
    <div style="flex:1"><label>최소 글자 수</label><input type="number" id="${p}-minlen" min="2" max="20" value="2"></div>
    <div style="flex:1"><label>최대 글자 수</label><input type="number" id="${p}-maxlen" min="2" max="20" placeholder="제한 없음"></div>
  </div>
  <label>한방 단어 (상대가 이을 수 없는 단어)</label>
  <select id="${p}-hanbang"><option value="allow">허용</option><option value="ban">금지</option></select>
  <label>시작 방식</label>
  <select id="${p}-start"><option value="random">랜덤 시작 단어</option><option value="syll">시작 글자 직접 지정</option></select>
  <input type="text" id="${p}-syll" maxlength="1" placeholder="시작 글자 1자 (예: 가)" style="display:none;">`;
}

function readSettings(p) {
  const v = id => document.getElementById(p + '-' + id);
  const minLen = Math.max(2, Math.min(20, parseInt(v('minlen').value) || 2));
  let maxLen = Math.max(0, Math.min(20, parseInt(v('maxlen').value) || 0));
  if (maxLen && maxLen < minLen) maxLen = minLen;
  return {
    dueum: v('dueum').value,
    turnSeconds: Math.max(5, Math.min(120, parseInt(v('sec').value) || 30)),
    minLen, maxLen,
    banHanbang: v('hanbang').value === 'ban',
    startMode: v('start').value,
    startSyll: (v('syll').value || '').trim(),
    assist: true
  };
}

[['ls', 'local-settings', 30], ['cs', 'create-settings', 20], ['cp', 'cpu-settings', 30]].forEach(([p, host, sec]) => {
  document.getElementById(host).innerHTML = settingsHTML(p, sec);
  const st = document.getElementById(p + '-start'), sy = document.getElementById(p + '-syll');
  st.addEventListener('change', () => { sy.style.display = st.value === 'syll' ? 'block' : 'none'; });
});


// ============================================================
// 관리자 접근 제어 (Firebase /config)
// ============================================================
const SITE = { blocked: false, msg: '' };
let MY_IP = null;
async function refreshSiteConfig() {
  let siteOff = false, msg = '현재 접속이 제한되어 있습니다.';
  try { const cfg = await FB.getConfig(); siteOff = cfg.siteOpen === false; msg = cfg.message || msg; } catch (e) { return; }
  if (!MY_IP) MY_IP = await FB.getIP();
  let ipBlocked = false;
  if (MY_IP) { try { ipBlocked = await FB.isBlocked(MY_IP); } catch (e) { /* 읽기 실패 시 통과 */ } }
  SITE.ipBlocked = ipBlocked;
  SITE.blocked = siteOff || ipBlocked;
  SITE.msg = ipBlocked ? '🚫 관리자에 의해 접속이 차단되었습니다.' : msg;
  document.getElementById('site-overlay-msg').textContent = SITE.msg;
  document.getElementById('site-overlay').classList.toggle('hidden', !SITE.blocked);
  if (SITE.blocked) { stopAllLoops(); goScreen('menu'); }   // 진행 중인 게임/방 포함 전부 중단
}
async function heartbeat() {
  if (!MY_IP || SITE.ipBlocked) return;
  const sc = document.querySelector('.screen.active');
  try {
    await FB.heartbeat(ONLINE.myId, { ip: MY_IP, name: ONLINE.myName || '', screen: sc ? sc.id.replace('screen-', '') : '',
      room: ONLINE.code || '', lastSeen: Date.now() });
  } catch (e) { /* 무시 */ }
}
refreshSiteConfig().then(heartbeat);
setInterval(refreshSiteConfig, 5000);
setInterval(heartbeat, 10000);

// ============================================================
// 컴퓨터 대전 (일반 유저용)
// ============================================================
document.getElementById('cpu-start-btn').addEventListener('click', () => {
  const name = document.getElementById('cpu-name').value.trim() || '나';
  LOCAL.players = [{ id: 'L0', name, alive: true }, { id: 'CPU', name: '컴퓨터', alive: true, cpu: true }];
  LOCAL.cpuLevel = document.getElementById('cpu-level').value;
  LOCAL.turnIndex = 0;
  LOCAL.usedWords = new Set();
  Game.setSettings(readSettings('cp'));
  LOCAL.turnSeconds = Game.getSettings().turnSeconds;
  const st = Game.newStart();
  if (st.word) LOCAL.usedWords.add(st.word);
  LOCAL.currentSyllable = st.syll;
  LOCAL.history = [{ who: st.label, word: st.word || st.syll }];
  CURRENT_MODE = 'local'; LAST_MODE = 'cpu';
  document.getElementById('word-input').disabled = false;
  document.getElementById('submit-word-btn').disabled = false;
  startLocalTurn();
  goScreen('game');
  renderGameCommon(LOCAL.players, LOCAL.turnIndex, LOCAL.currentSyllable, LOCAL.history);
});

function maybeCpu() {
  const cur = LOCAL.players[LOCAL.turnIndex];
  if (!cur || !cur.cpu || CURRENT_MODE !== 'local') return;
  clearInterval(LOCAL.timerHandle);
  document.getElementById('word-input').disabled = true;
  document.getElementById('submit-word-btn').disabled = true;
  document.getElementById('turn-status').textContent = '컴퓨터가 생각 중...';
  setTimeout(() => {
    if (CURRENT_MODE !== 'local' || LOCAL.players[LOCAL.turnIndex] !== cur) return;
    const S = Game.getSettings(), used = LOCAL.usedWords, syll = LOCAL.currentSyllable;
    const human = LOCAL.players.find(p => !p.cpu);
    const ok = w => !S.banHanbang || Game.hasAnyContinuation(Game.lastSyll(w), used, w);
    const cands = Game.candidates(syll, used).filter(ok);
    document.getElementById('word-input').disabled = false;
    document.getElementById('submit-word-btn').disabled = false;
    if (!cands.length) {
      LOCAL.history.push({ who: '컴퓨터', word: '이을 단어가 없습니다' });
      endGame(human.name, LOCAL.history);
      return;
    }
    let pick = null;
    if (LOCAL.cpuLevel === 'smart') {
      const g = Game.winWords(syll, used).filter(x => !S.banHanbang || x.depth > 0);
      if (g.length) pick = g[0].word;
    }
    pick = pick || cands[Math.floor(Math.random() * cands.length)];
    used.add(pick);
    LOCAL.history.push({ who: cur.name, word: pick });
    LOCAL.currentSyllable = Game.lastSyll(pick);
    if (!Game.hasAnyContinuation(LOCAL.currentSyllable, used)) {
      LOCAL.history.push({ who: '시스템', word: `${human.name}님이 이을 단어가 없습니다` });
      endGame(cur.name, LOCAL.history);
      return;
    }
    LOCAL.turnIndex = nextAliveIdx(LOCAL.players, LOCAL.turnIndex);
    startLocalTurn();
    renderGameCommon(LOCAL.players, LOCAL.turnIndex, LOCAL.currentSyllable, LOCAL.history);
  }, 700 + Math.random() * 700);
}

document.getElementById('replay-btn').addEventListener('click', async () => {
  if (LAST_MODE === 'local') document.getElementById('local-start-btn').click();
  else if (LAST_MODE === 'cpu') document.getElementById('cpu-start-btn').click();
  else if (LAST_MODE === 'online' && ONLINE.room && ONLINE.room.hostId === ONLINE.myId) {
    try { await FB.resetRoom(ONLINE.code, ONLINE.room); } catch (e) { alert(e.message); }
  }
});

// ============================================================
// 방 자동 정리 (끝난 방 삭제)
// ============================================================
FB.sweep().catch(() => {});
setInterval(() => FB.sweep().catch(() => {}), 60000);
document.querySelector('#screen-result [data-go="menu"]').addEventListener('click', () => {
  if (LAST_MODE === 'online' && ONLINE.room && ONLINE.room.hostId === ONLINE.myId && ONLINE.code) FB.deleteRoom(ONLINE.code);
});
document.getElementById('lobby-leave-btn').addEventListener('click', () => {
  if (!ONLINE.room || !ONLINE.code) return;
  if (ONLINE.room.hostId === ONLINE.myId) FB.deleteRoom(ONLINE.code);
  else FB.leaveRoom(ONLINE.code, ONLINE.myId);   // 참가자가 나가면 명단에서 제거
});

// ============================================================
// 메인 화면: 단어 확인 + 등록 단어 목록
// ============================================================
(() => {
  const words = Game.words(), PAGE = 200;
  let shown = 0;
  document.getElementById('dict-total').textContent = words.length.toLocaleString();
  function more() {
    const box = document.getElementById('dict-list'), frag = document.createDocumentFragment();
    words.slice(shown, shown + PAGE).forEach(w => {
      const s = document.createElement('span');
      s.className = 'chip'; s.style.cursor = 'default'; s.textContent = w;
      frag.appendChild(s);
    });
    box.appendChild(frag);
    shown = Math.min(words.length, shown + PAGE);
    document.getElementById('dict-more').style.display = shown >= words.length ? 'none' : '';
  }
  document.getElementById('dict-more').addEventListener('click', more);
  more();
  document.getElementById('dict-q').addEventListener('input', e => {
    const w = e.target.value.trim(), out = document.getElementById('dict-result');
    if (!w) { out.textContent = ''; return; }
    if (!/^[가-힣]+$/.test(w)) { out.style.color = 'var(--muted)'; out.textContent = '한글 단어만 확인할 수 있어요.'; return; }
    const ok = Game.exists(w);
    out.style.color = ok ? 'var(--good)' : 'var(--bad)';
    out.textContent = ok ? `✅ '${w}' 은(는) 사전에 있는 단어입니다.` : `❌ '${w}' 은(는) 사전에 없는 단어입니다.`;
  });
})();
