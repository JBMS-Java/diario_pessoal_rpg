export const XP_REWARDS = Object.freeze({
  easy: 10,
  normal: 25,
  hard: 50,
  epic: 100
});

// A curva de níveis vive em progression.js; reexportada para manter os imports existentes.
export { getLevelProgress, xpForLevel } from './progression.js';

export function validateReward(xp, attributes) {
  if (!Number.isInteger(xp) || xp < 1 || xp > 500) {
    throw new RangeError('A recompensa deve estar entre 1 e 500 XP.');
  }
  if (!attributes || typeof attributes !== 'object') {
    throw new TypeError('As recompensas de atributo são inválidas.');
  }

  const values = Object.values(attributes);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10)) {
    throw new RangeError('Cada atributo deve receber entre 0 e 10 pontos.');
  }
  if (values.reduce((sum, value) => sum + value, 0) > 15) {
    throw new RangeError('Uma missão pode conceder no máximo 15 pontos de atributo.');
  }
}
