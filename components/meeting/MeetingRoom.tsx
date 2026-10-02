'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useStableCallback } from '@/lib/useStableCallback';
import { useRouter } from 'next/navigation';
import { Participant, RoomSettings, ChatMessage, ReactionItem, WaitingParticipant, TranscriptItem } from '@/lib/types';
import { WebRTCManager } from '@/lib/webrtc';
import { LiveKitRoomManager } from '@/lib/livekitService';
import { LiveTranscriptionService } from '@/lib/transcriptionService';
import {
  getOrCreateRoom,
  updateRoomSettings,
  subscribeToRoomSettings,
  sendChatMessage,
  subscribeToChatMessages,
  sendReaction,
  subscribeToReactions,
  subscribeToWaitingRoom,
  admitParticipant,
  denyParticipant,
  admitAllParticipants,
  updateHostPresence,
  updateParticipantRole,
  registerParticipant,
  saveRoomTranscriptItem,
} from '@/lib/roomService';
import { isHindiText, formatCaptionForUserPreference, translateText } from '@/lib/translation';
import { useAuth } from '@/lib/authContext';
import { VideoGrid } from './VideoGrid';
import { MeetingControls } from './MeetingControls';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { WhiteboardModal, WhiteboardDrawEvent } from './WhiteboardModal';
import { HostControlModal } from './HostControlModal';
import { ShareMeetingModal } from './ShareMeetingModal';
import { RecordModal } from './RecordModal';
import { LeaveMeetingModal } from './LeaveMeetingModal';
import { WaitingRoomBanner } from './WaitingRoomBanner';
import { ReactionsOverlay } from './ReactionsOverlay';
import {
  Copy,
  Check,
  Share2,
  ShieldCheck,
  ChevronDown,
  LayoutTemplate,
  LayoutGrid,
  Grid2X2,
  Maximize,
  Minimize,
  Zap,
  Lock,
} from 'lucide-react';

interface MeetingRoomProps {
  roomId: string;
  initialParticipant: Participant;
  initialStream: MediaStream | null;
}

