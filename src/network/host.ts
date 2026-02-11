import Peer, { DataConnection } from 'peerjs';
import { GameEngine, GameEvent } from '../game/game-engine';
import { HostMessage, PeerMessage, PlayerInfo } from '../game/types';
import { createHostPeer, generateRoomCode } from './connection';
import { serialize, deserializePeerMessage } from './messages';

interface ConnectedPeer {
  id: string;
  conn: DataConnection;
  name: string;
  isReady: boolean;
}

export class PokerHost {
  private peer: Peer | null = null;
  private peers: Map<string, ConnectedPeer> = new Map();
  private engine: GameEngine | null = null;
  private roomCode: string = '';
  private hostName: string;
  private hostId: string = 'host';

  // Callbacks for UI updates
  onRoomCreated: ((code: string) => void) | null = null;
  onPlayersChanged: ((players: PlayerInfo[]) => void) | null = null;
  onGameEvent: ((event: GameEvent) => void) | null = null;
  onHostMessage: ((msg: HostMessage) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onChat: ((from: string, message: string) => void) | null = null;

  constructor(hostName: string) {
    this.hostName = hostName;
  }

  async createRoom(): Promise<string> {
    this.roomCode = generateRoomCode();

    try {
      this.peer = await createHostPeer(this.roomCode);
    } catch {
      // If peer ID is taken, try again with a new code
      this.roomCode = generateRoomCode();
      this.peer = await createHostPeer(this.roomCode);
    }

    this.hostId = this.peer.id;

    // Create game engine
    this.engine = new GameEngine(this.roomCode, this.hostId, (event) => {
      this.handleGameEvent(event);
    });

    // Listen for incoming connections
    this.peer.on('connection', (conn) => {
      this.handleNewConnection(conn);
    });

    this.peer.on('disconnected', () => {
      // Try to reconnect
      this.peer?.reconnect();
    });

    this.onRoomCreated?.(this.roomCode);
    return this.roomCode;
  }

  private handleNewConnection(conn: DataConnection): void {
    const peerId = conn.peer;

    conn.on('open', () => {
      const connectedPeer: ConnectedPeer = {
        id: peerId,
        conn,
        name: '',
        isReady: false,
      };
      this.peers.set(peerId, connectedPeer);
    });

    conn.on('data', (data) => {
      try {
        const msg = deserializePeerMessage(data as string);
        this.handlePeerMessage(peerId, msg);
      } catch (e) {
        console.error('Failed to parse peer message:', e);
      }
    });

    conn.on('close', () => {
      this.handlePeerDisconnect(peerId);
    });

    conn.on('error', () => {
      this.handlePeerDisconnect(peerId);
    });
  }

  private handlePeerMessage(peerId: string, msg: PeerMessage): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    switch (msg.type) {
      case 'join':
        peer.name = msg.name;
        this.sendTo(peerId, {
          type: 'room_update',
          players: this.getPlayerInfoList(),
          hostId: this.hostId,
          roomCode: this.roomCode,
        });
        this.broadcastPlayerUpdate();
        break;

      case 'sit':
        if (this.engine) {
          const success = this.engine.addPlayer(peerId, msg.name || peer.name, msg.seatIndex);
          if (!success) {
            this.sendTo(peerId, { type: 'error', message: 'Seat is taken or invalid' });
          }
          this.broadcastPlayerUpdate();
        }
        break;

      case 'stand':
        if (this.engine) {
          this.engine.removePlayer(peerId);
          this.broadcastPlayerUpdate();
        }
        break;

      case 'ready':
        peer.isReady = true;
        this.broadcastPlayerUpdate();
        break;

      case 'action':
        if (this.engine) {
          const success = this.engine.handleAction(peerId, msg.action, msg.amount);
          if (!success) {
            this.sendTo(peerId, { type: 'error', message: 'Invalid action' });
          }
        }
        break;

      case 'chat': {
        const chatMsg: HostMessage = { type: 'chat', from: peer.name, message: msg.message };
        // Broadcast to all peers EXCEPT the sender (sender already shows it locally)
        this.broadcastExcept(peerId, chatMsg);
        this.onChat?.(peer.name, msg.message);
        break;
      }
    }
  }

  private handlePeerDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    this.peers.delete(peerId);

    if (this.engine) {
      this.engine.setPlayerConnected(peerId, false);
      this.engine.removePlayer(peerId);
      this.broadcastPlayerUpdate();
    }

