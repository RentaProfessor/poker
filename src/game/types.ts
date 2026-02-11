// ── Card Types ──

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = typeof SUITS[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = typeof RANKS[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// ── Hand Ranking ──

export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export const HAND_RANK_NAMES: Record<HandRank, string> = {
  [HandRank.HighCard]: 'High Card',
  [HandRank.OnePair]: 'One Pair',
  [HandRank.TwoPair]: 'Two Pair',
  [HandRank.ThreeOfAKind]: 'Three of a Kind',
  [HandRank.Straight]: 'Straight',
  [HandRank.Flush]: 'Flush',
  [HandRank.FullHouse]: 'Full House',
  [HandRank.FourOfAKind]: 'Four of a Kind',
  [HandRank.StraightFlush]: 'Straight Flush',
  [HandRank.RoyalFlush]: 'Royal Flush',
};

export interface EvaluatedHand {
  rank: HandRank;
  // Tiebreaker values (descending importance)
  values: number[];
  // The 5 cards making up the best hand
  cards: Card[];
  name: string;
}

// ── Player & Game State ──

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface Player {
  id: string;
  name: string;
  seatIndex: number;
  chips: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisRound: number;
  hasFolded: boolean;
  isAllIn: boolean;
  isSittingOut: boolean;
  lastAction?: PlayerAction;
  isConnected: boolean;
}

export type BettingRound = 'preflop' | 'flop' | 'turn' | 'river';

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface GameState {
  // Room
  roomCode: string;
  hostId: string;

  // Table
  players: Player[];
  dealerSeatIndex: number;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;

  // Current hand
  handInProgress: boolean;
  bettingRound: BettingRound;
  communityCards: Card[];
  pot: number;
  sidePots: SidePot[];
  currentBet: number;
  minRaise: number;
  lastRaiseAmount: number;
  activePlayerIndex: number; // index into players array of who acts next

  // Timer
  actionTimerDeadline: number | null; // timestamp

  // Results
  winners: HandResult[] | null;
  handNumber: number;
}

export interface HandResult {
  playerId: string;
  amount: number;
  hand?: EvaluatedHand;
  potIndex: number; // which pot they won
}

// ── Network Messages ──

export type HostMessage =
  | { type: 'room_update'; players: PlayerInfo[]; hostId: string; roomCode: string }
  | { type: 'hand_start'; dealerSeat: number; handNumber: number; players: PlayerPublicInfo[] }
  | { type: 'hole_cards'; cards: Card[] }
  | { type: 'community'; cards: Card[]; round: BettingRound }
  | { type: 'action_on'; playerId: string; validActions: ValidAction[]; pot: number; currentBet: number; timeDeadline: number }
  | { type: 'player_acted'; playerId: string; action: PlayerAction; amount: number; pot: number; playerChips: number }
  | { type: 'pot_update'; pot: number; sidePots: SidePot[] }
  | { type: 'showdown'; results: ShowdownResult[] }
  | { type: 'hand_end'; players: PlayerPublicInfo[] }
  | { type: 'chat'; from: string; message: string }
  | { type: 'error'; message: string };

export type PeerMessage =
  | { type: 'sit'; seatIndex: number; name: string }
  | { type: 'stand' }
  | { type: 'ready' }
  | { type: 'action'; action: PlayerAction; amount?: number }
  | { type: 'chat'; message: string }
  | { type: 'join'; name: string };

export interface PlayerInfo {
  id: string;
  name: string;
  seatIndex: number;
  chips: number;
  isConnected: boolean;
  isReady: boolean;
}

export interface PlayerPublicInfo {
  id: string;
  name: string;
  seatIndex: number;
  chips: number;
  currentBet: number;
  hasFolded: boolean;
  isAllIn: boolean;
  lastAction?: PlayerAction;
}

export interface ValidAction {
  action: PlayerAction;
  minAmount?: number;
  maxAmount?: number;
}

export interface ShowdownResult {
  playerId: string;
  cards: Card[];
  hand: EvaluatedHand | null;
  winAmount: number;
}

