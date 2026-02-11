import { Card, SUIT_SYMBOLS } from '../game/types';

/**
 * Create a DOM element representing a playing card.
 */
export function createCardElement(card: Card, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const el = document.createElement('div');
  const sizeClass = size === 'sm' ? 'card-sm' : size === 'lg' ? 'card-lg' : '';
  el.className = `card card-front ${card.suit} ${sizeClass}`;

  const rankEl = document.createElement('span');
  rankEl.className = 'card-rank';
  rankEl.textContent = card.rank;

  const suitEl = document.createElement('span');
  suitEl.className = 'card-suit';
  suitEl.textContent = SUIT_SYMBOLS[card.suit];

  el.appendChild(rankEl);
  el.appendChild(suitEl);

  return el;
}

/**
 * Create a card-back element (face-down card).
 */
export function createCardBack(size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const el = document.createElement('div');
  const sizeClass = size === 'sm' ? 'card-sm' : size === 'lg' ? 'card-lg' : '';
  el.className = `card card-back ${sizeClass}`;
  return el;
}

/**
 * Create a placeholder for an unrevealed community card.
 */
export function createCardPlaceholder(size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const el = document.createElement('div');
  const sizeClass = size === 'sm' ? 'card-sm' : size === 'lg' ? 'card-lg' : '';
  el.className = `card card-back ${sizeClass}`;
  el.style.opacity = '0.3';
  return el;
}

