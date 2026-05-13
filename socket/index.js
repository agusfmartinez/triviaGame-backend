const { createRoom, joinRoom, removePlayer, startGame } = require('../rooms/roomManager');
const GameManager = require('../game/gameManager');

const activeGames = new Map();

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[+] ${socket.id}`);

    socket.on('create_room', ({ nickname }) => {
      if (!nickname?.trim()) return socket.emit('error', { message: 'Nickname inválido' });

      const room = createRoom(socket.id, nickname.trim());
      socket.join(room.code);
      socket.emit('room_created', { room });
      console.log(`Room ${room.code} created by ${nickname}`);
    });

    socket.on('join_room', ({ code, nickname }) => {
      if (!nickname?.trim() || !code?.trim()) {
        return socket.emit('error', { message: 'Datos inválidos' });
      }

      const result = joinRoom(code, socket.id, nickname.trim());
      if (result.error) return socket.emit('error', { message: result.error });

      socket.join(result.room.code);
      socket.emit('room_joined', { room: result.room });
      socket.to(result.room.code).emit('room_updated', { room: result.room });
      console.log(`${nickname} joined room ${result.room.code}`);
    });

    socket.on('start_game', ({ code }) => {
      const result = startGame(code, socket.id);
      if (result.error) return socket.emit('error', { message: result.error });

      const game = new GameManager(result.room, io);
      activeGames.set(result.room.code, game);

      io.to(result.room.code).emit('game_started', { room: result.room });
      game.start();
      console.log(`Game started in room ${result.room.code}`);
    });

    socket.on('leave_room', () => {
      const result = removePlayer(socket.id);
      if (!result) return;
      socket.emit('left_room');
      if (result.deleted) return;
      io.to(result.code).emit('room_updated', { room: result.room });
    });

    socket.on('vote_category', ({ code, categoryIndex }) => {
      const game = activeGames.get(code?.toUpperCase());
      if (!game) return;
      game.voteCategory(socket.id, categoryIndex);
    });

    socket.on('submit_answer', ({ code, answerIndex }) => {
      const game = activeGames.get(code?.toUpperCase());
      if (!game) return;
      game.submitAnswer(socket.id, answerIndex);
    });

    socket.on('ready_next', ({ code }) => {
      const game = activeGames.get(code?.toUpperCase());
      if (!game) return;
      game.markReady(socket.id);
    });

    socket.on('vote_rematch', ({ code }) => {
      const game = activeGames.get(code?.toUpperCase());
      if (!game) return;
      game.voteRematch(socket.id);
    });

    socket.on('dev_skip', ({ code }) => {
      if (process.env.NODE_ENV === 'production') return;
      const game = activeGames.get(code?.toUpperCase());
      if (!game) return;
      game.skip();
    });

    socket.on('disconnect', () => {
      console.log(`[-] ${socket.id}`);
      const result = removePlayer(socket.id);
      if (!result) return;

      if (result.deleted) {
        const game = activeGames.get(result.code);
        if (game) {
          game.destroy();
          activeGames.delete(result.code);
        }
        return;
      }

      io.to(result.code).emit('room_updated', { room: result.room });
    });
  });
}

module.exports = registerSocketHandlers;
