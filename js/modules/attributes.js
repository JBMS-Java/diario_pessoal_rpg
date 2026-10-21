export const ATTRIBUTE_DEFINITIONS = Object.freeze([
  { id: 'intellect', name: 'Intelecto', color: '#44e5ed' },
  { id: 'strength', name: 'Força', color: '#ed60c8' },
  { id: 'technique', name: 'Técnica', color: '#a477ff' },
  { id: 'endurance', name: 'Resistência', color: '#72e0a0' },
  { id: 'discipline', name: 'Disciplina', color: '#ffc76a' }
]);

export function createInitialAttributes() {
  return Object.fromEntries(ATTRIBUTE_DEFINITIONS.map(({ id }) => [id, 0]));
}

export function validateAttributes(attributes) {
  if (!attributes || ATTRIBUTE_DEFINITIONS.some(({ id }) =>
    !Number.isSafeInteger(attributes[id]) || attributes[id] < 0
  )) {
    throw new TypeError('Os atributos do personagem são inválidos.');
  }
}

export function getAttributePoints(attributes, rewards) {
  validateAttributes(attributes);
  return Object.fromEntries(ATTRIBUTE_DEFINITIONS.map(({ id }) => [
    id,
    attributes[id] + (rewards[id] ?? 0)
  ]));
}
