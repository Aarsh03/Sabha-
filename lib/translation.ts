/**
 * Sabha (सभा) - Real-Time Translation Utility
 * Detects Hindi speech and translates to English using Gemini API and fast fallback.
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
 * Translates Hindi text into English with multi-tier fallback and memory caching.
 */
export async function translateHindiToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // If text does not contain Hindi Devanagari characters, return as-is
  if (!isHindiText(trimmed)) {
    return trimmed;
  }

  // Check cache
  if (translationCache.has(trimmed)) {
    return translationCache.get(trimmed)!;
  }

  // 1. Try Sabha Gemini Translation Endpoint
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
        translationCache.set(trimmed, result);
        return result;
      }
    }
  } catch (apiErr) {
    // Continue to fallback
  }

  // 2. Client-side Fast Fallback via Free Public Translation Gateway
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=hi|en`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translated = data?.responseData?.translatedText;
      if (translated && typeof translated === 'string' && !translated.startsWith('MYMEMORY WARNING')) {
        const result = translated.trim();
        translationCache.set(trimmed, result);
        return result;
      }
    }
  } catch (fallbackErr) {
    console.warn('Translation fallback notice:', fallbackErr);
  }

  return trimmed;
}