    if (peer) {
      this.broadcast({ type: 'chat', from: 'System', message: `${peer.name} disconnected` });
    }
  }

  private handleGameEvent(event: GameEvent): void {
    this.onGameEvent?.(event);

    switch (event.type) {
      case 'hand_start':
        this.broadcast({
          type: 'hand_start',
          dealerSeat: event.dealerSeat,
          handNumber: event.handNumber,
          players: event.players,
        });
        // Also send to host UI
        this.onHostMessage?.({
          type: 'hand_start',
          dealerSeat: event.dealerSeat,
          handNumber: event.handNumber,
          players: event.players,
        });
        break;

      case 'hole_cards':
        // Send hole cards only to the specific player
        if (event.playerId === this.hostId) {
          this.onHostMessage?.({
            type: 'hole_cards',
            cards: event.cards,
          });
        } else {
          this.sendTo(event.playerId, {
            type: 'hole_cards',
            cards: event.cards,
          });
        }
        break;

      case 'community':
        this.broadcast({ type: 'community', cards: event.cards, round: event.round });
        this.onHostMessage?.({ type: 'community', cards: event.cards, round: event.round });
        break;

      case 'action_on':
        this.broadcast({
          type: 'action_on',
          playerId: event.playerId,
          validActions: event.validActions,
          pot: event.pot,
          currentBet: event.currentBet,
          timeDeadline: event.timeDeadline,
        });
        this.onHostMessage?.({
          type: 'action_on',
          playerId: event.playerId,
          validActions: event.validActions,
          pot: event.pot,
          currentBet: event.currentBet,
          timeDeadline: event.timeDeadline,
        });
        break;

      case 'player_acted':
        this.broadcast({
          type: 'player_acted',
          playerId: event.playerId,
          action: event.action,
          amount: event.amount,
          pot: event.pot,
          playerChips: event.playerChips,
        });
        this.onHostMessage?.({
          type: 'player_acted',
          playerId: event.playerId,
          action: event.action,
          amount: event.amount,
          pot: event.pot,
          playerChips: event.playerChips,
        });
        break;

      case 'pot_update':
        this.broadcast({ type: 'pot_update', pot: event.pot, sidePots: event.sidePots });
        this.onHostMessage?.({ type: 'pot_update', pot: event.pot, sidePots: event.sidePots });
        break;

      case 'showdown':
        this.broadcast({ type: 'showdown', results: event.results });
        this.onHostMessage?.({ type: 'showdown', results: event.results });
        break;

      case 'hand_end':
        this.broadcast({ type: 'hand_end', players: event.players });
        this.onHostMessage?.({ type: 'hand_end', players: event.players });
        break;
    }
  }

  // ── Host player actions (host plays too) ──

  sitHost(seatIndex: number): boolean {
    if (!this.engine) return false;
    const success = this.engine.addPlayer(this.hostId, this.hostName, seatIndex);
    this.broadcastPlayerUpdate();
    return success;
  }

  standHost(): void {
    if (!this.engine) return;
    this.engine.removePlayer(this.hostId);
    this.broadcastPlayerUpdate();
  }

  hostAction(action: string, amount?: number): boolean {
    if (!this.engine) return false;
    return this.engine.handleAction(this.hostId, action as any, amount);
  }

  dealHand(): void {
    if (!this.engine) return;
    if (this.engine.canStartHand()) {
      this.engine.startHand();
    }
  }

  canDeal(): boolean {
    return this.engine?.canStartHand() ?? false;
  }

  sendChat(message: string): void {
    const chatMsg: HostMessage = { type: 'chat', from: this.hostName, message };
    this.broadcast(chatMsg);
    this.onChat?.(this.hostName, message);
  }

  // ── Helpers ──

  private sendTo(peerId: string, msg: HostMessage): void {
    const peer = this.peers.get(peerId);
    if (peer && peer.conn.open) {
      peer.conn.send(serialize(msg));
    }
  }

  private broadcast(msg: HostMessage): void {
    const data = serialize(msg);
    for (const peer of this.peers.values()) {
      if (peer.conn.open) {
        peer.conn.send(data);
      }
    }
  }

  private broadcastExcept(excludeId: string, msg: HostMessage): void {
    const data = serialize(msg);
    for (const [id, peer] of this.peers.entries()) {
      if (id !== excludeId && peer.conn.open) {
        peer.conn.send(data);
      }
    }
  }

  private broadcastPlayerUpdate(): void {
    const players = this.getPlayerInfoList();
    const msg: HostMessage = {
      type: 'room_update',
      players,
      hostId: this.hostId,
      roomCode: this.roomCode,
    };
    this.broadcast(msg);
    this.onPlayersChanged?.(players);
  }

  private getPlayerInfoList(): PlayerInfo[] {
    const enginePlayers = this.engine?.gameState.players ?? [];
    return enginePlayers.map(p => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      chips: p.chips,
      isConnected: p.isConnected,
      isReady: p.id === this.hostId ? true : (this.peers.get(p.id)?.isReady ?? false),
    }));
  }

  get isHost(): boolean {
    return true;
  }

  get playerId(): string {
    return this.hostId;
  }

  get code(): string {
    return this.roomCode;
  }

  get engine_ref(): GameEngine | null {
    return this.engine;
  }

  destroy(): void {
    this.engine?.destroy();
    for (const peer of this.peers.values()) {
      peer.conn.close();
    }
    this.peer?.destroy();
  }
}

