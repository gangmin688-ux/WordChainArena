// ===== Firebase Realtime Database REST 래퍼 (SDK 불필요) =====
const FB = (() => {
  const BASE = 'https://wordchainarena-default-rtdb.asia-southeast1.firebasedatabase.app';
  const START_COINS = 1000; // 신규 가입 시 지급되는 시작 코인

  async function getRoom(code) {
    const res = await fetch(`${BASE}/rooms/${code}.json`);
    if (!res.ok) throw new Error('방 정보를 불러오지 못했습니다.');
    return res.json();
  }

  async function putRoom(code, data) {
    const res = await fetch(`${BASE}/rooms/${code}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('방 생성에 실패했습니다. (Firebase 규칙을 확인하세요)');
    return res.json();
  }

  async function patchRoom(code, data) {
    const res = await fetch(`${BASE}/rooms/${code}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('업데이트에 실패했습니다.');
    return res.json();
  }

  async function deleteRoom(code) {
    await fetch(`${BASE}/rooms/${code}.json`, { method: 'DELETE' });
  }

  async function listRooms() {
    const res = await fetch(`${BASE}/rooms.json`);
    if (!res.ok) throw new Error('방 목록을 불러오지 못했습니다.');
    return (await res.json()) || {};
  }
  // 게임 종료 후 같은 방에서 다시 플레이: 대기실 상태로 초기화
  async function resetRoom(code, room) {
    const players = {};
    Object.keys(room.players || {}).forEach(pid => { players[pid] = { ...room.players[pid], alive: true }; });
    await patchRoom(code, { players, status: 'waiting', turnIndex: 0, usedWords: [], history: [],
      currentSyllable: null, winnerId: null, turnStartedAt: null, pot: null, payoutDone: false });
  }

  // 끝난 방(3분 경과)·오래된 방(6시간) 자동 삭제
  async function sweep(rooms) {
    rooms = rooms || await listRooms();
    const now = Date.now();
    for (const [code, r] of Object.entries(rooms)) {
      if (!r) continue;
      const doneStale = r.status === 'finished' && now - (r.finishedAt || r.turnStartedAt || r.createdAt || 0) > 3 * 60e3;
      const oldStale = now - (r.createdAt || 0) > 6 * 3600e3;
      if (doneStale || oldStale) await deleteRoom(code);
    }
  }

  // ---- 접속자 / 사용자 차단 ----
  async function heartbeat(clientId, info) {
    await fetch(`${BASE}/presence/${clientId}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) });
  }
  async function listPresence() { return (await (await fetch(`${BASE}/presence.json`)).json()) || {}; }
  async function deletePresence(id) { await fetch(`${BASE}/presence/${id}.json`, { method: 'DELETE' }); }
  async function isUserBlocked(username) {
    const res = await fetch(`${BASE}/blockedUsers/${encodeURIComponent(username)}.json`);
    if (!res.ok) throw new Error('차단 목록 읽기 실패');
    return (await res.json()) != null;
  }
  async function listBlockedUsers() { return (await (await fetch(`${BASE}/blockedUsers.json`)).json()) || {}; }
  async function blockUser(username, reason) {
    const res = await fetch(`${BASE}/blockedUsers/${encodeURIComponent(username)}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, reason: reason || '', at: Date.now() }) });
    if (!res.ok) throw new Error('차단 실패 (Firebase 규칙에 /blockedUsers 쓰기 권한이 필요합니다)');
  }
  async function unblockUser(username) { await fetch(`${BASE}/blockedUsers/${encodeURIComponent(username)}.json`, { method: 'DELETE' }); }

  async function getConfig() {
    const res = await fetch(`${BASE}/config.json`);
    if (!res.ok) throw new Error('config 읽기 실패');
    return (await res.json()) || {};
  }
  async function setConfig(cfg) {
    const res = await fetch(`${BASE}/config.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error('저장 실패 (Firebase 규칙에 /config 쓰기 권한이 필요합니다)');
    return res.json();
  }

  // ---- 계정(아이디/비밀번호) — 이 앱은 서버가 없어 비밀번호 해시를 클라이언트가 직접 비교합니다.
  // 즉, DB 규칙이 열려 있으면 누구나 해시를 읽어갈 수 있어 오프라인 크래킹에 취약합니다.
  // 실제 자산이 걸린 서비스가 아니라 재미용 게임머니 용도로만 사용하세요 (다른 곳과 같은 비밀번호 재사용 금지).
  const ID_RE = /^[A-Za-z0-9가-힣_]{2,16}$/;

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randomHex(bytes) {
    const arr = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function hashPassword(password, salt) {
    let h = `${salt}:${password}`;
    for (let i = 0; i < 1000; i++) h = await sha256Hex(h); // 약한 형태의 반복 해시 (bcrypt 대체 아님)
    return h;
  }
  async function getAuthRecord(username) {
    const res = await fetch(`${BASE}/auth/${encodeURIComponent(username)}.json`);
    if (!res.ok) throw new Error('계정 확인에 실패했습니다.');
    return res.json();
  }
  async function signup(username, password) {
    username = (username || '').trim();
    if (!ID_RE.test(username)) throw new Error('아이디는 영문/숫자/한글 2~16자로 입력하세요.');
    if (!password || password.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');
    const existing = await getAuthRecord(username);
    if (existing) throw new Error('이미 사용 중인 아이디입니다.');
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const putRes = await fetch(`${BASE}/auth/${encodeURIComponent(username)}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salt, hash, createdAt: Date.now() })
    });
    if (!putRes.ok) throw new Error('가입 실패 (Firebase 규칙에 /auth 쓰기 권한이 필요합니다)');
    await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coins: START_COINS, createdAt: Date.now() })
    });
    return { username, coins: START_COINS };
  }
  async function login(username, password) {
    username = (username || '').trim();
    if (!username || !password) throw new Error('아이디와 비밀번호를 입력하세요.');
    const rec = await getAuthRecord(username);
    if (!rec) throw new Error('존재하지 않는 아이디입니다.');
    const hash = await hashPassword(password, rec.salt);
    if (hash !== rec.hash) throw new Error('비밀번호가 일치하지 않습니다.');
    return { username };
  }

  // ---- 코인 지갑 ----
  async function getWallet(username) {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`);
    if (!res.ok) throw new Error('코인 정보를 불러오지 못했습니다.');
    return (await res.json()) || { coins: 0 };
  }
  async function adjustWallet(username, delta) {
    // Firebase 서버 증분(.sv increment)으로 동시 수정 시에도 비교적 안전하게 반영
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coins: { '.sv': { increment: delta } } })
    });
    if (!res.ok) throw new Error('코인 갱신에 실패했습니다.');
  }
  async function listWallets() {
    const res = await fetch(`${BASE}/users.json`);
    if (!res.ok) throw new Error('랭킹을 불러오지 못했습니다.');
    return (await res.json()) || {};
  }
  // 관리자용: 코인을 절대값으로 직접 설정 (adjustWallet은 상대적 증감)
  async function setWallet(username, coins) {
    const n = Math.max(0, Math.round(Number(coins) || 0));
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coins: n })
    });
    if (!res.ok) throw new Error('코인 설정에 실패했습니다.');
    return n;
  }

  function genCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // ---- 참가비 (베팅이 아닌, 게임 시작 시 무작위로 정해지는 금액) ----
  const FEE_MIN = 5000, FEE_MAX = 100000, FEE_STEP = 5000;
  function randomEntryFee() {
    const steps = Math.floor((FEE_MAX - FEE_MIN) / FEE_STEP) + 1;
    return FEE_MIN + Math.floor(Math.random() * steps) * FEE_STEP;
  }

  async function createRoom(hostName, hostId, settings, hostTitle, isPublic) {
    for (let i = 0; i < 10; i++) {
      const code = genCode();
      const existing = await getRoom(code);
      if (existing) continue; // 이미 사용 중인 코드면 재시도
      const room = {
        code,
        createdAt: Date.now(),
        hostId,
        status: 'waiting',
        isPublic: !!isPublic,
        turnSeconds: (settings && settings.turnSeconds) || 20,
        settings: settings || null,
        players: {
          [hostId]: { name: hostName, alive: true, joinedAt: Date.now(), title: hostTitle || null }
        },
        order: [hostId],
        turnIndex: 0,
        currentSyllable: null,
        usedWords: [],
        history: [],
        turnStartedAt: null,
        winnerId: null
      };
      await putRoom(code, room);
      return room;
    }
    throw new Error('방 코드를 생성하지 못했습니다. 다시 시도해주세요.');
  }

  // 참가자 모집 중인 공개방 목록 (방 코드 없이 참가 가능)
  async function listPublicRooms() {
    const rooms = await listRooms();
    sweep(rooms).catch(() => {});
    const arr = Object.values(rooms).filter(r => r && r.status === 'waiting' && r.isPublic
      && Date.now() - (r.createdAt || 0) < 6 * 3600e3);
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return arr;
  }

  // 방장 먼저, 이후 입장 순서
  function orderFromPlayers(players, hostId) {
    return Object.keys(players || {}).sort((x, y) => {
      if (x === hostId) return -1;
      if (y === hostId) return 1;
      return (players[x].joinedAt || 0) - (players[y].joinedAt || 0);
    });
  }

  async function joinRoom(code, name, playerId, title) {
    const room = await getRoom(code);
    if (!room) throw new Error('존재하지 않는 방 코드입니다.');
    if (room.status !== 'waiting') throw new Error('이미 시작된 게임입니다.');
    // 내 항목만 원자적으로 추가 (players 전체를 덮어쓰지 않음)
    await patchRoom(code, { ['players/' + playerId]: { name, alive: true, joinedAt: Date.now(), title: title || null } });
    const fresh = await getRoom(code);
    if (!fresh) throw new Error('방이 사라졌습니다.');
    const order = orderFromPlayers(fresh.players, fresh.hostId);
    await patchRoom(code, { order });
    return { ...fresh, order };
  }

  async function leaveRoom(code, playerId) {
    await fetch(`${BASE}/rooms/${code}/players/${playerId}.json`, { method: 'DELETE' });
  }

  async function startGame(code, room) {
    Game.init();
    if (room.settings) Game.setSettings(room.settings);
    const fee = randomEntryFee(); // 베팅이 아닌, 게임 시작 시 무작위로 정해지는 참가비 (5,000~100,000원, 5,000원 단위)
    const fresh = (await getRoom(code)) || room;           // 최신 참가자 명단으로 순서 확정
    const order = orderFromPlayers(fresh.players, fresh.hostId);
    // 시작 전 전원 잔액 확인 (부족하면 시작하지 않음)
    for (const pid of order) {
      const uname = (fresh.players[pid] || {}).name;
      const w = await getWallet(uname);
      if ((w.coins || 0) < fee) throw new Error(`${uname}님의 코인이 부족합니다. (보유 ${(w.coins || 0).toLocaleString()} / 필요 ${fee.toLocaleString()})`);
    }
    // 확인 후 전원 차감
    for (const pid of order) await adjustWallet((fresh.players[pid] || {}).name, -fee);
    const st = Game.newStart();
    await patchRoom(code, {
      order,
      status: 'playing',
      currentSyllable: st.syll,
      usedWords: st.word ? [st.word] : [],
      history: [{ playerId: 'system', name: st.label, word: st.word || st.syll, ts: Date.now() }],
      turnStartedAt: Date.now(),
      turnIndex: 0,
      entryFee: fee,
      pot: fee * order.length,
      payoutDone: false
    });
  }

  async function submitWord(code, room, playerId, playerName, word) {
    const usedWords = [...(room.usedWords || []), word];
    const history = [...(room.history || []), { playerId, name: playerName, word, ts: Date.now() }];
    const order = room.order || [];
    const nextIdx = nextAliveIndex(order, room.players, room.turnIndex);
    await patchRoom(code, {
      usedWords,
      history,
      currentSyllable: Game.lastSyll(word),
      turnIndex: nextIdx,
      turnStartedAt: Date.now()
    });
  }

  function nextAliveIndex(order, players, fromIdx) {
    const n = order.length;
    for (let step = 1; step <= n; step++) {
      const idx = (fromIdx + step) % n;
      const pid = order[idx];
      if (players[pid] && players[pid].alive) return idx;
    }
    return fromIdx;
  }

  async function eliminateCurrentPlayer(code, room) {
    const order = room.order || [];
    const players = { ...room.players };
    const curPid = order[room.turnIndex];
    if (!players[curPid] || !players[curPid].alive) return; // 이미 처리됨
    const fresh = (await getRoom(code)) || room;
    if (fresh.status === 'finished') return; // 다른 클라이언트가 이미 종료 처리함
    players[curPid] = { ...players[curPid], alive: false };
    const aliveIds = order.filter(pid => players[pid] && players[pid].alive);
    if (aliveIds.length <= 1) {
      const winnerId = aliveIds[0] || null;
      await patchRoom(code, {
        players,
        status: 'finished',
        finishedAt: Date.now(),
        winnerId,
        payoutDone: true
      });
      if (!fresh.payoutDone && winnerId && fresh.pot) {
        const winnerName = (players[winnerId] || {}).name;
        if (winnerName) await adjustWallet(winnerName, fresh.pot).catch(() => {});
      }
      return;
    }
    const nextIdx = nextAliveIndex(order, players, room.turnIndex);
    await patchRoom(code, {
      players,
      turnIndex: nextIdx,
      turnStartedAt: Date.now()
    });
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---- 칭호(타이틀) 상점 ----
  async function listTitles() {
    const res = await fetch(`${BASE}/titles.json`);
    if (!res.ok) throw new Error('칭호 목록을 불러오지 못했습니다.');
    return (await res.json()) || {};
  }
  async function addTitle(name, price) {
    name = (name || '').trim();
    if (!name) throw new Error('칭호 이름을 입력하세요.');
    price = Math.max(0, Math.round(Number(price) || 0));
    const id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const res = await fetch(`${BASE}/titles/${id}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, createdAt: Date.now() })
    });
    if (!res.ok) throw new Error('칭호 추가 실패 (Firebase 규칙에 /titles 쓰기 권한이 필요합니다)');
    return id;
  }
  async function deleteTitle(id) {
    await fetch(`${BASE}/titles/${id}.json`, { method: 'DELETE' });
  }
  async function buyTitle(username, titleId, price) {
    const w = await getWallet(username);
    if (w.ownedTitles && w.ownedTitles[titleId]) throw new Error('이미 보유한 칭호입니다.');
    if ((w.coins || 0) < price) throw new Error('코인이 부족합니다.');
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coins: { '.sv': { increment: -price } }, ['ownedTitles/' + titleId]: true })
    });
    if (!res.ok) throw new Error('구매에 실패했습니다.');
  }
  async function equipTitle(username, titleId) {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equippedTitle: titleId || null })
    });
    if (!res.ok) throw new Error('칭호 장착에 실패했습니다.');
  }

  return {
    getRoom, putRoom, patchRoom, deleteRoom, getConfig, setConfig, listRooms, resetRoom, sweep,
    heartbeat, listPresence, deletePresence, isUserBlocked, listBlockedUsers, blockUser, unblockUser,
    createRoom, joinRoom, leaveRoom, startGame, submitWord, listPublicRooms,
    eliminateCurrentPlayer, nextAliveIndex, uid,
    signup, login, getWallet, adjustWallet, setWallet, listWallets, START_COINS,
    listTitles, addTitle, deleteTitle, buyTitle, equipTitle
  };
})();
