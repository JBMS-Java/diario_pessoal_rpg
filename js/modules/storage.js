import { createInitialAttributes, validateAttributes } from './attributes.js';
import { rewardFor, xpFor } from './balance.js';
import { getLevelProgress, validateReward } from './experience.js';
import { buildScheduledOccurrences, buildSpecialOccurrence, localDateKey, normalizeActivityKey, shouldAwardWeeklyBonus, validateRoutine, validateSpecialQuest, weekStart, weekDates, WEEKLY_BONUS_CAP, WEEKLY_BONUS_XP } from './quests.js';
import { evaluateNextRank, RANKS } from './ranks.js';
import { getEpicProgress, updateEpicSubtask, validateEpic } from './epics.js';

const DATABASE_NAME = 'cursed-system';
const DATABASE_VERSION = 3;

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao acessar o banco local.'));
  });
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('Este navegador não oferece suporte ao armazenamento local IndexedDB.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains('profile')) {
        database.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('quests')) {
        const quests = database.createObjectStore('quests', { keyPath: 'id' });
        quests.createIndex('status', 'status', { unique: false });
      }
      if (!database.objectStoreNames.contains('events')) {
        const events = database.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!database.objectStoreNames.contains('attributeHistory')) {
        const history = database.createObjectStore('attributeHistory', { keyPath: 'id' });
        history.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!database.objectStoreNames.contains('questDefinitions')) {
        const definitions = database.createObjectStore('questDefinitions', { keyPath: 'id' });
        definitions.createIndex('kind', 'kind', { unique: false });
      }
      if (!database.objectStoreNames.contains('occurrences')) {
        const occurrences = database.createObjectStore('occurrences', { keyPath: 'id' });
        occurrences.createIndex('date', 'date', { unique: false });
        occurrences.createIndex('definitionId', 'definitionId', { unique: false });
        occurrences.createIndex('activityKey', 'activityKey', { unique: false });
      }
      if (!database.objectStoreNames.contains('epics')) {
        const epics = database.createObjectStore('epics', { keyPath: 'id' });
        epics.createIndex('status', 'status', { unique: false });
      }
      if (!database.objectStoreNames.contains('xpLedger')) {
        const ledger = database.createObjectStore('xpLedger', { keyPath: 'sourceId' });
        ledger.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (event.oldVersion < 2 && database.objectStoreNames.contains('events')) {
        const migration = request.transaction.objectStore('events').openCursor();
        migration.onsuccess = () => {
          const cursor = migration.result;
          if (!cursor) return;
          const oldEvent = cursor.value;
          if (oldEvent.xp > 0 && oldEvent.questId) {
            request.transaction.objectStore('xpLedger').put({
              sourceId: `legacy:${oldEvent.id}`,
              sourceType: 'legacy',
              sourceIdRef: oldEvent.questId,
              xp: oldEvent.xp,
              attributeRewards: {},
              createdAt: oldEvent.createdAt
            });
          }
          cursor.continue();
        };
      }

      if (event.oldVersion < 3 && database.objectStoreNames.contains('quests')) {
        const questsStore = request.transaction.objectStore('quests');
        const migration = questsStore.openCursor();
        migration.onsuccess = () => {
          const cursor = migration.result;
          if (!cursor) return;
          const quest = cursor.value;
          const occurrenceDate = quest.status === 'completed' && quest.completedAt
            ? localDateKey(new Date(quest.completedAt))
            : quest.status === 'pending'
              ? localDateKey()
              : localDateKey(new Date(quest.createdAt));
          const occurrence = {
            ...quest,
            kind: 'legacy',
            date: occurrenceDate,
            time: '',
            source: undefined,
            activityKey: normalizeActivityKey(quest.title, quest.category || 'Geral', occurrenceDate)
          };
          delete occurrence.migrated;
          request.transaction.objectStore('occurrences').put(occurrence);
          cursor.update({ ...quest, migrated: true });
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Não foi possível abrir o banco local.'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('O banco está aberto em outra aba. Feche as outras abas e tente novamente.'));
    };
  });
  return databasePromise;
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('A operação no banco local foi cancelada.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao gravar no banco local.'));
  });
}

