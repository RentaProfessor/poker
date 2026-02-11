import { PokerHost } from '../network/host';
import { PokerPeer } from '../network/peer';
import {
  Card, HostMessage, PlayerPublicInfo,
  PlayerAction, ShowdownResult, PlayerInfo, SUIT_SYMBOLS,
} from '../game/types';
import { createCardElement } from './card-renderer';
import { ActionBar } from './actions';

// ── Views ──
const viewLanding = document.getElementById('view-landing')!;
const viewTable = document.getElementById('view-table')!;

function showView(view: 'landing' | 'table'): void {
  viewLanding.classList.toggle('hidden', view !== 'landing');
  viewTable.classList.toggle('hidden', view !== 'table');
}

// ── State ──
let host: PokerHost | null = null;
let peer: PokerPeer | null = null;
let myId = '';
let isHost = false;
let roomCode = '';
let playerName = '';

let currentPlayers: PlayerPublicInfo[] = [];
let mySeatIndex = -1;
let myHoleCards: Card[] = [];
let communityCards: Card[] = [];
let currentPot = 0;
let dealerSeat = -1;
let activePlayerId = '';
let handInProgress = false;

let actionBar: ActionBar | null = null;

// ═══════════════════════════════════════
//  LANDING PAGE
// ═══════════════════════════════════════
function initLanding(): void {
  const hostNameInput = document.getElementById('host-name') as HTMLInputElement;
  const joinNameInput = document.getElementById('join-name') as HTMLInputElement;
  const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;
  const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
  const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
  const statusMessage = document.getElementById('status-message') as HTMLDivElement;
  const loadingSpinner = document.getElementById('loading-spinner') as HTMLDivElement;

  function showStatus(msg: string, isError = false): void {
    statusMessage.textContent = msg;
    statusMessage.style.color = isError ? '#e94560' : '#27ae60';
  }

  function showLoading(show: boolean): void {
    loadingSpinner.classList.toggle('hidden', !show);
    btnCreate.disabled = show;
    btnJoin.disabled = show;
  }

  // Create Room
  btnCreate.addEventListener('click', async () => {
    const name = hostNameInput.value.trim();
    if (!name) {
      showStatus('Please enter your name', true);
      hostNameInput.focus();
      return;
    }

    showLoading(true);
    showStatus('Creating room...');

    try {
      playerName = name;
      host = new PokerHost(name);

      host.onError = (msg) => {
        showStatus(msg, true);
        showLoading(false);
      };

      roomCode = await host.createRoom();
      isHost = true;
      myId = host.playerId;

      switchToTable();
    } catch (err: any) {
      showStatus(`Failed to create room: ${err.message}`, true);
      showLoading(false);
    }
  });

  // Join Room
  btnJoin.addEventListener('click', async () => {
    const name = joinNameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();

    if (!name) {
      showStatus('Please enter your name', true);
      joinNameInput.focus();
      return;
    }

    if (!code || code.length < 4) {
      showStatus('Please enter a valid room code', true);
      roomCodeInput.focus();
      return;
    }

    showLoading(true);
    showStatus('Connecting to room...');

    try {
      playerName = name;
      roomCode = code;
      peer = new PokerPeer(name, code);

      peer.onError = (msg) => {
        showStatus(msg, true);
        showLoading(false);
      };

      peer.onDisconnected = () => {
        showStatus('Disconnected from room', true);
        showLoading(false);
      };

      await peer.connect();

      isHost = false;
      myId = peer.playerId;

      switchToTable();
    } catch (err: any) {
      showStatus(`Failed to join: ${err.message}`, true);
      showLoading(false);
    }
  });

  // Auto-uppercase room code
  roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase();
  });

  // Enter key support
  hostNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnCreate.click();
  });
  joinNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') roomCodeInput.focus();
  });
  roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });
}

// ═══════════════════════════════════════
//  TABLE VIEW
// ═══════════════════════════════════════
function switchToTable(): void {
  showView('table');
  initTable();
}

function initTable(): void {
  // Display room code
  document.getElementById('room-code-display')!.textContent = roomCode;

  // Copy button
  document.getElementById('btn-copy-code')!.addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).catch(() => {});
    const btn = document.getElementById('btn-copy-code')!;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '📋', 1500);
  });

  // Leave button
  document.getElementById('btn-leave')!.addEventListener('click', () => {
    if (confirm('Leave the table?')) {
      if (host) host.destroy();
      if (peer) peer.destroy();
      host = null;
      peer = null;
      resetState();
      showView('landing');
    }
  });

  // Action bar
  actionBar = new ActionBar();

  // Chat
  setupChat();

  // Seat click handlers
  setupSeats();

  if (isHost) {
    initHostTable();
  } else {
    initPeerTable();
  }
}

