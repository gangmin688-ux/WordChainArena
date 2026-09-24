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
  if (typeof stopPublicRoomsPoll === 'function') stopPublicRoomsPoll();
}

Game.init();

// ============================================================
// 계정 (로그인 / 회원가입) — 온라인 대전(코인 판돈) 이용에 필요
// ============================================================
const AUTH = { username: null };

function restoreSession() {
  AUTH.username = localStorage.getItem('wca_user') || null;
}
function saveSession(username) {
  AUTH.username = username;
  localStorage.setItem('wca_user', username);
}
function clearSession() {
  AUTH.username = null;
  localStorage.removeItem('wca_user');
}

function escHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ============================================================
// 칭호(타이틀) 캐시
// ============================================================
let TITLES_CACHE = null;
async function loadTitlesCache(force) {
  if (TITLES_CACHE && !force) return TITLES_CACHE;
  try { TITLES_CACHE = await FB.listTitles(); } catch (e) { TITLES_CACHE = TITLES_CACHE || {}; }
  return TITLES_CACHE;
}
async function myEquippedTitleName() {
  try {
    const w = await FB.getWallet(AUTH.username);
    if (!w.equippedTitle) return null;
    await loadTitlesCache();
    const t = TITLES_CACHE[w.equippedTitle];
    return t ? t.name : null;
  } catch (e) { return null; }
}

async function refreshAccountUI() {
  const guest = document.getElementById('account-guest');
  const user = document.getElementById('account-user');
  if (!AUTH.username) {
    guest.classList.remove('hidden'); user.classList.add('hidden');
    return;
  }
  guest.classList.add('hidden'); user.classList.remove('hidden');
  document.getElementById('account-name').textContent = `👤 ${AUTH.username}`;
  try {
    const w = await FB.getWallet(AUTH.username);
    document.getElementById('account-coins').textContent = (w.coins || 0).toLocaleString();
    await loadTitlesCache();
    const t = w.equippedTitle && TITLES_CACHE[w.equippedTitle];
    document.getElementById('account-name').textContent = `👤 ${AUTH.username}${t ? ` [${t.name}]` : ''}`;
  } catch (e) { /* 무시 */ }
}

document.getElementById('go-signup-link').addEventListener('click', (e) => { e.preventDefault(); goScreen('signup'); });
document.getElementById('signup-start-coins').textContent = FB.START_COINS.toLocaleString();

document.getElementById('signup-btn').addEventListener('click', async () => {
  const id = document.getElementById('signup-id').value.trim();
  const pw = document.getElementById('signup-pw').value;
  const pw2 = document.getElementById('signup-pw2').value;
  const err = document.getElementById('signup-error');
  err.textContent = '';
  if (pw !== pw2) { err.textContent = '비밀번호가 서로 다릅니다.'; return; }
  try {
    await FB.signup(id, pw);
    saveSession(id);
    await refreshAccountUI();
    goScreen('menu');
  } catch (e) { err.textContent = e.message; }
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const id = document.getElementById('login-id').value.trim();
  const pw = document.getElementById('login-pw').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    await FB.login(id, pw);
    saveSession(id);
    await refreshAccountUI();
    goScreen('menu');
  } catch (e) { err.textContent = e.message; }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  refreshAccountUI();
  goScreen('menu');
});

document.getElementById('menu-online-create').addEventListener('click', async () => {
  if (!AUTH.username) { goScreen('login'); return; }
  document.getElementById('create-username').textContent = AUTH.username;
  document.getElementById('create-error').textContent = '';
  try {
    const w = await FB.getWallet(AUTH.username);
    document.getElementById('create-mycoins').textContent = (w.coins || 0).toLocaleString();
  } catch (e) { document.getElementById('create-mycoins').textContent = '?'; }
  goScreen('online-create');
});
document.getElementById('menu-online-join').addEventListener('click', async () => {
  if (!AUTH.username) { goScreen('login'); return; }
  document.getElementById('join-username').textContent = AUTH.username;
  document.getElementById('join-error').textContent = '';
  try {
    const w = await FB.getWallet(AUTH.username);
    document.getElementById('join-mycoins').textContent = (w.coins || 0).toLocaleString();
  } catch (e) { document.getElementById('join-mycoins').textContent = '?'; }
  goScreen('online-join');
  startPublicRoomsPoll();
});

