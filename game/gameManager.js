const questions = require('../questions/questions.json');

const CATEGORY_VOTE_TIME = 15;
const QUESTION_TIME = 20;
const RESULT_TIME = 5;
const QUESTIONS_PER_GAME = 5;
const BASE_SCORE = 1000;
const SPEED_BONUS = 500;

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
    this.phase = 'LOBBY';
    this.scores = {};
    this.currentQuestionIdx = 0;
    this.gameQuestions = [];
    this.availableCategories = [];
    this.categoryVotes = {};
    this.answers = {};
    this.questionStartTime = null;
  }

  start() {
    this.room.players.forEach(p => { this.scores[p.id] = 0; });
    this.startCategoryVote();
  }

  startCategoryVote() {
    this.phase = 'CATEGORY_VOTE';
    this.categoryVotes = {};

    const allKeys = Object.keys(questions.categories);
    this.availableCategories = shuffle(allKeys).slice(0, 4);

    this.broadcast('phase_changed', {
      phase: 'CATEGORY_VOTE',
      categories: this.availableCategories.map(k => questions.categories[k].name),
      votes: [0, 0, 0, 0],
      timeLimit: CATEGORY_VOTE_TIME,
    });

    this.startTimer(CATEGORY_VOTE_TIME, () => this.endCategoryVote());
  }

  voteCategory(playerId, categoryIndex) {
    if (this.phase !== 'CATEGORY_VOTE') return;
    if (categoryIndex < 0 || categoryIndex > 3) return;

    this.categoryVotes[playerId] = categoryIndex;

    const tally = [0, 0, 0, 0];
    Object.values(this.categoryVotes).forEach(v => tally[v]++);

    this.broadcast('vote_update', { votes: tally });
  }

  endCategoryVote() {
    const tally = [0, 0, 0, 0];
    Object.values(this.categoryVotes).forEach(v => tally[v]++);

    // tie-break: random among tied winners
    const max = Math.max(...tally);
    const tied = tally.reduce((acc, v, i) => (v === max ? [...acc, i] : acc), []);
    const winnerIdx = tied[Math.floor(Math.random() * tied.length)];
    const winnerKey = this.availableCategories[winnerIdx];

    this.gameQuestions = shuffle(questions.categories[winnerKey].questions).slice(0, QUESTIONS_PER_GAME);
    this.currentQuestionIdx = 0;

    this.startQuestion();
  }

  startQuestion() {
    if (this.currentQuestionIdx >= this.gameQuestions.length) {
      return this.endGame();
    }

    this.phase = 'QUESTION_ACTIVE';
    this.answers = {};
    this.questionStartTime = Date.now();

    const q = this.gameQuestions[this.currentQuestionIdx];

    this.broadcast('phase_changed', {
      phase: 'QUESTION_ACTIVE',
      questionNumber: this.currentQuestionIdx + 1,
      totalQuestions: this.gameQuestions.length,
      question: q.question,
      options: q.options,
      timeLimit: QUESTION_TIME,
    });

    this.startTimer(QUESTION_TIME, () => this.endQuestion());
  }

  submitAnswer(playerId, answerIndex) {
    if (this.phase !== 'QUESTION_ACTIVE') return;
    if (this.answers[playerId] !== undefined) return;
    if (answerIndex < 0 || answerIndex > 3) return;

    const elapsed = (Date.now() - this.questionStartTime) / 1000;
    const timeLeft = Math.max(0, QUESTION_TIME - elapsed);

    this.answers[playerId] = { answerIndex, timeLeft };
    this.broadcast('answer_submitted', { count: Object.keys(this.answers).length });

    if (Object.keys(this.answers).length >= this.room.players.length) {
      this.clearTimer();
      this.endQuestion();
    }
  }

  endQuestion() {
    this.phase = 'QUESTION_RESULT';
    const q = this.gameQuestions[this.currentQuestionIdx];

    const roundScores = {};
    const playerAnswers = {};

    this.room.players.forEach(p => {
      const answer = this.answers[p.id];
      const correct = answer ? answer.answerIndex === q.correct : false;
      const points = correct ? Math.round(BASE_SCORE + (answer.timeLeft / QUESTION_TIME) * SPEED_BONUS) : 0;

      roundScores[p.id] = points;
      this.scores[p.id] = (this.scores[p.id] || 0) + points;

      playerAnswers[p.id] = {
        nickname: p.nickname,
        answerIndex: answer ? answer.answerIndex : null,
        correct,
        points,
      };
    });

    this.broadcast('phase_changed', {
      phase: 'QUESTION_RESULT',
      questionNumber: this.currentQuestionIdx + 1,
      totalQuestions: this.gameQuestions.length,
      question: q.question,
      options: q.options,
      correctIndex: q.correct,
      playerAnswers,
      roundScores,
      scoreboard: this.getScoreboard(),
      timeLimit: RESULT_TIME,
    });

    this.currentQuestionIdx++;
    this.startTimer(RESULT_TIME, () => this.startQuestion());
  }

  endGame() {
    this.phase = 'GAME_OVER';
    const scoreboard = this.getScoreboard();

    this.broadcast('phase_changed', {
      phase: 'GAME_OVER',
      scoreboard,
      winner: scoreboard[0] || null,
    });
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
  }
}

module.exports = GameManager;