function resetState(): void {
  currentPlayers = [];
  mySeatIndex = -1;
  myHoleCards = [];
  communityCards = [];
  currentPot = 0;
  dealerSeat = -1;
  activePlayerId = '';
  handInProgress = false;
}

// ── Host Table ──
function initHostTable(): void {
  if (!host) return;

  const hostControls = document.getElementById('host-controls')!;
  const btnDeal = document.getElementById('btn-deal') as HTMLButtonElement;
  btnDeal.addEventListener('click', () => {
    if (host && host.canDeal()) {
      host.dealHand();
      btnDeal.classList.add('hidden');
    }
  });

  // Host callbacks
  host.onPlayersChanged = (players: PlayerInfo[]) => {
    if (handInProgress) {
      // During a hand, merge new info without resetting game state
      for (const p of players) {
        const existing = currentPlayers.find(cp => cp.id === p.id);
        if (existing) {
          existing.chips = p.chips;
          existing.name = p.name;
        } else {
          currentPlayers.push({
            id: p.id,
            name: p.name,
            seatIndex: p.seatIndex,
            chips: p.chips,
            currentBet: 0,
            hasFolded: false,
            isAllIn: false,
          });
        }
      }
      // Remove players no longer present
      currentPlayers = currentPlayers.filter(cp =>
        players.some(p => p.id === cp.id)
      );
    } else {
      currentPlayers = players.map(p => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        chips: p.chips,
        currentBet: 0,
        hasFolded: false,
        isAllIn: false,
      }));
    }
    renderSeats();
    updateDealButton();
  };

  host.onHostMessage = (msg: HostMessage) => {
    handleGameMessage(msg);
  };

  host.onChat = (from: string, message: string) => {
    addChatMessage(from, message);
  };

  host.onError = (msg: string) => {
    addChatMessage('System', `Error: ${msg}`);
  };

  // Action bar -> host engine
  actionBar!.onAction = (action: PlayerAction, amount?: number) => {
    host?.hostAction(action, amount);
  };

  // Render initial empty seats
  renderSeats();
}

// ── Peer Table ──
function initPeerTable(): void {
  if (!peer) return;

  peer.onMessage = (msg: HostMessage) => {
    handleGameMessage(msg);
  };

  peer.onDisconnected = () => {
    addChatMessage('System', 'Lost connection to host');
  };

  peer.onError = (msg: string) => {
    addChatMessage('System', `Error: ${msg}`);
  };

  // Action bar -> send via WebRTC
  actionBar!.onAction = (action: PlayerAction, amount?: number) => {
    peer?.action(action, amount);
  };

  // Render initial empty seats
  renderSeats();
}

// ═══════════════════════════════════════
//  GAME MESSAGE HANDLING
// ═══════════════════════════════════════
function handleGameMessage(msg: HostMessage): void {
  switch (msg.type) {
    case 'room_update':
      if (!myId) myId = isHost ? host!.playerId : peer!.playerId;
      currentPlayers = msg.players.map(p => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        chips: p.chips,
        currentBet: 0,
        hasFolded: false,
        isAllIn: false,
      }));
      updateMySeat();
      renderSeats();
      break;

    case 'hand_start':
      handInProgress = true;
      dealerSeat = msg.dealerSeat;
      currentPlayers = msg.players;
      communityCards = [];
      myHoleCards = [];
      currentPot = 0;
      activePlayerId = '';
      renderSeats();
      renderCommunityCards();
      renderPot();
      if (isHost) {
        document.getElementById('btn-deal')?.classList.add('hidden');
        document.getElementById('host-controls')?.classList.add('hidden');
      }
      addChatMessage('System', `Hand #${msg.handNumber} starting`);
      break;

    case 'hole_cards':
      myHoleCards = msg.cards;
      renderSeats();
      break;

    case 'community':
      communityCards = msg.cards;
      renderCommunityCards();
      break;

    case 'action_on':
      activePlayerId = msg.playerId;
      currentPot = msg.pot;
      renderPot();
      renderSeats();

      if (msg.playerId === myId) {
        actionBar!.show(msg.validActions, msg.pot, msg.currentBet, msg.timeDeadline);
      } else {
        actionBar!.hide();
      }
      break;

    case 'player_acted': {
      const actedPlayer = currentPlayers.find(p => p.id === msg.playerId);
      if (actedPlayer) {
        actedPlayer.lastAction = msg.action;
        actedPlayer.currentBet = msg.amount;
        actedPlayer.chips = msg.playerChips;
        if (msg.action === 'fold') actedPlayer.hasFolded = true;
        if (msg.action === 'all-in') actedPlayer.isAllIn = true;
      }
      currentPot = msg.pot;
      renderPot();
      renderSeats();
      addChatMessage('', `${getPlayerName(msg.playerId)} ${formatAction(msg.action, msg.amount)}`);
      break;
    }

    case 'pot_update':
      currentPot = msg.pot;
      // Reset displayed player bets (bets collected into pot at round change)
      for (const p of currentPlayers) {
        p.currentBet = 0;
        p.lastAction = undefined;
      }
      renderPot();
      renderSeats();
      break;

    case 'showdown':
      handleShowdown(msg.results);
      break;

    case 'hand_end':
      handInProgress = false;
      activePlayerId = '';
      currentPlayers = msg.players;
      actionBar!.hide();
      renderSeats();
      if (isHost) {
        updateDealButton();
        // Auto-deal next hand after a short delay
        setTimeout(() => {
          if (host?.canDeal()) {
            host.dealHand();
          }
        }, 4000);
      }
      break;

    case 'chat':
      addChatMessage(msg.from, msg.message);
      break;

    case 'error':
      addChatMessage('System', msg.message);
      break;
  }
}

