const { generateRoomCode } = require('../utils/codeGenerator');

const rooms = new Map();

function createRoom(hostId, hostNickname) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    hostId,
    players: [{ id: hostId, nickname: hostNickname, isHost: true }],
    state: 'LOBBY',
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerId, nickname) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Sala no encontrada' };
  if (room.state !== 'LOBBY') return { error: 'La partida ya comenzó' };
  if (room.players.length >= 10) return { error: 'Sala llena (máximo 10 jugadores)' };
  if (room.players.find(p => p.nickname.toLowerCase() === nickname.toLowerCase())) {
    return { error: 'Ese nickname ya está en uso' };
  }
  room.players.push({ id: playerId, nickname, isHost: false });
  return { room };
}

function removePlayer(playerId) {
  for (const [code, room] of rooms.entries()) {
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(code);
      return { deleted: true, code };
    }

    if (room.hostId === playerId) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
    }

    return { room, code };
  }
  return null;
}

function getRoom(code) {
  return rooms.get(code.toUpperCase());
}

function startGame(code, requesterId) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Sala no encontrada' };
  if (room.hostId !== requesterId) return { error: 'Solo el host puede iniciar la partida' };
  if (room.players.length < 2) return { error: 'Se necesitan al menos 2 jugadores' };
  room.state = 'GAME_STARTED';
  return { room };
}

module.exports = { createRoom, joinRoom, removePlayer, getRoom, startGame };
