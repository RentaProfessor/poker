import {
  Card, Player, GameState, BettingRound, PlayerAction,
  ValidAction, SidePot, HandResult, ShowdownResult,
  PlayerPublicInfo, EvaluatedHand,
} from './types';
import { HandDeck } from './deck';
import { evaluateBestHand, compareHands } from './hand-evaluator';

const ACTION_TIMEOUT = 30_000; // 30 seconds

export type GameEvent =
  | { type: 'hand_start'; dealerSeat: number; handNumber: number; players: PlayerPublicInfo[] }
  | { type: 'hole_cards'; playerId: string; cards: Card[] }
  | { type: 'community'; cards: Card[]; round: BettingRound }
  | { type: 'action_on'; playerId: string; validActions: ValidAction[]; pot: number; currentBet: number; timeDeadline: number }
  | { type: 'player_acted'; playerId: string; action: PlayerAction; amount: number; pot: number; playerChips: number }
  | { type: 'pot_update'; pot: number; sidePots: SidePot[] }
  | { type: 'showdown'; results: ShowdownResult[] }
  | { type: 'hand_end'; players: PlayerPublicInfo[] };

export class GameEngine {
  private state: GameState;
  private deck: HandDeck | null = null;
  private onEvent: (event: GameEvent) => void;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(roomCode: string, hostId: string, onEvent: (event: GameEvent) => void) {
    this.onEvent = onEvent;
    this.state = {
      roomCode,
      hostId,
      players: [],
      dealerSeatIndex: -1,
      smallBlind: 1,
      bigBlind: 2,
      buyIn: 200,
      handInProgress: false,
      bettingRound: 'preflop',
      communityCards: [],
      pot: 0,
      sidePots: [],
      currentBet: 0,
      minRaise: 2,
      lastRaiseAmount: 2,
      activePlayerIndex: -1,
      actionTimerDeadline: null,
      winners: null,
      handNumber: 0,
    };
  }

  get gameState(): GameState {
    return this.state;
  }

  // ── Player Management ──

  addPlayer(id: string, name: string, seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex > 5) return false;
    if (this.state.players.some(p => p.seatIndex === seatIndex)) return false;
    if (this.state.players.some(p => p.id === id)) return false;
    if (this.state.players.length >= 6) return false;

    this.state.players.push({
      id,
      name,
      seatIndex,
      chips: this.state.buyIn,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      hasFolded: false,
      isAllIn: false,
      isSittingOut: false,
      isConnected: true,
    });