function handleShowdown(results: ShowdownResult[]): void {
  for (const result of results) {
    const pName = getPlayerName(result.playerId);
    if (result.winAmount > 0) {
      const handName = result.hand ? ` with ${result.hand.name}` : '';
      addChatMessage('', `🏆 ${pName} wins $${result.winAmount}${handName}`);
    }
    if (result.cards.length > 0) {
      const cardStr = result.cards.map(c => `${c.rank}${SUIT_SYMBOLS[c.suit]}`).join(' ');
      addChatMessage('', `${pName} shows: ${cardStr}`);
    }
  }
  renderShowdownCards(results);
}

// ═══════════════════════════════════════
//  SEAT RENDERING
// ═══════════════════════════════════════
function setupSeats(): void {
  for (let i = 0; i < 6; i++) {
    const seatEl = document.querySelector(`.seat-${i}`) as HTMLElement;
    seatEl.addEventListener('click', () => {
      if (mySeatIndex >= 0) return;
      const occupied = currentPlayers.some(p => p.seatIndex === i);
      if (occupied) return;

      if (isHost) {
        host?.sitHost(i);
        mySeatIndex = i;
      } else {
        peer?.sit(i);
        mySeatIndex = i;
      }
    });
  }
}

function updateMySeat(): void {
  const me = currentPlayers.find(p => p.id === myId);
  mySeatIndex = me ? me.seatIndex : -1;
}

function renderSeats(): void {
  updateMySeat();

  for (let i = 0; i < 6; i++) {
    const seatEl = document.querySelector(`.seat-${i}`) as HTMLElement;
    const player = currentPlayers.find(p => p.seatIndex === i);

    if (!player) {
      seatEl.innerHTML = `
        <div class="seat-box empty">
          <span class="seat-empty-label">${mySeatIndex >= 0 ? 'Empty' : 'Sit Here'}</span>
        </div>
      `;
      continue;
    }

    const isMe = player.id === myId;
    const isActive = player.id === activePlayerId;
    const classes = [
      'seat-box', 'occupied',
      isActive ? 'active-turn' : '',
      player.hasFolded ? 'folded' : '',
    ].filter(Boolean).join(' ');

    // Cards
    let cardsHtml = '';
    if (handInProgress && !player.hasFolded) {
      if (isMe && myHoleCards.length === 2) {
        cardsHtml = `<div class="seat-cards">${myHoleCards.map(c => cardHtml(c, 'sm')).join('')}</div>`;
      } else if (!isMe) {
        cardsHtml = `<div class="seat-cards">
          <div class="card card-back card-sm"></div>
          <div class="card card-back card-sm"></div>
        </div>`;
      }
    }

    // Action label
    let actionLabel = '';
    if (player.lastAction && handInProgress) {
      actionLabel = `<span class="seat-action-label">${fmtActionShort(player.lastAction)}</span>`;
    }

    // Badge
    let badge = getBadgeHtml(i);

    // Bet
    let betHtml = '';
    if (player.currentBet > 0 && handInProgress) {
      betHtml = `<span class="seat-bet">$${player.currentBet}</span>`;
    }

    seatEl.innerHTML = `
      <div class="${classes}" style="position:relative;">
        ${badge}
        <span class="seat-name">${esc(player.name)}${isMe ? ' (You)' : ''}</span>
        <span class="seat-chips">$${player.chips}</span>
        ${cardsHtml}
        ${actionLabel}
        ${betHtml}
      </div>
    `;
  }
}

