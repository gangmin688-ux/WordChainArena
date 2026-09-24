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
  const startWord = Game.randomStartWord();
  LOCAL.usedWords.add(startWord);
  LOCAL.currentSyllable = Game.lastSyll(startWord);
  LOCAL.history = [{ who: '시작 단어', word: startWord }];
  CURRENT_MODE = 'local';
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
  let id = null;
  try { id = localStorage.getItem('kkeugeul_id'); } catch (e) { /* file:// 등에서 차단될 수 있음 */ }
  if (!id) {
    id = FB.uid();
    try { localStorage.setItem('kkeugeul_id', id); } catch (e) { /* 무시 */ }
  }
  ONLINE.myId = id;
  return id;
}
ensureMyId();

document.getElementById('create-room-btn').addEventListener('click', async () => {
  const name = document.getElementById('create-name').value.trim();
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = '닉네임을 입력하세요.'; return; }
  try {
    const room = await FB.createRoom(name, ONLINE.myId);
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
  CURRENT_MODE = 'online';
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
    if (room.status === 'waiting') {
      renderLobby(room);
    } else if (room.status === 'playing') {
      if (!document.getElementById('screen-game').classList.contains('active')) {
        goScreen('game');
        clearInterval(ONLINE.tickHandle);
        ONLINE.tickHandle = setInterval(onlineTick, 200);
      }
      renderOnlineGame(room);
    } else if (room.status === 'finished') {
      clearInterval(ONLINE.pollHandle);
      clearInterval(ONLINE.tickHandle);
      const winnerName = room.winnerId && room.players[room.winnerId] ? room.players[room.winnerId].name : '무승부';
      const hist = (room.history || []).map(h => ({ who: h.name, word: h.word }));
      endGame(winnerName, hist);
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
  renderHistory((room.history || []).map(h => ({ who: h.playerId === 'system' ? h.name : h.name, word: h.word })));
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
function renderGameCommon(players, turnIndex, syllable, history) {
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

document.getElementById('hint-btn').addEventListener('click', () => {
  let syll, used;
  if (activeMode() === 'local') { syll = LOCAL.currentSyllable; used = LOCAL.usedWords; }
  else { syll = ONLINE.room.currentSyllable; used = new Set(ONLINE.room.usedWords || []); }
  const h = Game.hint(syll, used);
  showWordError(h ? `힌트: ${h}` : '더 이상 이어갈 단어가 없습니다!');
});

document.getElementById('giveup-btn').addEventListener('click', () => {
  if (activeMode() === 'local') {
    clearInterval(LOCAL.timerHandle);
    localEliminateCurrent();
  } else {
    const room = ONLINE.room;
    const curPid = (room.order || [])[room.turnIndex];
    if (curPid !== ONLINE.myId) { showWordError('내 차례가 아닙니다.'); return; }
    FB.eliminateCurrentPlayer(ONLINE.code, room);
  }
});

function endGame(winnerName, history) {
  stopAllLoops();
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