export async function loadDashboard(startDate = localDateKey(), endDate = localDateKey()) {
  const database = await openDatabase();
  await ensureRoutineOccurrences(startDate, endDate);
  const transaction = database.transaction(['profile', 'quests', 'events', 'questDefinitions', 'occurrences', 'epics', 'xpLedger'], 'readonly');
  const completion = transactionComplete(transaction);
  const profileRequest = transaction.objectStore('profile').get('player');
  const questsRequest = transaction.objectStore('quests').getAll();
  const eventsRequest = transaction.objectStore('events').getAll();
  const definitionsRequest = transaction.objectStore('questDefinitions').getAll();
  const occurrencesRequest = transaction.objectStore('occurrences').getAll();
  const epicsRequest = transaction.objectStore('epics').getAll();
  const ledgerRequest = transaction.objectStore('xpLedger').getAll();
  const [storedProfile, legacyQuests, events, definitions, occurrences, epics, ledger] = await Promise.all([
    requestResult(profileRequest),
    requestResult(questsRequest),
    requestResult(eventsRequest),
    requestResult(definitionsRequest),
    requestResult(occurrencesRequest),
    requestResult(epicsRequest),
    requestResult(ledgerRequest),
    completion
  ]).then(([profile, oldQuests, allEvents, allDefinitions, allOccurrences, allEpics, allLedger]) =>
    [profile, oldQuests, allEvents, allDefinitions, allOccurrences, allEpics, allLedger]
  );

  if (storedProfile) {
    validateAttributes(storedProfile.attributes);
    getLevelProgress(storedProfile.totalXp);
    if (!Number.isInteger(storedProfile.rankIndex) || storedProfile.rankIndex < 0 || storedProfile.rankIndex >= RANKS.length) {
      throw new Error('O grau salvo está inválido. Os dados locais não foram alterados.');
    }
  }

  const recurringAndSpecialOccurrences = occurrences.map((occurrence) => ({ ...occurrence, source: 'occurrence' }));
  const legacyInstances = legacyQuests.filter((quest) => !quest.migrated).map((quest) => ({
    ...quest,
    kind: 'legacy',
    date: quest.completedAt ? localDateKey(new Date(quest.completedAt)) : localDateKey(new Date(quest.createdAt)),
    time: '',
    source: 'legacy'
  }));
  const quests = [...recurringAndSpecialOccurrences, ...legacyInstances];
  const allEvents = events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  const selectedDay = quests.filter((quest) => quest.date === startDate);
  return {
    profile: storedProfile ?? {
      id: 'player',
      totalXp: 0,
      rankIndex: 0,
      attributes: createInitialAttributes(),
      activeDays: []
    },
    quests,
    occurrences,
    definitions,
    epics,
    ledger,
    selectedDay,
    events: allEvents
  };
}

