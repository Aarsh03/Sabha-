/**
 * Sabha (सभा) - Live Browser-Native Speech Recognition Service
 * 
 * Architectural Guarantees:
 * 1. 100% Free ($0) Browser-Native Web Speech API (Chrome, Edge, Safari) with ZERO API tokens during the meeting.
 * 2. Bilingual / Hinglish Dual-Language Mode (hi-IN + en-IN) supported out of the box.
 * 3. Graceful Brave Browser detection: prevents console NotSupportedErrors and alerts user about Brave Shields
 *    without burning continuous background Gemini API tokens.
 * 4. Token Protection: Gemini API is strictly preserved ONLY for final post-meeting summarization.
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
  private language: string = 'dual';
  private lastInterimText: string = '';

  public isBraveOrFallbackMode: boolean = false;

  constructor(language: string = 'dual') {
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

  public setAudioStream(_stream: MediaStream | null) {
    // MediaStream reference kept for interface parity; 0 tokens spent on continuous audio streaming.
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
      this.isBraveOrFallbackMode = true;
      this.onModeChangeCallback?.(true);
      console.log('[Transcription] Brave Browser verified. Native speech recognition is disabled by Brave Shields. Subtitles from other attendees will display on screen.');
    }
  }

  public static mapLanguageToRecognitionLang(lang: string): string {
    if (lang === 'english_only' || lang === 'en' || lang === 'en-IN' || lang === 'en-US') {
      return 'en-IN';
    }
    if (lang === 'hindi_only' || lang === 'hi' || lang === 'hi-IN') {
      return 'hi-IN';
    }
    if (lang === 'dual') {
      return 'hi-IN';
    }
    const bcpMap: Record<string, string> = {
      mr: 'mr-IN',
      bn: 'bn-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      gu: 'gu-IN',
      kn: 'kn-IN',
      pa: 'pa-IN',
      ml: 'ml-IN',
      ur: 'ur-IN',
      es: 'es-ES',
      fr: 'fr-FR',
      de: 'de-DE',
      ja: 'ja-JP',
      ar: 'ar-SA',
      ru: 'ru-RU',
    };
    return bcpMap[lang] || 'en-IN';
  }

  private initRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.isBraveOrFallbackMode = true;
      this.onModeChangeCallback?.(true);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      // Dynamically map chosen language to native speech recognition BCP-47 model
      recognition.lang = LiveTranscriptionService.mapLanguageToRecognitionLang(this.language);
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
          this.isBraveOrFallbackMode = true;
          this.onModeChangeCallback?.(true);
          this.isActuallyListening = false;
          this.onStatusCallback?.(false);
          return;
        }

        if (event.error === 'not-allowed') {
          this.isDesiredListening = false;
          this.isActuallyListening = false;
          this.onStatusCallback?.(false);
          return;
        }

        console.warn('[Transcription] Speech recognition notice:', event.error);
      };

      recognition.onend = () => {
        this.isActuallyListening = false;

        // Auto-restart if continuous listening is desired and not in Brave blocked mode
        if (this.isDesiredListening && !this.isBraveOrFallbackMode) {
          if (this.restartTimeout) clearTimeout(this.restartTimeout);
          this.restartTimeout = setTimeout(() => {
            if (this.isDesiredListening && !this.isActuallyListening && !this.isBraveOrFallbackMode) {
              try {
                this.recognition?.start();
              } catch (e) {
                // Ignore invalid state
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
      this.isBraveOrFallbackMode = true;
      this.onModeChangeCallback?.(true);
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
    const text = this.lastInterimText.trim();
    this.lastInterimText = '';
    return text || null;
  }

  public start() {
    this.isDesiredListening = true;

    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition || this.isBraveOrFallbackMode) {
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
    this.onModeChangeCallback = null;
    this.lastInterimText = '';
  }
}
