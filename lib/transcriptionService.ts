/**
 * Sabha (सभा) - Live Browser-Native & AI-Powered Speech Recognition Service
 * Supports:
 * 1. Native Web Speech API (Chrome, Edge, Safari) for instant 0-cost streaming.
 * 2. Smart Audio Chunking & AI Fallback (Brave Browser, Firefox, Unsupported Browsers)
 *    using client-side Web Audio VAD + serverless Gemini speech transcription.
 * 3. Multilingual recognition for Hindi (hi-IN), Indian English (en-IN), and US English (en-US).
 */

export interface SpeechRecognitionResultCallback {
  (text: string, isFinal: boolean, translation?: string): void;
}

/**
 * Detects if the user is running Brave browser
 */
export async function isBraveBrowser(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if ((navigator as any).brave && typeof (navigator as any).brave.isBrave === 'function') {
      return await (navigator as any).brave.isBrave();
    }
  } catch {}
  return false;
}

export class LiveTranscriptionService {
  private recognition: any = null;
  private isDesiredListening: boolean = false;
  private isActuallyListening: boolean = false;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private onResultCallback: SpeechRecognitionResultCallback | null = null;
  private onStatusCallback: ((listening: boolean) => void) | null = null;
  private onModeChangeCallback: ((isBraveOrFallback: boolean) => void) | null = null;
  private language: string = 'hi-IN';
  private lastInterimText: string = '';

  // Audio Fallback Engine (for Brave & Web Speech disabled environments)
  public isBraveOrFallbackMode: boolean = false;
  private useAudioFallback: boolean = false;
  private activeAudioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private audioChunks: Blob[] = [];

  constructor(language: string = 'hi-IN') {
    this.language = language;
    this.initRecognition();
    this.checkBraveEnvironment();
  }

