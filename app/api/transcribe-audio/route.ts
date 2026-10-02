import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const { audio, mimeType = 'audio/webm', language = 'hi-IN' } = await req.json();

    if (!audio || typeof audio !== 'string') {
      return NextResponse.json({ error: 'Missing audio base64 payload' }, { status: 400 });
    }

    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const modelsToTry = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];

    const langDescription =
      language === 'hi-IN'
        ? 'Hindi (हिन्दी) or Indian English / Hinglish'
        : language === 'en-IN'
        ? 'Indian English'
        : 'English';

    const prompt = `You are a real-time speech-to-text audio transcription engine.
Transcribe the speech in this audio clip verbatim. The expected spoken language context is ${langDescription}.

Instructions:
1. If the speaker spoke, output a raw JSON object with:
   {"text": "transcribed speech in the original spoken language", "translation": "English translation if spoken in Hindi, otherwise the exact same as text"}
2. If the audio is silence, breathing, microphone clicking, coughing, or unintelligible noise, output:
   {"text": "", "translation": ""}
3. Return raw JSON only, without markdown backticks or commentary.`;

    // Clean audio base64 if it has data URL prefix
    const base64Data = audio.replace(/^data:[^;]+;base64,/, '');

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType: mimeType.split(';')[0] || 'audio/webm',
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        });

        const raw = (response?.text || '').trim();
        if (!raw) continue;

        // Remove any markdown code fences if present
        const jsonStr = raw
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```$/i, '')
          .trim();

        try {
          const parsed = JSON.parse(jsonStr);
          const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
          const translation =
            typeof parsed.translation === 'string' && parsed.translation.trim()
              ? parsed.translation.trim()
              : text;

          return NextResponse.json({
            text,
            translation,
          });
        } catch {
          // If response is not JSON, check if it's plain text transcription
          if (raw && !raw.toLowerCase().includes('silence') && !raw.startsWith('{')) {
            return NextResponse.json({
              text: raw,
              translation: raw,
            });
          }
          return NextResponse.json({ text: '', translation: '' });
        }
      } catch (err: any) {
        console.warn(`[transcribe-audio] Model ${model} failed, trying next:`, err?.message || err);
      }
    }

    return NextResponse.json({ text: '', translation: '' });
  } catch (error: any) {
    console.error('Error in /api/transcribe-audio:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal audio transcription error' },
      { status: 500 }
    );
  }
}
