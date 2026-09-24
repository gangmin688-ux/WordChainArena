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

  function genCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  async function createRoom(hostName, hostId) {
    for (let i = 0; i < 10; i++) {
      const code = genCode();
      const existing = await getRoom(code);
      if (existing) continue; // 이미 사용 중인 코드면 재시도
      const room = {
        code,
        createdAt: Date.now(),
        hostId,
        status: 'waiting',
        turnSeconds: 20,
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

  async function joinRoom(code, name, playerId) {
    const room = await getRoom(code);
    if (!room) throw new Error('존재하지 않는 방 코드입니다.');
    if (room.status !== 'waiting') throw new Error('이미 시작된 게임입니다.');
    const players = room.players || {};
    players[playerId] = { name, alive: true, joinedAt: Date.now() };
    const order = room.order || [];
    if (!order.includes(playerId)) order.push(playerId);
    await patchRoom(code, { players, order });
    return { ...room, players, order };
  }

  async function startGame(code, room) {
    Game.init();
    const startWord = Game.randomStartWord();
    await patchRoom(code, {
      status: 'playing',
      currentSyllable: Game.lastSyll(startWord),
      usedWords: [startWord],
      history: [{ playerId: 'system', name: '시작 단어', word: startWord, ts: Date.now() }],
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
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }

  return {
    getRoom, putRoom, patchRoom, deleteRoom,
    createRoom, joinRoom, startGame, submitWord,
    eliminateCurrentPlayer, nextAliveIndex, uid
  };
})();
