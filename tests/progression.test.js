import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevelProgress, validateReward, xpForLevel } from '../js/modules/experience.js';
import { applyXpGain, totalXpForLevel } from '../js/modules/progression.js';
import {
  EPIC_XP_RANGE,
  focusedStudyXp,
  getRewardPreset,
  REWARD_PRESETS,
  SPECIAL_XP_RANGE,
  suggestEventXp
} from '../js/modules/rewards.js';
import { createInitialAttributes } from '../js/modules/attributes.js';
import { evaluateNextRank } from '../js/modules/ranks.js';

test('XP por nível segue ceil(100 × nível^1,5) nos níveis de referência', () => {
  // O exemplo "1.118" do enunciado diverge da fórmula: 100 × 5^1,5 = 1118,03 → 1119.
  const expected = { 1: 100, 2: 283, 3: 520, 5: 1119, 10: 3163, 20: 8945 };
  for (const [level, xp] of Object.entries(expected)) assert.equal(xpForLevel(Number(level)), xp);
  assert.equal(xpForLevel(4), 800);
  assert.equal(xpForLevel(9), 2700);
  assert.throws(() => xpForLevel(0), /inteiro positivo/);
});

test('multiplicador e expoente são ajustáveis sem alterar o padrão', () => {
  assert.equal(xpForLevel(4, { multiplier: 50, exponent: 2 }), 800);
  assert.equal(xpForLevel(4), 800);
  assert.throws(() => xpForLevel(2, { multiplier: 0, exponent: 1.5 }), /inválida/);
  assert.equal(getLevelProgress(1000, { multiplier: 50, exponent: 2 }).level, 4);
  assert.equal(getLevelProgress(1000).level, 4);
  assert.equal(getLevelProgress(1499, { multiplier: 50, exponent: 2 }).level, 4);
  assert.equal(getLevelProgress(1500, { multiplier: 50, exponent: 2 }).level, 5);
});

test('XP total fica separado do XP dentro do nível', () => {
  assert.deepEqual(getLevelProgress(0), { level: 1, totalXp: 0, xpInLevel: 0, xpToNextLevel: 100, progress: 0 });
  assert.deepEqual(getLevelProgress(99), { level: 1, totalXp: 99, xpInLevel: 99, xpToNextLevel: 100, progress: 99 });
  assert.deepEqual(getLevelProgress(100), { level: 2, totalXp: 100, xpInLevel: 0, xpToNextLevel: 283, progress: 0 });
  assert.equal(getLevelProgress(100 + 283 - 1).level, 2);
  assert.equal(getLevelProgress(100 + 283).level, 3);
  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(4), 100 + 283 + 520);
});

test('limites de nível coincidem com o XP acumulado nos níveis 1, 2, 3, 5, 10 e 20', () => {
  for (const level of [1, 2, 3, 5, 10, 20]) {
    const threshold = totalXpForLevel(level);
    assert.equal(getLevelProgress(threshold).level, level);
    assert.equal(getLevelProgress(threshold).xpInLevel, 0);
    if (threshold > 0) assert.equal(getLevelProgress(threshold - 1).level, level - 1);
    assert.equal(getLevelProgress(threshold + xpForLevel(level) - 1).level, level);
    assert.equal(getLevelProgress(threshold + xpForLevel(level)).level, level + 1);
  }
});

test('ganhos menores, iguais e maiores que o requisito do nível', () => {
  const start = totalXpForLevel(3) + 100;
  const smaller = applyXpGain(start, xpForLevel(3) - 101);
  assert.equal(smaller.levelsGained, 0);
  assert.equal(smaller.after.xpInLevel, xpForLevel(3) - 1);

  const equal = applyXpGain(totalXpForLevel(3), xpForLevel(3));
  assert.deepEqual(equal.reachedLevels, [4]);
  assert.equal(equal.after.xpInLevel, 0);

  const larger = applyXpGain(totalXpForLevel(3), xpForLevel(3) + xpForLevel(4) + 7);
  assert.deepEqual(larger.reachedLevels, [4, 5]);
  assert.equal(larger.after.level, 5);
  assert.equal(larger.after.xpInLevel, 7);
  assert.equal(larger.after.progress, Math.floor((7 / xpForLevel(5)) * 100));
  assert.throws(() => applyXpGain(0, -1), /não negativo/);
});

test('ganhos sucessivos equivalem a um único ganho e nunca reduzem o XP', () => {
  const total = 12345;
  const steps = [3000, 4000, 5345];
  let accumulated = 0;
  for (const step of steps) {
    const result = applyXpGain(accumulated, step);
    assert.ok(result.after.totalXp > result.before.totalXp);
    accumulated = result.after.totalXp;
  }
  assert.equal(accumulated, total);
  assert.deepEqual(getLevelProgress(accumulated), applyXpGain(0, total).after);
  // Trocar a configuração apenas reinterpreta o mesmo XP total, sem alterá-lo.
  const alternate = getLevelProgress(total, { multiplier: 80, exponent: 1.4 });
  assert.equal(alternate.totalXp, total);
});