// ============================================================
// 공개방 목록 (방 참가 화면 — 코드 입력 없이 바로 참가)
// ============================================================
let PUBLIC_ROOMS_POLL = null;
function startPublicRoomsPoll() {
  clearInterval(PUBLIC_ROOMS_POLL);
  refreshPublicRooms();
  PUBLIC_ROOMS_POLL = setInterval(refreshPublicRooms, 3000);
}
function stopPublicRoomsPoll() {
  clearInterval(PUBLIC_ROOMS_POLL);
  PUBLIC_ROOMS_POLL = null;
}
async function refreshPublicRooms() {
  if (!document.getElementById('screen-online-join').classList.contains('active')) { stopPublicRoomsPoll(); return; }
  const el = document.getElementById('join-public-rooms');
  try {
    const arr = await FB.listPublicRooms();
    el.innerHTML = arr.length ? arr.map(r => {
      const ids = Object.keys(r.players || {});
      const host = (r.players[r.hostId] || {}).name || '?';
      return `<div class="rank-row"><div class="rank-name">방 ${escHtml(r.code)} · 방장 ${escHtml(host)}</div>
        <div class="small">${ids.length}명 대기 중</div>
        <button class="btn primary" data-joincode="${escHtml(r.code)}" style="width:auto; padding:6px 14px; font-size:13px;">참가</button></div>`;
    }).join('') : '현재 참가자 모집 중인 공개방이 없습니다.';
    el.querySelectorAll('button[data-joincode]').forEach(b => b.addEventListener('click', () => {
      document.getElementById('join-code').value = b.dataset.joincode;
      document.getElementById('join-room-btn').click();
    }));
  } catch (e) { el.textContent = '공개방 목록을 불러오지 못했습니다.'; }
}

restoreSession();
refreshAccountUI();
loadTitlesCache();

// ============================================================
// 코인 랭킹
// ============================================================
document.querySelector('[data-go="ranking"]').addEventListener('click', loadRanking);
async function loadRanking() {
  const el = document.getElementById('ranking-list');
  el.textContent = '불러오는 중...';
  try {
    const [wallets] = await Promise.all([FB.listWallets(), loadTitlesCache()]);
    const arr = Object.entries(wallets).map(([name, w]) => ({ name, coins: (w && w.coins) || 0, equippedTitle: w && w.equippedTitle }))
      .sort((a, b) => b.coins - a.coins).slice(0, 100);
    el.innerHTML = arr.length ? arr.map((r, i) => {
      const t = r.equippedTitle && TITLES_CACHE[r.equippedTitle];
      const nameHtml = escHtml(r.name) + (t ? ` <span class="title-tag">[${escHtml(t.name)}]</span>` : '');
      return `
      <div class="rank-row ${r.name === AUTH.username ? 'me' : ''}">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-name">${nameHtml}${r.name === AUTH.username ? ' (나)' : ''}</div>
        <div class="rank-coins">💰 ${r.coins.toLocaleString()}</div>
      </div>`;
    }).join('') : '<div class="center-msg">아직 등록된 플레이어가 없습니다.</div>';
  } catch (e) { el.textContent = '랭킹을 불러오지 못했습니다.'; }
}

// ============================================================
// 칭호 상점
// ============================================================
document.getElementById('menu-shop-btn').addEventListener('click', () => {
  if (!AUTH.username) { goScreen('login'); return; }
  goScreen('shop');
  loadShop();
});
async function loadShop() {
  const listEl = document.getElementById('shop-list');
  listEl.textContent = '불러오는 중...';
  try {
    const [w, titles] = await Promise.all([FB.getWallet(AUTH.username), loadTitlesCache(true)]);
    document.getElementById('shop-mycoins').textContent = (w.coins || 0).toLocaleString();
    const equippedT = w.equippedTitle && titles[w.equippedTitle];
    document.getElementById('shop-equipped').textContent = equippedT ? `[${equippedT.name}]` : '없음';
    const arr = Object.entries(titles).map(([id, t]) => ({ id, name: (t && t.name) || '', price: (t && t.price) || 0 }))
      .sort((a, b) => a.price - b.price);
    const owned = w.ownedTitles || {};
    listEl.innerHTML = arr.length ? arr.map(t => {
      const has = !!owned[t.id];
      const equipped = w.equippedTitle === t.id;
      let btn;
      if (equipped) btn = `<button class="btn danger" data-unequip="${t.id}" style="width:auto; padding:6px 14px; font-size:13px;">장착 해제</button>`;
      else if (has) btn = `<button class="btn primary" data-equip="${t.id}" style="width:auto; padding:6px 14px; font-size:13px;">장착</button>`;
      else btn = `<button class="btn accent2" data-buy="${t.id}" data-price="${t.price}" style="width:auto; padding:6px 14px; font-size:13px;">구매</button>`;
      return `<div class="rank-row"><div class="rank-name">${escHtml(t.name)}</div><div class="rank-coins">💰 ${t.price.toLocaleString()}</div>${btn}</div>`;
    }).join('') : '등록된 칭호가 없습니다. (관리자 패널에서 추가할 수 있습니다)';
    listEl.querySelectorAll('button[data-buy]').forEach(b => b.addEventListener('click', async () => {
      try { await FB.buyTitle(AUTH.username, b.dataset.buy, parseInt(b.dataset.price)); await loadShop(); await refreshAccountUI(); }
      catch (e) { alert(e.message); }
    }));
    listEl.querySelectorAll('button[data-equip]').forEach(b => b.addEventListener('click', async () => {
      try { await FB.equipTitle(AUTH.username, b.dataset.equip); await loadShop(); await refreshAccountUI(); }
      catch (e) { alert(e.message); }
    }));
    listEl.querySelectorAll('button[data-unequip]').forEach(b => b.addEventListener('click', async () => {
      try { await FB.equipTitle(AUTH.username, null); await loadShop(); await refreshAccountUI(); }
      catch (e) { alert(e.message); }
    }));
  } catch (e) { listEl.textContent = '불러오지 못했습니다.'; }
}

