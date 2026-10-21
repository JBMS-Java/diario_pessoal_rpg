// Ícones SVG originais, um por grau (índice igual ao de RANKS).
const PATHS = [
  // Grau 4: círculo com ponto central
  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  // Grau 3: escudo
  '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.500-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  // Grau 2: hexágono com losango
  '<path d="M12 2.500l8 4.500v10l-8 4.500-8-4.500V7z"/><path d="M12 8l3.500 4-3.500 4-3.500-4z"/>',
  // Semi-Grau 1: estrela de quatro pontas
  '<path d="M12 2l2.500 7.500L22 12l-7.500 2.500L12 22l-2.500-7.500L2 12l7.500-2.500z"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/>',
  // Grau 1: estrela de cinco pontas
  '<path d="M12 2.500l2.900 6 6.600.9-4.800 4.600 1.200 6.500L12 17.400l-5.900 3.100 1.200-6.500L2.500 9.400l6.600-.9z"/>',
  // Grau Especial: olho com raios
  '<path d="M2 12s3.500-6 10-6 10 6 10 6-3.500 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.500v2M4.500 4l1.400 1.400M19.500 4l-1.400 1.400"/>'
];

export function rankIcon(index, size = 24) {
  const body = PATHS[Math.min(Math.max(index, 0), PATHS.length - 1)];
  return `<svg class="rank-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${body}</svg>`;
}