    // Sort by seat index for consistent ordering
    this.state.players.sort((a, b) => a.seatIndex - b.seatIndex);
    return true;
  }

  removePlayer(id: string): void {
    const idx = this.state.players.findIndex(p => p.id === id);
    if (idx === -1) return;

    if (this.state.handInProgress) {
      // If hand is in progress, fold them first
      const player = this.state.players[idx];
      if (!player.hasFolded) {
        player.hasFolded = true;
      }
      player.isConnected = false;
      // If it's their turn, auto-fold and advance
      if (this.getActivePlayer()?.id === id) {
        this.handleAction(id, 'fold');
        return;
      }
    } else {
      this.state.players.splice(idx, 1);
    }
  }

  setPlayerConnected(id: string, connected: boolean): void {
    const player = this.state.players.find(p => p.id === id);
    if (player) player.isConnected = connected;
  }

  // ── Hand Flow ──

  canStartHand(): boolean {
    const activePlayers = this.state.players.filter(
      p => p.isConnected && p.chips > 0 && !p.isSittingOut
    );
    return activePlayers.length >= 2 && !this.state.handInProgress;
  }

  startHand(): void {
    if (!this.canStartHand()) return;

    // Remove busted players (0 chips) and disconnected players between hands
    this.state.players = this.state.players.filter(p => p.chips > 0 && p.isConnected);

    this.state.handInProgress = true;
    this.state.handNumber++;
    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.sidePots = [];
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.lastRaiseAmount = this.state.bigBlind;
    this.state.winners = null;
    this.state.bettingRound = 'preflop';

    // Reset player states
    for (const p of this.state.players) {
      p.holeCards = [];
      p.currentBet = 0;
      p.totalBetThisRound = 0;
      p.hasFolded = !p.isConnected || p.chips === 0 || p.isSittingOut;
      p.isAllIn = false;
      p.lastAction = undefined;
    }

    // Advance dealer
    this.advanceDealer();

    // Create and shuffle deck
    this.deck = new HandDeck();

    // Post blinds
    this.postBlinds();

    // Emit hand start
    this.onEvent({
      type: 'hand_start',
      dealerSeat: this.state.dealerSeatIndex,
      handNumber: this.state.handNumber,
      players: this.getPublicPlayers(),
    });

    // Deal hole cards
    this.dealHoleCards();

    // Set betting round to preflop and find first actor
    this.state.bettingRound = 'preflop';
    this.startBettingRound();
  }

  private advanceDealer(): void {
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length === 0) return;

    if (this.state.dealerSeatIndex === -1) {
      // First hand - pick a random seat
      this.state.dealerSeatIndex = activePlayers[0].seatIndex;
      return;
    }

    // Find next active player after current dealer
    const currentIdx = activePlayers.findIndex(p => p.seatIndex === this.state.dealerSeatIndex);
    const nextIdx = (currentIdx + 1) % activePlayers.length;
    this.state.dealerSeatIndex = activePlayers[nextIdx].seatIndex;
  }

  private postBlinds(): void {
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length < 2) return;

    const dealerIdx = activePlayers.findIndex(p => p.seatIndex === this.state.dealerSeatIndex);

    let sbIdx: number, bbIdx: number;

    if (activePlayers.length === 2) {
      // Heads-up: dealer posts SB, other posts BB
      sbIdx = dealerIdx;
      bbIdx = (dealerIdx + 1) % activePlayers.length;
    } else {
      sbIdx = (dealerIdx + 1) % activePlayers.length;
      bbIdx = (dealerIdx + 2) % activePlayers.length;
    }

    const sbPlayer = activePlayers[sbIdx];
    const bbPlayer = activePlayers[bbIdx];

    this.postBlind(sbPlayer, this.state.smallBlind);
    this.postBlind(bbPlayer, this.state.bigBlind);

    this.state.currentBet = this.state.bigBlind;
  }

  private postBlind(player: Player, amount: number): void {
    const actualAmount = Math.min(amount, player.chips);
    player.chips -= actualAmount;
    player.currentBet = actualAmount;
    player.totalBetThisRound = actualAmount;
    this.state.pot += actualAmount;

    if (player.chips === 0) {
      player.isAllIn = true;
    }
  }

  private dealHoleCards(): void {
    const activePlayers = this.getActivePlayers();
    for (const player of activePlayers) {
      if (!player.hasFolded) {
        player.holeCards = this.deck!.dealMultiple(2);
        this.onEvent({
          type: 'hole_cards',
          playerId: player.id,
          cards: player.holeCards,
        });
      }
    }
  }

  // ── Betting ──

  private startBettingRound(): void {
    // Reset bets for new round (except preflop where blinds are already posted)
    if (this.state.bettingRound !== 'preflop') {
      for (const p of this.state.players) {
        p.currentBet = 0;
        p.lastAction = undefined;
      }
      this.state.currentBet = 0;
      this.state.minRaise = this.state.bigBlind;
      this.state.lastRaiseAmount = this.state.bigBlind;

      // Notify UI that bets are collected into pot
      this.onEvent({
        type: 'pot_update',
        pot: this.state.pot,
        sidePots: this.state.sidePots,
      });
    }

    // Check if we can skip this round (only 1 player not folded/all-in)
    const canAct = this.getPlayersWhoCanAct();
    const notFolded = this.state.players.filter(p => !p.hasFolded);

    if (notFolded.length <= 1 || canAct.length === 0) {
      // Everyone folded or all-in, proceed to next stage
      this.advanceToNextRound();
      return;
    }

    // Find first actor
    this.findFirstActor();
    this.promptAction();
  }

  private findFirstActor(): void {
    const activePlayers = this.getActivePlayers();
    const dealerIdx = activePlayers.findIndex(p => p.seatIndex === this.state.dealerSeatIndex);

    let startIdx: number;

    if (this.state.bettingRound === 'preflop') {
      if (activePlayers.length === 2) {
        // Heads-up: dealer (SB) acts first preflop
        startIdx = dealerIdx;
      } else {
        // UTG: 3 after dealer (left of BB)
        startIdx = (dealerIdx + 3) % activePlayers.length;
      }
    } else {
      // Post-flop: first active player after dealer
      startIdx = (dealerIdx + 1) % activePlayers.length;
    }

    // Find next player who can act starting from startIdx
    for (let i = 0; i < activePlayers.length; i++) {
      const idx = (startIdx + i) % activePlayers.length;
      const player = activePlayers[idx];
      if (!player.hasFolded && !player.isAllIn) {
        this.state.activePlayerIndex = this.state.players.indexOf(player);
        return;
      }
    }
  }

  private promptAction(): void {
    const player = this.getActivePlayer();
    if (!player) {
      this.advanceToNextRound();
      return;
    }

    const validActions = this.getValidActions(player);
    const deadline = Date.now() + ACTION_TIMEOUT;
    this.state.actionTimerDeadline = deadline;

    this.onEvent({
      type: 'action_on',
      playerId: player.id,
      validActions,
      pot: this.state.pot,
      currentBet: this.state.currentBet,
      timeDeadline: deadline,
    });

    // Auto-fold timer
    this.clearActionTimer();
    this.actionTimer = setTimeout(() => {
      if (this.state.handInProgress && this.getActivePlayer()?.id === player.id) {
        this.handleAction(player.id, 'fold');
      }
    }, ACTION_TIMEOUT);
  }

  private getValidActions(player: Player): ValidAction[] {
    const actions: ValidAction[] = [];
    const toCall = this.state.currentBet - player.currentBet;

    // Can always fold
    actions.push({ action: 'fold' });

    if (toCall <= 0) {
      // No bet to call - can check
      actions.push({ action: 'check' });
    } else {
      // Must call or fold
      if (toCall >= player.chips) {
        // Can only go all-in to call
        actions.push({ action: 'call', minAmount: player.chips, maxAmount: player.chips });
      } else {
        actions.push({ action: 'call', minAmount: toCall, maxAmount: toCall });
      }
    }

    // Can raise if they have enough chips
    if (player.chips > toCall) {
      const minRaiseTotal = this.state.currentBet + this.state.minRaise;
      const minRaiseAmount = Math.min(minRaiseTotal - player.currentBet, player.chips);
      const maxRaiseAmount = player.chips;

      if (minRaiseAmount <= maxRaiseAmount) {
        actions.push({
          action: 'raise',
          minAmount: minRaiseAmount,
          maxAmount: maxRaiseAmount,
        });
      }
    }

    return actions;
  }

  handleAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    const activePlayer = this.getActivePlayer();
    if (!activePlayer || activePlayer.id !== playerId) return false;

    this.clearActionTimer();

    const toCall = this.state.currentBet - player.currentBet;

    switch (action) {
      case 'fold':
        player.hasFolded = true;
        player.lastAction = 'fold';
        break;

      case 'check':
        if (toCall > 0) return false; // Can't check when there's a bet
        player.lastAction = 'check';
        break;

      case 'call': {
        const callAmount = Math.min(toCall, player.chips);
        player.chips -= callAmount;
        player.currentBet += callAmount;
        player.totalBetThisRound += callAmount;
        this.state.pot += callAmount;
        player.lastAction = 'call';
        if (player.chips === 0) player.isAllIn = true;
        break;
      }

      case 'raise':
      case 'all-in': {
        let raiseAmount: number;
        if (action === 'all-in' || (amount && amount >= player.chips)) {
          raiseAmount = player.chips;
        } else {
          raiseAmount = amount || 0;
        }

        // Validate raise amount
        const minRaiseTotal = this.state.currentBet + this.state.minRaise;
        const minAllowedBet = minRaiseTotal - player.currentBet;

        // Allow all-in for less than min raise
        if (raiseAmount < minAllowedBet && raiseAmount < player.chips) {
          return false;
        }

        const newBet = player.currentBet + raiseAmount;
        const raiseOver = newBet - this.state.currentBet;

        if (raiseOver > 0 && raiseOver >= this.state.minRaise) {
          this.state.lastRaiseAmount = raiseOver;
          this.state.minRaise = raiseOver;
        }

        player.chips -= raiseAmount;
        player.currentBet = newBet;
        player.totalBetThisRound += raiseAmount;
        this.state.pot += raiseAmount;

        if (newBet > this.state.currentBet) {
          this.state.currentBet = newBet;
        }

        if (player.chips === 0) {
          player.isAllIn = true;
          player.lastAction = 'all-in';
        } else {
          player.lastAction = 'raise';
        }
        break;
      }

      default:
        return false;
    }

    // Emit player action
    this.onEvent({
      type: 'player_acted',
      playerId: player.id,
      action: player.lastAction!,
      amount: player.currentBet,
      pot: this.state.pot,
      playerChips: player.chips,
    });

    // Check if hand is over (only 1 player remaining)
    const notFolded = this.state.players.filter(p => !p.hasFolded);
    if (notFolded.length <= 1) {
      this.endHandFold(notFolded[0]);
      return true;
    }

    // Advance to next player or next round
    this.advanceAction();
    return true;
  }

  private advanceAction(): void {
    const nextPlayer = this.findNextActor();

    if (!nextPlayer) {
      // Betting round is complete
      this.advanceToNextRound();
    } else {
      this.state.activePlayerIndex = this.state.players.indexOf(nextPlayer);
      this.promptAction();
    }
  }

  private findNextActor(): Player | null {
    const activePlayers = this.getActivePlayers();
    const currentPlayer = this.getActivePlayer();
    if (!currentPlayer) return null;

    // Find the current player's position by seat order in the active list
    let currentActiveIdx = activePlayers.indexOf(currentPlayer);
    if (currentActiveIdx < 0) {
      // Current player might have gone all-in (0 chips) but is still
      // in activePlayers since getActivePlayers uses >= 0.
      // Fall back to finding by seat position.
      currentActiveIdx = activePlayers.findIndex(
        p => p.seatIndex >= currentPlayer.seatIndex
      );
      if (currentActiveIdx < 0) currentActiveIdx = 0;
    }

    for (let i = 1; i <= activePlayers.length; i++) {
      const idx = (currentActiveIdx + i) % activePlayers.length;
      const player = activePlayers[idx];

      if (player.hasFolded || player.isAllIn) continue;

      // Player can still act if:
      // 1. Their bet is less than the current bet
      if (player.currentBet < this.state.currentBet) {
        return player;
      }

      // 2. BB option in preflop (hasn't acted yet)
      if (this.state.bettingRound === 'preflop' && !player.lastAction) {
        return player;
      }
    }

    return null;
  }

  private advanceToNextRound(): void {
    const notFolded = this.state.players.filter(p => !p.hasFolded);

    if (notFolded.length <= 1) {
      this.endHandFold(notFolded[0]);
      return;
    }

    // Check if we need to deal all remaining cards (all players all-in)
    const canAct = notFolded.filter(p => !p.isAllIn);

    const nextRound = this.getNextBettingRound();

    if (!nextRound) {
      // After river, go to showdown
      this.showdown();
      return;
    }

    this.state.bettingRound = nextRound;

    // Deal community cards
    this.dealCommunityCards(nextRound);

    if (canAct.length <= 1) {
      // All remaining players are all-in (or only 1 can act), just deal out
      this.advanceToNextRound();
    } else {
      this.startBettingRound();
    }
  }

  private getNextBettingRound(): BettingRound | null {
    switch (this.state.bettingRound) {
      case 'preflop': return 'flop';
      case 'flop': return 'turn';
      case 'turn': return 'river';
      case 'river': return null;
    }
  }

  private dealCommunityCards(round: BettingRound): void {
    if (!this.deck) return;

    // Burn a card before each community deal
    this.deck.burn();

    let newCards: Card[];
    switch (round) {
      case 'flop':
        newCards = this.deck.dealMultiple(3);
        break;
      case 'turn':
      case 'river':
        newCards = this.deck.dealMultiple(1);
        break;
      default:
        return;
    }

    this.state.communityCards.push(...newCards);

    this.onEvent({
      type: 'community',
      cards: [...this.state.communityCards],
      round,
    });
  }

  // ── Showdown ──

  private showdown(): void {
    const notFolded = this.state.players.filter(p => !p.hasFolded);

    // Calculate side pots
    const pots = this.calculatePots();

    const results: ShowdownResult[] = [];
    const handResults: HandResult[] = [];

    // Evaluate each pot
    for (let potIdx = 0; potIdx < pots.length; potIdx++) {
      const pot = pots[potIdx];
      const eligible = notFolded.filter(p => pot.eligiblePlayerIds.includes(p.id));

      // Evaluate all eligible hands
      const evaluations: { player: Player; hand: EvaluatedHand }[] = [];
      for (const player of eligible) {
        const allCards = [...player.holeCards, ...this.state.communityCards];
        if (allCards.length >= 5) {
          const hand = evaluateBestHand(allCards);
          evaluations.push({ player, hand });
        }
      }

      if (evaluations.length === 0) continue;

      // Sort by hand rank (best first)
      evaluations.sort((a, b) => compareHands(b.hand, a.hand));

      // Find winner(s) (handle ties)
      const bestHand = evaluations[0].hand;
      const winners = evaluations.filter(e => compareHands(e.hand, bestHand) === 0);

      // Split pot among winners
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - share * winners.length;

      for (let i = 0; i < winners.length; i++) {
        const winAmount = share + (i === 0 ? remainder : 0);
        winners[i].player.chips += winAmount;
        handResults.push({
          playerId: winners[i].player.id,
          amount: winAmount,
          hand: winners[i].hand,
          potIndex: potIdx,
        });
      }

      // Add to showdown results
      for (const e of evaluations) {
        const existing = results.find(r => r.playerId === e.player.id);
        if (!existing) {
          const winResult = handResults.find(h => h.playerId === e.player.id);
          results.push({
            playerId: e.player.id,
            cards: e.player.holeCards,
            hand: e.hand,
            winAmount: winResult ? winResult.amount : 0,
          });
        }
      }
    }

    this.state.winners = handResults;

    this.onEvent({ type: 'showdown', results });
    this.endHand();
  }

  private calculatePots(): SidePot[] {
    const activePlayers = this.state.players.filter(p => !p.hasFolded);
    const allInPlayers = activePlayers
      .filter(p => p.isAllIn)
      .sort((a, b) => a.totalBetThisRound - b.totalBetThisRound);

    if (allInPlayers.length === 0) {
      // No side pots
      return [{
        amount: this.state.pot,
        eligiblePlayerIds: activePlayers.map(p => p.id),
      }];
    }

    const pots: SidePot[] = [];
    let processedAmount = 0;
    const bettors = this.state.players.filter(p => p.totalBetThisRound > 0);

    // Sort all players by their total bet
    const sortedBettors = [...bettors].sort((a, b) => a.totalBetThisRound - b.totalBetThisRound);
    let prevLevel = 0;

    const levels = [...new Set(allInPlayers.map(p => p.totalBetThisRound))].sort((a, b) => a - b);

    for (const level of levels) {
      let potAmount = 0;
      const eligible: string[] = [];

      for (const p of bettors) {
        const contribution = Math.min(p.totalBetThisRound, level) - prevLevel;
        if (contribution > 0) {
          potAmount += contribution;
        }
        if (!p.hasFolded && p.totalBetThisRound >= level) {
          eligible.push(p.id);
        }
      }

      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
        processedAmount += potAmount;
      }
      prevLevel = level;
    }

    // Main pot (remainder)
    const remaining = this.state.pot - processedAmount;
    if (remaining > 0) {
      const eligible = activePlayers
        .filter(p => p.totalBetThisRound > prevLevel || !p.isAllIn)
        .map(p => p.id);
      pots.push({ amount: remaining, eligiblePlayerIds: eligible });
    }

    // If no pots generated, fallback
    if (pots.length === 0) {
      pots.push({
        amount: this.state.pot,
        eligiblePlayerIds: activePlayers.map(p => p.id),
      });
    }

    return pots;
  }

  private endHandFold(winner?: Player): void {
    if (winner) {
      winner.chips += this.state.pot;
      this.state.winners = [{
        playerId: winner.id,
        amount: this.state.pot,
        potIndex: 0,
      }];

      this.onEvent({
        type: 'showdown',
        results: [{
          playerId: winner.id,
          cards: [],
          hand: null,
          winAmount: this.state.pot,
        }],
      });
    }

    this.endHand();
  }

  private endHand(): void {
    this.clearActionTimer();
    this.state.handInProgress = false;
    this.state.activePlayerIndex = -1;

    // Remove disconnected players with no chips (they're gone)
    this.state.players = this.state.players.filter(
      p => p.isConnected || p.chips > 0
    );

    this.onEvent({
      type: 'hand_end',
      players: this.getPublicPlayers(),
    });
  }

  // ── Helpers ──

  private getActivePlayers(): Player[] {
    return this.state.players.filter(
      p => !p.isSittingOut && p.chips >= 0 && p.isConnected
    );
  }

  private getPlayersWhoCanAct(): Player[] {
    return this.state.players.filter(
      p => !p.hasFolded && !p.isAllIn && p.isConnected
    );
  }

  getActivePlayer(): Player | null {
    if (this.state.activePlayerIndex < 0 || this.state.activePlayerIndex >= this.state.players.length) {
      return null;
    }
    return this.state.players[this.state.activePlayerIndex];
  }

  getPublicPlayers(): PlayerPublicInfo[] {
    return this.state.players.map(p => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      chips: p.chips,
      currentBet: p.currentBet,
      hasFolded: p.hasFolded,
      isAllIn: p.isAllIn,
      lastAction: p.lastAction,
    }));
  }

  getPlayerById(id: string): Player | undefined {
    return this.state.players.find(p => p.id === id);
  }

  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  destroy(): void {
    this.clearActionTimer();
  }
}