export function MeetingRoom({
  roomId,
  initialParticipant,
  initialStream,
}: MeetingRoomProps) {
  const router = useRouter();

  // Participant & Stream state
  const [localParticipant, setLocalParticipant] = useState<Participant>(initialParticipant);
  const [localStream, setLocalStream] = useState<MediaStream | null>(initialStream);
  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());

  // Room settings & Realtime data
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(() => ({
    roomId,
    hostId: initialParticipant.isHost ? initialParticipant.id : '',
    hostName: initialParticipant.isHost ? initialParticipant.name : '',
    title: `Sabha ${roomId}`,
    isLocked: false,
    allowScreenShare: true,
    allowChat: true,
    allowUnmute: true,
    createdAt: Date.now(),
  }));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [latestReaction, setLatestReaction] = useState<ReactionItem | null>(null);

  const { user } = useAuth();

  // Panels & Modals
  const [isChatOpen, setIsChatOpen] = useState(false);
  const isChatOpenRef = useRef(isChatOpen);
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [waitingList, setWaitingList] = useState<WaitingParticipant[]>([]);
  const [incomingDrawEvent, setIncomingDrawEvent] = useState<WhiteboardDrawEvent | null>(null);

  // Recording State & Audio Mixing
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const recordingDisplayStreamRef = useRef<MediaStream | null>(null);
  const recordingMicStreamRef = useRef<MediaStream | null>(null);

  // Meeting duration timer & Zoom View mode state
  const [duration, setDuration] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isLiveKitSFU, setIsLiveKitSFU] = useState(false);

  // Live Speech-to-Text Transcription & Captions
  const [, setTranscript] = useState<TranscriptItem[]>([]);
  const transcriptRef = useRef<TranscriptItem[]>([]);
  const [isCaptionsOn, setIsCaptionsOn] = useState<boolean>(true);
  const [isBraveActive, setIsBraveActive] = useState<boolean>(false);
  const [dismissBraveNotice, setDismissBraveNotice] = useState<boolean>(false);
  const [captionLanguage, setCaptionLanguage] = useState<string>('dual');
  const captionLanguageRef = useRef<string>(captionLanguage);
  useEffect(() => {
    captionLanguageRef.current = captionLanguage;
  }, [captionLanguage]);

  // Subtitle Anti-Flicker Debounce & Display State
  const captionDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteCaptionDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (captionDebounceTimerRef.current) clearTimeout(captionDebounceTimerRef.current);
      if (remoteCaptionDebounceTimerRef.current) clearTimeout(remoteCaptionDebounceTimerRef.current);
      if (captionFadeTimerRef.current) clearTimeout(captionFadeTimerRef.current);
    };
  }, []);

  const [latestLiveCaption, setLatestLiveCaption] = useState<{
    senderName: string;
    text: string;
    translation?: string;
    badgeLabel?: string;
  } | null>(null);
  const captionFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionServiceRef = useRef<LiveTranscriptionService | null>(null);

  const handleUpdateLiveCaption = useStableCallback((
    senderName: string,
    text: string,
    translation?: string,
    badgeLabel?: string
  ) => {
    const activeTarget = captionLanguageRef.current || 'dual';

    // STRICT ZERO-HINDI GUARD for English Only mode:
    // If user has selected English Only, NEVER display Devanagari / Hindi script!
    if (activeTarget === 'english_only' && (isHindiText(text) || isHindiText(translation || ''))) {
      const textToTranslate = isHindiText(text) ? text : (translation || text);
      translateText(textToTranslate, 'hi', 'en')
        .then((eng) => {
          if (eng && !isHindiText(eng)) {
            setLatestLiveCaption({ senderName, text: eng, translation: undefined, badgeLabel: 'English' });
            if (captionFadeTimerRef.current) clearTimeout(captionFadeTimerRef.current);
            captionFadeTimerRef.current = setTimeout(() => setLatestLiveCaption(null), 6000);
          }
        })
        .catch(() => {});
      return;
    }

    setLatestLiveCaption({ senderName, text, translation, badgeLabel });
    if (captionFadeTimerRef.current) {
      clearTimeout(captionFadeTimerRef.current);
    }
    // Hold caption on screen for 6 seconds so user has ample time to read without rushing
    // Ref mutation inside an event-time handler (never during render) is valid; the compiler lint misreads it
    // eslint-disable-next-line react-hooks/immutability
    captionFadeTimerRef.current = setTimeout(() => {
      setLatestLiveCaption(null);
    }, 6000);
  });

  const handleAppendTranscriptItem = (item: TranscriptItem) => {
    if (!item || !item.text) return;

    const activeTarget = captionLanguageRef.current || 'dual';

    // Handle interim results with anti-flicker debouncing
    if (!item.isFinal) {
      const words = item.text.trim().split(/\s+/);
      if (words.length < 2 || item.text.trim().length < 4) return;

      if (remoteCaptionDebounceTimerRef.current) {
        clearTimeout(remoteCaptionDebounceTimerRef.current);
      }
      remoteCaptionDebounceTimerRef.current = setTimeout(() => {
        // In English only mode, if item.text is already in English, render immediately with 0ms delay
        if (activeTarget === 'english_only') {
          if (!isHindiText(item.text)) {
            handleUpdateLiveCaption(item.senderName, item.text, undefined, 'English');
            return;
          }
          translateText(item.text, 'hi', 'en').then((eng) => {
            handleUpdateLiveCaption(item.senderName, eng, undefined, 'English');
          }).catch(() => {});
          return;
        }

        const sourceText = item.translation || item.text;
        formatCaptionForUserPreference(sourceText, activeTarget)
          .then(({ primaryText, secondaryText, badgeLabel }) => {
            if (primaryText) {
              handleUpdateLiveCaption(item.senderName, primaryText, secondaryText, badgeLabel);
            }
          })
          .catch(() => {});
      }, 280);
      return;
    }

    // Finalized item from remote peer: clear interim debounce and render
    if (remoteCaptionDebounceTimerRef.current) {
      clearTimeout(remoteCaptionDebounceTimerRef.current);
      remoteCaptionDebounceTimerRef.current = null;
    }

    transcriptRef.current.push(item);
    setTranscript((prev) => [...prev, item]);
    saveRoomTranscriptItem(roomId, item).catch(() => {});

    // In English only mode, if item.text is already English, render immediately
    if (activeTarget === 'english_only') {
      if (!isHindiText(item.text)) {
        handleUpdateLiveCaption(item.senderName, item.text, undefined, 'English');
        return;
      }
      translateText(item.text, 'hi', 'en').then((eng) => {
        handleUpdateLiveCaption(item.senderName, eng, undefined, 'English');
      }).catch(() => {});
      return;
    }

    const sourceText = item.translation || item.text;
    formatCaptionForUserPreference(sourceText, activeTarget)
      .then(({ primaryText, secondaryText, badgeLabel }) => {
        if (primaryText) {
          handleUpdateLiveCaption(item.senderName, primaryText, secondaryText, badgeLabel);
        }
      })
      .catch((err) => {
        console.warn('[Captions] Translation notice:', err);
      });
  };

  const handleAppendTranscriptItemRef = useRef(handleAppendTranscriptItem);
  useEffect(() => {
    handleAppendTranscriptItemRef.current = handleAppendTranscriptItem;
  });

  // Zoom-style View Switcher & Top-Bar State
  const [viewMode, setViewMode] = useState<'gallery' | 'speaker' | 'multi-speaker'>('gallery');
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showMeetingInfo, setShowMeetingInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const meetingInfoRef = useRef<HTMLDivElement>(null);

  // Click-outside listeners for top-bar dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
      if (meetingInfoRef.current && !meetingInfoRef.current.contains(e.target as Node)) {
        setShowMeetingInfo(false);
      }
    }
    if (showViewMenu || showMeetingInfo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showViewMenu, showMeetingInfo]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
    setShowViewMenu(false);
  };

  const rtcManagerRef = useRef<WebRTCManager | null>(null);
  const liveKitManagerRef = useRef<LiveKitRoomManager | null>(null);
  const initialStreamRef = useRef<MediaStream | null>(initialStream);
  const activeCameraStreamRef = useRef<MediaStream | null>(initialStream || null);

  // Initialize Room & Media Engine
  useEffect(() => {
    let active = true;

    async function init() {
      // 1. Fetch or initialize room data from Firestore
      const roomData = await getOrCreateRoom(
        roomId,
        user?.uid || '',
        user?.displayName || ''
      );

      if (active) {
        setRoomSettings(roomData);
      }

      // True Database Verification: user is host ONLY if their UID matches Firestore hostId
      const isVerifiedHost = Boolean(user?.uid && roomData.hostId && user.uid === roomData.hostId);

      if (active) {
        setLocalParticipant((prev) => ({ ...prev, isHost: isVerifiedHost }));
      }

      if (isVerifiedHost) {
        updateHostPresence(roomId, true).catch(() => {});
      }

      // Record participant identity & email in Firestore
      registerParticipant(roomId, {
        ...initialParticipant,
        isHost: isVerifiedHost,
      }).catch(() => {});

      // Check if room is locked and user is not verified host
      if (roomData.isLocked && !isVerifiedHost) {
        alert('This Sabha meeting has been locked by the host.');
        router.push('/');
        return;
      }

      // 2. Try LiveKit SFU first (handles 50 to 100+ participants)
      let connectedViaLiveKit = false;
      try {
        const identity = initialParticipant.id;
        const username = initialParticipant.name || initialParticipant.id;
        const res = await fetch(
          `/api/livekit-token?room=${encodeURIComponent(roomId)}&identity=${encodeURIComponent(identity)}&username=${encodeURIComponent(username)}&isHost=${isVerifiedHost}&photoURL=${encodeURIComponent(initialParticipant.photoURL || '')}&email=${encodeURIComponent(initialParticipant.email || '')}`
        );

        if (res.ok) {
          const data = await res.json();
          if (data.token && data.wsUrl && active) {
            const cleanWsUrl = (data.wsUrl || '').trim();
            const cleanToken = (data.token || '').trim();
            const lkManager = new LiveKitRoomManager(cleanWsUrl, cleanToken, initialParticipant);

            lkManager.onRemoteStreamAdded = (peerId, stream) => {
              setRemoteStreams((prev) => new Map(prev).set(peerId, new MediaStream(stream.getTracks())));
            };

            lkManager.onRemoteStreamRemoved = (peerId) => {
              setRemoteStreams((prev) => {
                const next = new Map(prev);
                next.delete(peerId);
                return next;
              });
            };

            // Dedicated screen sharing stream subscriptions
            lkManager.onRemoteScreenStreamAdded = (peerId, stream) => {
              setRemoteScreenStreams((prev) => new Map(prev).set(peerId, new MediaStream(stream.getTracks())));
            };

            lkManager.onRemoteScreenStreamRemoved = (peerId) => {
              setRemoteScreenStreams((prev) => {
                const next = new Map(prev);
                next.delete(peerId);
                return next;
              });
            };

            lkManager.onLocalScreenShareStopped = () => {
              setScreenStream(null);
              setLocalParticipant((p) => ({ ...p, screenSharing: false }));
            };

            lkManager.onParticipantsChanged = (participants) => {
              setRemoteParticipants(participants);
            };

            lkManager.onRoleChanged = (isCoHost) => {
              setLocalParticipant((p) => ({ ...p, isCoHost }));
              if (isCoHost) {
                alert('You have been made a Co-host (सह-सभापति) of this Sabha!');
              } else {
                alert('Your Co-host privileges were removed.');
              }
            };

            // Whiteboard & data packets
            lkManager.onDataReceived = (payload) => {
              if (payload?.type === 'whiteboard') {
                setIncomingDrawEvent(payload.event ?? null);
              } else if (payload?.type === 'transcript-chunk' && payload.item) {
                handleAppendTranscriptItemRef.current(payload.item);
              } else if (payload?.type === 'meeting-concluding') {
                if (transcriptionServiceRef.current) {
                  const flushed = transcriptionServiceRef.current.flushInterim();
                  if (flushed && flushed.length > 0) {
                    const flushedItem: TranscriptItem = {
                      id: `${localParticipant.id}_${Date.now()}_conclude_flush`,
                      senderId: localParticipant.id,
                      senderName: localParticipant.name || 'You',
                      text: flushed,
                      timestamp: Date.now(),
                      isFinal: true,
                    };
                    saveRoomTranscriptItem(roomId, flushedItem).catch(() => {});
                    liveKitManagerRef.current?.sendData({ type: 'transcript-chunk', item: flushedItem });
                  }
                }
              }
            };

            // Keep local stream synchronized with any track updates
            lkManager.onLocalStreamChanged = (stream) => {
              if (active && stream) {
                setLocalStream(new MediaStream(stream.getTracks()));
              }
            };

            lkManager.onKicked = (reason?: string) => {
              if (reason === 'meeting-ended') {
                alert('The host has ended this Sabha assembly.');
              } else {
                alert('You have been removed from this Sabha by the host.');
              }
              router.push('/');
            };

            await lkManager.connect();
            const lkLocalStream = await lkManager.publishLocalTracks(
              initialParticipant.audioEnabled,
              initialParticipant.videoEnabled,
              initialStreamRef.current
            );

            if (lkLocalStream && lkLocalStream.getTracks().length > 0) {
              setLocalStream(lkLocalStream);
            }

            liveKitManagerRef.current = lkManager;
            setIsLiveKitSFU(true);
            connectedViaLiveKit = true;
          }
        }
      } catch (err) {
        console.warn('LiveKit SFU connection attempt returned, falling back to WebRTC Mesh:', err);
        if (liveKitManagerRef.current) {
          liveKitManagerRef.current.disconnect().catch(() => {});
          liveKitManagerRef.current = null;
        }
        setIsLiveKitSFU(false);
        connectedViaLiveKit = false;
      }

      // 3. Fallback to WebRTC Mesh if LiveKit is not configured or fails
      if (!connectedViaLiveKit && active) {
        const manager = new WebRTCManager(roomId, initialParticipant);
        rtcManagerRef.current = manager;

        let meshStream: MediaStream | null = initialStreamRef.current;
        if (!meshStream || meshStream.getTracks().every((t) => t.readyState === 'ended')) {
          try {
            meshStream = await navigator.mediaDevices.getUserMedia({
              audio: initialParticipant.audioEnabled,
              video: initialParticipant.videoEnabled ? { width: 1280, height: 720 } : false,
            });
            if (active) {
              setLocalStream(meshStream);
            }
          } catch (err) {
            console.warn('Fallback WebRTC getUserMedia failed:', err);
          }
        }

        if (meshStream) {
          activeCameraStreamRef.current = meshStream;
          manager.setLocalStream(meshStream);
        }

        manager.onRemoteStreamAdded = (peerId, stream) => {
          setRemoteStreams((prev) => new Map(prev).set(peerId, new MediaStream(stream.getTracks())));
        };

        manager.onRemoteStreamRemoved = (peerId) => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        };

        manager.onRemoteScreenStreamAdded = (peerId, stream) => {
          setRemoteScreenStreams((prev) => new Map(prev).set(peerId, new MediaStream(stream.getTracks())));
        };

        manager.onRemoteScreenStreamRemoved = (peerId) => {
          setRemoteScreenStreams((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        };

        manager.onParticipantsChanged = (participants) => {
          const self = participants.find((p) => p.id === initialParticipant.id);
          if (self && self.isCoHost !== undefined) {
            setLocalParticipant((prev) => {
              if (prev.isCoHost !== self.isCoHost) {
                if (self.isCoHost) {
                  alert('You have been made a Co-host (सह-सभापति) of this Sabha!');
                } else if (prev.isCoHost) {
                  alert('Your Co-host privileges were removed.');
                }
                return { ...prev, isCoHost: self.isCoHost };
              }
              return prev;
            });
          }
          const others = participants.filter((p) => p.id !== initialParticipant.id);
          setRemoteParticipants(others);
        };

        manager.onMuteRequested = () => {
          if (localStream) {
            localStream.getAudioTracks().forEach((t) => (t.enabled = false));
          }
          setLocalParticipant((prev) => ({ ...prev, audioEnabled: false }));
          manager.updateParticipantState({ audioEnabled: false });
          alert('You have been muted by the host.');
        };

        manager.onKicked = (reason?: string) => {
          if (reason === 'meeting-ended') {
            alert('The host has ended this Sabha assembly.');
          } else {
            alert('You have been removed from this Sabha by the host.');
          }
          router.push('/');
        };

        manager.onWhiteboardReceived = (event) => {
          setIncomingDrawEvent(event);
        };

        manager.onTranscriptReceived = (item) => {
          handleAppendTranscriptItemRef.current(item);
        };

        manager.onMeetingConcluding = () => {
          if (transcriptionServiceRef.current) {
            const flushed = transcriptionServiceRef.current.flushInterim();
            if (flushed && flushed.length > 0) {
              const flushedItem: TranscriptItem = {
                id: `${localParticipant.id}_${Date.now()}_conclude_flush`,
                senderId: localParticipant.id,
                senderName: localParticipant.name || 'You',
                text: flushed,
                timestamp: Date.now(),
                isFinal: true,
              };
              saveRoomTranscriptItem(roomId, flushedItem).catch(() => {});
              manager.sendTranscriptItem(flushedItem);
            }
          }
        };

        await manager.joinRoom();
      }
    }

    init();

    // 4. Subscriptions
    const unsubSettings = subscribeToRoomSettings(roomId, (updated) => {
      setRoomSettings(updated);
    });

    const unsubChat = subscribeToChatMessages(roomId, (allMsgs) => {
      setMessages(allMsgs);
      if (!isChatOpenRef.current && allMsgs.length > 0) {
        setUnreadChatCount((c) => c + 1);
      }
    });

    const unsubReactions = subscribeToReactions(roomId, (rx) => {
      setLatestReaction(rx);
    });

    // 5. Duration timer
    const timer = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);

    // 6. Fast cleanup on app close, tab close, or navigation (beforeunload + pagehide)
    const handleCleanExit = () => {
      if (initialParticipant.isHost) {
        updateHostPresence(roomId, false).catch(() => {});
      }
      if (liveKitManagerRef.current) {
        liveKitManagerRef.current.disconnect();
      }
      if (rtcManagerRef.current) {
        rtcManagerRef.current.leaveRoom();
      }
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const payload = JSON.stringify({ roomId, participantId: initialParticipant.id });
        navigator.sendBeacon('/api/room/leave', new Blob([payload], { type: 'application/json' }));
      }
    };

    window.addEventListener('beforeunload', handleCleanExit);

    return () => {
      active = false;
      window.removeEventListener('beforeunload', handleCleanExit);
      if (initialParticipant.isHost) {
        updateHostPresence(roomId, false).catch(() => {});
      }
      if (liveKitManagerRef.current) {
        liveKitManagerRef.current.disconnect();
      }
      if (rtcManagerRef.current) {
        rtcManagerRef.current.leaveRoom();
      }
      clearInterval(timer);
      unsubSettings();
      unsubChat();
      unsubReactions();
    };
    // Intentionally keyed to the room/participant identity only: re-running would tear down and rejoin the call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, initialParticipant.id]);

  // Subscribe to waiting room for host and co-host
  useEffect(() => {
    if (!localParticipant.isHost && !localParticipant.isCoHost) return;
    const unsub = subscribeToWaitingRoom(roomId, (list) => {
      setWaitingList(list);
    });
    return () => unsub();
  }, [roomId, localParticipant.isHost, localParticipant.isCoHost]);

  // Reset unread chat count when chat opens (adjusted during render, not in an effect)
  const [prevChatOpen, setPrevChatOpen] = useState(isChatOpen);
  if (isChatOpen !== prevChatOpen) {
    setPrevChatOpen(isChatOpen);
    if (isChatOpen) setUnreadChatCount(0);
  }

  // Web Speech API & AI Audio Fallback Live Transcription (Brave Browser compatible)
  useEffect(() => {
    const service = new LiveTranscriptionService(captionLanguage);
    transcriptionServiceRef.current = service;

    service.setOnModeChange((brave) => {
      setIsBraveActive(brave);
    });

    service.setCallbacks((text, isFinal) => {
      // 1. Debounce and clean interim speech so partial syllables NEVER flash or flicker
      if (!isFinal) {
        if (text.trim().length < 4 || text.trim().split(/\s+/).length < 2) {
          return;
        }
        if (captionDebounceTimerRef.current) {
          clearTimeout(captionDebounceTimerRef.current);
        }
        captionDebounceTimerRef.current = setTimeout(() => {
          const targetLang = captionLanguageRef.current || 'dual';
          formatCaptionForUserPreference(text, targetLang)
            .then(({ primaryText, secondaryText, badgeLabel }) => {
              if (primaryText) {
                handleUpdateLiveCaption(localParticipant.name || 'You', primaryText, secondaryText, badgeLabel);
              }
            })
            .catch(() => {});
        }, 280);
        return;
      }

      // 2. Finalized speech: clear interim debounce timer
      if (captionDebounceTimerRef.current) {
        clearTimeout(captionDebounceTimerRef.current);
        captionDebounceTimerRef.current = null;
      }

      // Translate Devanagari/Hindi to English so transcripts are ALWAYS logged in English
      const processFinalized = async () => {
        let englishText = text;
        if (isHindiText(text)) {
          try {
            englishText = await translateText(text, 'hi', 'en');
          } catch {}
        }

        const baseItem: TranscriptItem = {
          id: `${localParticipant.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          senderId: localParticipant.id,
          senderName: localParticipant.name || 'You',
          text: englishText, // Transcripts are ALWAYS logged in English
          translation: text !== englishText ? text : undefined, // Spoken original preserved in translation field
          timestamp: Date.now(),
          isFinal: true,
        };

        // Broadcast to all peers
        if (liveKitManagerRef.current) {
          liveKitManagerRef.current.sendData({
            type: 'transcript-chunk',
            item: baseItem,
          });
        }
        if (rtcManagerRef.current) {
          rtcManagerRef.current.sendTranscriptItem(baseItem);
        }

        // Save to local transcript and Firestore
        transcriptRef.current.push(baseItem);
        setTranscript((prev) => [...prev, baseItem]);
        saveRoomTranscriptItem(roomId, baseItem).catch(() => {});

        // Format and render subtitle for 6 seconds in user's chosen target language
        const targetLang = captionLanguageRef.current || 'dual';
        formatCaptionForUserPreference(text, targetLang)
          .then(({ primaryText, secondaryText, badgeLabel }) => {
            if (primaryText) {
              handleUpdateLiveCaption(localParticipant.name || 'You', primaryText, secondaryText, badgeLabel);
            }
          })
          .catch(() => {});
      };

      processFinalized().catch(() => {});
    });

    if (localParticipant.audioEnabled) {
      service.start();
    }

    const transcript = transcriptRef.current;
    return () => {
      const flushed = service.flushInterim();
      if (flushed) {
        if (isHindiText(flushed)) {
          translateText(flushed, 'hi', 'en').then((res) => {
            const item: TranscriptItem = {
              id: `${localParticipant.id}_${Date.now()}_clean_flush`,
              senderId: localParticipant.id,
              senderName: localParticipant.name || 'You',
              text: res,
              translation: flushed !== res ? flushed : undefined,
              timestamp: Date.now(),
              isFinal: true,
            };
            transcript.push(item);
            saveRoomTranscriptItem(roomId, item).catch(() => {});
          }).catch(() => {});
        } else {
          const flushedItem: TranscriptItem = {
            id: `${localParticipant.id}_${Date.now()}_clean_flush`,
            senderId: localParticipant.id,
            senderName: localParticipant.name || 'You',
            text: flushed,
            timestamp: Date.now(),
            isFinal: true,
          };
          transcript.push(flushedItem);
          saveRoomTranscriptItem(roomId, flushedItem).catch(() => {});
        }
      }
      service.destroy();
      transcriptionServiceRef.current = null;
      if (captionFadeTimerRef.current) {
        clearTimeout(captionFadeTimerRef.current);
      }
      if (captionDebounceTimerRef.current) {
        clearTimeout(captionDebounceTimerRef.current);
      }
    };
    // Recreated only when identity, transport or language changes; mute state is synced by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localParticipant.id, localParticipant.name, isLiveKitSFU, captionLanguage]);

  // Synchronize transcription with microphone mute/unmute state
  useEffect(() => {
    if (transcriptionServiceRef.current) {
      if (localParticipant.audioEnabled) {
        transcriptionServiceRef.current.start();
      } else {
        transcriptionServiceRef.current.stop();
      }
    }
  }, [localParticipant.audioEnabled]);

  // Toggle Audio
  const handleToggleAudio = async () => {
    if (roomSettings.allowUnmute === false && !localParticipant.isHost && !localParticipant.isCoHost && !localParticipant.audioEnabled) {
      alert('The host has disabled participants from unmuting.');
      return;
    }

    const nextState = !localParticipant.audioEnabled;

    // 1. Optimistic UI update (0ms instant feedback)
    setLocalParticipant((p) => ({ ...p, audioEnabled: nextState }));
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = nextState));
      setLocalStream(new MediaStream(localStream.getTracks()));
    }

    try {
      if (isLiveKitSFU && liveKitManagerRef.current) {
        const updatedStream = await liveKitManagerRef.current.setAudioEnabled(nextState);
        if (updatedStream && updatedStream.getTracks().length > 0) {
          setLocalStream(new MediaStream(updatedStream.getTracks()));
        }
      } else {
        // WebRTC Mesh mode
        const activeStream = localStream;
        const liveAudioTrack = activeStream?.getAudioTracks().find((t) => t.readyState === 'live');

        if (nextState) {
          if (liveAudioTrack) {
            liveAudioTrack.enabled = true;
            setLocalStream(new MediaStream(activeStream!.getTracks()));
            rtcManagerRef.current?.setLocalStream(activeStream!);
          } else {
            try {
              const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const newAudioTrack = micStream.getAudioTracks()[0];
              if (newAudioTrack) {
                newAudioTrack.enabled = true;
                const tracks = activeStream ? activeStream.getTracks().filter((t) => t.kind !== 'audio') : [];
                tracks.push(newAudioTrack);
                const combinedStream = new MediaStream(tracks);
                setLocalStream(combinedStream);
                rtcManagerRef.current?.setLocalStream(combinedStream);
              }
            } catch (mediaErr) {
              console.warn('Microphone permission or device error:', mediaErr);
              setLocalParticipant((p) => ({ ...p, audioEnabled: false }));
              return;
            }
          }
        } else {
          if (liveAudioTrack) {
            liveAudioTrack.enabled = false;
            setLocalStream(new MediaStream(activeStream!.getTracks()));
            rtcManagerRef.current?.setLocalStream(activeStream!);
          }
        }
      }
      rtcManagerRef.current?.updateParticipantState({ audioEnabled: nextState });
    } catch (err) {
      console.warn('Microphone toggle warning:', err);
      // Revert if failed
      setLocalParticipant((p) => ({ ...p, audioEnabled: !nextState }));
    }
  };

  // Automatically turn on video if host forces cameras on
  useEffect(() => {
    if (roomSettings.requireVideo && !localParticipant.isHost && !localParticipant.isCoHost && !localParticipant.videoEnabled) {
      const enableVideoAutomatically = async () => {
        try {
          setLocalParticipant((p) => ({ ...p, videoEnabled: true }));
          if (localStream) {
            localStream.getVideoTracks().forEach((t) => (t.enabled = true));
            setLocalStream(new MediaStream(localStream.getTracks()));
          }
          if (isLiveKitSFU && liveKitManagerRef.current) {
            const updatedStream = await liveKitManagerRef.current.setVideoEnabled(true);
            if (updatedStream && updatedStream.getTracks().length > 0) {
              setLocalStream(new MediaStream(updatedStream.getTracks()));
            }
          }
          rtcManagerRef.current?.updateParticipantState({ videoEnabled: true });
        } catch (err) {
          console.warn('Auto enable video failed:', err);
        }
      };
      enableVideoAutomatically();
    }
  }, [roomSettings.requireVideo, localParticipant.isHost, localParticipant.isCoHost, localParticipant.videoEnabled, isLiveKitSFU, localStream]);

  // Toggle Video
  const handleToggleVideo = async () => {
    if (roomSettings.requireVideo && !localParticipant.isHost && !localParticipant.isCoHost && localParticipant.videoEnabled) {
      alert('The host (सभापति) requires all participants to keep their camera on.');
      return;
    }

    const nextState = !localParticipant.videoEnabled;

    // 1. Optimistic UI update (0ms instant feedback)
    setLocalParticipant((p) => ({ ...p, videoEnabled: nextState }));
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => (t.enabled = nextState));
      setLocalStream(new MediaStream(localStream.getTracks()));
    }

    try {
      if (isLiveKitSFU && liveKitManagerRef.current) {
        const updatedStream = await liveKitManagerRef.current.setVideoEnabled(nextState);
        if (updatedStream && updatedStream.getTracks().length > 0) {
          setLocalStream(new MediaStream(updatedStream.getTracks()));
        }
      } else {
        // WebRTC Mesh mode
        const activeStream = localStream;
        const liveVideoTrack = activeStream?.getVideoTracks().find((t) => t.readyState === 'live');

        if (nextState) {
          if (liveVideoTrack) {
            liveVideoTrack.enabled = true;
            setLocalStream(new MediaStream(activeStream!.getTracks()));
            activeCameraStreamRef.current = activeStream;
            rtcManagerRef.current?.setLocalStream(activeStream!);
          } else {
            try {
              const camStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 },
              });
              const newVideoTrack = camStream.getVideoTracks()[0];
              if (newVideoTrack) {
                newVideoTrack.enabled = true;
                const tracks = activeStream ? activeStream.getTracks().filter((t) => t.kind !== 'video') : [];
                tracks.push(newVideoTrack);
                const combinedStream = new MediaStream(tracks);
                setLocalStream(combinedStream);
                activeCameraStreamRef.current = combinedStream;
                rtcManagerRef.current?.setLocalStream(combinedStream);
              }
            } catch (mediaErr) {
              console.warn('Camera permission or device error:', mediaErr);
              setLocalParticipant((p) => ({ ...p, videoEnabled: false }));
              return;
            }
          }
        } else {
          if (liveVideoTrack) {
            liveVideoTrack.enabled = false;
            setLocalStream(new MediaStream(activeStream!.getTracks()));
            rtcManagerRef.current?.setLocalStream(activeStream!);
          }
        }
      }
      rtcManagerRef.current?.updateParticipantState({ videoEnabled: nextState });
    } catch (err) {
      console.warn('Camera toggle warning:', err);
      // Revert if failed
      setLocalParticipant((p) => ({ ...p, videoEnabled: !nextState }));
    }
  };

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    if (roomSettings.allowScreenShare === false && !localParticipant.isHost && !localParticipant.isCoHost && !localParticipant.screenSharing) {
      alert('The host has disabled screen sharing for participants.');
      return;
    }

    if (localParticipant.screenSharing) {
      // --- STOP SHARING ---
      if (isLiveKitSFU && liveKitManagerRef.current) {
        await liveKitManagerRef.current.setScreenShareEnabled(false);
      } else {
        rtcManagerRef.current?.setScreenStream(null);
      }
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
      }
      setLocalParticipant((p) => ({ ...p, screenSharing: false }));
      rtcManagerRef.current?.updateParticipantState({ screenSharing: false });
    } else {
      // --- START SHARING ---
      try {
        if (isLiveKitSFU && liveKitManagerRef.current) {
          const lkScreen = await liveKitManagerRef.current.setScreenShareEnabled(true);
          if (lkScreen) {
            setScreenStream(lkScreen);
            setLocalParticipant((p) => ({ ...p, screenSharing: true }));
            const track = lkScreen.getVideoTracks()[0];
            if (track) {
              track.onended = () => {
                liveKitManagerRef.current?.setScreenShareEnabled(false);
                setScreenStream(null);
                setLocalParticipant((p) => ({ ...p, screenSharing: false }));
              };
            }
          }
        } else {
          // WebRTC Mesh mode (direct browser getDisplayMedia)
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });

          // Retain local camera stream intact - do not overwrite localStream!
          setScreenStream(stream);
          rtcManagerRef.current?.setScreenStream(stream);
          setLocalParticipant((p) => ({ ...p, screenSharing: true }));
          rtcManagerRef.current?.updateParticipantState({ screenSharing: true });

          // Browser native "Stop Sharing" floating bar handler
          const screenVideoTrack = stream.getVideoTracks()[0];
          if (screenVideoTrack) {
            screenVideoTrack.onended = () => {
              rtcManagerRef.current?.setScreenStream(null);
              setScreenStream(null);
              setLocalParticipant((p) => ({ ...p, screenSharing: false }));
              rtcManagerRef.current?.updateParticipantState({ screenSharing: false });
            };
          }
        }
      } catch (err) {
        console.warn('Screen share canceled or failed:', err);
      }
    }
  };

  // Broadcast Whiteboard stroke / clear
  const handleBroadcastDraw = (drawEvent: WhiteboardDrawEvent) => {
    if (isLiveKitSFU && liveKitManagerRef.current) {
      liveKitManagerRef.current.sendData({
        type: 'whiteboard',
        event: drawEvent,
      });
    } else {
      rtcManagerRef.current?.sendWhiteboardEvent(drawEvent);
    }
  };

  // Toggle Hand Raise
  const handleToggleHandRaise = () => {
    const next = !localParticipant.isHandRaised;
    setLocalParticipant((p) => ({ ...p, isHandRaised: next }));
    rtcManagerRef.current?.updateParticipantState({ isHandRaised: next });
    if (next) {
      sendReaction(roomId, '✋', localParticipant.id, localParticipant.name);
    }
  };

  // Send Reaction
  const handleSendReaction = (emoji: string) => {
    sendReaction(roomId, emoji, localParticipant.id, localParticipant.name);
  };

  // Send Chat Message
  const handleSendMessage = (text: string, to: string) => {
    sendChatMessage(roomId, {
      senderId: localParticipant.id,
      senderName: localParticipant.name,
      senderPhoto: localParticipant.photoURL,
      text,
      to,
    });
  };

  // Stop Recording helper
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn('Error stopping media recorder:', err);
      }
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingSeconds(0);
    setIsRecording(false);
  };

  // Toggle Recording: Open options modal or stop active recording
  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      setIsRecordModalOpen(true);
    }
  };

  // Start Recording with Web Audio API multi-channel audio mixing
  const handleStartRecording = async ({
    includeMic,
    includeParticipants,
  }: {
    includeMic: boolean;
    includeParticipants: boolean;
  }) => {
    try {
      // 1. Capture screen display (video & system audio)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      recordingDisplayStreamRef.current = displayStream;

      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track available in display capture');
      }

      // 2. Set up AudioContext to mix all selected sources
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      recordingAudioContextRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();

      let hasAnyAudio = false;

      // 2a. System audio from display capture
      const displayAudioTracks = displayStream.getAudioTracks();
      if (displayAudioTracks.length > 0) {
        try {
          const displayAudioStream = new MediaStream(displayAudioTracks);
          const displaySource = audioCtx.createMediaStreamSource(displayAudioStream);
          displaySource.connect(destination);
          hasAnyAudio = true;
        } catch (e) {
          console.warn('Failed to mix display audio:', e);
        }
      }

      // 2b. Microphone audio (own voice)
      let micStream: MediaStream | null = null;
      if (includeMic) {
        const existingAudioTrack = localStream?.getAudioTracks().find((t) => t.readyState === 'live');
        if (existingAudioTrack) {
          try {
            const micAudioStream = new MediaStream([existingAudioTrack]);
            const micSource = audioCtx.createMediaStreamSource(micAudioStream);
            micSource.connect(destination);
            hasAnyAudio = true;
          } catch (e) {
            console.warn('Failed to mix existing mic track:', e);
          }
        } else {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            recordingMicStreamRef.current = micStream;
            const micSource = audioCtx.createMediaStreamSource(micStream);
            micSource.connect(destination);
            hasAnyAudio = true;
          } catch (err) {
            console.warn('Microphone capture failed or denied:', err);
          }
        }
      }

      // 2c. Remote participants audio
      if (includeParticipants) {
        remoteStreams.forEach((rStream) => {
          const remoteAudioTracks = rStream.getAudioTracks().filter((t) => t.readyState === 'live');
          if (remoteAudioTracks.length > 0) {
            try {
              const remoteAudioStream = new MediaStream(remoteAudioTracks);
              const remoteSource = audioCtx.createMediaStreamSource(remoteAudioStream);
              remoteSource.connect(destination);
              hasAnyAudio = true;
            } catch (e) {
              console.warn('Failed to mix remote audio:', e);
            }
          }
        });
      }

      // 3. Assemble combined tracks for MediaRecorder
      const combinedTracks: MediaStreamTrack[] = [videoTrack];
      if (hasAnyAudio) {
        const mixedAudioTrack = destination.stream.getAudioTracks()[0];
        if (mixedAudioTrack) {
          combinedTracks.push(mixedAudioTrack);
        }
      } else if (displayAudioTracks.length > 0) {
        combinedTracks.push(displayAudioTracks[0]);
      }

      const finalStream = new MediaStream(combinedTracks);

      // 4. Select best supported MIME type
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4';
      }

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(finalStream, { mimeType });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        // Stop all temporary capture tracks
        displayStream.getTracks().forEach((t) => t.stop());
        if (micStream) {
          micStream.getTracks().forEach((t) => t.stop());
          recordingMicStreamRef.current = null;
        }
        if (recordingAudioContextRef.current && recordingAudioContextRef.current.state !== 'closed') {
          recordingAudioContextRef.current.close().catch(() => {});
          recordingAudioContextRef.current = null;
        }
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setRecordingSeconds(0);
        setIsRecording(false);

        // Download the recorded WebM file
        if (recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          const cleanTitle = (roomSettings?.title || 'Sabha-Meeting').replace(/[^a-zA-Z0-9_-]/g, '_');
          const dateStr = new Date().toISOString().slice(0, 10);
          const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          a.download = `${cleanTitle}_${roomId}_${dateStr}_${timeStr}.${ext}`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }, 150);
        }
      };

      // Native browser "Stop sharing" floating bar handler
      videoTrack.onended = () => {
        stopRecording();
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      // Start recording timer
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Recording cancelled or failed:', err);
      setIsRecording(false);
    }
  };

  // Moderator Controls (Host & Co-host)
  const handleMuteAll = () => {
    rtcManagerRef.current?.sendMuteAllCommand(remoteParticipants);
  };

  const handleMuteParticipant = (peerId: string) => {
    const target = remoteParticipants.find((p) => p.id === peerId);
    if (!localParticipant.isHost && target?.isHost) {
      alert('The meeting host cannot be muted by a co-host.');
      return;
    }
    rtcManagerRef.current?.sendMuteCommand(peerId);
    if (isLiveKitSFU && liveKitManagerRef.current) {
      liveKitManagerRef.current.updatePeerState(peerId, { audioEnabled: false });
    }
  };

  const handleKickParticipant = (peerId: string) => {
    const target = remoteParticipants.find((p) => p.id === peerId);
    if (target?.isHost) {
      alert('The meeting host cannot be removed.');
      return;
    }
    if (!localParticipant.isHost && target?.isCoHost) {
      alert('Co-hosts cannot remove other co-hosts.');
      return;
    }
    rtcManagerRef.current?.sendKickCommand(peerId);
    if (isLiveKitSFU && liveKitManagerRef.current) {
      liveKitManagerRef.current.sendData({
        type: 'kick-command',
        participantId: peerId,
        payload: { reason: 'kicked' },
      });
    }
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const payload = JSON.stringify({ roomId, participantId: peerId });
      navigator.sendBeacon('/api/room/leave', new Blob([payload], { type: 'application/json' }));
    }
  };

  // Toggle Co-host role for a participant (Host only)
  const handleToggleCoHost = async (targetPeerId: string) => {
    if (!localParticipant.isHost) {
      alert('Only the host can assign or remove co-hosts.');
      return;
    }

    const target = remoteParticipants.find((p) => p.id === targetPeerId);
    if (!target) return;

    const nextCoHost = !target.isCoHost;

    // 1. Optimistic UI update
    setRemoteParticipants((prev) =>
      prev.map((p) => (p.id === targetPeerId ? { ...p, isCoHost: nextCoHost } : p))
    );

    // 2. Broadcast via WebRTC or LiveKit
    if (isLiveKitSFU && liveKitManagerRef.current) {
      liveKitManagerRef.current.updatePeerState(targetPeerId, { isCoHost: nextCoHost });
    } else {
      rtcManagerRef.current?.updatePeerRole(targetPeerId, { isCoHost: nextCoHost });
    }

    // 3. Persist in Firestore
    updateParticipantRole(roomId, targetPeerId, { isCoHost: nextCoHost }).catch((err) => {
      console.warn('Error saving cohost state to Firestore:', err);
    });
  };

  const handleToggleLock = () => {
    updateRoomSettings(roomId, { isLocked: !roomSettings.isLocked });
  };

  const handleUpdateSettings = (updates: Partial<RoomSettings>) => {
    updateRoomSettings(roomId, updates);
  };

  const handleAdmitWaiting = async (participantId: string) => {
    await admitParticipant(roomId, participantId);
  };

  const handleDenyWaiting = async (participantId: string) => {
    await denyParticipant(roomId, participantId);
  };

  const handleAdmitAllWaiting = async (participantIds: string[]) => {
    await admitAllParticipants(roomId, participantIds);
  };

  const handleInitiateEndMeeting = async () => {
    setIsLeaveModalOpen(false);

    // 1. Immediately flush host's local interim speech buffer and log in English
    if (transcriptionServiceRef.current) {
      const flushed = transcriptionServiceRef.current.flushInterim();
      if (flushed && flushed.length > 0) {
        let englishText = flushed;
        if (isHindiText(flushed)) {
          try {
            englishText = await translateText(flushed, 'hi', 'en');
          } catch {}
        }
        const flushedItem: TranscriptItem = {
          id: `${localParticipant.id}_${Date.now()}_host_conclude_flush`,
          senderId: localParticipant.id,
          senderName: localParticipant.name || 'You',
          text: englishText,
          translation: flushed !== englishText ? flushed : undefined,
          timestamp: Date.now(),
          isFinal: true,
        };
        transcriptRef.current.push(flushedItem);
        saveRoomTranscriptItem(roomId, flushedItem).catch(() => {});
      }
    }

    // 2. Broadcast kick/end command to all remote participants so they exit immediately with zero waiting
    try {
      if (liveKitManagerRef.current) {
        liveKitManagerRef.current.sendData({ type: 'end-meeting', reason: 'meeting-ended' });
      }
      await rtcManagerRef.current?.sendKickCommand('broadcast', 'meeting-ended');
      for (const p of remoteParticipants) {
        rtcManagerRef.current?.sendKickCommand(p.id, 'meeting-ended').catch(() => {});
      }
    } catch {}

    // 3. Notify server with endForAll flag
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const payload = JSON.stringify({ roomId, participantId: localParticipant.id, endForAll: true });
        navigator.sendBeacon('/api/room/leave', new Blob([payload], { type: 'application/json' }));
      } else {
        await fetch('/api/room/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId: localParticipant.id, endForAll: true }),
        }).catch(() => {});
      }
    } catch {}

    // 4. Dispatch AI Meeting Summarization & Email Dispatch in server background (server merges Firestore transcripts)
    try {
      const allParticipants = [localParticipant, ...remoteParticipants];
      const summaryPayload = JSON.stringify({
        roomId,
        title: roomSettings.title,
        durationMinutes: Math.max(1, Math.ceil(duration / 60)),
        participants: allParticipants.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email || (p.id === localParticipant.id ? user?.email : null) || null,
          isHost: p.isHost,
          isCoHost: p.isCoHost,
        })),
        transcript: transcriptRef.current,
      });

      fetch('/api/meeting/summarize-and-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: summaryPayload,
        keepalive: true,
      }).catch((e) => console.warn('Summarization email dispatch error:', e));
    } catch (err) {
      console.warn('Failed to dispatch meeting summarization:', err);
    }

    updateHostPresence(roomId, false).catch(() => {});

    // 5. Disconnect local engines and navigate home immediately (0ms waiting!)
    if (liveKitManagerRef.current) {
      liveKitManagerRef.current.disconnect().catch(() => {});
    }
    if (rtcManagerRef.current) {
      rtcManagerRef.current.leaveRoom().catch(() => {});
    }
    router.push('/');
  };

  const handleLeaveMeeting = async () => {
    setIsLeaveModalOpen(false);
    if (localParticipant.isHost) {
      updateHostPresence(roomId, false).catch(() => {});
    }

    // Flush attendee's speech before leaving so concluding remarks are recorded in English
    if (transcriptionServiceRef.current) {
      const flushed = transcriptionServiceRef.current.flushInterim();
      if (flushed && flushed.length > 0) {
        let englishText = flushed;
        if (isHindiText(flushed)) {
          try {
            englishText = await translateText(flushed, 'hi', 'en');
          } catch {}
        }
        const flushedItem: TranscriptItem = {
          id: `${localParticipant.id}_${Date.now()}_leave_flush`,
          senderId: localParticipant.id,
          senderName: localParticipant.name || 'You',
          text: englishText,
          translation: flushed !== englishText ? flushed : undefined,
          timestamp: Date.now(),
          isFinal: true,
        };
        saveRoomTranscriptItem(roomId, flushedItem).catch(() => {});
        if (liveKitManagerRef.current) {
          liveKitManagerRef.current.sendData({ type: 'transcript-chunk', item: flushedItem });
        }
        if (rtcManagerRef.current) {
          rtcManagerRef.current.sendTranscriptItem(flushedItem);
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const payload = JSON.stringify({ roomId, participantId: localParticipant.id });
      navigator.sendBeacon('/api/room/leave', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/room/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, participantId: localParticipant.id }),
      }).catch(() => {});
    }
    if (liveKitManagerRef.current) {
      await liveKitManagerRef.current.disconnect().catch(() => {});
    }
    await rtcManagerRef.current?.leaveRoom().catch(() => {});
    router.push('/');
  };

  const copyInviteLink = () => {
    const cleanUrl = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(cleanUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Stable handler identities so memoized children (VideoGrid, ChatPanel, MeetingControls) skip re-renders
  const allParticipants = useMemo(() => [localParticipant, ...remoteParticipants], [localParticipant, remoteParticipants]);
  const onToggleScreenShare = useStableCallback(handleToggleScreenShare);
  const onToggleCoHost = useStableCallback(handleToggleCoHost);
  const onMuteParticipant = useStableCallback(handleMuteParticipant);
  const onKickParticipant = useStableCallback(handleKickParticipant);
  const onSendMessage = useStableCallback(handleSendMessage);
  const onToggleAudio = useStableCallback(handleToggleAudio);
  const onToggleVideo = useStableCallback(handleToggleVideo);
  const onToggleHandRaise = useStableCallback(handleToggleHandRaise);
  const onToggleRecording = useStableCallback(handleToggleRecording);
  const onSendReaction = useStableCallback(handleSendReaction);
  const onCloseChat = useStableCallback(() => setIsChatOpen(false));
  const onToggleCaptions = useStableCallback(() => setIsCaptionsOn((prev) => !prev));
  const onChangeCaptionLanguage = useStableCallback((lang: string) => {
    setCaptionLanguage(lang);
    captionLanguageRef.current = lang;
    transcriptionServiceRef.current?.setLanguage(lang);
    if (latestLiveCaption?.text) {
      formatCaptionForUserPreference(latestLiveCaption.text, lang)
        .then(({ primaryText, secondaryText, badgeLabel }) => {
          if (primaryText) {
            handleUpdateLiveCaption(latestLiveCaption.senderName, primaryText, secondaryText, badgeLabel);
          }
        })
        .catch(() => {});
    }
  });
  const onToggleParticipantsPanel = useStableCallback(() => {
    setIsParticipantsOpen(!isParticipantsOpen);
    setIsChatOpen(false);
  });
  const onToggleChatPanel = useStableCallback(() => {
    setIsChatOpen(!isChatOpen);
    setIsParticipantsOpen(false);
  });
  const onToggleWhiteboard = useStableCallback(() => setIsWhiteboardOpen(!isWhiteboardOpen));
  const onOpenSecurityModal = useStableCallback(() => setIsSecurityOpen(true));
  const onLeaveMeeting = useStableCallback(() => setIsLeaveModalOpen(true));

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col overflow-hidden select-none">
      {/* Zoom-Style Top Header Bar */}
      <div className="h-14 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-2 sm:px-4 flex items-center justify-between z-30 select-none">
        {/* Left: Branding & Room Info */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 text-slate-950 font-black text-sm flex items-center justify-center shadow-md shadow-amber-500/10">
            स
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="font-bold text-white text-sm hidden xs:inline">Sabha</span>
            <span className="text-xs px-2 py-0.5 rounded-lg bg-slate-800/90 text-amber-400 font-mono border border-slate-700/50">
              {roomId}
            </span>
            {isLiveKitSFU && (
              <span className="hidden md:flex text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/30 items-center gap-1">
                <Zap className="w-3 h-3" /> SFU 100+
              </span>
            )}
            {roomSettings.isLocked && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
          </div>
        </div>

        {/* Center: Recording Indicator */}
        <div className="flex items-center gap-2">
          {isRecording && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-xs font-semibold text-rose-400 animate-pulse shadow-sm">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span className="font-mono">{formatDuration(recordingSeconds)}</span>
              <span className="hidden sm:inline text-[10px] text-rose-300 font-bold">REC</span>
            </div>
          )}
        </div>

        {/* Right: Zoom Header Suite (Shield + Timer + View Switcher + Invite) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Zoom Green Shield: Verified Encryption & Security Status */}
          <div className="relative" ref={meetingInfoRef}>
            <button
              onClick={() => setShowMeetingInfo(!showMeetingInfo)}
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 transition cursor-pointer"
              title="Meeting Info & Security Details"
            >
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                <Check className="w-3 h-3 stroke-[3]" />
              </div>
              <span className="font-mono text-xs text-slate-300 font-medium hidden sm:inline">
                {formatDuration(duration)}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 hidden sm:inline" />
            </button>

            {/* Meeting Info Popover */}
            {showMeetingInfo && (
              <div className="absolute top-full right-0 mt-2 w-72 sm:w-80 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-4 z-50 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Sabha Meeting Info</h4>
                    <p className="text-[10px] text-emerald-400 font-medium">End-to-end verified session</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Meeting ID</span>
                    <span className="font-mono text-slate-200 font-semibold">{roomId}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Host (सभापति)</span>
                    <span className="text-slate-200 truncate max-w-[140px]">{roomSettings.hostName || 'Host'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Duration</span>
                    <span className="font-mono text-slate-200">{formatDuration(duration)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Network Engine</span>
                    <span className="text-amber-400 font-semibold">{isLiveKitSFU ? 'LiveKit SFU Mesh' : 'WebRTC Peer Mesh'}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
                  <button
                    onClick={copyInviteLink}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center justify-center gap-1.5 transition border border-slate-700/60 cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowMeetingInfo(false);
                      setIsShareModalOpen(true);
                    }}
                    className="py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Invite</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Zoom View Dropdown: Speaker vs Gallery vs Multi-speaker (matching Image 3) */}
          <div className="relative" ref={viewMenuRef}>
            <button
              onClick={() => setShowViewMenu(!showViewMenu)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/60 transition cursor-pointer text-xs font-semibold"
              title="Change Meeting Layout (Speaker / Gallery)"
            >
              {viewMode === 'speaker' ? (
                <LayoutTemplate className="w-3.5 h-3.5 text-amber-400" />
              ) : viewMode === 'multi-speaker' ? (
                <Grid2X2 className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <LayoutGrid className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span className="hidden xs:inline">View</span>
            </button>

            {/* Dropdown Menu matching Image 3 */}
            {showViewMenu && (
              <div className="absolute top-full right-0 mt-2 w-48 sm:w-56 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl py-1.5 z-50 text-xs text-slate-200 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* Speaker View */}
                <button
                  onClick={() => {
                    setViewMode('speaker');
                    setShowViewMenu(false);
                  }}
                  className={`w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                    viewMode === 'speaker' ? 'text-amber-400 font-semibold' : 'text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 flex items-center justify-center">
                      {viewMode === 'speaker' && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span>Speaker</span>
                  </div>
                  <LayoutTemplate className="w-4 h-4 text-slate-400" />
                </button>

                {/* Gallery View */}
                <button
                  onClick={() => {
                    setViewMode('gallery');
                    setShowViewMenu(false);
                  }}
                  className={`w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                    viewMode === 'gallery' ? 'text-amber-400 font-semibold' : 'text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 flex items-center justify-center">
                      {viewMode === 'gallery' && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span>Gallery</span>
                  </div>
                  <LayoutGrid className="w-4 h-4 text-slate-400" />
                </button>

                {/* Multi-speaker View */}
                <button
                  onClick={() => {
                    setViewMode('multi-speaker');
                    setShowViewMenu(false);
                  }}
                  className={`w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                    viewMode === 'multi-speaker' ? 'text-amber-400 font-semibold' : 'text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 flex items-center justify-center">
                      {viewMode === 'multi-speaker' && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span>Multi-speaker</span>
                  </div>
                  <Grid2X2 className="w-4 h-4 text-slate-400" />
                </button>

                <div className="my-1 border-t border-slate-800" />

                {/* Fullscreen Toggle */}
                <button
                  onClick={handleToggleFullscreen}
                  className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer text-slate-300 hover:text-white"
                >
                  <div className="flex items-center gap-2 pl-6">
                    <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                  </div>
                  {isFullscreen ? <Minimize className="w-4 h-4 text-slate-400" /> : <Maximize className="w-4 h-4 text-slate-400" />}
                </button>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Invite Button */}
          <button
            onClick={() => setIsShareModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer"
            title="Invite participants"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Invite</span>
          </button>
        </div>
      </div>

      {/* Main Body: Video Grid + Side Panels */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Floating Host Knocking Notification Banner */}
        {(localParticipant.isHost || localParticipant.isCoHost) && (
          <WaitingRoomBanner
            waitingList={waitingList}
            onAdmit={handleAdmitWaiting}
            onDeny={handleDenyWaiting}
            onAdmitAll={handleAdmitAllWaiting}
            onOpenParticipants={() => {
              setIsParticipantsOpen(true);
              setIsChatOpen(false);
            }}
          />
        )}

        <VideoGrid
          localParticipant={localParticipant}
          localStream={localStream}
          remoteParticipants={remoteParticipants}
          remoteStreams={remoteStreams}
          screenStream={screenStream}
          remoteScreenStreams={remoteScreenStreams}
          onStopScreenShare={onToggleScreenShare}
          isHostViewer={localParticipant.isHost}
          isCoHostViewer={Boolean(localParticipant.isCoHost)}
          onToggleCoHost={onToggleCoHost}
          onMuteParticipant={onMuteParticipant}
          onKickParticipant={onKickParticipant}
          viewMode={viewMode}
        />

        {/* Side Panel: In-Meeting Chat */}
        <ChatPanel
          isOpen={isChatOpen}
          onClose={onCloseChat}
          messages={messages}
          participants={allParticipants}
          currentUserId={localParticipant.id}
          onSendMessage={onSendMessage}
          allowChat={roomSettings.allowChat}
          isHost={localParticipant.isHost}
          isCoHost={Boolean(localParticipant.isCoHost)}
        />

        {/* Side Panel: Participants Roster */}
        <ParticipantsPanel
          isOpen={isParticipantsOpen}
          onClose={() => setIsParticipantsOpen(false)}
          participants={[localParticipant, ...remoteParticipants]}
          currentUserId={localParticipant.id}
          isHost={localParticipant.isHost}
          isCoHost={Boolean(localParticipant.isCoHost)}
          isLocked={roomSettings.isLocked}
          waitingList={waitingList}
          onAdmit={handleAdmitWaiting}
          onDeny={handleDenyWaiting}
          onAdmitAll={handleAdmitAllWaiting}
          onMuteAll={handleMuteAll}
          onMuteParticipant={handleMuteParticipant}
          onKickParticipant={handleKickParticipant}
          onToggleCoHost={handleToggleCoHost}
          onToggleLock={handleToggleLock}
          onOpenInvite={() => setIsShareModalOpen(true)}
        />

        {/* Live Closed Captions / Subtitles Overlay with Hindi-English Translation */}
        {isCaptionsOn && latestLiveCaption && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-2xl px-5 py-3 rounded-2xl bg-slate-950/90 backdrop-blur-md border border-slate-700/80 text-center shadow-2xl pointer-events-none z-20 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-amber-400 font-bold text-xs">{latestLiveCaption.senderName}</span>
              {latestLiveCaption.badgeLabel && (
                <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 font-bold rounded uppercase tracking-wider">
                  {latestLiveCaption.badgeLabel}
                </span>
              )}
            </div>
            <div className="text-slate-100 text-sm font-medium tracking-wide leading-relaxed">
              {latestLiveCaption.text}
            </div>
            {latestLiveCaption.translation && latestLiveCaption.translation !== latestLiveCaption.text && (
              <div className="text-amber-300/90 text-xs italic mt-1 font-medium">
                &ldquo;{latestLiveCaption.translation}&rdquo;
              </div>
            )}
          </div>
        )}

        {/* Brave Browser Shields Notice Banner */}
        {isBraveActive && !dismissBraveNotice && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 max-w-2xl w-[94%] sm:w-auto px-4 py-3 rounded-2xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-xl text-slate-200 text-xs shadow-2xl z-30 animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-base">
                🦁
              </div>
              <div className="leading-relaxed">
                <div className="font-semibold text-amber-300 text-xs flex items-center gap-1.5">
                  <span>Brave Browser Notice</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 font-normal">Privacy Shield Active</span>
                </div>
                <p className="text-slate-300 text-[11px] mt-0.5">
                  Brave disables Google speech recognition for privacy. You can talk, listen, and view live subtitles from others. To transcribe your own mic, open this meeting in <strong>Chrome</strong> or <strong>Edge</strong>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
              <button
                onClick={copyInviteLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-medium transition cursor-pointer active:scale-95"
                title="Copy link to paste into Google Chrome or Microsoft Edge"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied Link!' : 'Copy Link for Chrome/Edge'}</span>
              </button>
              <button
                onClick={() => setDismissBraveNotice(true)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition text-[11px] font-medium cursor-pointer"
                title="Dismiss notice"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zoom-Style Bottom Toolbar */}
      <MeetingControls
        isHost={localParticipant.isHost}
        isCoHost={Boolean(localParticipant.isCoHost)}
        audioEnabled={localParticipant.audioEnabled}
        videoEnabled={localParticipant.videoEnabled}
        screenSharing={localParticipant.screenSharing}
        isHandRaised={localParticipant.isHandRaised}
        isRecording={isRecording}
        participantCount={remoteParticipants.length + 1}
        waitingCount={waitingList.length}
        unreadChatCount={unreadChatCount}
        isCaptionsOn={isCaptionsOn}
        isBraveMode={isBraveActive}
        captionLanguage={captionLanguage}
        onToggleCaptions={onToggleCaptions}
        onChangeCaptionLanguage={onChangeCaptionLanguage}
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onToggleScreenShare={onToggleScreenShare}
        onToggleHandRaise={onToggleHandRaise}
        onToggleRecording={onToggleRecording}
        onToggleParticipantsPanel={onToggleParticipantsPanel}
        onToggleChatPanel={onToggleChatPanel}
        isWhiteboardOpen={isWhiteboardOpen}
        onToggleWhiteboard={onToggleWhiteboard}
        onOpenSecurityModal={onOpenSecurityModal}
        onSendReaction={onSendReaction}
        onLeaveMeeting={onLeaveMeeting}
      />

      {/* Interactive Modals */}
      <WhiteboardModal
        isOpen={isWhiteboardOpen}
        onClose={() => setIsWhiteboardOpen(false)}
        onBroadcastDraw={handleBroadcastDraw}
        incomingDrawEvent={incomingDrawEvent}
      />

      <HostControlModal
        isOpen={isSecurityOpen}
        onClose={() => setIsSecurityOpen(false)}
        roomSettings={roomSettings}
        onUpdateSettings={handleUpdateSettings}
        onEndMeetingForAll={handleInitiateEndMeeting}
        isHost={localParticipant.isHost}
      />

      {/* Share / Invite Modal */}
      <ShareMeetingModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        roomId={roomId}
        hostName={roomSettings.hostName}
      />

      {/* Recording Audio Options Modal */}
      <RecordModal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        onStartRecording={handleStartRecording}
      />

      {/* Leave / End Sabha Confirmation Modal */}
      <LeaveMeetingModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        isHost={localParticipant.isHost}
        onLeaveMeeting={handleLeaveMeeting}
        onEndMeetingForAll={handleInitiateEndMeeting}
      />

      {/* Floating Emoji Reactions Layer */}
      <ReactionsOverlay latestReaction={latestReaction} />
    </div>
  );
}
