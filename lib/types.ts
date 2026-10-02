export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
}

export interface Participant {
  id: string; // peerId or uid
  uid: string;
  name: string;
  email?: string | null;
  photoURL?: string | null;
  isHost: boolean;
  isCoHost?: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isHandRaised: boolean;
  isMutedByHost: boolean;
  joinedAt: number;
}

export interface TranscriptItem {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  translation?: string;
  timestamp: number;
  isFinal: boolean;
}

export interface WaitingParticipant {
  id: string; // peerId or uid
  uid: string;
  name: string;
  photoURL?: string | null;
  status: 'waiting' | 'admitted' | 'denied';
  audioEnabled: boolean;
  videoEnabled: boolean;
  requestedAt: number;
}

export interface RoomSettings {
  roomId: string;
  hostId: string;
  hostName: string;
  title: string;
  isLocked: boolean;
  allowScreenShare: boolean;
  allowChat: boolean;
  allowUnmute: boolean;
  requireVideo?: boolean;
  waitingRoomEnabled?: boolean;
  hostJoined?: boolean;
  createdAt: number;
  endedAt?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string | null;
  text: string;
  timestamp: number;
  isSystem?: boolean;
  to?: string; // 'everyone' or specific participant id
}

export interface ReactionItem {
  id: string;
  emoji: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

export interface WhiteboardDrawEvent {
  type: 'draw' | 'clear';
  prevX?: number;
  prevY?: number;
  currX?: number;
  currY?: number;
  color?: string;
  lineWidth?: number;
}

export type ParticipantUpdatePayload = Partial<Participant> & { targetPeerId?: string };

export type SignalPayload =
  | RTCSessionDescriptionInit
  | RTCIceCandidateInit
  | WhiteboardDrawEvent
  | TranscriptItem
  | ParticipantUpdatePayload
  | { reason?: string; remainingSeconds?: number };

export interface DataMessage {
  type: string;
  event?: WhiteboardDrawEvent;
  item?: TranscriptItem;
  reason?: string;
  participantId?: string;
  updates?: Partial<Participant>;
  [key: string]: unknown;
}

export interface SignalData {
  from: string;
  to: string;
  type: 'offer' | 'answer' | 'candidate' | 'mute-command' | 'kick-command' | 'whiteboard' | 'participant-update' | 'transcript-chunk' | 'meeting-concluding';
  payload: SignalPayload;
  timestamp: number;
}

export interface ErrorLike {
  code?: string;
  message?: string;
}