test('recompensas padrão das rotinas e faixas de eventos e épicos', () => {
  const xp = (id) => getRewardPreset(id).xp;
  assert.equal(xp('work'), 12);
  assert.equal(xp('spanish'), 35);
  assert.equal(xp('gym'), 18);
  assert.equal(xp('organization'), 10);
  for (const id of ['study-short', 'study-medium', 'study-long']) {
    assert.ok(xp(id) >= 25 && xp(id) <= 40);
  }
  assert.equal(focusedStudyXp(30), 25);
  assert.equal(focusedStudyXp(90, 'hard'), 40);
  assert.throws(() => focusedStudyXp(0), /positiva/);
  for (const item of REWARD_PRESETS) assert.doesNotThrow(() => validateReward(item.xp, item.attributeRewards));
  assert.deepEqual([SPECIAL_XP_RANGE.min, SPECIAL_XP_RANGE.max], [60, 100]);
  assert.deepEqual([EPIC_XP_RANGE.min, EPIC_XP_RANGE.max], [150, 300]);
});

test('sugestão de XP de eventos considera vários fatores e respeita as faixas', () => {
  const low = { effort: 1, importance: 1, preparation: 1, rarity: 1 };
  const high = { effort: 5, importance: 5, preparation: 5, rarity: 5 };
  assert.equal(suggestEventXp('special', low), 60);
  assert.equal(suggestEventXp('special', high), 100);
  assert.equal(suggestEventXp('epic', low), 150);
  assert.equal(suggestEventXp('epic', high), 300);
  // Raridade máxima sozinha não leva o evento ao teto.
  assert.ok(suggestEventXp('special', { ...low, rarity: 5 }) < 80);
  assert.throws(() => suggestEventXp('special', { ...low, effort: 6 }), /entre 1 e 5/);
  assert.throws(() => suggestEventXp('routine', low), /Special e Epic/);
});

test('apenas rotinas não destravam graus altos rapidamente', () => {
  // Semana cheia: trabalho 5×12, espanhol 2×35, academia 4×18, estudo 5×30, organização 7×10 + bônus 25.
  const weeklyRoutineXp = 5 * 12 + 2 * 35 + 4 * 18 + 5 * 30 + 7 * 10 + 25;
  const afterOneYear = getLevelProgress(weeklyRoutineXp * 52).level;
  assert.ok(afterOneYear >= 5, 'a rotina deve gerar progresso consistente');
  assert.ok(afterOneYear < 15, 'a rotina sozinha não deve alcançar o requisito do Grau 2 em um ano');
});

test('promoção não altera XP, nível ou atributos acumulados', () => {
  const profile = { totalXp: totalXpForLevel(5) + 10, attributes: { intellect: 5, strength: 5, technique: 5, endurance: 0, discipline: 0 } };
  const snapshot = structuredClone(profile);
  const evaluation = evaluateNextRank(0, getLevelProgress(profile.totalXp).level, profile.attributes, []);
  assert.equal(evaluation.eligible, true);
  assert.deepEqual(profile, snapshot);
});

test('progressão calcula o primeiro nível e a curva seguinte', () => {
  assert.equal(getLevelProgress(100).level, 2);
  assert.equal(xpForLevel(2), 283);
});

test('progressão identifica corretamente múltiplos níveis alcançados', () => {
  assert.equal(getLevelProgress(100 + 283 + 520).level, 4);
});

test('recompensas validam limites de XP e atributos', () => {
  assert.doesNotThrow(() => validateReward(100, { intellect: 5, strength: 5 }));
  assert.throws(() => validateReward(501, {}), /500 XP/);
  assert.throws(() => validateReward(10, { intellect: 11 }), /0 e 10/);
  assert.throws(() => validateReward(10, { intellect: 10, strength: 6 }), /15 pontos/);
});

test('atributos iniciais são zerados', () => {
  assert.deepEqual(createInitialAttributes(), {
    intellect: 0,
    strength: 0,
    technique: 0,
    endurance: 0,
    discipline: 0
  });
});

test('promoção depende do nível, atributos e avaliação de missão especial', () => {
  const attributes = { intellect: 5, strength: 5, technique: 5, endurance: 0, discipline: 0 };
  const pending = evaluateNextRank(0, 5, attributes, []);
  assert.equal(pending.eligible, true);
  assert.equal(evaluateNextRank(1, 15, attributes, []).eligible, false);
  assert.equal(evaluateNextRank(3, 40, {
    intellect: 30, strength: 30, technique: 30, endurance: 30, discipline: 0
  }, []).eligible, false);
  assert.equal(evaluateNextRank(3, 40, {
    intellect: 30, strength: 30, technique: 30, endurance: 30, discipline: 0
  }, [{ elite: true, status: 'completed' }]).eligible, true);
});

test('Grau Especial exige uma campanha especial concluída', () => {
  const attributes = { intellect: 40, strength: 40, technique: 40, endurance: 40, discipline: 40 };
  assert.equal(evaluateNextRank(4, 60, attributes, []).eligible, false);
  assert.equal(evaluateNextRank(4, 60, attributes, [
    { specialCampaign: true, status: 'pending' }
  ]).eligible, false);
  assert.equal(evaluateNextRank(4, 60, attributes, [
    { specialCampaign: true, status: 'completed' }
  ]).eligible, true);
});
