import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const { text, from = 'hi', to = 'en' } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json({ translation: '' });
    }

    // 1. Try Gemini API
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const prompt = `You are a real-time conference translator. Translate this Hindi spoken statement directly to natural English. Output ONLY the English translation without preamble or quotes:\n\n${trimmed}`;

        const modelsToTry = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
        for (const model of modelsToTry) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: prompt,
            });
            const translated = response?.text?.trim();
            if (translated) {
              return NextResponse.json({ translation: translated });
            }
          } catch (modelErr) {
            // Try next model
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini translate error, falling back:', geminiErr);
      }
    }

    // 2. Free Translation Gateway Fallback
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${from}|${to}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (translated && typeof translated === 'string' && !translated.startsWith('MYMEMORY WARNING')) {
          return NextResponse.json({ translation: translated.trim() });
        }
      }
    } catch (fallbackErr) {
      console.warn('MyMemory translation error:', fallbackErr);
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
