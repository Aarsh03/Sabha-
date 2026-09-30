import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

interface ParticipantSummaryData {
  id?: string;
  name: string;
  email?: string | null;
  isHost?: boolean;
  isCoHost?: boolean;
}

interface TranscriptItemData {
  senderName: string;
  text: string;
  translation?: string;
  timestamp: number;
}

interface SummarizeRequestBody {
  roomId: string;
  title?: string;
  durationMinutes?: number;
  participants: ParticipantSummaryData[];
  transcript: TranscriptItemData[];
}

// Convert Markdown to clean, safe inline HTML for email clients
function markdownToEmailHtml(md: string): string {
  let html = md
    // Escape basic html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gim, '<h3 style="color:#f59e0b;font-size:16px;margin:18px 0 8px 0;font-weight:700;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="color:#d97706;font-size:19px;margin:22px 0 10px 0;border-bottom:1px solid #334155;padding-bottom:6px;font-weight:700;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="color:#f59e0b;font-size:22px;margin:16px 0 12px 0;font-weight:800;">$1</h1>')
    // Bold & Italics
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color:#f8fafc;">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Bullet lists
    .replace(/^\s*-\s+(.*$)/gim, '<li style="margin-bottom:6px;color:#cbd5e1;line-height:1.5;">$1</li>')
    .replace(/^\s*\*\s+(.*$)/gim, '<li style="margin-bottom:6px;color:#cbd5e1;line-height:1.5;">$1</li>')
    // Line breaks / paragraphs
    .replace(/\n\n/gim, '</p><p style="margin:10px 0;color:#cbd5e1;line-height:1.6;">')
    .replace(/\n/gim, '<br/>');

  // Wrap lists
  html = html.replace(/(<li[\s\S]*<\/li>)/, '<ul style="padding-left:20px;margin:10px 0;">$1</ul>');
  return `<p style="margin:10px 0;color:#cbd5e1;line-height:1.6;">${html}</p>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SummarizeRequestBody;
    const { roomId, title, durationMinutes = 1, participants = [], transcript = [] } = body;

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    const meetingTitle = title || `Sabha Assembly (${roomId})`;
    const dateFormatted = new Date().toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    // 1. Collect all participant emails from payload
    const hostEmails: string[] = Array.from(
      new Set(
        participants
          .filter((p) => (p.isHost || p.isCoHost) && p.email && p.email.includes('@'))
          .map((p) => p.email!.trim().toLowerCase())
      )
    );

    const attendeeEmails: string[] = Array.from(
      new Set(
        participants
          .filter((p) => !p.isHost && !p.isCoHost && p.email && p.email.includes('@'))
          .map((p) => p.email!.trim().toLowerCase())
          .filter((email) => !hostEmails.includes(email))
      )
    );

    // Double-check Firestore database roster to capture all registered participants
    if (isFirebaseConfigured() && db) {
      try {
        const snap = await getDocs(collection(db, `rooms/${roomId}/participants`));
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data && data.email && typeof data.email === 'string' && data.email.includes('@')) {
            const cleanEmail = data.email.trim().toLowerCase();
            if (data.isHost || data.isCoHost) {
              if (!hostEmails.includes(cleanEmail)) {
                hostEmails.push(cleanEmail);
              }
            } else {
              if (!hostEmails.includes(cleanEmail) && !attendeeEmails.includes(cleanEmail)) {
                attendeeEmails.push(cleanEmail);
              }
            }
          }
        });
      } catch (fsErr) {
        console.warn('Could not query Firestore participants for emails:', fsErr);
      }
    }

    const participantNames = participants.map((p) => p.name || 'Participant').join(', ');

    // 2. Generate Verbatim Transcript Text
    let transcriptText = '';
    if (transcript && transcript.length > 0) {
      const startTime = transcript[0].timestamp;
      const lines = transcript.map((t) => {
        const offsetSec = Math.max(0, Math.floor((t.timestamp - startTime) / 1000));
        const m = Math.floor(offsetSec / 60);
        const s = offsetSec % 60;
        const timeStr = `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}]`;
        const translatedPart = t.translation && t.translation !== t.text ? ` (${t.translation})` : '';
        return `${timeStr} ${t.senderName}: ${t.text}${translatedPart}`;
      });

      transcriptText = [
        `================================================================`,
        `SABHA (सभा) — OFFICIAL MEETING TRANSCRIPT`,
        `Meeting Title : ${meetingTitle}`,
        `Room ID       : ${roomId}`,
        `Date & Time   : ${dateFormatted}`,
        `Duration      : ${durationMinutes} minutes`,
        `Participants  : ${participantNames || 'None recorded'}`,
        `================================================================`,
        '',
        ...lines,
        '',
        `================================================================`,
        `End of Transcript — Sabha Real-Time Communications`,
        `================================================================`,
      ].join('\r\n');
    } else {
      transcriptText = [
        `================================================================`,
        `SABHA (सभा) — OFFICIAL MEETING TRANSCRIPT`,
        `Meeting Title : ${meetingTitle}`,
        `Room ID       : ${roomId}`,
        `Date & Time   : ${dateFormatted}`,
        `Duration      : ${durationMinutes} minutes`,
        `Participants  : ${participantNames || 'None recorded'}`,
        `================================================================`,
        '',
        `[No spoken transcript was captured during this Sabha assembly.]`,
        '',
        `================================================================`,
      ].join('\r\n');
    }

    // 3. AI Meeting Summary Generation via Gemini (3.5-flash / 3.8-flash)
    let aiSummaryMarkdown = '';
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (geminiKey && transcript && transcript.length > 0) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const dialogue = transcript
          .map((t) => {
            const tr = t.translation && t.translation !== t.text ? ` [Translation: ${t.translation}]` : '';
            return `${t.senderName}: ${t.text}${tr}`;
          })
          .join('\n');

        const prompt = `You are an elite executive AI assistant summarizing a Sabha (सभा) video conference.