// ============================================================
// 코인 애니메이션 (판돈 모으기 / 획득)
// ============================================================
function coinFx(count, toast) {
  const layer = document.getElementById('coin-fx-layer');
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const n = Math.max(1, Math.min(16, count));
  for (let i = 0; i < n; i++) {
    const span = document.createElement('span');
    span.className = 'coin-fly';
    span.textContent = '💰';
    const dx0 = (Math.random() - 0.5) * 240, dy0 = (Math.random() - 0.5) * 160;
    span.style.left = cx + 'px'; span.style.top = cy + 'px';
    span.style.setProperty('--dx0', dx0 + 'px'); span.style.setProperty('--dy0', dy0 + 'px');
    span.style.setProperty('--dx1', (dx0 * 0.3) + 'px'); span.style.setProperty('--dy1', (dy0 * 0.3 - 140) + 'px');
    span.style.animationDelay = (Math.random() * 0.2) + 's';
    layer.appendChild(span);
    setTimeout(() => span.remove(), 1400);
  }
  if (toast) {
    const t = document.createElement('div');
    t.className = 'coin-toast';
    t.textContent = toast;
    layer.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }
}

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
  const name = AUTH.username;
  const errEl = document.getElementById('create-error');
  errEl.textContent = '';
  if (!name) { goScreen('login'); return; }
  const settings = readSettings('cs');
  const isPublic = document.getElementById('create-public').value === '1';
  try {
    const title = await myEquippedTitleName();
    const room = await FB.createRoom(name, ONLINE.myId, settings, title, isPublic);
    ONLINE.code = room.code;
    ONLINE.myName = name;
    ONLINE.room = room;
    enterLobby(true);
  } catch (e) {
    errEl.textContent = e.message;
  }
});

document.getElementById('join-room-btn').addEventListener('click', async () => {
  const name = AUTH.username;
  const code = document.getElementById('join-code').value.trim();
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';
  if (!name) { goScreen('login'); return; }
  if (!code) { errEl.textContent = '방 코드를 입력하세요.'; return; }
  try {
    const title = await myEquippedTitleName();
    const room = await FB.joinRoom(code, name, ONLINE.myId, title);
    ONLINE.code = code;
    ONLINE.myName = name;
    ONLINE.room = room;
    enterLobby(false);
  } catch (e) {
    errEl.textContent = e.message;
  }
});

