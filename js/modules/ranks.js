export const RANKS = Object.freeze([
  {
    name: 'Grau 4',
    requirements: []
  },
  {
    name: 'Grau 3',
    requirements: [
      { type: 'level', value: 5, label: 'Alcançar o nível 5' },
      { type: 'attributes', count: 3, value: 5, label: '3 atributos com pelo menos 5 pontos' }
    ]
  },
  {
    name: 'Grau 2',
    requirements: [
      { type: 'level', value: 15, label: 'Alcançar o nível 15' },
      { type: 'attributes', count: 3, value: 12, label: '3 atributos com pelo menos 12 pontos' }
    ]
  },
  {
    name: 'Semi-Grau 1',
    requirements: [
      { type: 'level', value: 25, label: 'Alcançar o nível 25' },
      { type: 'attributes', count: 4, value: 20, label: '4 atributos com pelo menos 20 pontos' }
    ]
  },
  {
    name: 'Grau 1',
    requirements: [
      { type: 'level', value: 40, label: 'Alcançar o nível 40' },
      { type: 'attributes', count: 4, value: 30, label: '4 atributos com pelo menos 30 pontos' },
      { type: 'elite', value: 1, label: 'Concluir uma missão de elite' }
    ]
  },
  {
    name: 'Grau Especial',
    requirements: [
      { type: 'level', value: 60, label: 'Alcançar o nível 60' },
      { type: 'attributes', count: 5, value: 40, label: 'Os 5 atributos com pelo menos 40 pontos' },
      { type: 'campaign', value: 1, label: 'Concluir uma campanha especial' }
    ]
  }
]);

export function evaluateNextRank(rankIndex, level, attributes, quests) {
  const nextRank = RANKS[rankIndex + 1];
  if (!nextRank) return null;

  const checks = nextRank.requirements.map((requirement) => {
    let met = false;
    if (requirement.type === 'level') {
      met = level >= requirement.value;
    } else if (requirement.type === 'attributes') {
      met = Object.values(attributes).filter((points) => points >= requirement.value).length >= requirement.count;
    } else if (requirement.type === 'elite') {
      met = quests.some((quest) => quest.elite && quest.status === 'completed');
    } else if (requirement.type === 'campaign') {
      met = quests.some((quest) => quest.specialCampaign && quest.status === 'completed');
    }
    return { label: requirement.label, met };
  });

  return {
    rank: nextRank.name,
    checks,
    eligible: checks.every(({ met }) => met)
  };
}
