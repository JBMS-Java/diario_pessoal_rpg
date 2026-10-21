/**
 * Regras de recompensa do app. Todo XP e todo ponto de atributo saem daqui:
 * o formulário não escolhe valores e o armazenamento aplica estas regras na conclusão.
 */

export const ROUTINE_XP = 5;

/** XP fixo por tipo de missão (não rotineira). */
export const TYPE_XP = Object.freeze({
  daily: ROUTINE_XP,
  side: 15,
  main: 100,
  weekly: 10,
  epic: 150,
  training: 7
});

/** Um ponto de atributo a cada N conclusões do mesmo grupo. */
export const POINTS_EVERY = 5;

export function xpFor({ kind, type }) {
  if (kind === 'routine') return ROUTINE_XP;
  if (kind === 'epic') return TYPE_XP.epic;
  const xp = TYPE_XP[type ?? 'side'];
  if (!xp) throw new RangeError('Tipo de missão inválido.');
  return xp;
}

/**
 * Define qual atributo uma missão desenvolve e em qual contador ela conta.
 * Rotinas sempre contam para Disciplina; as demais seguem a categoria (ou o tipo Training → Força).
 */
export function attributeSourceFor({ kind, type, category }) {
  if (kind === 'epic') return null;
  if (kind === 'routine') return { group: 'routine', attribute: 'discipline' };
  let attribute = null;
  if (category === 'Artes marciais') attribute = 'technique';
  else if (category === 'Resistência física e cardio') attribute = 'endurance';
  else if (type === 'training' || category === 'Força e musculação') attribute = 'strength';
  else if (category === 'Estudos e idiomas' || category === 'Programação e tecnologia') attribute = 'intellect';
  else if (category === 'Disciplina e organização') attribute = 'discipline';
  return attribute ? { group: attribute, attribute } : null;
}

/**
 * Pontos de atributo da conclusão atual: +1 a cada 5ª conclusão do grupo.
 * `completedBefore` conta as conclusões anteriores do mesmo grupo.
 */
export function attributePointsFor(item, completedBefore) {
  const rewards = { intellect: 0, strength: 0, technique: 0, endurance: 0, discipline: 0 };
  const source = attributeSourceFor(item);
  if (source && (completedBefore + 1) % POINTS_EVERY === 0) rewards[source.attribute] = 1;
  return rewards;
}

export function countCompletedInGroup(occurrences, group) {
  return occurrences.filter((occurrence) =>
    occurrence.status === 'completed' && attributeSourceFor(occurrence)?.group === group
  ).length;
}

/** Recompensa efetiva de uma ocorrência pendente, dado o histórico de conclusões. */
export function rewardFor(item, occurrences) {
  const source = attributeSourceFor(item);
  const completedBefore = source ? countCompletedInGroup(occurrences, source.group) : 0;
  return { xp: xpFor(item), attributeRewards: attributePointsFor(item, completedBefore) };
}
