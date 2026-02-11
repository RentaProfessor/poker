import Peer, { DataConnection } from 'peerjs';

const PEER_ID_PREFIX = 'poker-room-';

// Multiple STUN servers for reliable NAT traversal over the internet
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

/**
 * Generate a short 6-character room code.
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const values = new Uint8Array(6);
  crypto.getRandomValues(values);
  return Array.from(values).map(v => chars[v % chars.length]).join('');
}

/**
 * Convert room code to PeerJS peer ID.
 */
export function roomCodeToPeerId(code: string): string {
  return PEER_ID_PREFIX + code.toUpperCase();
}

/**
 * Create a PeerJS peer as the host (room creator).
 * The peer ID is derived from the room code so others can connect.
 */
export function createHostPeer(roomCode: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peerId = roomCodeToPeerId(roomCode);
    const peer = new Peer(peerId, {
      debug: 0,
      config: ICE_SERVERS,
    });

    peer.on('open', () => {
      resolve(peer);
    });

    peer.on('error', (err) => {
      reject(err);
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      reject(new Error('Could not connect to signaling server. Check your internet connection.'));
    }, 15000);
  });
}

/**
 * Create a PeerJS peer as a client and connect to the host.
 */
export function createClientPeer(): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({
      debug: 0,
      config: ICE_SERVERS,
    });

    peer.on('open', () => {
      resolve(peer);
    });

    peer.on('error', (err) => {
      reject(err);
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      reject(new Error('Could not connect to signaling server. Check your internet connection.'));
    }, 15000);
  });
}

/**
 * Connect to a host peer by room code.
 */
export function connectToHost(peer: Peer, roomCode: string): Promise<DataConnection> {
  return new Promise((resolve, reject) => {
    const hostPeerId = roomCodeToPeerId(roomCode);
    const conn = peer.connect(hostPeerId, {
      reliable: true,
    });

    conn.on('open', () => {
      resolve(conn);
    });

    conn.on('error', (err) => {
      reject(err);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      reject(new Error('Connection timeout - room may not exist'));
    }, 10000);
  });
}

