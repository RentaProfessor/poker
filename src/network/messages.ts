import { HostMessage, PeerMessage } from '../game/types';

/**
 * Serialize a message for sending over WebRTC data channel.
 */
export function serialize(msg: HostMessage | PeerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Deserialize a message received from WebRTC data channel.
 */
export function deserializeHostMessage(data: string): HostMessage {
  return JSON.parse(data) as HostMessage;
}

export function deserializePeerMessage(data: string): PeerMessage {
  return JSON.parse(data) as PeerMessage;
}

