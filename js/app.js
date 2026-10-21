import { ATTRIBUTE_DEFINITIONS } from './modules/attributes.js';
import { getEpicProgress } from './modules/epics.js';
import { getLevelProgress } from './modules/experience.js';
import { localDateKey, weekDates, weekStart } from './modules/quests.js';
import { POINTS_EVERY, xpFor } from './modules/balance.js';
import { evaluateNextRank, RANKS } from './modules/ranks.js';
import {
  addDemoQuests,
  completeEpic,
  completeOccurrence,
  completeQuest,
  createEpic,
  createRoutine,
  createSpecialQuest,
  loadDashboard,
  promoteToNextRank,
  removePendingDemoQuests,
  setEpicSubtask,
  updateOccurrenceStatus,
  updateRoutine,
  updateSpecialQuest
} from './modules/storage.js';

const ATTRIBUTE_LABELS = Object.fromEntries(ATTRIBUTE_DEFINITIONS.map(({ id, name }) => [id, name]));
const ATTRIBUTE_IDS = ATTRIBUTE_DEFINITIONS.map(({ id }) => id);
const TYPE_COLORS = { routine: '#72e0a0', special: '#44e5ed', epic: '#ed60c8', legacy: '#a477ff' };
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const elements = {
  currentRank: document.querySelector('#current-rank'),
  levelValue: document.querySelector('#level-value'),
  xpLabel: document.querySelector('#xp-label'),
  xpProgress: document.querySelector('#xp-progress'),
  progressTrack: document.querySelector('.progress-track'),
  nextLevelLabel: document.querySelector('#next-level-label'),
  attributesList: document.querySelector('#attributes-list'),
  rankProgress: document.querySelector('#rank-progress'),
  questCount: document.querySelector('#quest-count'),
  dailyProgress: document.querySelector('#daily-progress'),
  activeDays: document.querySelector('#active-days'),
  questList: document.querySelector('#quest-list'),
  weekStrip: document.querySelector('#week-strip'),
  weekLabel: document.querySelector('#week-label'),
  epicList: document.querySelector('#epic-list'),
  activityList: document.querySelector('#activity-list'),
  dialog: document.querySelector('#quest-dialog'),
  form: document.querySelector('#quest-form'),
  formError: document.querySelector('#form-error'),
  toast: document.querySelector('#toast'),
  customCategoryWrap: document.querySelector('#custom-category-wrap'),
  customCategory: document.querySelector('#custom-category'),
  specialFields: document.querySelector('#special-fields'),
  routineFields: document.querySelector('#routine-fields'),
  epicFields: document.querySelector('#epic-fields'),
  missionKind: document.querySelector('#mission-kind'),
  typeField: document.querySelector('#type-field'),
  xpPreview: document.querySelector('#xp-preview'),
  addDemo: document.querySelector('#add-demo'),
  removeDemo: document.querySelector('#remove-demo'),
  dateFilter: document.querySelector('#filter-date'),
  categoryFilter: document.querySelector('#filter-category'),
  kindFilter: document.querySelector('#filter-kind'),
  statusFilter: document.querySelector('#filter-status')
};

