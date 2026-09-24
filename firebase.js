// ===== Firebase Realtime Database REST 래퍼 (SDK 불필요) =====
const FB = (() => {
  const BASE = 'https://wordchainarena-default-rtdb.asia-southeast1.firebasedatabase.app';

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
      currentSyllable: null, winnerId: null, turnStartedAt: null });
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

  // ---- 접속자 / IP 차단 ----
  const ipKey = ip => String(ip).replace(/[.:]/g, '_');
  let cachedIP = null;
  async function getIP() {
    if (cachedIP) return cachedIP;
    for (const u of ['https://api.ipify.org?format=json', 'https://api64.ipify.org?format=json']) {
      try { const j = await (await fetch(u)).json(); if (j.ip) return (cachedIP = j.ip); } catch (e) { /* 다음 주소 시도 */ }
    }
    return null;
  }
  async function heartbeat(clientId, info) {
    await fetch(`${BASE}/presence/${clientId}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) });
  }
  async function listPresence() { return (await (await fetch(`${BASE}/presence.json`)).json()) || {}; }
  async function deletePresence(id) { await fetch(`${BASE}/presence/${id}.json`, { method: 'DELETE' }); }
  async function isBlocked(ip) {
    const res = await fetch(`${BASE}/blocked/${ipKey(ip)}.json`);
    if (!res.ok) throw new Error('차단 목록 읽기 실패');
    return (await res.json()) != null;
  }
  async function listBlocked() { return (await (await fetch(`${BASE}/blocked.json`)).json()) || {}; }
  async function blockIP(ip, reason) {
    const res = await fetch(`${BASE}/blocked/${ipKey(ip)}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, reason: reason || '', at: Date.now() }) });
    if (!res.ok) throw new Error('차단 실패 (Firebase 규칙에 /blocked 쓰기 권한이 필요합니다)');
  }
  async function unblockIP(ip) { await fetch(`${BASE}/blocked/${ipKey(ip)}.json`, { method: 'DELETE' }); }

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

  function genCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  async function createRoom(hostName, hostId, settings) {
    for (let i = 0; i < 10; i++) {
      const code = genCode();
      const existing = await getRoom(code);
      if (existing) continue; // 이미 사용 중인 코드면 재시도
      const room = {
        code,
        createdAt: Date.now(),
        hostId,
        status: 'waiting',
        turnSeconds: (settings && settings.turnSeconds) || 20,
        settings: settings || null,
        players: {
          [hostId]: { name: hostName, alive: true, joinedAt: Date.now() }
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

  // 방장 먼저, 이후 입장 순서
  function orderFromPlayers(players, hostId) {
    return Object.keys(players || {}).sort((x, y) => {
      if (x === hostId) return -1;
      if (y === hostId) return 1;
      return (players[x].joinedAt || 0) - (players[y].joinedAt || 0);
    });
  }

  async function joinRoom(code, name, playerId) {
    const room = await getRoom(code);
    if (!room) throw new Error('존재하지 않는 방 코드입니다.');
    if (room.status !== 'waiting') throw new Error('이미 시작된 게임입니다.');
    // 내 항목만 원자적으로 추가 (players 전체를 덮어쓰지 않음)
    await patchRoom(code, { ['players/' + playerId]: { name, alive: true, joinedAt: Date.now() } });
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
    const st = Game.newStart();
    const fresh = (await getRoom(code)) || room;           // 최신 참가자 명단으로 순서 확정
    await patchRoom(code, {
      order: orderFromPlayers(fresh.players, fresh.hostId),
      status: 'playing',
      currentSyllable: st.syll,
      usedWords: st.word ? [st.word] : [],
      history: [{ playerId: 'system', name: st.label, word: st.word || st.syll, ts: Date.now() }],
      turnStartedAt: Date.now(),
      turnIndex: 0
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
    players[curPid] = { ...players[curPid], alive: false };
    const aliveIds = order.filter(pid => players[pid] && players[pid].alive);
    if (aliveIds.length <= 1) {
      await patchRoom(code, {
        players,
        status: 'finished',
        finishedAt: Date.now(),
        winnerId: aliveIds[0] || null
      });
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

  return {
    getRoom, putRoom, patchRoom, deleteRoom, getConfig, setConfig, listRooms, resetRoom, sweep,
    getIP, heartbeat, listPresence, deletePresence, isBlocked, listBlocked, blockIP, unblockIP,
    createRoom, joinRoom, leaveRoom, startGame, submitWord,
    eliminateCurrentPlayer, nextAliveIndex, uid
  };
})();
