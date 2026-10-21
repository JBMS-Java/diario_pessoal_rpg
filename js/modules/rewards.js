import { validateReward } from './experience.js';

const NO_ATTRIBUTES = Object.freeze({ intellect: 0, strength: 0, technique: 0, endurance: 0, discipline: 0 });

export const SPECIAL_XP_RANGE = Object.freeze({ min: 60, max: 100, default: 80 });
export const EPIC_XP_RANGE = Object.freeze({ min: 150, max: 300, default: 200 });

/** XP de estudo focado: 25 base, +5 por duração (≥45 e ≥90 min) e +5 para dificuldade alta; teto de 40. */
export function focusedStudyXp(minutes, difficulty = 'normal') {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new RangeError('A duração deve ser positiva.');
  if (!['normal', 'hard'].includes(difficulty)) throw new RangeError('Dificuldade de estudo inválida.');
  let xp = 25;
  if (minutes >= 45) xp += 5;
  if (minutes >= 90) xp += 5;
  if (difficulty === 'hard') xp += 5;
  return Math.min(xp, 40);
}

function preset(id, label, kind, values) {
  return Object.freeze({
    id,
    label,
    kind,
    type: 'daily',
    attributeRewards: NO_ATTRIBUTES,
    ...values
  });
}

/** Modelos iniciais: só preenchem o formulário; valores salvos pelo usuário nunca são sobrescritos. */
export const REWARD_PRESETS = Object.freeze([
  preset('work', 'Trabalho · 12 XP por turno', 'routine', {
    title: 'Turno de trabalho', category: 'Disciplina e organização', xp: 12,
    attributeRewards: { ...NO_ATTRIBUTES, discipline: 1 }
  }),
  preset('spanish', 'Aula de espanhol · 35 XP', 'routine', {
    title: 'Aula de espanhol', category: 'Estudos e idiomas', xp: 35,
    attributeRewards: { ...NO_ATTRIBUTES, intellect: 2 }
  }),
  preset('gym', 'Academia · 18 XP', 'routine', {
    title: 'Treino na academia', category: 'Força e musculação', type: 'training', xp: 18,
    attributeRewards: { ...NO_ATTRIBUTES, strength: 2 }
  }),
  preset('study-short', 'Estudo focado · 30 min · 25 XP', 'routine', {
    title: 'Estudo focado', category: 'Estudos e idiomas', xp: focusedStudyXp(30),
    attributeRewards: { ...NO_ATTRIBUTES, intellect: 2 }
  }),
  preset('study-medium', 'Estudo focado · 60 min · 30 XP', 'routine', {
    title: 'Estudo focado', category: 'Estudos e idiomas', xp: focusedStudyXp(60),
    attributeRewards: { ...NO_ATTRIBUTES, intellect: 3 }
  }),
  preset('study-long', 'Estudo focado · 90 min difícil · 40 XP', 'routine', {
    title: 'Estudo focado', category: 'Estudos e idiomas', xp: focusedStudyXp(90, 'hard'),
    attributeRewards: { ...NO_ATTRIBUTES, intellect: 4 }
  }),
  preset('organization', 'Organização diária · 10 XP', 'routine', {
    title: 'Organização diária', category: 'Disciplina e organização', xp: 10,
    attributeRewards: { ...NO_ATTRIBUTES, discipline: 1 }
  })
]);

export function getRewardPreset(id) {
  return REWARD_PRESETS.find((item) => item.id === id) ?? null;
}

/**
 * Sugere XP para Special/Epic Quests a partir de esforço, importância, preparação e raridade (1 a 5).
 * A raridade pesa 20%, portanto nunca é o único fator.
 */
export function suggestEventXp(kind, { effort, importance, preparation, rarity }) {
  const range = kind === 'epic' ? EPIC_XP_RANGE : kind === 'special' ? SPECIAL_XP_RANGE : null;
  if (!range) throw new TypeError('Apenas Special e Epic Quests possuem sugestão de XP.');
  const factors = { effort, importance, preparation, rarity };
  for (const value of Object.values(factors)) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new RangeError('Cada fator deve ser um inteiro entre 1 e 5.');
    }
  }
  const score = effort * 0.3 + importance * 0.3 + preparation * 0.2 + rarity * 0.2;
  const xp = range.min + Math.round(((score - 1) / 4) * (range.max - range.min) / 5) * 5;
  validateReward(xp, NO_ATTRIBUTES);
  return Math.min(range.max, Math.max(range.min, xp));
}
