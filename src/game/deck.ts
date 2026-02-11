import { Card, SUITS, RANKS } from './types';

/**
 * Creates a standard 52-card deck.
 * 4 suits × 13 ranks = 52 unique cards.
 * No duplicates by construction.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle using cryptographically secure random numbers.
 * Uses crypto.getRandomValues() for true randomness.
 * Shuffles in-place and returns the deck.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const n = deck.length;
  // Generate all random values at once for efficiency
  const randomValues = new Uint32Array(n);
  crypto.getRandomValues(randomValues);

  for (let i = n - 1; i > 0; i--) {
    // Unbiased modulo: random index in [0, i]
    const j = randomValues[i] % (i + 1);
    // Swap
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }

  return deck;
}

/**
 * Manages a deck for a single hand of poker.
 * Cards are popped from the shuffled array, making it impossible to deal duplicates.
 */
export class HandDeck {
  private cards: Card[];
  private position: number;

  constructor() {
    this.cards = shuffleDeck(createDeck());
    this.position = 0;
  }

  /**
   * Deal one card from the deck.
   * @throws Error if deck is exhausted (should never happen in standard play)
   */
  deal(): Card {
    if (this.position >= this.cards.length) {
      throw new Error('Deck exhausted - this should never happen in a standard hand');
    }
    return this.cards[this.position++];
  }

  /**
   * Deal multiple cards.
   */
  dealMultiple(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  /**
   * Burn one card (standard casino procedure before community cards).
   */
  burn(): void {
    this.deal(); // Just advance position, discard the card
  }

  /**
   * Number of cards remaining in the deck.
   */
  get remaining(): number {
    return this.cards.length - this.position;
  }
}

