const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O to avoid confusion
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 10);
}

function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    phase: 'lobby', // lobby | investigation | assembly
    hostSocketId,
    createdAt: Date.now(),
    players: new Map(),
    timerDuration: 480, // 8 minutes default
    timerStartedAt: null,
    timerInterval: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

function addPlayer(room, name, socketId) {
  const id = generatePlayerId();
  const player = {
    id,
    name,
    socketId,
    sceneId: null,
    status: 'waiting', // waiting | investigating | submitted | complete
    chatHistory: [],
    messageCount: 0,
    submission: null,
    evaluation: null,
    lastActivity: Date.now(),
  };
  room.players.set(id, player);
  return player;
}

function removePlayer(room, playerId) {
  room.players.delete(playerId);
}

function getPlayerBySocketId(room, socketId) {
  for (const player of room.players.values()) {
    if (player.socketId === socketId) return player;
  }
  return null;
}

function findPlayerById(playerId) {
  for (const room of rooms.values()) {
    if (room.players.has(playerId)) {
      return { room, player: room.players.get(playerId) };
    }
  }
  return null;
}

function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId) return room;
    for (const player of room.players.values()) {
      if (player.socketId === socketId) return room;
    }
  }
  return null;
}

function getPlayersArray(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    sceneId: p.sceneId,
    status: p.status,
    messageCount: p.messageCount,
    lastActivity: p.lastActivity,
  }));
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (room?.timerInterval) {
    clearInterval(room.timerInterval);
  }
  rooms.delete(code);
}

module.exports = {
  createRoom,
  getRoom,
  addPlayer,
  removePlayer,
  getPlayerBySocketId,
  findPlayerById,
  getRoomBySocketId,
  getPlayersArray,
  deleteRoom,
};
