const ATTACKS_BY_ROUND = {
  2: ['freeze', 'sticky'],
  3: ['freeze', 'sticky', 'confuse', 'hide'],
};

const DEFENSES = ['shield', 'no_drop', 'bombita'];

const ATTACK_META = {
  freeze:  { label: '❄️ Congelar',  desc: 'No puede responder 3s' },
  sticky:  { label: '🦠 Sticky',    desc: 'Slime tapa la pantalla 3s' },
  confuse: { label: '🔀 Confusión', desc: 'Opciones se mezclan 3s' },
  hide:    { label: '👁️ Ocultar',   desc: 'Opciones invisibles 3s' },
};

const DEFENSE_META = {
  shield:  { label: '🛡️ Escudo',   desc: 'Bloquea 1 ataque entrante' },
  no_drop: { label: '📌 No bajar', desc: 'No pierde escalón en pirámide' },
  bombita: { label: '💣 Bombita',  desc: 'Elimina 2 opciones incorrectas' },
};

function getAvailableAttacks(round) {
  if (round <= 1) return [];
  if (round === 2) return ATTACKS_BY_ROUND[2];
  return ATTACKS_BY_ROUND[3];
}

function getRandomDefense() {
  return DEFENSES[Math.floor(Math.random() * DEFENSES.length)];
}

module.exports = { ATTACK_META, DEFENSE_META, getAvailableAttacks, getRandomDefense };