Analyze the following meeting metadata and verbatim dialogue:

Meeting Title: ${meetingTitle}
Room ID: ${roomId}
Date: ${dateFormatted}
Duration: ${durationMinutes} minutes
Attendees: ${participantNames}

Verbatim Dialogue:
${dialogue.slice(0, 15000)}

Instructions:
- The spoken dialogue may contain Hindi (हिन्दी), Hinglish, or English speech.
- Accurately understand and translate any Hindi speech into clear, high-quality, professional English in the Executive Overview, Key Discussion Points & Decisions, and Action Items.
- Retain accurate names, key technical terms, and explicit decisions.

Please produce a concise, professional, beautifully formatted summary in Markdown with the following structured sections:
# 📋 Sabha Meeting Summary
**Meeting**: ${meetingTitle}
**Date**: ${dateFormatted}
**Duration**: ${durationMinutes} minutes
**Attendees**: ${participantNames}

## 🎯 Executive Overview
(Summarize the primary purpose, context, and key narrative of the assembly in 1-2 sharp paragraphs)

## 💡 Key Discussion Points & Decisions
(Bullet points highlighting core topics discussed, insights shared, and explicit decisions made)

## ⚡ Action Items & Next Steps
(Actionable tasks formatted with owner and task details, e.g. "- **[Owner]**: Description of task")

Ensure clarity, professional tone, and zero fluff.`;

        let result;
        const modelsToTry = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
        for (const model of modelsToTry) {
          try {
            result = await ai.models.generateContent({
              model,
              contents: prompt,
            });
            if (result && result.text) break;
          } catch (mErr: any) {
            console.warn(`Model ${model} failed, trying next:`, mErr?.message || mErr);
          }
        }

        aiSummaryMarkdown = result?.text || '';
      } catch (geminiError: any) {
        console.error('Gemini summarization failed:', geminiError?.message || geminiError);
      }
    }

    // Fallback summary if Gemini is offline or transcript empty
    if (!aiSummaryMarkdown) {
      aiSummaryMarkdown = `# 📋 Sabha Meeting Summary
**Meeting**: ${meetingTitle}
**Date**: ${dateFormatted}
**Duration**: ${durationMinutes} minutes
**Attendees**: ${participantNames || 'Attendees'}

## 🎯 Executive Overview
The Sabha assembly concluded successfully after ${durationMinutes} minutes. ${
        transcript.length > 0
          ? `A total of ${transcript.length} speech segments were captured.`
          : 'No spoken speech transcript was recorded during this session.'
      }

## 💡 Key Discussion Points & Decisions
- Meeting convened with participants: ${participantNames || 'Members of Sabha'}.
- Session ended by host or concluded naturally.

