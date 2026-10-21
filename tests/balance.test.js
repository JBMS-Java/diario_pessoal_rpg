import test from 'node:test';
import assert from 'node:assert/strict';
import { attributePointsFor, rewardFor, xpFor } from '../js/modules/balance.js';

const done = (item) => ({ ...item, status: 'completed' });

test('XP fixo por tipo e rotina', () => {
  assert.equal(xpFor({ kind: 'routine', type: 'training' }), 5);
  assert.equal(xpFor({ kind: 'special', type: 'side' }), 15);
  assert.equal(xpFor({ kind: 'special', type: 'main' }), 100);
  assert.equal(xpFor({ kind: 'special', type: 'weekly' }), 10);
  assert.equal(xpFor({ kind: 'special', type: 'training' }), 7);
  assert.equal(xpFor({ kind: 'epic' }), 150);
  assert.throws(() => xpFor({ kind: 'special', type: 'x' }), RangeError);
});

test('rotina dá +1 Disciplina somente na 5ª, 10ª... conclusão', () => {
  const routine = { kind: 'routine', category: 'Estudos e idiomas', type: 'daily' };
  const history = [];
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    points.push(rewardFor(routine, history).attributeRewards.discipline);
    history.push(done(routine));
  }
  assert.deepEqual(points, [0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('missões não rotineiras seguem a categoria, com contador próprio', () => {
  const study = { kind: 'special', type: 'side', category: 'Estudos e idiomas' };
  const training = { kind: 'special', type: 'training', category: 'Desenvolvimento pessoal' };
  const martial = { kind: 'special', type: 'side', category: 'Artes marciais' };
  const history = Array.from({ length: 4 }, () => done(study));
  assert.equal(attributePointsFor(study, 4).intellect, 1);
  assert.equal(rewardFor(study, history).attributeRewards.intellect, 1);
  assert.equal(rewardFor(training, history).attributeRewards.strength, 0);
  assert.equal(attributePointsFor(training, 4).strength, 1);
  assert.equal(attributePointsFor(martial, 4).technique, 1);
  assert.equal(attributePointsFor({ kind: 'special', type: 'side', category: 'Outra' }, 4).intellect, 0);
});

test('conclusões não concluídas não contam para o contador', () => {
  const routine = { kind: 'routine', type: 'daily', category: 'X' };
  const history = [...Array.from({ length: 4 }, () => ({ ...routine, status: 'skipped' }))];
  assert.equal(rewardFor(routine, history).attributeRewards.discipline, 0);
});