export async function ensureRoutineOccurrences(startDate, endDate) {
  const database = await openDatabase();
  const transaction = database.transaction(['questDefinitions', 'occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const definitions = transaction.objectStore('questDefinitions');
  const occurrences = transaction.objectStore('occurrences');
  const conflicts = [];
  let operationError;
  const definitionsRequest = definitions.index('kind').getAll('routine');

  definitionsRequest.onsuccess = () => {
    try {
      for (const definition of definitionsRequest.result) {
        const generated = buildScheduledOccurrences(definition, startDate, endDate);
        for (const occurrence of generated) {
          const existingRequest = occurrences.get(occurrence.id);
          existingRequest.onsuccess = () => {
            const existing = existingRequest.result;
            if (existing) {
              if (existing.status === 'cancelled' && existing.cancelReason === 'schedule-edited' && occurrence.date >= localDateKey()) {
                const duplicateRequest = occurrences.index('activityKey').getAll(occurrence.activityKey);
                duplicateRequest.onsuccess = () => {
                  const duplicate = duplicateRequest.result.find((item) => item.id !== existing.id && item.status !== 'cancelled');
                  if (duplicate) {
                    conflicts.push({ definitionId: occurrence.definitionId, date: occurrence.date, title: occurrence.title, duplicateId: duplicate.id });
                    return;
                  }
                  occurrences.put({ ...occurrence, createdAt: existing.createdAt });
                };
                duplicateRequest.onerror = () => transaction.abort();
              }
              return;
            }
            const activityRequest = occurrences.index('activityKey').getAll(occurrence.activityKey);
            activityRequest.onsuccess = () => {
              const duplicate = activityRequest.result.find((item) => item.status !== 'cancelled');
              if (duplicate) {
                conflicts.push({ definitionId: occurrence.definitionId, date: occurrence.date, title: occurrence.title, duplicateId: duplicate.id });
                return;
              }
              occurrences.add(occurrence);
            };
            activityRequest.onerror = () => transaction.abort();
          };
          existingRequest.onerror = () => transaction.abort();
        }
      }
    } catch (error) {
      operationError = error;
      transaction.abort();
    }
  };
  definitionsRequest.onerror = () => {
    operationError = definitionsRequest.error;
    transaction.abort();
  };

  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
  return conflicts;
}

export async function createRoutine(definition) {
  validateRoutine(definition);
  const database = await openDatabase();
  const transaction = database.transaction(['questDefinitions'], 'readwrite');
  const completion = transactionComplete(transaction);
  transaction.objectStore('questDefinitions').add({ ...definition, active: true, createdAt: new Date().toISOString() });
  await completion;
  const conflicts = await ensureRoutineOccurrences(localDateKey(), addDays(localDateKey(), 90));
  return conflicts.filter(({ definitionId }) => definitionId === definition.id);
}

export async function updateRoutine(definition) {
  validateRoutine(definition);
  const database = await openDatabase();
  const transaction = database.transaction(['questDefinitions', 'occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const definitions = transaction.objectStore('questDefinitions');
  const occurrences = transaction.objectStore('occurrences');
  const conflicts = [];
  let operationError;
  const existingRequest = definitions.get(definition.id);
  existingRequest.onsuccess = () => {
    if (!existingRequest.result || existingRequest.result.kind !== 'routine') {
      operationError = new Error('A rotina não foi encontrada para edição.');
      transaction.abort();
      return;
    }
    definitions.put({ ...definition, active: true, updatedAt: new Date().toISOString() });
    const occurrenceRequest = occurrences.index('definitionId').getAll(definition.id);
    occurrenceRequest.onsuccess = () => {
      for (const occurrence of occurrenceRequest.result) {
        if (occurrence.status !== 'pending' || occurrence.date < localDateKey()) continue;
        let remainsScheduled;
        let updated;
        try {
          const scheduled = buildScheduledOccurrences(definition, occurrence.date, occurrence.date);
          remainsScheduled = scheduled.length > 0;
          updated = scheduled[0];
        } catch (error) {
          operationError = error;
          transaction.abort();
          return;
        }
        if (!remainsScheduled) {
          occurrences.put({ ...occurrence, status: 'cancelled', cancelReason: 'schedule-edited', cancelledAt: new Date().toISOString() });
        } else {
          const duplicateRequest = occurrences.index('activityKey').getAll(updated.activityKey);
          duplicateRequest.onsuccess = () => {
            const duplicate = duplicateRequest.result.find((item) => item.id !== occurrence.id && item.status !== 'cancelled');
            if (duplicate) {
              conflicts.push({ definitionId: definition.id, date: occurrence.date, title: updated.title, duplicateId: duplicate.id });
              occurrences.put({ ...occurrence, status: 'cancelled', cancelReason: 'duplicate', cancelledAt: new Date().toISOString(), duplicateOf: duplicate.id });
              return;
            }
            occurrences.put({ ...updated, createdAt: occurrence.createdAt });
          };
          duplicateRequest.onerror = () => transaction.abort();
        }
      }
    };
    occurrenceRequest.onerror = () => transaction.abort();
  };
  existingRequest.onerror = () => {
    operationError = existingRequest.error;
    transaction.abort();
  };
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
  const generatedConflicts = await ensureRoutineOccurrences(localDateKey(), addDays(localDateKey(), 90));
  return [...conflicts, ...generatedConflicts.filter(({ definitionId: id }) => id === definition.id)];
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export async function createSpecialQuest(definition) {
  validateSpecialQuest(definition);
  const occurrence = buildSpecialOccurrence(definition);
  const database = await openDatabase();
  const transaction = database.transaction(['questDefinitions', 'occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const definitions = transaction.objectStore('questDefinitions');
  const occurrences = transaction.objectStore('occurrences');
  let duplicateFound = false;
  const duplicateRequest = occurrences.index('activityKey').getAll(occurrence.activityKey);
  duplicateRequest.onsuccess = () => {
    const duplicate = duplicateRequest.result.find((item) => item.status !== 'cancelled');
    if (duplicate) {
      duplicateFound = true;
      transaction.abort();
      return;
    }
    definitions.add({ ...definition, active: true, createdAt: new Date().toISOString() });
    occurrences.add(occurrence);
  };
  duplicateRequest.onerror = () => transaction.abort();
  try {
    await completion;
  } catch (error) {
    if (duplicateFound) throw new Error('Já existe uma missão com o mesmo nome e categoria nesta data.');
    throw error;
  }
  return occurrence;
}

export async function updateSpecialQuest(definition, occurrenceId) {
  validateSpecialQuest(definition);
  const database = await openDatabase();
  const transaction = database.transaction(['questDefinitions', 'occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const definitions = transaction.objectStore('questDefinitions');
  const occurrences = transaction.objectStore('occurrences');
  let operationError;
  const occurrenceRequest = occurrences.get(occurrenceId);
  occurrenceRequest.onsuccess = () => {
    const current = occurrenceRequest.result;
    if (!current || current.kind !== 'special' || current.status !== 'pending') {
      operationError = new Error('Apenas uma Special Quest pendente pode ser editada.');
      transaction.abort();
      return;
    }
    const replacement = { ...buildSpecialOccurrence({ ...definition, id: current.definitionId }), id: current.id, createdAt: current.createdAt };
    const duplicateRequest = occurrences.index('activityKey').getAll(replacement.activityKey);
    duplicateRequest.onsuccess = () => {
      const duplicate = duplicateRequest.result.find((item) => item.id !== current.id && item.status !== 'cancelled');
      if (duplicate) {
        operationError = new Error('A edição duplicaria outra missão nesta data.');
        transaction.abort();
        return;
      }
      definitions.put({ ...definition, id: current.definitionId, active: true, updatedAt: new Date().toISOString() });
      occurrences.put(replacement);
    };
    duplicateRequest.onerror = () => transaction.abort();
  };
  occurrenceRequest.onerror = () => {
    operationError = occurrenceRequest.error;
    transaction.abort();
  };
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
}

function addRewardRecords(transaction, profile, reward, sourceId, sourceType, title, eventType = 'quest') {
  validateReward(reward.xp, reward.attributeRewards);
  validateAttributes(profile.attributes);
  const updatedAttributes = { ...profile.attributes };
  for (const [id, points] of Object.entries(reward.attributeRewards)) {
    if (!(id in updatedAttributes)) throw new Error('A recompensa contém um atributo desconhecido.');
    updatedAttributes[id] += points;
  }
  const previousLevel = getLevelProgress(profile.totalXp).level;
  const totalXp = profile.totalXp + reward.xp;
  const nextLevel = getLevelProgress(totalXp).level;
  const createdAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const day = localDateKey(new Date(createdAt));
  const activeDays = [...new Set([...(profile.activeDays ?? []), day])].sort();

  transaction.objectStore('profile').put({ ...profile, totalXp, attributes: updatedAttributes, activeDays });
  transaction.objectStore('events').add({
    id: eventId,
    sourceId,
    type: eventType,
    title,
    xp: reward.xp,
    previousLevel,
    nextLevel,
    createdAt
  });
  transaction.objectStore('xpLedger').add({
    sourceId,
    sourceType,
    title,
    xp: reward.xp,
    attributeRewards: { ...reward.attributeRewards },
    previousTotalXp: profile.totalXp,
    totalXp,
    createdAt
  });
  if (Object.values(reward.attributeRewards).some((points) => points > 0)) {
    transaction.objectStore('attributeHistory').add({
      id: eventId,
      sourceId,
      rewards: { ...reward.attributeRewards },
      attributes: updatedAttributes,
      createdAt
    });
  }
  return { previousLevel, nextLevel, totalXp, updatedAttributes };
}

export async function updateOccurrenceStatus(occurrenceId, status) {
  if (!['skipped', 'absent', 'cancelled'].includes(status)) throw new TypeError('Estado de ocorrência inválido.');
  const database = await openDatabase();
  const transaction = database.transaction(['occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const store = transaction.objectStore('occurrences');
  const request = store.get(occurrenceId);
  let operationError;
  request.onsuccess = () => {
    const occurrence = request.result;
    if (!occurrence || occurrence.status !== 'pending') {
      operationError = new Error('A ocorrência não está mais pendente.');
      transaction.abort();
      return;
    }
    store.put({
      ...occurrence,
      status,
      ...(status === 'cancelled' ? { cancelReason: 'user' } : {}),
      [`${status}At`]: new Date().toISOString()
    });
  };
  request.onerror = () => {
    operationError = request.error;
    transaction.abort();
  };
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
}

export async function completeOccurrence(occurrenceId) {
  const initialDatabase = await openDatabase();
  const initialTransaction = initialDatabase.transaction(['occurrences'], 'readonly');
  const initialCompletion = transactionComplete(initialTransaction);
  const initialOccurrence = await requestResult(initialTransaction.objectStore('occurrences').get(occurrenceId));
  await initialCompletion;
  if (!initialOccurrence) throw new Error('A ocorrência não foi encontrada.');
  if (initialOccurrence.date > localDateKey()) {
    throw new Error('Esta ocorrência só pode ser concluída na data programada ou depois dela.');
  }
  const firstDay = weekStart(initialOccurrence.date);
  const lastDay = weekDates(initialOccurrence.date).at(-1);
  await ensureRoutineOccurrences(firstDay, lastDay);

  const database = await openDatabase();
  const transaction = database.transaction(['profile', 'occurrences', 'questDefinitions', 'epics', 'events', 'attributeHistory', 'xpLedger'], 'readwrite');
  const completion = transactionComplete(transaction);
  const occurrenceStore = transaction.objectStore('occurrences');
  const epicStore = transaction.objectStore('epics');
  const request = occurrenceStore.get(occurrenceId);
  let operationError;
  request.onsuccess = () => {
    const occurrence = request.result;
    if (!occurrence || occurrence.status !== 'pending') {
      operationError = new Error('Esta ocorrência já foi processada.');
      transaction.abort();
      return;
    }
    const ledgerStore = transaction.objectStore('xpLedger');
    const ledgerRequest = ledgerStore.get(occurrence.id);
    ledgerRequest.onsuccess = () => {
      if (ledgerRequest.result) {
        operationError = new Error('Esta ocorrência já recebeu sua recompensa.');
        transaction.abort();
        return;
      }
      const profileRequest = transaction.objectStore('profile').get('player');
      const allOccurrencesRequest = occurrenceStore.getAll();
      const routinesRequest = transaction.objectStore('questDefinitions').index('kind').getAll('routine');
      const ledgerAllRequest = ledgerStore.getAll();
      const epicsRequest = epicStore.getAll();
      let requestsRemaining = 5;
      let profile;
      let allOccurrences;
      let routines;
      let ledgerEntries;
      let epics;
      const applyCompletion = () => {
        requestsRemaining -= 1;
        if (requestsRemaining !== 0) return;
        profile ??= {
          id: 'player',
          totalXp: 0,
          rankIndex: 0,
          attributes: createInitialAttributes(),
          activeDays: []
        };
        try {
          const duplicateEpic = epics.some((epic) =>
            epic.status === 'completed' &&
            epic.completedAt &&
            localDateKey(new Date(epic.completedAt)) === occurrence.date &&
            normalizeActivityKey(epic.title, epic.category, occurrence.date) === occurrence.activityKey
          );
          if (duplicateEpic) throw new Error('Uma Epic Quest já recebeu recompensa por esta atividade nesta data.');
          const earned = rewardFor(occurrence, allOccurrences);
          const baseReward = addRewardRecords(transaction, profile, earned, occurrence.id, occurrence.kind, occurrence.title);
          let nextProfile = { ...profile, totalXp: baseReward.totalXp, attributes: baseReward.updatedAttributes };
          const routine = routines.find(({ id }) => id === occurrence.definitionId);
          if (routine?.weeklyBonus) {
            const week = weekStart(occurrence.date);
            const bonusSourceId = `weekly-bonus:${week}:${routine.id}`;
            const alreadyAwarded = ledgerEntries.some(({ sourceId }) => sourceId === bonusSourceId);
            const weeklyTotal = ledgerEntries
              .filter((entry) => entry.sourceType === 'weekly-bonus' && entry.week === week)
              .reduce((total, entry) => total + entry.xp, 0);
            if (shouldAwardWeeklyBonus(
              routine,
              allOccurrences,
              week,
              alreadyAwarded,
              weeklyTotal,
              occurrence.id,
              localDateKey()
            )) {
              const bonusXp = Math.min(WEEKLY_BONUS_XP, WEEKLY_BONUS_CAP - weeklyTotal);
              if (bonusXp > 0) {
                const bonusReward = addRewardRecords(transaction, nextProfile, {
                  xp: bonusXp,
                  attributeRewards: createInitialAttributes()
                }, bonusSourceId, 'weekly-bonus', `Bônus de consistência semanal · ${routine.title}`, 'weekly-bonus');
                nextProfile = { ...nextProfile, totalXp: bonusReward.totalXp, attributes: bonusReward.updatedAttributes };
                ledgerStore.put({
                  sourceId: bonusSourceId,
                  sourceType: 'weekly-bonus',
                  week,
                  title: routine.title,
                  xp: bonusXp,
                  attributeRewards: createInitialAttributes(),
                  previousTotalXp: baseReward.totalXp,
                  totalXp: bonusReward.totalXp,
                  createdAt: new Date().toISOString()
                });
              }
            }
          }
          occurrenceStore.put({
            ...occurrence,
            status: 'completed',
            completedAt: new Date().toISOString(),
            xp: earned.xp,
            xpAwarded: earned.xp,
            attributeRewards: earned.attributeRewards
          });
        } catch (error) {
          operationError = error;
          transaction.abort();
        }
      };
      profileRequest.onsuccess = () => { profile = profileRequest.result; applyCompletion(); };
      allOccurrencesRequest.onsuccess = () => { allOccurrences = allOccurrencesRequest.result; applyCompletion(); };
      routinesRequest.onsuccess = () => { routines = routinesRequest.result; applyCompletion(); };
      ledgerAllRequest.onsuccess = () => { ledgerEntries = ledgerAllRequest.result; applyCompletion(); };
      epicsRequest.onsuccess = () => { epics = epicsRequest.result; applyCompletion(); };
      for (const failedRequest of [profileRequest, allOccurrencesRequest, routinesRequest, ledgerAllRequest, epicsRequest]) {
        failedRequest.onerror = () => {
          operationError = failedRequest.error;
          transaction.abort();
        };
      }
    };
    ledgerRequest.onerror = () => {
      operationError = ledgerRequest.error;
      transaction.abort();
    };
  };
  request.onerror = () => {
    operationError = request.error;
    transaction.abort();
  };
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
}

export async function createEpic(epic) {
  validateEpic(epic);
  const database = await openDatabase();
  const transaction = database.transaction(['epics'], 'readwrite');
  const completion = transactionComplete(transaction);
  transaction.objectStore('epics').add({ ...epic, status: 'pending', createdAt: new Date().toISOString() });
  await completion;
}

export async function setEpicSubtask(epicId, subtaskId, completed) {
  const database = await openDatabase();
  const transaction = database.transaction(['epics'], 'readwrite');
  const completion = transactionComplete(transaction);
  const store = transaction.objectStore('epics');
  const request = store.get(epicId);
  let operationError;
  request.onsuccess = () => {
    try {
      store.put(updateEpicSubtask(request.result, subtaskId, completed));
    } catch (error) {
      operationError = error;
      transaction.abort();
    }
  };
  request.onerror = () => {
    operationError = request.error;
    transaction.abort();
  };
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
}

export async function completeEpic(epicId) {
  const database = await openDatabase();
  const transaction = database.transaction(['profile', 'epics', 'occurrences', 'events', 'attributeHistory', 'xpLedger'], 'readwrite');
  const completion = transactionComplete(transaction);
  const epicStore = transaction.objectStore('epics');
  const occurrenceStore = transaction.objectStore('occurrences');
  const request = epicStore.get(epicId);
  let operationError;
  request.onsuccess = () => {
    const epic = request.result;
    if (!epic || !getEpicProgress(epic).readyToClaim) {
      operationError = new Error('Conclua todas as etapas antes de reivindicar a recompensa épica.');
      transaction.abort();
      return;
    }
    const completionDate = localDateKey();
    const activityKey = normalizeActivityKey(epic.title, epic.category, completionDate);
    const duplicatesRequest = occurrenceStore.index('activityKey').getAll(activityKey);
    duplicatesRequest.onsuccess = () => {
      const duplicateOccurrence = duplicatesRequest.result.some((occurrence) =>
        ['pending', 'completed'].includes(occurrence.status)
      );
      const completedEpic = epicStore.getAll();
      completedEpic.onsuccess = () => {
        const duplicateEpic = completedEpic.result.some((other) =>
          other.id !== epic.id &&
          other.status === 'completed' &&
          other.completedAt &&
          localDateKey(new Date(other.completedAt)) === completionDate &&
          normalizeActivityKey(other.title, other.category, completionDate) === activityKey
        );
        if (duplicateOccurrence || duplicateEpic) {
          operationError = new Error('Já existe uma recompensa por esta atividade nesta data.');
          transaction.abort();
          return;
        }
        const ledgerRequest = transaction.objectStore('xpLedger').get(`epic:${epic.id}`);
        ledgerRequest.onsuccess = () => {
          if (ledgerRequest.result) {
            operationError = new Error('A recompensa desta missão épica já foi concedida.');
            transaction.abort();
            return;
          }
          const profileRequest = transaction.objectStore('profile').get('player');
          profileRequest.onsuccess = () => {
            const profile = profileRequest.result ?? {
              id: 'player',
              totalXp: 0,
              rankIndex: 0,
              attributes: createInitialAttributes(),
              activeDays: []
            };
            try {
              const epicXp = xpFor({ kind: 'epic' });
              addRewardRecords(transaction, profile, { xp: epicXp, attributeRewards: createInitialAttributes() }, `epic:${epic.id}`, 'epic', epic.title, 'epic');
              epicStore.put({ ...epic, status: 'completed', completedAt: new Date().toISOString(), xp: epicXp, xpAwarded: epicXp });
            } catch (error) {
              operationError = error;
              transaction.abort();
            }
          };
          profileRequest.onerror = () => transaction.abort();
        };
        ledgerRequest.onerror = () => transaction.abort();
      };
      completedEpic.onerror = () => transaction.abort();
    };
    duplicatesRequest.onerror = () => transaction.abort();
  };
  request.onerror = () => transaction.abort();
  try {
    await completion;
  } catch (error) {
    throw operationError ?? error;
  }
}

export async function createQuest(quest) {
  const database = await openDatabase();
  const transaction = database.transaction(['quests'], 'readwrite');
  const completion = transactionComplete(transaction);
  transaction.objectStore('quests').add(quest);
  await completion;
}

export async function completeQuest(questId) {
  const database = await openDatabase();
  const transaction = database.transaction(['profile', 'quests', 'events', 'attributeHistory', 'xpLedger'], 'readwrite');
  const completion = transactionComplete(transaction);
  const quests = transaction.objectStore('quests');
  let completionError;

  const questRequest = quests.get(questId);
  questRequest.onsuccess = () => {
    const quest = questRequest.result;
    if (!quest || quest.status !== 'pending') {
      completionError = new Error('Esta missão já foi concluída ou não está mais disponível.');
      transaction.abort();
      return;
    }

    const ledgerRequest = transaction.objectStore('xpLedger').get(quest.id);
    ledgerRequest.onsuccess = () => {
      if (ledgerRequest.result) {
        completionError = new Error('Esta missão já recebeu sua recompensa.');
        transaction.abort();
        return;
      }
      const profileRequest = transaction.objectStore('profile').get('player');
      profileRequest.onsuccess = () => {
        const profile = profileRequest.result ?? {
          id: 'player',
          totalXp: 0,
          rankIndex: 0,
          attributes: createInitialAttributes(),
          activeDays: []
        };
        try {
          addRewardRecords(transaction, profile, quest, quest.id, 'legacy', quest.title);
          quests.put({ ...quest, status: 'completed', completedAt: new Date().toISOString(), xpAwarded: quest.xp });
        } catch (error) {
          completionError = error;
          transaction.abort();
        }
      };
      profileRequest.onerror = () => {
        completionError = profileRequest.error ?? new Error('Falha ao ler o perfil.');
        transaction.abort();
      };
    };
    ledgerRequest.onerror = () => {
      completionError = ledgerRequest.error ?? new Error('Falha ao verificar o histórico de XP.');
      transaction.abort();
    };
  };
  questRequest.onerror = () => {
    completionError = questRequest.error ?? new Error('Falha ao ler a missão.');
    transaction.abort();
  };

  try {
    await completion;
  } catch (error) {
    throw completionError ?? error;
  }
}

export async function addDemoQuests(demoQuests) {
  const database = await openDatabase();
  const transaction = database.transaction(['occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const store = transaction.objectStore('occurrences');
  let added = 0;
  for (const quest of demoQuests) {
    const date = localDateKey();
    const occurrence = {
      ...quest,
      kind: 'legacy',
      date,
      time: '',
      activityKey: normalizeActivityKey(quest.title, quest.category, date)
    };
    const duplicateRequest = store.index('activityKey').getAll(occurrence.activityKey);
    duplicateRequest.onsuccess = () => {
      if (duplicateRequest.result.some((item) => item.status !== 'cancelled')) return;
      store.add(occurrence);
      added += 1;
    };
    duplicateRequest.onerror = () => transaction.abort();
  }
  await completion;
  return added;
}

export async function removePendingDemoQuests() {
  const database = await openDatabase();
  const transaction = database.transaction(['quests', 'occurrences'], 'readwrite');
  const completion = transactionComplete(transaction);
  const stores = [transaction.objectStore('quests'), transaction.objectStore('occurrences')];
  for (const store of stores) {
    const request = store.getAll();
    request.onsuccess = () => {
      for (const quest of request.result) {
        if (quest.demo && quest.status === 'pending') store.delete(quest.id);
      }
    };
    request.onerror = () => transaction.abort();
  }
  await completion;
}

export async function promoteToNextRank() {
  const database = await openDatabase();
  const transaction = database.transaction(['profile', 'quests', 'occurrences', 'epics', 'events'], 'readwrite');
  const completion = transactionComplete(transaction);
  const profiles = transaction.objectStore('profile');
  const oldQuests = transaction.objectStore('quests');
  const occurrences = transaction.objectStore('occurrences');
  const epics = transaction.objectStore('epics');
  const events = transaction.objectStore('events');
  let promotionError;
  let checkedRequests = 0;
  let currentProfile;
  let rankQuests;

  const checkAndPromote = () => {
    checkedRequests += 1;
    if (checkedRequests !== 4) return;
    currentProfile ??= {
      id: 'player',
      totalXp: 0,
      rankIndex: 0,
      attributes: createInitialAttributes(),
      activeDays: []
    };
    const evaluation = evaluateNextRank(
      currentProfile.rankIndex,
      getLevelProgress(currentProfile.totalXp).level,
      currentProfile.attributes,
      rankQuests
    );
    if (!evaluation?.eligible) {
      promotionError = new Error('Os requisitos para a promoção ainda não foram cumpridos.');
      transaction.abort();
      return;
    }

    const promotedAt = new Date().toISOString();
    const eventId = crypto.randomUUID();
    profiles.put({
      ...currentProfile,
      rankIndex: currentProfile.rankIndex + 1,
      promotions: [...(currentProfile.promotions ?? []), { rank: evaluation.rank, promotedAt }]
    });
    events.add({
      id: eventId,
      title: `Promoção para ${evaluation.rank}`,
      xp: 0,
      createdAt: promotedAt,
      type: 'promotion'
    });
  };

  const profileRequest = profiles.get('player');
  const questRequests = [oldQuests.getAll(), occurrences.getAll(), epics.getAll()];
  profileRequest.onsuccess = () => {
    currentProfile = profileRequest.result;
    checkAndPromote();
  };
  const questLists = [null, null, null];
  questRequests.forEach((request, index) => {
    request.onsuccess = () => {
      questLists[index] = request.result;
      if (questLists.every((list) => list !== null)) {
        rankQuests = [...questLists[0], ...questLists[1], ...questLists[2]];
      }
      checkAndPromote();
    };
    request.onerror = () => {
      promotionError = request.error ?? new Error('Falha ao ler os requisitos de promoção.');
      transaction.abort();
    };
  });
  profileRequest.onerror = () => {
    promotionError = profileRequest.error ?? new Error('Falha ao ler o perfil.');
    transaction.abort();
  };

  try {
    await completion;
  } catch (error) {
    throw promotionError ?? error;
  }
}