let dashboard;
let selectedDate = localDateKey();
let toastTimer;
let editingOccurrenceId = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function localNoon(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function shiftDate(dateString, days) {
  const date = localNoon(dateString);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatDate(dateString, options = { day: '2-digit', month: 'short' }) {
  return new Intl.DateTimeFormat('pt-BR', options).format(localNoon(dateString));
}

function displayKind(quest) {
  if (quest.kind === 'routine') return 'ROUTINE';
  if (quest.kind === 'special') return 'SPECIAL';
  if (quest.kind === 'legacy') return 'QUEST';
  return quest.kind.toUpperCase();
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 4000);
}

function renderAttributes(attributes) {
  elements.attributesList.innerHTML = ATTRIBUTE_DEFINITIONS.map(({ id, name, color }) => {
    const value = attributes[id];
    const width = Math.min(value, 40) / 40 * 100;
    return `<div class="attribute-row">
      <span class="attribute-name">${name}</span>
      <div class="attribute-track" role="meter" aria-label="${name}" aria-valuemin="0" aria-valuemax="40" aria-valuenow="${value}"><span style="--attribute-color:${color};width:${width}%"></span></div>
      <span class="attribute-value">${value}</span>
    </div>`;
  }).join('');
}

function renderRank(profile, level, quests, epics) {
  const rankQuests = [...quests, ...epics.map((epic) => ({ ...epic, status: epic.status, specialCampaign: epic.specialCampaign }))];
  const evaluation = evaluateNextRank(profile.rankIndex, level, profile.attributes, rankQuests);
  elements.currentRank.textContent = RANKS[profile.rankIndex].name;
  if (!evaluation) {
    elements.rankProgress.innerHTML = '<div class="rank-next"><strong>Grau Especial</strong><span>Grau máximo alcançado</span></div><p class="requirement met">Todas as classificações foram conquistadas.</p>';
    return;
  }
  elements.rankProgress.innerHTML = `
    <div class="rank-next"><strong>${escapeHtml(evaluation.rank)}</strong><span>${evaluation.eligible ? 'Requisitos completos' : 'Avaliação pendente'}</span></div>
    <div class="requirement-list">${evaluation.checks.map(({ label, met }) => `<div class="requirement${met ? ' met' : ''}">${escapeHtml(label)}</div>`).join('')}</div>
    <button id="promote-button" class="button button-quiet rank-action" type="button" ${evaluation.eligible ? '' : 'disabled'}>${evaluation.eligible ? 'Concluir avaliação de promoção ↗' : 'Continue evoluindo'}</button>`;
}

function matchesQuestFilters(quest) {
  const kind = quest.kind === 'legacy' ? 'special' : quest.kind;
  return (!elements.categoryFilter.value || quest.category === elements.categoryFilter.value) &&
    (!elements.kindFilter.value || kind === elements.kindFilter.value) &&
    (!elements.statusFilter.value || quest.status === elements.statusFilter.value);
}

function renderWeek(quests) {
  const days = weekDates(selectedDate);
  elements.weekLabel.textContent = `${formatDate(days[0], { day: 'numeric', month: 'short' })} — ${formatDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  elements.weekStrip.innerHTML = days.map((date) => {
    const day = localNoon(date).getDay();
    const scheduled = quests.filter((quest) => quest.date === date && quest.kind !== 'epic');
    const pending = scheduled.filter((quest) => quest.status === 'pending').length;
    const completed = scheduled.filter((quest) => quest.status === 'completed').length;
    return `<button class="week-day${date === selectedDate ? ' selected' : ''}" type="button" data-date="${date}" aria-pressed="${date === selectedDate}">
      <span>${WEEKDAY_SHORT[day]}</span><strong>${date.slice(-2)}</strong><small>${completed}/${scheduled.length} feitas${pending ? ` · ${pending} pend.` : ''}</small>
    </button>`;
  }).join('');
}

function renderQuests() {
  const quests = dashboard.quests.filter((quest) =>
    quest.date === selectedDate && matchesQuestFilters(quest) && quest.kind !== 'epic'
  ).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.createdAt.localeCompare(b.createdAt));
  const pending = quests.filter((quest) => quest.status === 'pending');
  elements.questCount.textContent = String(pending.length);
  const todayQuests = dashboard.quests.filter((quest) => quest.date === selectedDate && quest.kind !== 'epic');
  const todayRoutine = todayQuests.filter((quest) => quest.kind === 'routine' || quest.type === 'daily');
  const doneToday = todayRoutine.filter((quest) => quest.status === 'completed').length;
  elements.dailyProgress.textContent = `${doneToday} / ${todayRoutine.length}`;
  elements.activeDays.textContent = `◈ ${dashboard.profile.activeDays?.length ?? 0} dias registrados`;
  renderWeek(dashboard.quests);

  if (!quests.length) {
    elements.questList.innerHTML = '<div class="empty-state">Nenhuma ocorrência corresponde a esta data e aos filtros. Ajuste os filtros ou crie uma missão.</div>';
    return;
  }

  elements.questList.innerHTML = quests.map((quest) => {
    const received = quest.status === 'completed';
    const rewards = received ? Object.entries(quest.attributeRewards ?? {})
      .filter(([, points]) => points > 0)
      .map(([id, points]) => `+${points} ${ATTRIBUTE_LABELS[id]}`)
      .join(' · ') : '';
    const terminal = quest.status !== 'pending';
    let actions = '';
    if (!terminal) {
      actions += `<button class="complete-button" type="button" data-action="complete" data-id="${escapeHtml(quest.id)}">Concluir ✓</button>`;
      if (quest.kind === 'routine') {
        actions += `<button class="mini-action" type="button" data-action="skip" data-id="${escapeHtml(quest.id)}">Pular</button>
          <button class="mini-action" type="button" data-action="absent" data-id="${escapeHtml(quest.id)}">Ausência</button>
          <button class="mini-action" type="button" data-action="edit-routine" data-id="${escapeHtml(quest.definitionId)}">Editar rotina</button>`;
      } else if (quest.kind === 'special') {
        actions += `<button class="mini-action" type="button" data-action="edit-special" data-id="${escapeHtml(quest.id)}">Editar</button>
          <button class="mini-action" type="button" data-action="cancel" data-id="${escapeHtml(quest.id)}">Cancelar</button>`;
      } else {
        actions += `<button class="mini-action" type="button" data-action="cancel" data-id="${escapeHtml(quest.id)}">Cancelar</button>`;
      }
    } else {
      actions = `<span class="completed-badge ${received ? '' : 'muted-status'}">${received ? '✓ Concluída' : quest.status === 'absent' ? 'Ausência registrada' : quest.status === 'skipped' ? 'Pulada' : 'Cancelada'}</span>`;
    }
    const potentialXp = ['routine', 'special'].includes(quest.kind) ? xpFor(quest) : quest.xp;
    const rewardText = received ? `+${quest.xpAwarded ?? quest.xp} XP recebido` : `+${potentialXp} XP potencial`;
    return `<article class="quest-card quest-${escapeHtml(quest.kind)}">
      <span class="quest-accent" style="--quest-color:${TYPE_COLORS[quest.kind] ?? '#44e5ed'}"></span>
      <div class="quest-info"><span class="quest-kind">${displayKind(quest)}${quest.time ? ` · ${escapeHtml(quest.time)}` : ''}</span><h3>${escapeHtml(quest.title)}</h3><p>${escapeHtml(quest.description || quest.category)}${quest.demo ? ' · Demo' : ''}</p></div>
      <span class="quest-reward">${rewardText}${rewards ? `<small>${escapeHtml(rewards)}</small>` : ''}</span>
      <div class="quest-actions-inline">${actions}</div>
    </article>`;
  }).join('');
}

function renderEpics(epics) {
  const visible = epics.filter((epic) => !elements.kindFilter.value || elements.kindFilter.value === 'epic')
    .filter((epic) => !elements.categoryFilter.value || epic.category === elements.categoryFilter.value)
    .filter((epic) => !elements.statusFilter.value || epic.status === elements.statusFilter.value);
  if (!visible.length) {
    elements.epicList.innerHTML = '<div class="empty-state">Crie uma Epic Quest para acompanhar um objetivo em várias etapas. As etapas não concedem XP individual.</div>';
    return;
  }
  elements.epicList.innerHTML = visible.map((epic) => {
    const progress = getEpicProgress(epic);
    const subtasks = epic.subtasks.map((task) => `
      <label class="epic-subtask${task.completed ? ' is-done' : ''}">
        <input type="checkbox" data-epic-task="${escapeHtml(task.id)}" data-epic-id="${escapeHtml(epic.id)}" ${task.completed ? 'checked' : ''} ${epic.status !== 'pending' ? 'disabled' : ''}>
        <span>${escapeHtml(task.title)}</span>
      </label>`).join('');
    return `<article class="epic-card">
      <div class="epic-card-heading"><div><span class="quest-kind">EPIC${epic.dueDate ? ` · PRAZO ${formatDate(epic.dueDate)}` : ''}</span><h3>${escapeHtml(epic.title)}</h3><p>${escapeHtml(epic.description || epic.category)}</p></div>
        <span class="quest-reward">${epic.status === 'completed' ? `+${epic.xpAwarded ?? epic.xp} XP recebido` : `+${xpFor(epic)} XP final`}</span>
      </div>
      <div class="epic-progress-label"><span>ETAPAS ${progress.completed}/${progress.total}</span><strong>${progress.percentage}%</strong></div>
      <div class="progress-track"><span style="width:${progress.percentage}%;background:var(--magenta)"></span></div>
      <div class="epic-subtasks">${subtasks}</div>
      ${progress.readyToClaim ? `<button class="button button-primary epic-claim" type="button" data-claim-epic="${escapeHtml(epic.id)}">Concluir Epic e receber +${xpFor(epic)} XP</button>` : epic.status === 'completed' ? '<span class="completed-badge">✓ Epic concluída · recompensa única</span>' : ''}
    </article>`;
  }).join('');
}

function renderActivity(events) {
  if (!events.length) {
    elements.activityList.innerHTML = '<div class="empty-state">XP e bônus recebidos aparecerão aqui.</div>';
    return;
  }
  elements.activityList.innerHTML = events.map((event) => `
    <div class="activity-item">
      <span class="activity-dot" style="${event.type === 'promotion' ? 'background:var(--purple)' : event.type === 'weekly-bonus' ? 'background:var(--amber)' : ''}"></span>
      <div class="activity-copy"><strong>${escapeHtml(event.type === 'promotion' ? event.title : event.title)}</strong><small>${formatDate(localDateKey(new Date(event.createdAt)))}${event.nextLevel > event.previousLevel ? ` · Nível ${event.previousLevel} → ${event.nextLevel}` : ''}</small></div>
      <span class="activity-xp">${event.xp > 0 ? `+${event.xp} XP` : event.type === 'promotion' ? 'RANK UP' : ''}</span>
    </div>`).join('');
}

function renderCategoryFilter() {
    const selectedCategory = elements.categoryFilter.value;
    const existing = new Set([...elements.categoryFilter.options].map(({ value }) => value));
    const categories = new Set([
      ...dashboard.quests.map(({ category }) => category),
      ...dashboard.definitions.map(({ category }) => category),
      ...dashboard.epics.map(({ category }) => category)
    ].filter(Boolean));
    for (const category of categories) {
      if (existing.has(category)) continue;
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      elements.categoryFilter.append(option);
    }
    if ([...elements.categoryFilter.options].some(({ value }) => value === selectedCategory)) {
      elements.categoryFilter.value = selectedCategory;
    }
}

function render() {
  const { profile, quests, events, epics } = dashboard;
  const { level, xpInLevel, xpToNextLevel, progress } = getLevelProgress(profile.totalXp);
  elements.levelValue.textContent = String(level).padStart(2, '0');
  elements.xpLabel.textContent = `${xpInLevel} / ${xpToNextLevel} XP`;
  elements.xpProgress.style.width = `${progress}%`;
  elements.progressTrack.setAttribute('aria-valuenow', String(progress));
  elements.nextLevelLabel.textContent = `${xpToNextLevel - xpInLevel} XP até o próximo nível`;
  elements.dateFilter.value = selectedDate;
  renderCategoryFilter();
  renderAttributes(profile.attributes);
  renderRank(profile, level, quests, epics);
  renderQuests();
  renderEpics(epics);
  renderActivity(events);
}

async function refresh() {
  const firstDay = weekStart(selectedDate);
  const lastDay = weekDates(selectedDate).at(-1);
  dashboard = await loadDashboard(firstDay, lastDay);
  render();
}

async function perform(action, successMessage) {
  try {
    await action();
    await refresh();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    showToast(error.message || 'Não foi possível concluir a operação.', true);
  }
}

function currentRewardItem() {
  const kind = elements.missionKind.value;
  return { kind, type: kind === 'routine' ? 'daily' : kind === 'epic' ? 'epic' : elements.form.elements.type.value };
}

function updateXpPreview() {
  const item = currentRewardItem();
  const note = item.kind === 'routine'
    ? `A cada ${POINTS_EVERY} conclusões: +1 Disciplina.`
    : item.kind === 'epic' ? 'Recompensa única ao concluir todas as etapas.' : `+1 ponto de atributo a cada ${POINTS_EVERY} conclusões da mesma área.`;
  elements.xpPreview.textContent = `Recompensa automática: +${xpFor(item)} XP. ${note}`;
}

function setMissionKind(kind) {
  elements.missionKind.value = kind;
  elements.specialFields.classList.toggle('hidden', kind !== 'special');
  elements.routineFields.classList.toggle('hidden', kind !== 'routine');
  elements.epicFields.classList.toggle('hidden', kind !== 'epic');
  elements.typeField.classList.toggle('hidden', kind !== 'special');
  updateXpPreview();
  const title = document.querySelector('#quest-title');
  title.required = true;
  const date = elements.form.elements.date;
  const startDate = elements.form.elements.startDate;
  date.required = kind === 'special';
  startDate.required = kind === 'routine';
}

function openDialog(kind, definition = null, occurrence = null) {
  elements.form.reset();
  elements.formError.textContent = '';
  editingOccurrenceId = occurrence?.id ?? null;
  elements.form.elements.editId.value = definition?.id ?? '';
  elements.customCategoryWrap.classList.add('hidden');
  elements.customCategory.required = false;
  setMissionKind(kind);
  const category = definition?.category ?? occurrence?.category ?? 'Desenvolvimento pessoal';
  if (![...elements.form.elements.category.options].some(({ value }) => value === category)) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    option.dataset.userCategory = 'true';
    elements.form.elements.category.append(option);
  }
  elements.form.elements.category.value = category;
  elements.form.elements.title.value = definition?.title ?? occurrence?.title ?? '';
  elements.form.elements.description.value = definition?.description ?? occurrence?.description ?? '';
  elements.form.elements.type.value = definition?.type ?? occurrence?.type ?? 'side';
  updateXpPreview();  elements.form.elements.elite.checked = Boolean(definition?.elite ?? occurrence?.elite);
  elements.form.elements.specialCampaign.checked = Boolean(definition?.specialCampaign ?? occurrence?.specialCampaign);
  if (kind === 'special') {
    elements.form.elements.date.value = definition?.date ?? occurrence?.date ?? selectedDate;
    elements.form.elements.time.value = definition?.time ?? occurrence?.time ?? '';
  } else if (kind === 'routine') {
    elements.form.elements.startDate.value = definition?.startDate ?? selectedDate;
    elements.form.elements.endDate.value = definition?.endDate ?? '';
    elements.form.elements.routineTime.value = definition?.time ?? '';
    elements.form.elements.weeklyBonus.checked = Boolean(definition?.weeklyBonus);
    for (const day of elements.form.querySelectorAll('[name="weekday"]')) {
      day.checked = Boolean(definition?.daysOfWeek?.includes(Number(day.value)));
    }
  } else {
    elements.form.elements.dueDate.value = definition?.dueDate ?? '';
    elements.form.elements.subtasks.value = definition?.subtasks?.map(({ title: taskTitle }) => taskTitle).join('\n') ?? '';
  }
  document.querySelector('.dialog-heading h2').textContent = definition ? 'Editar missão futura' : 'Registrar missão';
  elements.form.querySelector('[type="submit"]').textContent = definition ? 'Salvar alterações' : 'Criar missão';
  elements.dialog.showModal();
  document.querySelector('#quest-title').focus();
}

function rewardFromForm(formData) {
  const kind = String(formData.get('missionKind'));
  const type = kind === 'routine' ? 'daily' : kind === 'epic' ? 'epic' : String(formData.get('type'));
  const attributeRewards = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, 0]));
  return { difficulty: 'fixed', type, xp: xpFor({ kind, type }), attributeRewards };
}

function definitionFromForm(formData) {
  const reward = rewardFromForm(formData);
  return {
    id: String(formData.get('editId') || crypto.randomUUID()),
    kind: String(formData.get('missionKind')),
    title: String(formData.get('title') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    category: String(formData.get('category')),
    ...reward,
    elite: formData.get('elite') === 'on',
    specialCampaign: formData.get('specialCampaign') === 'on'
  };
}

function openEdit(quest) {
  if (quest.kind === 'routine') {
    const definition = dashboard.definitions.find(({ id }) => id === quest.definitionId);
    if (definition) openDialog('routine', definition, quest);
  } else if (quest.kind === 'special') {
    const definition = dashboard.definitions.find(({ id }) => id === quest.definitionId);
    if (definition) openDialog('special', definition, quest);
  }
}

document.querySelector('#open-quest-form').addEventListener('click', () => openDialog('special'));
const themeToggle = document.querySelector('#theme-toggle');
function syncThemeToggle() {
  themeToggle.textContent = document.documentElement.dataset.theme === 'friendly' ? 'Visual HUD' : 'Visual amigável';
}
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'friendly' ? 'hud' : 'friendly';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cursed-theme', next); } catch { /* preferência é opcional */ }
  syncThemeToggle();
});
syncThemeToggle();

const palettePicker = document.querySelector('#palette-picker');
palettePicker.value = document.documentElement.dataset.palette;
palettePicker.addEventListener('change', () => {
  document.documentElement.dataset.palette = palettePicker.value;
  try { localStorage.setItem('cursed-palette', palettePicker.value); } catch { /* preferência é opcional */ }
});
document.querySelector('#open-routine-form').addEventListener('click', () => openDialog('routine'));
document.querySelector('#open-epic-form').addEventListener('click', () => openDialog('epic'));
document.querySelector('#close-quest-form').addEventListener('click', () => elements.dialog.close());
document.querySelector('#cancel-quest-form').addEventListener('click', () => elements.dialog.close());
elements.missionKind.addEventListener('change', (event) => setMissionKind(event.target.value));
elements.form.addEventListener('change', (event) => {
  if (event.target.name === 'type') updateXpPreview();
  if (event.target.name === 'category') {
    const custom = event.target.value === 'custom';
    elements.customCategoryWrap.classList.toggle('hidden', !custom);
    elements.customCategory.required = custom;
  }
});
elements.form.addEventListener('reset', () => {
  elements.customCategoryWrap.classList.add('hidden');
  elements.customCategory.required = false;
  for (const option of elements.form.elements.category.querySelectorAll('[data-user-category]')) option.remove();
});
elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.formError.textContent = '';
  try {
    const data = new FormData(elements.form);
    const definition = definitionFromForm(data);
    if (elements.form.elements.category.value === 'custom') {
      definition.category = String(data.get('customCategory') || '').trim();
      if (!definition.category) throw new Error('Informe o nome da nova categoria.');
    }
    const editing = Boolean(elements.form.elements.editId.value);
    let conflicts = [];
    if (definition.kind === 'routine') {
      definition.startDate = String(data.get('startDate'));
      definition.endDate = String(data.get('endDate') || '');
      definition.time = String(data.get('routineTime') || '');
      definition.daysOfWeek = data.getAll('weekday').map(Number);
      definition.weeklyBonus = data.get('weeklyBonus') === 'on';
      if (editing) {
        conflicts = await updateRoutine(definition);
      } else {
        conflicts = await createRoutine(definition);
      }
    } else if (definition.kind === 'special') {
      definition.date = String(data.get('date'));
      definition.time = String(data.get('time') || '');
      if (editingOccurrenceId) await updateSpecialQuest(definition, editingOccurrenceId);
      else await createSpecialQuest(definition);
    } else {
      const subtasks = String(data.get('subtasks')).split(/\r?\n/).map((title) => title.trim()).filter(Boolean);
      const epic = {
        ...definition,
        dueDate: String(data.get('dueDate') || ''),
        subtasks: subtasks.map((title) => ({ id: crypto.randomUUID(), title, completed: false })),
        status: 'pending'
      };
      await createEpic(epic);
    }
    await refresh();
    elements.dialog.close();
    if (conflicts.length) {
      showToast(`${editing ? 'Programação atualizada' : 'Rotina criada'}, mas ${conflicts.length} ocorrência(s) coincidem com outra missão e não foram duplicadas.`, true);
    } else {
      showToast(editing ? 'Programação futura atualizada; o histórico passado foi preservado.' : 'Missão registrada. A recompensa só será creditada após a conclusão.');
    }
  } catch (error) {
    elements.formError.textContent = error.message || 'Não foi possível salvar a missão.';
  }
});
elements.questList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const quest = dashboard.quests.find((item) => item.id === id);
  if (action === 'edit-routine' || action === 'edit-special') {
    if (quest) openEdit(quest);
    else {
      const definition = dashboard.definitions.find((item) => item.id === id);
      if (definition) openDialog('routine', definition);
    }
    return;
  }
  const success = action === 'complete' ? 'Ocorrência concluída; recompensa registrada.' : 'Estado da ocorrência atualizado sem penalidade.';
  perform(async () => {
    if (action === 'complete') {
      if (quest?.source === 'legacy') await completeQuest(id);
      else await completeOccurrence(id);
    } else {
      await updateOccurrenceStatus(id, action === 'skip' ? 'skipped' : action === 'absent' ? 'absent' : 'cancelled');
    }
  }, success);
});
elements.epicList.addEventListener('change', (event) => {
  const input = event.target.closest('[data-epic-task]');
  if (input) perform(() => setEpicSubtask(input.dataset.epicId, input.dataset.epicTask, input.checked), 'Progresso da etapa atualizado. Etapas não concedem XP.');
});
elements.epicList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-claim-epic]');
  if (button) perform(() => completeEpic(button.dataset.claimEpic), 'Epic concluída! A recompensa final foi registrada uma única vez.');
});
elements.rankProgress.addEventListener('click', (event) => {
  if (event.target.id === 'promote-button') perform(() => promoteToNextRank(), 'Promoção registrada. Um novo grau foi alcançado!');
});
elements.weekStrip.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (button) {
    selectedDate = button.dataset.date;
    refresh().catch((error) => showToast(error.message, true));
  }
});
elements.dateFilter.addEventListener('change', () => {
  if (!elements.dateFilter.value) return;
  selectedDate = elements.dateFilter.value;
  refresh().catch((error) => showToast(error.message, true));
});
for (const filter of [elements.categoryFilter, elements.kindFilter, elements.statusFilter]) {
  filter.addEventListener('change', () => render());
}
document.querySelector('#week-previous').addEventListener('click', () => {
  selectedDate = shiftDate(selectedDate, -7);
  refresh().catch((error) => showToast(error.message, true));
});
document.querySelector('#week-next').addEventListener('click', () => {
  selectedDate = shiftDate(selectedDate, 7);
  refresh().catch((error) => showToast(error.message, true));
});
document.querySelector('#week-today').addEventListener('click', () => {
  selectedDate = localDateKey();
  refresh().catch((error) => showToast(error.message, true));
});
elements.addDemo.addEventListener('click', () => {
  const now = new Date().toISOString();
  const demoQuests = [
    { title: 'Estudar lógica de programação', description: 'Resolver exercícios por 30 minutos', type: 'side', category: 'Programação e tecnologia', difficulty: 'normal', xp: 25, attributeRewards: { intellect: 2, strength: 0, technique: 0, endurance: 0, discipline: 1 }, elite: false, specialCampaign: false },
    { title: 'Treino de força', description: 'Concluir a sessão planejada', type: 'training', category: 'Força e musculação', difficulty: 'hard', xp: 50, attributeRewards: { intellect: 0, strength: 3, technique: 0, endurance: 0, discipline: 0 }, elite: false, specialCampaign: false },
    { title: 'Organizar a semana', description: 'Definir prioridades para os próximos dias', type: 'daily', category: 'Disciplina e organização', difficulty: 'easy', xp: 10, attributeRewards: { intellect: 0, strength: 0, technique: 0, endurance: 0, discipline: 2 }, elite: false, specialCampaign: false }
  ].map((quest) => ({ ...quest, id: crypto.randomUUID(), status: 'pending', demo: true, createdAt: now }));
  perform(async () => {
    const added = await addDemoQuests(demoQuests);
    showToast(added ? `${added} missão(ões) demonstrativa(s) adicionada(s).` : 'Essas atividades demonstrativas já estão registradas para hoje.');
  });
});
elements.removeDemo.addEventListener('click', () => perform(
  () => removePendingDemoQuests(),
  'Missões demonstrativas pendentes removidas; o histórico concluído foi preservado.'
));

try {
  await refresh();
} catch (error) {
  showToast(error.message || 'Falha ao carregar os dados locais.', true);
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
}

const NAME_KEY = 'cursed-player-name';
const nameDialog = document.querySelector('#name-dialog');
const nameInput = document.querySelector('#name-input');
const playerNameEl = document.querySelector('#player-name');

function readPlayerName() {
  try { return localStorage.getItem(NAME_KEY); } catch { return ''; }
}
function savePlayerName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* preferência é opcional */ }
  renderPlayerName();
}
function renderPlayerName() {
  playerNameEl.textContent = readPlayerName() || 'feiticeiro';
}
function openNameDialog() {
  nameInput.value = readPlayerName() ?? '';
  nameDialog.showModal();
  nameInput.focus();
}
document.querySelector('#edit-name').addEventListener('click', openNameDialog);
document.querySelector('#skip-name').addEventListener('click', () => {
  if (readPlayerName() === null) savePlayerName('');
  nameDialog.close();
});
document.querySelector('#name-form').addEventListener('submit', () => {
  savePlayerName(nameInput.value.replace(/\s+/g, ' ').trim());
});
renderPlayerName();
// Primeira abertura: nenhum nome salvo ainda (null). "Agora não" grava vazio para não perguntar de novo.
if (readPlayerName() === null) openNameDialog();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch((error) => showToast(`Não foi possível ativar o modo offline: ${error.message}`, true));
}
