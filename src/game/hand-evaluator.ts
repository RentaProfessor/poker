import { Card, Rank, Suit, HandRank, EvaluatedHand, RANK_VALUES, HAND_RANK_NAMES } from './types';

/**
 * Evaluates the best 5-card poker hand from up to 7 cards.
 * Returns ranking, tiebreaker values, and the actual 5 cards.
 */
export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }

  // Generate all C(n,5) combinations
  const combos = getCombinations(cards, 5);
  let best: EvaluatedHand | null = null;

  for (const combo of combos) {
    const evaluated = evaluateFiveCards(combo);
    if (!best || compareHands(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return best!;
}

/**
 * Compare two evaluated hands. Returns:
 *  > 0 if a beats b
 *  < 0 if b beats a
 *  0 if tie
 */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  // Same hand rank -> compare tiebreaker values
  for (let i = 0; i < a.values.length && i < b.values.length; i++) {
    if (a.values[i] !== b.values[i]) {
      return a.values[i] - b.values[i];
    }
  }
  return 0;
}

/**
 * Evaluate exactly 5 cards into a hand ranking.
 */
function evaluateFiveCards(cards: Card[]): EvaluatedHand {
  const sorted = [...cards].sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);
  const values = sorted.map(c => RANK_VALUES[c.rank]);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(values);
  const isWheelStraight = checkWheelStraight(values);

  // Count rank occurrences
  const rankCounts = new Map<number, number>();
  for (const v of values) {
    rankCounts.set(v, (rankCounts.get(v) || 0) + 1);
  }

  const counts = Array.from(rankCounts.entries())
    .sort((a, b) => {
      // Sort by count desc, then by value desc
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0] - a[0];
    });

  // Determine hand rank
  if (isFlush && isStraight) {
    if (values[0] === 14 && values[1] === 13) {
      // Royal Flush: A K Q J 10 of same suit
      return makeResult(HandRank.RoyalFlush, [14], sorted);
    }
    return makeResult(HandRank.StraightFlush, [values[0]], sorted);
  }

  if (isFlush && isWheelStraight) {
    // A-2-3-4-5 straight flush (wheel / steel wheel)
    return makeResult(HandRank.StraightFlush, [5], sorted);
  }

  if (counts[0][1] === 4) {
    // Four of a Kind
    const quadVal = counts[0][0];
    const kicker = counts[1][0];
    return makeResult(HandRank.FourOfAKind, [quadVal, kicker], sorted);
  }

  if (counts[0][1] === 3 && counts[1][1] === 2) {
    // Full House
    return makeResult(HandRank.FullHouse, [counts[0][0], counts[1][0]], sorted);
  }

  if (isFlush) {
    return makeResult(HandRank.Flush, values, sorted);
  }

  if (isStraight) {
    return makeResult(HandRank.Straight, [values[0]], sorted);
  }

  if (isWheelStraight) {
    // A-2-3-4-5 straight (wheel)
    return makeResult(HandRank.Straight, [5], sorted);
  }

  if (counts[0][1] === 3) {
    // Three of a Kind
    const tripVal = counts[0][0];
    const kickers = counts.slice(1).map(c => c[0]);
    return makeResult(HandRank.ThreeOfAKind, [tripVal, ...kickers], sorted);
  }

  if (counts[0][1] === 2 && counts[1][1] === 2) {
    // Two Pair
    const highPair = Math.max(counts[0][0], counts[1][0]);
    const lowPair = Math.min(counts[0][0], counts[1][0]);
    const kicker = counts[2][0];
    return makeResult(HandRank.TwoPair, [highPair, lowPair, kicker], sorted);
  }

  if (counts[0][1] === 2) {
    // One Pair
    const pairVal = counts[0][0];
    const kickers = counts.slice(1).map(c => c[0]).sort((a, b) => b - a);
    return makeResult(HandRank.OnePair, [pairVal, ...kickers], sorted);
  }

  // High Card
  return makeResult(HandRank.HighCard, values, sorted);
}

/**
 * Check if sorted values form a straight (sequential).
 */
function checkStraight(values: number[]): boolean {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) {
      return false;
    }
  }
  return true;
}

/**
 * Check for A-2-3-4-5 straight (wheel).
 * Values sorted descending would be [14, 5, 4, 3, 2].
 */
function checkWheelStraight(values: number[]): boolean {
  const wheelValues = [14, 5, 4, 3, 2];
  return values.length === 5 && values.every((v, i) => v === wheelValues[i]);
}

function makeResult(rank: HandRank, values: number[], cards: Card[]): EvaluatedHand {
  return {
    rank,
    values,
    cards,
    name: HAND_RANK_NAMES[rank],
  };
}

/**
 * Generate all C(n, k) combinations from an array.
 */
function getCombinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];

  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return result;
}

/**
 * Format a card for display: "A♠", "K♥", etc.
 */
export function formatCard(card: Card): string {
  const suitSymbols: Record<string, string> = {
    hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠'
  };
  return `${card.rank}${suitSymbols[card.suit]}`;
}

/**
 * Format an evaluated hand for display.
 */
export function formatHand(hand: EvaluatedHand): string {
  return `${hand.name} (${hand.cards.map(formatCard).join(' ')})`;
}