function getBadgeHtml(seatIndex: number): string {
  if (!handInProgress) return '';

  const seated = currentPlayers.filter(p => !p.hasFolded || p.seatIndex === seatIndex)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  const dealerIdx = seated.findIndex(p => p.seatIndex === dealerSeat);
  if (dealerIdx < 0) return '';

  if (seatIndex === dealerSeat) {
    return '<span class="seat-badge badge-dealer">D</span>';
  }

  const n = seated.length;
  if (n === 2) {
    // Heads-up: dealer = SB
    const otherIdx = (dealerIdx + 1) % n;
    if (seated[otherIdx]?.seatIndex === seatIndex) {
      return '<span class="seat-badge badge-bb">BB</span>';
    }
  } else {
    const sbIdx = (dealerIdx + 1) % n;
    const bbIdx = (dealerIdx + 2) % n;
    if (seated[sbIdx]?.seatIndex === seatIndex) {
      return '<span class="seat-badge badge-sb">SB</span>';
    }
    if (seated[bbIdx]?.seatIndex === seatIndex) {
      return '<span class="seat-badge badge-bb">BB</span>';
    }
  }
  return '';
}

function renderShowdownCards(results: ShowdownResult[]): void {
  for (const result of results) {
    if (result.cards.length === 0) continue;
    const player = currentPlayers.find(p => p.id === result.playerId);
    if (!player || player.id === myId) continue;

    const seatEl = document.querySelector(`.seat-${player.seatIndex}`) as HTMLElement;
    const cardsContainer = seatEl.querySelector('.seat-cards');
    if (cardsContainer) {
      cardsContainer.innerHTML = result.cards.map(c => cardHtml(c, 'sm')).join('');
    }
  }

  // Highlight winners
  for (const result of results) {
    if (result.winAmount <= 0) continue;
    const player = currentPlayers.find(p => p.id === result.playerId);
    if (!player) continue;
    const seatEl = document.querySelector(`.seat-${player.seatIndex}`) as HTMLElement;
    const box = seatEl.querySelector('.seat-box');
    if (box) {
      box.classList.add('winner');
      setTimeout(() => box.classList.remove('winner'), 4000);
    }
  }
}

// ── Community Cards ──
function renderCommunityCards(): void {
  const container = document.getElementById('community-cards')!;
  container.innerHTML = '';
  for (let i = 0; i < communityCards.length; i++) {
    const el = createCardElement(communityCards[i], 'lg');
    el.classList.add('dealing');
    el.style.animationDelay = `${i * 0.1}s`;
    container.appendChild(el);
  }
}

// ── Pot ──
function renderPot(): void {
  const potDisplay = document.getElementById('pot-display')!;
  potDisplay.textContent = currentPot > 0 ? `Pot: $${currentPot}` : '';
}

// ── Deal Button ──
function updateDealButton(): void {
  if (!isHost) return;
  const btnDeal = document.getElementById('btn-deal') as HTMLButtonElement;
  const hostControls = document.getElementById('host-controls')!;

  if (host?.canDeal()) {
    btnDeal.classList.remove('hidden');
    hostControls.classList.remove('hidden');
  } else {
    btnDeal.classList.add('hidden');
    hostControls.classList.add('hidden');
  }
}

// ── Chat ──
function setupChat(): void {
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;
  const btnSend = document.getElementById('btn-chat-send') as HTMLButtonElement;

  const sendMessage = () => {
    const msg = chatInput.value.trim();
    if (!msg) return;
    if (isHost) {
      host?.sendChat(msg);
    } else {
      peer?.chat(msg);
      addChatMessage(playerName, msg);
    }
    chatInput.value = '';
  };

  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

function addChatMessage(from: string, message: string): void {
  const container = document.getElementById('chat-messages')!;
  const el = document.createElement('div');
  el.className = 'chat-msg';
  if (from) {
    el.innerHTML = `<span class="chat-author">${esc(from)}:</span> ${esc(message)}`;
  } else {
    el.innerHTML = esc(message);
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function cardHtml(card: Card, size: 'sm' | 'md' | 'lg'): string {
  const sc = size === 'sm' ? 'card-sm' : size === 'lg' ? 'card-lg' : '';
  return `<div class="card card-front ${card.suit} ${sc}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>
  </div>`;
}

function getPlayerName(id: string): string {
  return currentPlayers.find(p => p.id === id)?.name || 'Unknown';
}

function formatAction(action: PlayerAction, amount: number): string {
  switch (action) {
    case 'fold': return 'folds';
    case 'check': return 'checks';
    case 'call': return `calls $${amount}`;
    case 'raise': return `raises to $${amount}`;
    case 'all-in': return `goes all-in for $${amount}`;
  }
}

function fmtActionShort(action: PlayerAction): string {
  const map: Record<PlayerAction, string> = {
    'fold': 'FOLD', 'check': 'CHECK', 'call': 'CALL',
    'raise': 'RAISE', 'all-in': 'ALL IN',
  };
  return map[action] || String(action).toUpperCase();
}

function esc(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  showView('landing');
  initLanding();
});

