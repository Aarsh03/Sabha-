/**
 * Sabha (सभा) - Live Browser-Native Speech Recognition Service
 * Uses Web Speech API (webkitSpeechRecognition) for zero-cost, real-time transcription.
 * Supports Hindi (hi-IN), Indian English (en-IN), and US English (en-US).
 */

export interface SpeechRecognitionResultCallback {
  (text: string, isFinal: boolean): void;
}

export class LiveTranscriptionService {
  private recognition: any = null;
  private isDesiredListening: boolean = false;
  private isActuallyListening: boolean = false;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private onResultCallback: SpeechRecognitionResultCallback | null = null;
  private onStatusCallback: ((listening: boolean) => void) | null = null;
  private language: string = 'hi-IN';
  private lastInterimText: string = '';

  constructor(language: string = 'hi-IN') {
    this.language = language;
    this.initRecognition();
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

  private initRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[Transcription] Web Speech API not supported in this browser.');
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
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
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
    }
  }

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
    const text = this.lastInterimText.trim();
    this.lastInterimText = '';
    return text || null;
  }

  public start() {
    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) return;

    this.isDesiredListening = true;
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
    this.recognition = null;
    this.onResultCallback = null;
    this.onStatusCallback = null;
    this.lastInterimText = '';
  }
}
