/**
 * Sabha (सभा) - Live Browser-Native Speech Recognition Service
 * Uses Web Speech API (webkitSpeechRecognition) for zero-cost, real-time transcription.
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
  private language: string = 'en-US';

  constructor(language: string = 'en-US') {
    this.language = language;
    this.initRecognition();
  }

  public static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return Boolean(SpeechRecognition);
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

          if (transcript && this.onResultCallback) {
            this.onResultCallback(transcript, isFinal);
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
  }
}
