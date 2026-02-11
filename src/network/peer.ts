import Peer, { DataConnection } from 'peerjs';
import { HostMessage, PeerMessage } from '../game/types';
import { createClientPeer, connectToHost } from './connection';
import { serialize, deserializeHostMessage } from './messages';

export class PokerPeer {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private _playerId: string = '';
  private playerName: string;
  private roomCode: string;

  // Callbacks for UI
  onConnected: (() => void) | null = null;
  onDisconnected: (() => void) | null = null;
  onMessage: ((msg: HostMessage) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor(playerName: string, roomCode: string) {
    this.playerName = playerName;
    this.roomCode = roomCode.toUpperCase();
  }

  async connect(): Promise<void> {
    this.peer = await createClientPeer();
    this._playerId = this.peer.id;

    this.conn = await connectToHost(this.peer, this.roomCode);

    this.conn.on('data', (data) => {
      try {
        const msg = deserializeHostMessage(data as string);
        this.onMessage?.(msg);
      } catch (e) {
        console.error('Failed to parse host message:', e);
      }
    });

    this.conn.on('close', () => {
      this.onDisconnected?.();
    });

    this.conn.on('error', () => {
      this.onError?.('Connection error');
    });

    // Send join message
    this.send({ type: 'join', name: this.playerName });
    this.onConnected?.();
  }

  send(msg: PeerMessage): void {
    if (this.conn && this.conn.open) {
      this.conn.send(serialize(msg));
    }
  }

  sit(seatIndex: number): void {
    this.send({ type: 'sit', seatIndex, name: this.playerName });
  }

  stand(): void {
    this.send({ type: 'stand' });
  }

  ready(): void {
    this.send({ type: 'ready' });
  }

  action(action: string, amount?: number): void {
    this.send({ type: 'action', action: action as any, amount });
  }

  chat(message: string): void {
    this.send({ type: 'chat', message });
  }

  get playerId(): string {
    return this._playerId;
  }

  get isHost(): boolean {
    return false;
  }

  get code(): string {
    return this.roomCode;
  }

  destroy(): void {
    this.conn?.close();
    this.peer?.destroy();
  }
}