  public static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return Boolean(SpeechRecognition);
  }

  public getLanguage(): string {
    return this.language;
  }

  public setLanguage(newLanguage: string) {
    if (this.language === newLanguage) return;
    this.language = newLanguage;

    if (this.useAudioFallback) {
      // Audio fallback dynamically reads this.language on next chunk
      return;
    }

    const wasListening = this.isDesiredListening;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
    this.initRecognition();
    if (wasListening) {
      this.start();
    }
  }

  public setAudioStream(stream: MediaStream | null) {
    this.activeAudioStream = stream;
    if (this.useAudioFallback && this.isDesiredListening) {
      this.stopAudioFallback();
      this.startAudioFallback();
    }
  }

  public setOnModeChange(cb: (isBraveOrFallback: boolean) => void) {
    this.onModeChangeCallback = cb;
    if (this.isBraveOrFallbackMode) {
      cb(true);
    }
  }

  private async checkBraveEnvironment() {
    const isBrave = await isBraveBrowser();
    if (isBrave) {
      console.log('[Transcription] Brave Browser verified. Initializing AI audio fallback engine.');
      this.switchToAudioFallback();
    }
  }

  private switchToAudioFallback() {
    if (this.useAudioFallback) return;
    this.useAudioFallback = true;
    this.isBraveOrFallbackMode = true;
    this.onModeChangeCallback?.(true);

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.isDesiredListening) {
      this.startAudioFallback();
    }
  }

  private initRecognition() {
    if (typeof window === 'undefined' || this.useAudioFallback) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[Transcription] Web Speech API not supported. Activating AI audio fallback.');
      this.switchToAudioFallback();
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.language;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.isActuallyListening = true;
        this.onStatusCallback?.(true);
      };

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0]?.transcript?.trim();
          const isFinal = Boolean(result.isFinal);

          if (transcript) {
            if (isFinal) {
              this.lastInterimText = '';
            } else {
              this.lastInterimText = transcript;
            }

            if (this.onResultCallback) {
              this.onResultCallback(transcript, isFinal);
            }
          }
        }
      };

      recognition.onerror = (event: any) => {
        // 'no-speech' or 'audio-capture' are benign in continuous mode
        if (event.error === 'no-speech') {
          return;
        }

        // Brave browser intercepts Google's speech recognition backend and fires 'network' or 'service-not-allowed'
        if (event.error === 'network' || event.error === 'service-not-allowed') {
          console.warn(`[Transcription] Speech recognition '${event.error}' encountered (Brave/privacy block). Switching seamlessly to AI audio fallback.`);
          this.switchToAudioFallback();
          return;
        }

        if (event.error === 'not-allowed') {
          console.warn('[Transcription] Speech recognition permission denied or unavailable:', event.error);
          this.isDesiredListening = false;
          this.isActuallyListening = false;
          this.onStatusCallback?.(false);
          return;
        }

        console.warn('[Transcription] Speech recognition warning:', event.error);
      };

      recognition.onend = () => {
        this.isActuallyListening = false;
        if (this.useAudioFallback) return;

        // Auto-restart if continuous listening is desired
        if (this.isDesiredListening) {
          if (this.restartTimeout) clearTimeout(this.restartTimeout);
          this.restartTimeout = setTimeout(() => {
            if (this.isDesiredListening && !this.isActuallyListening) {
              try {
                this.recognition?.start();
              } catch (e) {
                // Ignore invalid state or already started error
              }
            }
          }, 300);
        } else {
          this.onStatusCallback?.(false);
        }
      };

      this.recognition = recognition;
    } catch (err) {
      console.warn('[Transcription] Failed to initialize SpeechRecognition:', err);
      this.switchToAudioFallback();
    }
  }

  // ==========================================
  // Brave & Audio Fallback Engine (VAD + AI)
  // ==========================================

  private async startAudioFallback() {
    if (this.isActuallyListening) return;

    // 1. Ensure we have an active live audio stream
    if (!this.activeAudioStream || this.activeAudioStream.getAudioTracks().every((t) => t.readyState === 'ended')) {
      try {
        this.activeAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.warn('[Transcription Fallback] Could not access microphone audio stream:', err);
        return;
      }
    }

    const audioTrack = this.activeAudioStream.getAudioTracks().find((t) => t.readyState === 'live');
    if (!audioTrack || !audioTrack.enabled) {
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      this.isActuallyListening = true;
      this.onStatusCallback?.(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const startRecordingChunk = () => {
        if (this.isSpeaking) return;
        this.isSpeaking = true;
        this.speechStartTime = Date.now();
        this.audioChunks = [];

        try {
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';

          this.mediaRecorder = mimeType
            ? new MediaRecorder(this.activeAudioStream!, { mimeType })
            : new MediaRecorder(this.activeAudioStream!);

          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.audioChunks.push(e.data);
            }
          };

          this.mediaRecorder.onstop = () => {
            const finalBlob = new Blob(this.audioChunks, {
              type: this.mediaRecorder?.mimeType || 'audio/webm',
            });
            this.audioChunks = [];
            if (finalBlob.size > 1200) {
              this.sendAudioChunkToGemini(finalBlob);
            }
          };

          this.mediaRecorder.start(200);
        } catch (recErr) {
          console.warn('[Transcription Fallback] MediaRecorder error:', recErr);
        }
      };

      const stopRecordingChunk = () => {
        if (!this.isSpeaking) return;
        this.isSpeaking = false;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          try {
            this.mediaRecorder.stop();
          } catch {}
        }
      };

      // VAD loop: inspect frequency energy every 90ms
      this.vadInterval = setInterval(() => {
        if (!this.isDesiredListening) {
          stopRecordingChunk();
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Speaking energy threshold
        const threshold = 15;

        if (average > threshold) {
          // Voice detected
          if (!this.isSpeaking) {
            startRecordingChunk();
          }
          if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
          }

          // Force chunk after 4.2 seconds of continuous speech for streaming fluidity
          if (this.isSpeaking && Date.now() - this.speechStartTime > 4200) {
            stopRecordingChunk();
            setTimeout(() => {
              if (this.isDesiredListening) startRecordingChunk();
            }, 60);
          }
        } else {
          // Silence detected
          if (this.isSpeaking && !this.silenceTimer) {
            this.silenceTimer = setTimeout(() => {
              stopRecordingChunk();
              this.silenceTimer = null;
            }, 850);
          }
        }
      }, 90);
    } catch (e) {
      console.warn('[Transcription Fallback] VAD initialization failed:', e);
    }
  }

  private async sendAudioChunkToGemini(blob: Blob) {
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string)?.split(',')[1];
        if (!base64Data) return;

        try {
          const res = await fetch('/api/transcribe-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio: base64Data,
              mimeType: blob.type || 'audio/webm',
              language: this.language,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text = (data.text || '').trim();
            const translation = data.translation ? data.translation.trim() : undefined;

            if (text && this.onResultCallback) {
              this.onResultCallback(text, true, translation);
            }
          }
        } catch (fetchErr) {
          console.warn('[Transcription Fallback] Chunk dispatch error:', fetchErr);
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.warn('[Transcription Fallback] Blob read error:', err);
    }
  }

  private stopAudioFallback() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;
    this.isSpeaking = false;
    this.audioChunks = [];

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
  }

  // ==========================================
  // Public Lifecycle Methods
  // ==========================================

  public setCallbacks(
    onResult: SpeechRecognitionResultCallback,
    onStatus?: (listening: boolean) => void
  ) {
    this.onResultCallback = onResult;
    if (onStatus) this.onStatusCallback = onStatus;
  }

  /**
   * Flushes any pending un-finalized interim speech text so the final words
   * spoken right before ending a meeting or muting are never lost.
   */
  public flushInterim(): string | null {
    if (this.useAudioFallback) {
      // Flush currently recorded speech if user was in the middle of talking
      if (this.isSpeaking && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try {
          this.mediaRecorder.stop();
        } catch {}
      }
      return null;
    }

    const text = this.lastInterimText.trim();
    this.lastInterimText = '';
    return text || null;
  }

  public start() {
    this.isDesiredListening = true;

    if (this.useAudioFallback) {
      this.startAudioFallback();
      return;
    }

    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) {
      this.switchToAudioFallback();
      return;
    }

    if (!this.isActuallyListening) {
      try {
        this.recognition.start();
      } catch (e) {
        // Can throw if already starting
      }
    }
  }

  public stop() {
    this.isDesiredListening = false;

    if (this.useAudioFallback) {
      this.stopAudioFallback();
      this.isActuallyListening = false;
      this.onStatusCallback?.(false);
      return;
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    // Flush any pending speech as final before stopping
    if (this.lastInterimText.trim() && this.onResultCallback) {
      const remaining = this.lastInterimText.trim();
      this.lastInterimText = '';
      try {
        this.onResultCallback(remaining, true);
      } catch {}
    }

    if (this.recognition && this.isActuallyListening) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.isActuallyListening = false;
    this.onStatusCallback?.(false);
  }

  public destroy() {
    this.stop();
    this.stopAudioFallback();
    this.recognition = null;
    this.onResultCallback = null;
    this.onStatusCallback = null;
    this.onModeChangeCallback = null;
    this.lastInterimText = '';
    this.activeAudioStream = null;
  }
}
