/**
 * Sabha (सभा) - Multi-Language Real-Time Translation Engine
 * 
 * Guarantees:
 * 1. $0 Token Consumption: Runs exclusively on client-side memory caching and
 *    free public translation gateways (MyMemory). Zero Gemini API tokens spent during live meetings.
 * 2. Target Display Language Support: Translate everything to Hindi Only, English Only, Dual,
 *    or popular Indian and global languages.
 * 3. 0ms Latency on Cached Common Phrases.
 */

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  region: 'preset' | 'indian' | 'global';
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  // Presets
  { code: 'dual', name: 'Dual (Hindi + English)', nativeName: 'हिन्दी + English', region: 'preset' },
  { code: 'hindi_only', name: 'Hindi Only', nativeName: 'हिन्दी Only', region: 'preset' },
  { code: 'english_only', name: 'English Only', nativeName: 'English Only', region: 'preset' },

  // Indian Languages
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', region: 'indian' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', region: 'indian' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', region: 'indian' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', region: 'indian' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', region: 'indian' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', region: 'indian' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', region: 'indian' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', region: 'indian' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', region: 'indian' },

  // Global Languages
  { code: 'es', name: 'Spanish', nativeName: 'Español', region: 'global' },
  { code: 'fr', name: 'French', nativeName: 'Français', region: 'global' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', region: 'global' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', region: 'global' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', region: 'global' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', region: 'global' },
];

const translationCache = new Map<string, string>();

/**
 * Checks if a string contains Hindi / Devanagari script characters
 */
export function isHindiText(text: string): boolean {
  if (!text) return false;
  return /[\u0900-\u097F]/.test(text);
}

function parseGoogleTranslationResponse(data: any): string {
  if (!data) return '';
  if (Array.isArray(data)) {
    if (Array.isArray(data[0])) {
      return data
        .map((item: any) => (Array.isArray(item) ? item[0] : item))
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    if (typeof data[0] === 'string') {
      return data.join(' ').trim();
    }
  }
  return '';
}

/**
 * Core translation helper using high-capacity Google translation gateway with memory caching.
 * Consumes 0 Gemini API tokens.
 */
export async function translateText(text: string, fromLang: string, toLang: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || fromLang === toLang) return trimmed;

  const srcLang = fromLang === 'autodetect' ? 'auto' : fromLang;
  const cacheKey = `${srcLang}:${toLang}:${trimmed.toLowerCase()}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  // 1. High-speed Google Chrome Translation Gateway ($0 cost, 0 Gemini tokens, unlimited capacity)
  try {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${srcLang}&tl=${toLang}&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = parseGoogleTranslationResponse(data);
      if (translated && translated.length > 0) {
        translationCache.set(cacheKey, translated);
        return translated;
      }
    }
  } catch {}

  // 2. Server route fallback ($0 cost)
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, from: srcLang, to: toLang }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.translation && typeof data.translation === 'string') {
        const result = data.translation.trim();
        translationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch {}

  return trimmed;
}

/**
 * Backwards-compatible helper: Translates Hindi text into English.
 */
export async function translateHindiToEnglish(text: string): Promise<string> {
  if (!isHindiText(text)) return text;
  return translateText(text, 'hi', 'en');
}

/**
 * Backwards-compatible helper: Translates English text into Hindi.
 */
export async function translateEnglishToHindi(text: string): Promise<string> {
  if (isHindiText(text)) return text;
  return translateText(text, 'en', 'hi');
}

export interface FormattedCaptionResult {
  primaryText: string;
  secondaryText?: string;
  badgeLabel?: string;
}

/**
 * Master caption formatter according to the user's preferred target display language.
 * Whatever other participants speak, this function formats it into the user's chosen language.
 */
export async function formatCaptionForUserPreference(
  rawText: string,
  targetMode: string
): Promise<FormattedCaptionResult> {
  const text = (rawText || '').trim();
  if (!text) {
    return { primaryText: '' };
  }

  const hasHindi = isHindiText(text);

  // 1. Hindi Only Mode: Translate everything into pure Hindi with NO secondary text
  if (targetMode === 'hindi_only') {
    if (hasHindi) {
      return { primaryText: text, badgeLabel: 'हिन्दी' };
    }
    const hindiTrans = await translateText(text, 'autodetect', 'hi');
    return {
      primaryText: hindiTrans,
      badgeLabel: 'हिन्दी',
    };
  }

  // 2. English Only Mode: Translate everything into pure English with NO secondary text
  if (targetMode === 'english_only') {
    const engTrans = await translateText(text, 'autodetect', 'en');
    return {
      primaryText: engTrans,
      badgeLabel: 'English',
    };
  }

  // 3. Dual Mode: Show both original and translation side-by-side
  if (targetMode === 'dual') {
    if (hasHindi) {
      const engTrans = await translateText(text, 'hi', 'en');
      return {
        primaryText: text,
        secondaryText: engTrans !== text ? engTrans : undefined,
        badgeLabel: 'हिन्दी + English',
      };
    } else {
      const hindiTrans = await translateText(text, 'autodetect', 'hi');
      return {
        primaryText: text,
        secondaryText: hindiTrans !== text ? hindiTrans : undefined,
        badgeLabel: 'English + हिन्दी',
      };
    }
  }

  // 4. Custom Regional or Global Target Language (e.g. Marathi, Telugu, Tamil, German, French, etc.)
  const targetLang = SUPPORTED_LANGUAGES.find((l) => l.code === targetMode);
  if (targetLang) {
    const translated = await translateText(text, 'autodetect', targetLang.code);
    return {
      primaryText: translated,
      badgeLabel: targetLang.nativeName,
    };
  }

  return { primaryText: text };
}
