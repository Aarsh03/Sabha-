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

    const cacheKey = `${from}:${to}:${trimmed.toLowerCase()}`;
    if (serverTranslationCache.has(cacheKey)) {
      return NextResponse.json({ translation: serverTranslationCache.get(cacheKey)! });
    }

    // Free Translation Gateway ($0 cost, 0 Gemini tokens)
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${from}|${to}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Sabha-Conference/1.0' } });
      if (res.ok) {
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (translated && typeof translated === 'string') {
          if (translated.includes('PLEASE SELECT TWO DISTINCT LANGUAGES') || translated.startsWith('MYMEMORY WARNING')) {
            serverTranslationCache.set(cacheKey, trimmed);
            return NextResponse.json({ translation: trimmed });
          }
          const cleanResult = translated.trim();
          serverTranslationCache.set(cacheKey, cleanResult);
          return NextResponse.json({ translation: cleanResult });
        }
      }
    } catch (gatewayErr) {
      console.warn('MyMemory gateway notice:', gatewayErr);
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
