import { validateReward } from './experience.js';

export function validateEpic(epic) {
  if (!epic || epic.kind !== 'epic') throw new TypeError('A missão épica é inválida.');
  if (typeof epic.title !== 'string' || !epic.title.trim()) throw new TypeError('Informe o nome da missão épica.');
  if (typeof epic.category !== 'string' || !epic.category.trim()) throw new TypeError('Informe a categoria da missão épica.');
  if (!Array.isArray(epic.subtasks) || epic.subtasks.length === 0) throw new TypeError('Uma missão épica precisa de pelo menos uma etapa.');
  if (epic.subtasks.some((task) => !task.id || typeof task.title !== 'string' || !task.title.trim()) ||
    new Set(epic.subtasks.map((task) => task.id)).size !== epic.subtasks.length) {
    throw new TypeError('Cada etapa precisa de um identificador e um nome.');
  }
  if (epic.dueDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(epic.dueDate);
    if (!match) throw new TypeError('O prazo da missão épica é inválido.');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
      throw new TypeError('O prazo da missão épica é inválido.');
    }
  }
  validateReward(epic.xp, epic.attributeRewards);
}

export function getEpicProgress(epic) {
  const total = epic.subtasks.length;
  const completed = epic.subtasks.filter((task) => task.completed).length;
  return {
    completed,
    total,
    percentage: Math.floor((completed / total) * 100),
    readyToClaim: epic.status === 'pending' && total > 0 && completed === total
  };
}

export function updateEpicSubtask(epic, subtaskId, completed) {
  validateEpic(epic);
  if (epic.status !== 'pending') throw new Error('Uma missão épica encerrada não pode ser editada.');
  if (typeof completed !== 'boolean') throw new TypeError('O estado da etapa é inválido.');
  const index = epic.subtasks.findIndex((task) => task.id === subtaskId);
  if (index < 0) throw new Error('A etapa da missão não foi encontrada.');
  const subtasks = epic.subtasks.map((task) =>
    task.id === subtaskId ? { ...task, completed } : task
  );
  return { ...epic, subtasks };
}
