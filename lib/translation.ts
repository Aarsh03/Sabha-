/**
 * Sabha (सभा) - Real-Time Translation Utility
 * Detects Hindi and English speech and translates with zero token cost.
 * Prioritizes free public translation gateways and client memory cache
 * so real-time speech consumes 0 Gemini API tokens during the meeting.
 */

const translationCache = new Map<string, string>();

/**
 * Checks if a string contains Hindi / Devanagari script characters
 */
export function isHindiText(text: string): boolean {
  if (!text) return false;
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Translates Hindi text into English with free fast gateway and memory caching.
 */
export async function translateHindiToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // If text does not contain Hindi Devanagari characters, return as-is
  if (!isHindiText(trimmed)) {
    return trimmed;
  }

  const cacheKey = `hi-en:${trimmed}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  // 1. Client-side Fast Free Translation Gateway ($0 cost, 0 Gemini tokens)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=hi|en`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = data?.responseData?.translatedText;
      if (translated && typeof translated === 'string' && !translated.startsWith('MYMEMORY WARNING')) {
        const result = translated.trim();
        translationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Server API fallback if configured
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, from: 'hi', to: 'en' }),
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
 * Translates English text into Hindi with free fast gateway and memory caching.
 */
export async function translateEnglishToHindi(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // If text is already in Devanagari, return as-is
  if (isHindiText(trimmed)) {
    return trimmed;
  }

  const cacheKey = `en-hi:${trimmed.toLowerCase()}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  // 1. Client-side Fast Free Translation Gateway ($0 cost, 0 Gemini tokens)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|hi`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = data?.responseData?.translatedText;
      if (translated && typeof translated === 'string' && !translated.startsWith('MYMEMORY WARNING')) {
        const result = translated.trim();
        translationCache.set(cacheKey, result);
        return result;
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Server API fallback if configured
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, from: 'en', to: 'hi' }),
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
