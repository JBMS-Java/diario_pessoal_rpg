import { validateReward } from './experience.js';

export const OCCURRENCE_STATUSES = Object.freeze(['pending', 'completed', 'skipped', 'absent', 'cancelled']);
export const WEEKLY_BONUS_XP = 10;
export const WEEKLY_BONUS_CAP = 25;

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw new TypeError('Informe uma data válida.');
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (localDateKey(date) !== dateString) throw new TypeError('Informe uma data válida.');
  return date;
}

export function normalizeActivityKey(title, category, date) {
  const normalizedTitle = String(title).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  const normalizedCategory = String(category).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  if (!normalizedTitle || !normalizedCategory) throw new TypeError('Missão e categoria são obrigatórias.');
  return `${date}|${normalizedCategory}|${normalizedTitle}`;
}

export function validateRoutine(routine) {
  if (!routine || routine.kind !== 'routine') throw new TypeError('A definição da rotina é inválida.');
  if (typeof routine.title !== 'string' || !routine.title.trim()) throw new TypeError('Informe o nome da missão recorrente.');
  if (typeof routine.category !== 'string' || !routine.category.trim()) throw new TypeError('Informe a categoria da missão recorrente.');
  if (!Array.isArray(routine.daysOfWeek) || routine.daysOfWeek.length < 1 ||
    routine.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(routine.daysOfWeek).size !== routine.daysOfWeek.length) {
    throw new TypeError('Selecione pelo menos um dia da semana válido.');
  }
  parseDate(routine.startDate);
  if (routine.endDate) {
    parseDate(routine.endDate);
    if (routine.endDate < routine.startDate) throw new RangeError('A data final deve ser igual ou posterior à data inicial.');
  }
  if (routine.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(routine.time)) throw new TypeError('Informe um horário válido.');
  validateReward(routine.xp, routine.attributeRewards);
}

export function validateSpecialQuest(quest) {
  if (!quest || quest.kind !== 'special') throw new TypeError('A missão especial é inválida.');
  if (typeof quest.title !== 'string' || !quest.title.trim()) throw new TypeError('Informe o nome da missão especial.');
  if (typeof quest.category !== 'string' || !quest.category.trim()) throw new TypeError('Informe a categoria da missão especial.');
  parseDate(quest.date);
  validateReward(quest.xp, quest.attributeRewards);
}

export function buildOccurrence(definition, date) {
  validateRoutine(definition);
  const scheduledDate = parseDate(date);
  if (date < definition.startDate || (definition.endDate && date > definition.endDate)) return null;
  if (!definition.daysOfWeek.includes(scheduledDate.getDay())) return null;
  return {
    id: `${definition.id}@${date}`,
    definitionId: definition.id,
    kind: 'routine',
    title: definition.title.trim(),
    description: definition.description ?? '',
    category: definition.category,
    type: definition.type ?? 'daily',
    difficulty: definition.difficulty,
    xp: definition.xp,
    attributeRewards: { ...definition.attributeRewards },
    date,
    time: definition.time ?? '',
    status: 'pending',
    elite: Boolean(definition.elite),
    specialCampaign: Boolean(definition.specialCampaign),
    activityKey: normalizeActivityKey(definition.title, definition.category, date),
    createdAt: new Date().toISOString()
  };
}

export function buildSpecialOccurrence(definition) {
  validateSpecialQuest(definition);
  return {
    id: crypto.randomUUID(),
    definitionId: definition.id,
    kind: 'special',
    title: definition.title.trim(),
    description: definition.description ?? '',
    category: definition.category,
    type: definition.type ?? 'side',
    difficulty: definition.difficulty,
    xp: definition.xp,
    attributeRewards: { ...definition.attributeRewards },
    date: definition.date,
    time: definition.time ?? '',
    status: 'pending',
    elite: Boolean(definition.elite),
    specialCampaign: Boolean(definition.specialCampaign),
    activityKey: normalizeActivityKey(definition.title, definition.category, definition.date),
    createdAt: new Date().toISOString()
  };
}

export function buildScheduledOccurrences(routine, startDate, endDate) {
  validateRoutine(routine);
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start) throw new RangeError('O intervalo final deve ser posterior ao início.');
  const occurrences = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = localDateKey(cursor);
    const occurrence = buildOccurrence(routine, date);
    if (occurrence) occurrences.push(occurrence);
  }
  return occurrences;
}

export function weekStart(dateString) {
  const date = parseDate(dateString);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
}

export function weekDates(dateString) {
  const start = parseDate(weekStart(dateString));
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    return localDateKey(day);
  });
}

export function shouldAwardWeeklyBonus(routine, occurrences, week, alreadyAwarded, weeklyTotal, completingId, completedDate = localDateKey()) {
  if (!routine.weeklyBonus || alreadyAwarded || weeklyTotal >= WEEKLY_BONUS_CAP) return false;
  const days = new Set(weekDates(week));
  if (!days.has(completedDate)) return false;
  const scheduled = occurrences.filter((occurrence) =>
    occurrence.definitionId === routine.id &&
    days.has(occurrence.date) &&
    occurrence.status !== 'cancelled'
  );
  return scheduled.length > 0 && scheduled.every((occurrence) =>
    occurrence.id === completingId ||
    (occurrence.status === 'completed' && occurrence.completedAt && days.has(localDateKey(new Date(occurrence.completedAt))))
  );
}
