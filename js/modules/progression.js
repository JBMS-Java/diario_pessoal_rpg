/**
 * Curva de progressão: único ponto de ajuste da fórmula de níveis.
 * O nível é sempre derivado do XP total acumulado; alterar a configuração
 * nunca modifica XP, eventos ou o histórico já gravados.
 */
export const PROGRESSION_CONFIG = Object.freeze({
  multiplier: 100,
  exponent: 1.5
});

function assertConfig(config) {
  if (!Number.isFinite(config?.multiplier) || config.multiplier <= 0 ||
    !Number.isFinite(config?.exponent) || config.exponent <= 0) {
    throw new RangeError('A configuração de progressão é inválida.');
  }
}

/** XP necessário para passar de `level` para `level + 1`: ceil(multiplicador × nível^expoente). */
export function xpForLevel(level, config = PROGRESSION_CONFIG) {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError('O nível deve ser um inteiro positivo.');
  }
  assertConfig(config);
  // O arredondamento a 9 casas evita que ruído de ponto flutuante empurre o ceil para cima.
  const raw = config.multiplier * Math.pow(level, config.exponent);
  return Math.ceil(Number(raw.toFixed(9)));
}

/** XP total acumulado necessário para ALCANÇAR `level` (nível 1 = 0). */
export function totalXpForLevel(level, config = PROGRESSION_CONFIG) {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError('O nível deve ser um inteiro positivo.');
  }
  let total = 0;
  for (let current = 1; current < level; current += 1) total += xpForLevel(current, config);
  return total;
}

/** Separa o XP total (acumulado) do XP dentro do nível atual. */
export function getLevelProgress(totalXp, config = PROGRESSION_CONFIG) {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) {
    throw new RangeError('O XP total deve ser um inteiro não negativo.');
  }
  let level = 1;
  let remainingXp = totalXp;
  while (remainingXp >= xpForLevel(level, config)) {
    remainingXp -= xpForLevel(level, config);
    level += 1;
  }
  const xpToNextLevel = xpForLevel(level, config);
  return {
    level,
    totalXp,
    xpInLevel: remainingXp,
    xpToNextLevel,
    progress: Math.floor((remainingXp / xpToNextLevel) * 100)
  };
}

/** Aplica um ganho de XP e informa todos os níveis cruzados, inclusive múltiplos. */
export function applyXpGain(totalXp, gain, config = PROGRESSION_CONFIG) {
  if (!Number.isSafeInteger(gain) || gain < 0) {
    throw new RangeError('O ganho de XP deve ser um inteiro não negativo.');
  }
  const before = getLevelProgress(totalXp, config);
  const after = getLevelProgress(totalXp + gain, config);
  const levelsGained = after.level - before.level;
  return {
    before,
    after,
    levelsGained,
    reachedLevels: Array.from({ length: levelsGained }, (_, index) => before.level + index + 1)
  };
}
