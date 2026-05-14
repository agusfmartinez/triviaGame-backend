const questions = require('../questions/questions.json');
const STATES = require('./states');

const CATEGORY_VOTE_TIME = 15;
const QUESTION_INTRO_TIME = 3;
const QUESTION_TIME = 20;
const RESULT_TIME = 10;
const SCOREBOARD_TIME = 30;
const QUESTIONS_PER_ROUND = 4;
const TOTAL_ROUNDS = 3;
const BASE_SCORE = 1000;
const SPEED_BONUS = 500;
const PYRAMID_INTRO_TIME = 30;
const PYRAMID_QUESTION_TIME = 15;
const PYRAMID_RESULT_TIME = 8;
const PYRAMID_SCOREBOARD_TIME = 30;
const PYRAMID_MAX_QUESTIONS = 30;
const PYRAMID_TOP_MOVERS = 3;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameManager {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.timer = null;
    this.phase = STATES.LOBBY;
    this.scores = {};
    this.currentQuestionIdx = 0;
    this.gameQuestions = [];
    this.availableCategories = [];
    this.categoryVotes = {};
    this.answers = {};
    this.questionStartTime = null;
    this.readyPlayers = new Set();
    this.currentRound = 0;
    this.rematchVotes = new Set();
    this.rematchTimer = null;
    this.pyramidPositions = {};
    this.pyramidHeight = 0;
    this.pyramidQuestions = [];
    this.pyramidQuestionIdx = 0;
    this.pyramidAnswers = {};
    this.pyramidWinnerId = null;
    this.pyramidReadyVotes = new Set();
    this.pyramidReadyTimer = null;
    this.pyramidReadyPlayers = new Set();
  }

  start() {
    this.currentRound = 1;
    this.room.players.forEach(p => { this.scores[p.id] = 0; });
    this.startCategoryVote();
  }

  startCategoryVote() {
    this.phase = STATES.CATEGORY_VOTE;
    this.categoryVotes = {};

    const allKeys = Object.keys(questions.categories);
    this.availableCategories = shuffle(allKeys).slice(0, 4);

    this.broadcast('phase_changed', {
      phase: STATES.CATEGORY_VOTE,
      categories: this.availableCategories.map(k => questions.categories[k].name),
      votes: [0, 0, 0, 0],
      currentRound: this.currentRound,
      totalRounds: TOTAL_ROUNDS,
      timeLimit: CATEGORY_VOTE_TIME,
    });

    this.startTimer(CATEGORY_VOTE_TIME, () => this.endCategoryVote());
  }

  voteCategory(playerId, categoryIndex) {
    if (this.phase !== STATES.CATEGORY_VOTE) return;
    if (categoryIndex < 0 || categoryIndex > 3) return;

    this.categoryVotes[playerId] = categoryIndex;

    const tally = [0, 0, 0, 0];
    Object.values(this.categoryVotes).forEach(v => tally[v]++);

    this.broadcast('vote_update', { votes: tally });
  }

  endCategoryVote() {
    const tally = [0, 0, 0, 0];
    Object.values(this.categoryVotes).forEach(v => tally[v]++);

    const max = Math.max(...tally);
    const tied = tally.reduce((acc, v, i) => (v === max ? [...acc, i] : acc), []);
    const winnerIdx = tied[Math.floor(Math.random() * tied.length)];
    const winnerKey = this.availableCategories[winnerIdx];
    const winnerName = questions.categories[winnerKey].name;

    this.gameQuestions = shuffle(questions.categories[winnerKey].questions).slice(0, QUESTIONS_PER_ROUND);
    this.currentQuestionIdx = 0;

    this.startQuestionIntro(winnerName);
  }

  startQuestionIntro(categoryName) {
    this.phase = STATES.QUESTION_INTRO;
    this.answers = {};

    const q = this.gameQuestions[this.currentQuestionIdx];

    this.broadcast('phase_changed', {
      phase: STATES.QUESTION_INTRO,
      questionNumber: this.currentQuestionIdx + 1,
      totalQuestions: this.gameQuestions.length,
      categoryName: categoryName || null,
      question: q.question,
      timeLimit: QUESTION_INTRO_TIME,
    });

    this.startTimer(QUESTION_INTRO_TIME, () => this.startQuestionActive());
  }

  startQuestionActive() {
    this.phase = STATES.QUESTION_ACTIVE;
    this.answers = {};
    this.questionStartTime = Date.now();

    const q = this.gameQuestions[this.currentQuestionIdx];

    this.broadcast('phase_changed', {
      phase: STATES.QUESTION_ACTIVE,
      questionNumber: this.currentQuestionIdx + 1,
      totalQuestions: this.gameQuestions.length,
      question: q.question,
      options: q.options,
      timeLimit: QUESTION_TIME,
    });

    this.startTimer(QUESTION_TIME, () => this.endQuestion());
  }

  submitAnswer(playerId, answerIndex) {
    if (this.phase !== STATES.QUESTION_ACTIVE) return;
    if (this.answers[playerId] !== undefined) return;
    if (answerIndex < 0 || answerIndex > 3) return;

    const elapsed = (Date.now() - this.questionStartTime) / 1000;
    const timeLeft = Math.max(0, QUESTION_TIME - elapsed);

    this.answers[playerId] = { answerIndex, timeLeft };
    this.broadcast('answer_submitted', { count: Object.keys(this.answers).length });
  }

  endQuestion() {
    this.phase = STATES.QUESTION_RESULT;
    const q = this.gameQuestions[this.currentQuestionIdx];

    const playerAnswers = {};

    this.room.players.forEach(p => {
      const answer = this.answers[p.id];
      const correct = answer ? answer.answerIndex === q.correct : false;
      const points = correct
        ? Math.round(BASE_SCORE + (answer.timeLeft / QUESTION_TIME) * SPEED_BONUS)
        : 0;

      this.scores[p.id] = (this.scores[p.id] || 0) + points;

      playerAnswers[p.id] = {
        nickname: p.nickname,
        answerIndex: answer ? answer.answerIndex : null,
        correct,
        points,
        timeSpent: answer ? Math.round((QUESTION_TIME - answer.timeLeft) * 10) / 10 : null,
      };
    });

    this.broadcast('phase_changed', {
      phase: STATES.QUESTION_RESULT,
      questionNumber: this.currentQuestionIdx + 1,
      totalQuestions: this.gameQuestions.length,
      question: q.question,
      options: q.options,
      correctIndex: q.correct,
      playerAnswers,
      scoreboard: this.getScoreboard(),
      timeLimit: RESULT_TIME,
    });

    this.currentQuestionIdx++;
    this.startTimer(RESULT_TIME, () => this.showScoreboard());
  }

  showScoreboard() {
    this.phase = STATES.SCOREBOARD;
    this.readyPlayers = new Set();
    const scoreboard = this.getScoreboard();
    const isEndOfRound = this.currentQuestionIdx >= this.gameQuestions.length;
    const isLast = isEndOfRound && this.currentRound >= TOTAL_ROUNDS;

    this.broadcast('phase_changed', {
      phase: STATES.SCOREBOARD,
      scoreboard,
      currentRound: this.currentRound,
      totalRounds: TOTAL_ROUNDS,
      isEndOfRound,
      isLast,
      readyCount: 0,
      totalPlayers: this.room.players.length,
      timeLimit: SCOREBOARD_TIME,
    });

    this.startTimer(SCOREBOARD_TIME, () => this.advanceFromScoreboard());
  }

  markReady(playerId) {
    if (this.phase !== STATES.SCOREBOARD) return;
    this.readyPlayers.add(playerId);

    this.broadcast('ready_update', {
      readyCount: this.readyPlayers.size,
      totalPlayers: this.room.players.length,
    });

    if (this.readyPlayers.size >= this.room.players.length) {
      this.clearTimer();
      this.advanceFromScoreboard();
    }
  }

  advanceFromScoreboard() {
    if (this.currentQuestionIdx < this.gameQuestions.length) {
      this.startQuestionIntro(null);
    } else if (this.currentRound >= TOTAL_ROUNDS) {
      this.startPyramidIntro();
    } else {
      this.currentRound++;
      this.startCategoryVote();
    }
  }

  startPyramidIntro() {
    this.phase = STATES.PYRAMID_INTRO;
    this.pyramidReadyVotes = new Set();
    if (this.pyramidReadyTimer) clearTimeout(this.pyramidReadyTimer);
    this.pyramidReadyTimer = null;

    const scoreboard = this.getScoreboard();
    const n = this.room.players.length;
    this.pyramidHeight = n * 2;

    scoreboard.forEach((p, i) => {
      this.pyramidPositions[p.id] = { nickname: p.nickname, position: n - i };
    });

    const allQuestions = Object.values(questions.categories).flatMap(c => c.questions);
    this.pyramidQuestions = shuffle(allQuestions);
    this.pyramidQuestionIdx = 0;
    this.pyramidWinnerId = null;

    this.broadcast('phase_changed', {
      phase: STATES.PYRAMID_INTRO,
      positions: this.pyramidPositions,
      pyramidHeight: this.pyramidHeight,
      readyCount: 0,
      totalPlayers: this.room.players.length,
      timeLimit: PYRAMID_INTRO_TIME,
    });
  }

  votePyramidStart(playerId) {
    if (this.phase !== STATES.PYRAMID_INTRO) return;
    if (this.pyramidReadyVotes.has(playerId)) return;

    const isFirst = this.pyramidReadyVotes.size === 0;
    this.pyramidReadyVotes.add(playerId);

    this.broadcast('pyramid_intro_update', {
      readyCount: this.pyramidReadyVotes.size,
      totalPlayers: this.room.players.length,
    });

    if (this.pyramidReadyVotes.size >= this.room.players.length) {
      if (this.pyramidReadyTimer) clearTimeout(this.pyramidReadyTimer);
      this.startPyramidQuestion();
      return;
    }

    if (isFirst) {
      this.startTimer(PYRAMID_INTRO_TIME, () => this.startPyramidQuestion());
    }
  }

  startPyramidQuestion() {
    this.phase = STATES.FINAL_PYRAMID;
    this.pyramidAnswers = {};
    this.questionStartTime = Date.now();

    const q = this.pyramidQuestions[this.pyramidQuestionIdx % this.pyramidQuestions.length];

    this.broadcast('phase_changed', {
      phase: STATES.FINAL_PYRAMID,
      question: q.question,
      options: q.options,
      questionNumber: this.pyramidQuestionIdx + 1,
      totalPlayers: this.room.players.length,
      timeLimit: PYRAMID_QUESTION_TIME,
    });

    this.startTimer(PYRAMID_QUESTION_TIME, () => this.endPyramidQuestion());
  }

  submitPyramidAnswer(playerId, answerIndex) {
    if (this.phase !== STATES.FINAL_PYRAMID) return;
    if (this.pyramidAnswers[playerId] !== undefined) return;
    if (answerIndex < 0 || answerIndex > 3) return;

    const elapsed = (Date.now() - this.questionStartTime) / 1000;
    this.pyramidAnswers[playerId] = { answerIndex, elapsed };
    this.broadcast('answer_submitted', { count: Object.keys(this.pyramidAnswers).length });
  }

  endPyramidQuestion() {
    const q = this.pyramidQuestions[this.pyramidQuestionIdx % this.pyramidQuestions.length];

    const atTop = new Set(
      this.room.players
        .filter(p => (this.pyramidPositions[p.id]?.position || 0) >= this.pyramidHeight)
        .map(p => p.id)
    );

    const correctAnswers = [];
    const playerAnswers = {};

    this.room.players.forEach(p => {
      const answer = this.pyramidAnswers[p.id];
      const correct = answer ? answer.answerIndex === q.correct : false;
      playerAnswers[p.id] = {
        nickname: this.pyramidPositions[p.id]?.nickname || p.nickname,
        answerIndex: answer ? answer.answerIndex : null,
        correct,
        elapsed: answer ? answer.elapsed : null,
      };
      if (correct) correctAnswers.push({ id: p.id, elapsed: answer.elapsed });
    });

    correctAnswers.sort((a, b) => a.elapsed - b.elapsed);
    const top3 = new Set(correctAnswers.slice(0, PYRAMID_TOP_MOVERS).map(a => a.id));

    let winnerId = null;
    const winnersAtTop = correctAnswers.filter(a => atTop.has(a.id));
    if (winnersAtTop.length > 0) winnerId = winnersAtTop[0].id;

    const movements = {};
    this.room.players.forEach(p => {
      const pos = this.pyramidPositions[p.id];
      if (!pos) return;
      const correct = playerAnswers[p.id].correct;

      if (correct && top3.has(p.id)) {
        pos.position = Math.min(pos.position + 1, this.pyramidHeight);
        movements[p.id] = 1;
      } else if (!correct) {
        pos.position = Math.max(pos.position - 1, 1);
        movements[p.id] = -1;
      } else {
        movements[p.id] = 0;
      }
    });

    this.pyramidQuestionIdx++;
    this.pyramidWinnerId = winnerId;

    this.phase = STATES.PYRAMID_RESULT;
    this.broadcast('phase_changed', {
      phase: STATES.PYRAMID_RESULT,
      movements,
      correctIndex: q.correct,
      options: q.options,
      playerAnswers,
      questionNumber: this.pyramidQuestionIdx,
      winnerId,
      winnerNickname: winnerId ? this.room.players.find(p => p.id === winnerId)?.nickname : null,
      timeLimit: PYRAMID_RESULT_TIME,
    });

    this.startTimer(PYRAMID_RESULT_TIME, () => this.advanceFromPyramidResult());
  }

  advanceFromPyramidResult() {
    if (this.pyramidWinnerId) {
      this.endPyramidGame(this.pyramidWinnerId);
    } else if (this.pyramidQuestionIdx >= PYRAMID_MAX_QUESTIONS) {
      this.endPyramidGame(null);
    } else {
      this.showPyramidScoreboard();
    }
  }

  showPyramidScoreboard() {
    this.phase = STATES.PYRAMID_SCOREBOARD;
    this.pyramidReadyPlayers = new Set();

    this.broadcast('phase_changed', {
      phase: STATES.PYRAMID_SCOREBOARD,
      positions: this.pyramidPositions,
      pyramidHeight: this.pyramidHeight,
      questionNumber: this.pyramidQuestionIdx,
      readyCount: 0,
      totalPlayers: this.room.players.length,
      timeLimit: PYRAMID_SCOREBOARD_TIME,
    });

    this.startTimer(PYRAMID_SCOREBOARD_TIME, () => this.startPyramidQuestion());
  }

  markReadyPyramid(playerId) {
    if (this.phase !== STATES.PYRAMID_SCOREBOARD) return;
    this.pyramidReadyPlayers.add(playerId);

    this.broadcast('pyramid_ready_update', {
      readyCount: this.pyramidReadyPlayers.size,
      totalPlayers: this.room.players.length,
    });

    if (this.pyramidReadyPlayers.size >= this.room.players.length) {
      this.clearTimer();
      this.startPyramidQuestion();
    }
  }

  endPyramidGame(winnerId) {
    this.phase = STATES.GAME_OVER;

    const scoreboard = this.room.players
      .map(p => ({
        id: p.id,
        nickname: p.nickname,
        position: this.pyramidPositions[p.id]?.position || 1,
        score: this.scores[p.id] || 0,
      }))
      .sort((a, b) => b.position - a.position || b.score - a.score);

    const winnerPlayer = winnerId
      ? this.room.players.find(p => p.id === winnerId)
      : this.room.players.find(p => p.id === scoreboard[0]?.id);

    this.broadcast('phase_changed', {
      phase: STATES.GAME_OVER,
      scoreboard,
      winner: winnerPlayer ? { id: winnerPlayer.id, nickname: winnerPlayer.nickname, score: this.scores[winnerPlayer.id] || 0 } : null,
      fromPyramid: true,
      pyramidHeight: this.pyramidHeight,
    });
  }

  skip() {
    this.clearTimer();
    switch (this.phase) {
      case STATES.CATEGORY_VOTE:  this.endCategoryVote(); break;
      case STATES.QUESTION_INTRO: this.startQuestionActive(); break;
      case STATES.QUESTION_ACTIVE: this.endQuestion(); break;
      case STATES.QUESTION_RESULT: this.showScoreboard(); break;
      case STATES.SCOREBOARD: this.advanceFromScoreboard(); break;
      case STATES.PYRAMID_INTRO: this.startPyramidQuestion(); break;
      case STATES.FINAL_PYRAMID: this.endPyramidQuestion(); break;
      case STATES.PYRAMID_RESULT: this.advanceFromPyramidResult(); break;
      case STATES.PYRAMID_SCOREBOARD: this.startPyramidQuestion(); break;
      default: break;
    }
  }

  voteRematch(playerId) {
    if (this.phase !== STATES.GAME_OVER) return;
    if (this.rematchVotes.has(playerId)) return;

    const isFirst = this.rematchVotes.size === 0;
    this.rematchVotes.add(playerId);

    this.broadcast('rematch_update', {
      count: this.rematchVotes.size,
      totalPlayers: this.room.players.length,
    });

    if (this.rematchVotes.size >= this.room.players.length) {
      if (this.rematchTimer) clearTimeout(this.rematchTimer);
      this.executeRematch();
      return;
    }

    if (isFirst) {
      this.broadcast('rematch_timer_started', { timeLimit: 30 });
      this.rematchTimer = setTimeout(() => this.executeRematch(), 30000);
    }
  }

  executeRematch() {
    const voterIds = new Set(this.rematchVotes);
    const allPlayers = [...this.room.players];

    allPlayers.forEach(p => {
      if (!voterIds.has(p.id)) {
        this.io.to(p.id).emit('go_home');
      }
    });

    this.room.players = allPlayers.filter(p => voterIds.has(p.id));
    this.room.state = 'LOBBY';

    if (this.room.players.length > 0) {
      this.room.players.forEach(p => { p.isHost = false; });
      this.room.players[0].isHost = true;
      this.room.hostId = this.room.players[0].id;
      this.io.to(this.room.code).emit('rematch_start', { room: this.room });
    }
  }

  getScoreboard() {
    return this.room.players
      .map(p => ({ id: p.id, nickname: p.nickname, score: this.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  startTimer(seconds, callback) {
    this.clearTimer();
    let remaining = seconds;

    this.broadcast('timer_tick', { timeLeft: remaining });

    this.timer = setInterval(() => {
      remaining--;
      this.broadcast('timer_tick', { timeLeft: remaining });
      if (remaining <= 0) {
        this.clearTimer();
        callback();
      }
    }, 1000);
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  broadcast(event, data) {
    this.io.to(this.room.code).emit(event, data);
  }

  destroy() {
    this.clearTimer();
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    if (this.pyramidReadyTimer) clearTimeout(this.pyramidReadyTimer);
  }
}

module.exports = GameManager;
