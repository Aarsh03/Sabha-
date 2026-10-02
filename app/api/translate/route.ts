import { NextRequest, NextResponse } from 'next/server';

const serverTranslationCache = new Map<string, string>();

/**
 * Free translation proxy route for Sabha live subtitles.
 * Runs 100% on free public gateways with server memory caching.
 * Consumes ZERO Gemini API tokens so quota is preserved for meeting summaries.
 */
export async function POST(req: NextRequest) {
  try {
    const { text, from = 'autodetect', to = 'en' } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const trimmed = text.trim();
    if (!trimmed || from === to) {
      return NextResponse.json({ translation: trimmed });
    }

    const srcLang = from === 'autodetect' ? 'auto' : from;
    const cacheKey = `${srcLang}:${to}:${trimmed.toLowerCase()}`;
    if (serverTranslationCache.has(cacheKey)) {
      return NextResponse.json({ translation: serverTranslationCache.get(cacheKey)! });
    }

    // Google Chrome Fast Translation Gateway ($0 cost, 0 Gemini tokens, unlimited quota)
    try {
      const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${srcLang}&tl=${to}&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (res.ok) {
        const data = await res.json();
        let translatedText = '';
        if (Array.isArray(data)) {
          if (Array.isArray(data[0])) {
            translatedText = data
              .map((item: any) => (Array.isArray(item) ? item[0] : item))
              .filter(Boolean)
              .join(' ')
              .trim();
          } else if (typeof data[0] === 'string') {
            translatedText = data.join(' ').trim();
          }
        }
        if (translatedText) {
          serverTranslationCache.set(cacheKey, translatedText);
          return NextResponse.json({ translation: translatedText });
        }
      }
    } catch (gatewayErr) {
      console.warn('Google translation gateway notice:', gatewayErr);
    }

    // Default to original text if translation fails
    return NextResponse.json({ translation: trimmed });
  } catch (error: any) {
    console.error('Translate route error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal translation error' },
      { status: 500 }
    );
  }
}
