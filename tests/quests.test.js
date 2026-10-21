import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduledOccurrences,
  localDateKey,
  normalizeActivityKey,
  shouldAwardWeeklyBonus,
  weekDates,
  weekStart
} from '../js/modules/quests.js';
import { getEpicProgress, updateEpicSubtask, validateEpic } from '../js/modules/epics.js';

const zeroRewards = { intellect: 0, strength: 0, technique: 0, endurance: 0, discipline: 0 };

function routine(overrides = {}) {
  return {
    id: 'routine-1',
    kind: 'routine',
    title: 'Treino',
    category: 'Força e musculação',
    difficulty: 'normal',
    xp: 25,
    attributeRewards: zeroRewards,
    daysOfWeek: [1, 3, 5],
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    time: '07:30',
    weeklyBonus: false,
    ...overrides
  };
}

test('rotina gera uma ocorrência estável para cada dia configurado no intervalo', () => {
  const occurrences = buildScheduledOccurrences(routine(), '2026-10-19', '2026-10-25');
  assert.deepEqual(occurrences.map(({ date }) => date), ['2026-10-19', '2026-10-21', '2026-10-23']);
  assert.equal(occurrences[0].id, 'routine-1@2026-10-19');
  assert.equal(occurrences[0].time, '07:30');
  assert.equal(occurrences[0].status, 'pending');
});

test('rotina respeita datas inicial e final e rejeita programações inválidas', () => {
  assert.deepEqual(buildScheduledOccurrences(routine(), '2026-10-26', '2026-10-31'), []);
  assert.throws(() => buildScheduledOccurrences(routine({ daysOfWeek: [] }), '2026-10-19', '2026-10-25'), /dia da semana/);
  assert.throws(() => buildScheduledOccurrences(routine({ endDate: '2026-10-18' }), '2026-10-19', '2026-10-25'), /posterior/);
});

test('chave normalizada identifica atividade repetida por data e categoria', () => {
  assert.equal(
    normalizeActivityKey('  Treino  de   força ', 'Força e musculação', '2026-10-20'),
    normalizeActivityKey('treino de FORCA', 'forca e musculacao', '2026-10-20')
  );
  assert.notEqual(
    normalizeActivityKey('Treino de força', 'Força e musculação', '2026-10-20'),
    normalizeActivityKey('Treino de força', 'Força e musculação', '2026-10-21')
  );
});

test('bônus semanal exige todas as ocorrências e só pode ser pago uma vez dentro do limite', () => {
  const definition = routine({ weeklyBonus: true });
  const week = '2026-10-19';
  const days = weekDates(week);
  const occurrences = buildScheduledOccurrences(definition, days[0], days[6]);
  const beforeLast = occurrences.map((occurrence, index) => ({
    ...occurrence,
    status: index === occurrences.length - 1 ? 'pending' : 'completed',
    completedAt: index === occurrences.length - 1 ? undefined : `${occurrence.date}T12:00:00.000Z`
  }));
  assert.equal(shouldAwardWeeklyBonus(definition, beforeLast, week, false, 0, beforeLast.at(-1).id, week), true);
  assert.equal(shouldAwardWeeklyBonus(definition, beforeLast, week, true, 0, beforeLast.at(-1).id, week), false);
  assert.equal(shouldAwardWeeklyBonus(definition, beforeLast, week, false, 25, beforeLast.at(-1).id, week), false);
  assert.equal(shouldAwardWeeklyBonus(definition, beforeLast.map((item) => ({ ...item, status: 'absent' })), week, false, 0, beforeLast[0].id, week), false);
  assert.equal(shouldAwardWeeklyBonus(definition, beforeLast, week, false, 0, beforeLast.at(-1).id, '2026-10-26'), false);
});

test('visão semanal começa na segunda-feira e contém sete datas locais', () => {
  assert.equal(weekStart('2026-10-20'), '2026-10-19');
  assert.equal(weekDates('2026-10-20').length, 7);
  assert.equal(localDateKey(new Date(2026, 9, 20)), '2026-10-20');
});

test('etapas épicas atualizam progresso sem liberar recompensa antes de todas serem concluídas', () => {
  const epic = {
    id: 'epic-1',
    kind: 'epic',
    title: 'Projeto',
    category: 'Programação e tecnologia',
    xp: 100,
    attributeRewards: zeroRewards,
    subtasks: [
      { id: 'one', title: 'Planejar', completed: false },
      { id: 'two', title: 'Executar', completed: false }
    ],
    status: 'pending'
  };
  const first = updateEpicSubtask(epic, 'one', true);
  assert.equal(getEpicProgress(first).percentage, 50);
  assert.equal(getEpicProgress(first).readyToClaim, false);
  const finished = updateEpicSubtask(first, 'two', true);
  assert.equal(getEpicProgress(finished).readyToClaim, true);
  assert.equal(epic.subtasks.every(({ completed }) => !completed), true);
  assert.doesNotThrow(() => validateEpic(finished));
  assert.throws(() => validateEpic({ ...epic, subtasks: [] }), /pelo menos uma etapa/);
});