function enterLobby(isHost) {
  CURRENT_MODE = 'online'; LAST_MODE = 'online'; ONLINE.resultShown = false; ONLINE.potFxShown = false; ONLINE.payoutFxShown = false;
  stopPublicRoomsPoll();
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
      ONLINE.resultShown = false; ONLINE.eliminating = false; ONLINE.potFxShown = false; ONLINE.payoutFxShown = false;
      renderLobby(room);
    } else if (room.status === 'playing') {
      if (!document.getElementById('screen-game').classList.contains('active')) {
        goScreen('game');
        clearInterval(ONLINE.tickHandle);
        ONLINE.tickHandle = setInterval(onlineTick, 200);
        ONLINE.potFxShown = false;
      }
      if ((room.pot || 0) > 0 && !ONLINE.potFxShown) {
        ONLINE.potFxShown = true;
        coinFx(Math.min(10, (room.order || []).length * 2), `💰 판돈 ${room.pot.toLocaleString()} 코인이 모였습니다!`);
      }
      renderOnlineGame(room);
    } else if (room.status === 'finished') {
      clearInterval(ONLINE.tickHandle);   // 폴링은 유지 (방장이 다시 플레이를 누르면 대기실로 복귀)
      if (!ONLINE.resultShown) {
        ONLINE.resultShown = true;
        const winner = room.winnerId && room.players[room.winnerId];
        const winnerName = winner ? winner.name : '무승부';
        const winnerTitle = winner ? winner.title : null;
        const hist = (room.history || []).map(h => ({ who: h.name, word: h.word }));
        endGame(winnerName, hist, true, room.pot || 0, winnerTitle);
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
  const errEl = document.getElementById('lobby-error');
  errEl.textContent = '';
  try {
    await FB.startGame(ONLINE.code, ONLINE.room);
  } catch (e) {
    errEl.textContent = e.message;
  }
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
    const p = players[pid];
    li.innerHTML = `<span>${escHtml(p.name)}${p.title ? ` <span class="title-tag">[${escHtml(p.title)}]</span>` : ''}${pid === room.hostId ? ' (방장)' : ''}</span>`;
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
    alive: room.players[pid] ? room.players[pid].alive : false,
    title: room.players[pid] ? room.players[pid].title : null
  }));
  renderPlayerList(playersArr, room.turnIndex);
  document.getElementById('game-syllable').textContent = room.currentSyllable || '-';
  const hist = (room.history || []).map(h => ({ who: h.name, word: h.word }));
  setLastWord(hist);
  renderHistory(hist);
  const badge = document.getElementById('game-pot-badge');
  if ((room.pot || 0) > 0) { badge.classList.remove('hidden'); badge.textContent = `💰 판돈 ${room.pot.toLocaleString()} 코인`; }
  else badge.classList.add('hidden');
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
    let label = escHtml(p.name) + (p.title ? ` <span class="title-tag">[${escHtml(p.title)}]</span>` : '');
    if (i === turnIndex && p.alive) li.classList.add('turn');
    if (!p.alive) { li.classList.add('dead'); label += ' (탈락)'; }
    li.innerHTML = label;
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

function endGame(winnerName, history, keepPoll, pot, winnerTitle) {
  if (!keepPoll) stopAllLoops();
  const rb = document.getElementById('replay-btn'), note = document.getElementById('replay-note');
  if (LAST_MODE === 'online') {
    const host = ONLINE.room && ONLINE.room.hostId === ONLINE.myId;
    rb.style.display = host ? 'block' : 'none';
    note.textContent = host ? '' : '방장이 다시 플레이를 누르면 대기실로 이동합니다.';
  } else { rb.style.display = 'block'; note.textContent = ''; }
  document.getElementById('result-winner').textContent = `🏆 ${winnerName}${winnerTitle ? ` [${winnerTitle}]` : ''}`;
  const potBadge = document.getElementById('result-pot-badge');
  if (pot > 0) {
    potBadge.classList.remove('hidden');
    potBadge.textContent = `${winnerName}님이 판돈 💰 ${pot.toLocaleString()} 코인 획득!`;
    if (!ONLINE.payoutFxShown) {
      ONLINE.payoutFxShown = true;
      coinFx(10, `🏆 ${winnerName}님이 ${pot.toLocaleString()} 코인 획득!`);
      if (winnerName === AUTH.username) refreshAccountUI();
    }
  } else {
    potBadge.classList.add('hidden'); potBadge.textContent = '';
  }
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
async function refreshSiteConfig() {
  let siteOff = false, msg = '현재 접속이 제한되어 있습니다.';
  try { const cfg = await FB.getConfig(); siteOff = cfg.siteOpen === false; msg = cfg.message || msg; } catch (e) { return; }
  let userBlocked = false;
  if (AUTH.username) { try { userBlocked = await FB.isUserBlocked(AUTH.username); } catch (e) { /* 읽기 실패 시 통과 */ } }
  SITE.userBlocked = userBlocked;
  SITE.blocked = siteOff || userBlocked;
  SITE.msg = userBlocked ? '🚫 관리자에 의해 이 계정은 차단되었습니다.' : msg;
  document.getElementById('site-overlay-msg').textContent = SITE.msg;
  document.getElementById('site-overlay').classList.toggle('hidden', !SITE.blocked);
  if (SITE.blocked) { stopAllLoops(); goScreen('menu'); }   // 진행 중인 게임/방 포함 전부 중단
}
async function heartbeat() {
  if (SITE.userBlocked) return;
  const sc = document.querySelector('.screen.active');
  try {
    await FB.heartbeat(ONLINE.myId, { name: AUTH.username || '', screen: sc ? sc.id.replace('screen-', '') : '',
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