## ⚡ Action Items & Next Steps
- Review notes and follow up on any offline discussions.`;
    }

    const summaryHtmlContent = markdownToEmailHtml(aiSummaryMarkdown);

    // 4. Send Emails via Zoho Mail SMTP
    const zohoUser = process.env.ZOHO_MAIL_USER;
    const zohoPass = process.env.ZOHO_MAIL_PASS;
    const zohoHost = process.env.ZOHO_MAIL_HOST || 'smtp.zoho.in';
    const zohoPort = Number(process.env.ZOHO_MAIL_PORT || 465);

    const emailsDispatched = {
      hosts: 0,
      attendees: 0,
    };

    if (zohoUser && zohoPass) {
      const transporter = nodemailer.createTransport({
        host: zohoHost,
        port: zohoPort,
        secure: zohoPort === 465,
        auth: {
          user: zohoUser,
          pass: zohoPass,
        },
      });

      // Email Template Wrapper
      const createEmailTemplate = (isHostOrCoHost: boolean) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sabha Meeting Notes</title>
</head>
<body style="margin:0;padding:0;background-color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f1f5f9;">
  <div style="max-width:680px;margin:24px auto;padding:24px 16px;">
    
    <!-- Header Card -->
    <div style="background:linear-gradient(135deg, #1e293b 0%, #0f172a 100%);border:1px solid #334155;border-radius:16px;padding:28px 24px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);margin-bottom:20px;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <span style="display:inline-block;padding:4px 10px;background-color:#f59e0b;color:#0f172a;font-weight:900;font-size:12px;border-radius:8px;text-transform:uppercase;letter-spacing:1px;margin-right:10px;">
          SABHA (सभा)
        </span>
        <span style="color:#94a3b8;font-size:13px;">AI Meeting Intelligence</span>
      </div>
      <h1 style="color:#f8fafc;font-size:24px;margin:0 0 8px 0;font-weight:800;">
        ${meetingTitle}
      </h1>
      <p style="color:#94a3b8;font-size:13px;margin:0;">
        Completed on ${dateFormatted} &bull; Total Duration: ${durationMinutes} min
      </p>
    </div>

    <!-- Main Summary Card -->
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:28px 24px;margin-bottom:20px;">
      ${summaryHtmlContent}
    </div>

    <!-- Host Attachment Notice -->
    ${
      isHostOrCoHost
        ? `
    <div style="background:rgba(245, 158, 11, 0.08);border:1px solid rgba(245, 158, 11, 0.25);border-radius:12px;padding:16px 20px;margin-bottom:20px;">
      <div style="color:#fbbf24;font-size:14px;font-weight:700;margin-bottom:4px;">
        📎 Complete Verbatim Transcript Attached
      </div>
      <div style="color:#cbd5e1;font-size:13px;line-height:1.5;">
        As the Host / Co-host, the complete speaker-tagged verbatim meeting dialogue has been attached to this email as <strong>sabha-${roomId}-transcript.txt</strong>.
      </div>
    </div>`
        : ''
    }

    <!-- Footer -->
    <div style="text-align:center;padding:12px;color:#64748b;font-size:12px;">
      Sent automatically by <strong>Sabha (सभा)</strong> Real-Time Video Platform &bull; Zero-infrastructure AI meetings.
    </div>

  </div>
</body>
</html>`;

      // 4a. Send to Host & Co-Hosts (Includes .txt Transcript Attachment)
      if (hostEmails.length > 0) {
        try {
          await transporter.sendMail({
            from: `"Sabha Assembly" <${zohoUser}>`,
            to: hostEmails.join(', '),
            subject: `[Sabha Summary & Transcript] ${meetingTitle}`,
            html: createEmailTemplate(true),
            text: `${aiSummaryMarkdown}\n\n[Full Verbatim Transcript Attached as .txt]`,
            attachments: [
              {
                filename: `sabha-${roomId}-transcript.txt`,
                content: transcriptText,
                contentType: 'text/plain',
              },
            ],
          });
          emailsDispatched.hosts = hostEmails.length;
        } catch (sendHostErr) {
          console.error('Error emailing host/co-hosts:', sendHostErr);
        }
      }

      // 4b. Send to Attendees (Summary Notes Only, individual delivery to each attendee)
      if (attendeeEmails.length > 0) {
        for (const recipient of attendeeEmails) {
          try {
            await transporter.sendMail({
              from: `"Sabha Assembly" <${zohoUser}>`,
              to: recipient,
              subject: `[Sabha Meeting Notes] ${meetingTitle}`,
              html: createEmailTemplate(false),
              text: aiSummaryMarkdown,
            });
            emailsDispatched.attendees += 1;
          } catch (sendAttendeeErr) {
            console.error(`Error emailing attendee ${recipient}:`, sendAttendeeErr);
          }
        }
      }
    } else {
      console.warn('Zoho Mail credentials not configured in environment variables.');
    }

    return NextResponse.json({
      success: true,
      summary: aiSummaryMarkdown,
      emailsDispatched,
      totalHostRecipients: hostEmails.length,
      totalAttendeeRecipients: attendeeEmails.length,
    });
  } catch (error: any) {
    console.error('Error in summarize-and-email route:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error processing meeting summary' },
      { status: 500 }
    );
  }
}
