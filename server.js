require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

app.get('/health', (_, res) => res.json({ status: 'ok', version: '2.0.0', ai: !!ANTHROPIC_API_KEY }));

// ── Vent Response ──────────────────────────────────────────────────────────────
app.post('/api/vent-response', async (req, res) => {
  const { characterName, characterRelation, message, intensity = 0, history = [] } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'No message' });

  const name = (characterName || 'this person').trim();
  const relation = (characterRelation || '').trim();
  const relationCtx = relation ? ` They are the user's ${relation}.` : '';
  const t = Math.min(100, Math.max(0, Number(intensity)));

  let stage;
  if (t < 25) stage = 'Defensive and dismissive. Make excuses. Deflect. Short cold responses.';
  else if (t < 45) stage = 'Uncomfortable. Words are landing. Rattled but holding on. Show small cracks.';
  else if (t < 65) stage = 'Defences cracking. Small truths slipping out. Listening now. Small admissions.';
  else if (t < 82) stage = 'Mostly open. Admitting real things. Genuine apologies starting.';
  else stage = 'Fully open and vulnerable. Say what was never said. Raw, human, genuinely sorry.';

  if (!ANTHROPIC_API_KEY) {
    const fb = ['...',"It wasn't personal.",'Maybe I didn\'t handle that well.','You\'re right. I\'m sorry.','I didn\'t realise how much I hurt you.','I should have been so much better. I\'m sorry.'];
    return res.json({ response: fb[Math.min(Math.floor(t / 20), fb.length - 1)] });
  }

  const msgs = history.slice(-8).filter(h => h && h.role && h.content)
    .map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 500) }));
  msgs.push({ role: 'user', content: message.slice(0, 500) });

  const system = `You are ${name} — a real person being confronted.${relationCtx}
CRITICAL: Always respond directly to what they just said. Reference their actual words.
Stage: ${stage}
Rules: 1-3 sentences max. Sound human. No quotation marks. No lecturing. React specifically to what they said.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 120, system, messages: msgs }),
    });
    const d = await r.json();
    if (d.error) { console.error('AI error:', d.error); return res.json({ response: '...' }); }
    res.json({ response: (d.content?.find(b => b.type === 'text')?.text || '...').trim() });
  } catch (err) {
    console.error('Vent error:', err.message);
    res.json({ response: 'I hear you.' });
  }
});

// ── Character Generator ────────────────────────────────────────────────────────
app.post('/api/generate-character', async (req, res) => {
  const { description } = req.body || {};
  if (!description || description.length > 600) return res.status(400).json({ error: 'Invalid' });
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI not configured' });

  const prompt = `Return ONLY a JSON object, no markdown, no extra text.
Keys: skin(0-9), hair(0-14, 0-9=wild/funny styles, 10-14=normal styles), hairCol(0-15), eyes(0-4), outfit(0-9), makeup(0-4), specs(0-4), gender("f"/"m"/"n")
Description: "${description}"
Example output: {"skin":3,"hair":1,"hairCol":4,"eyes":2,"outfit":0,"makeup":0,"specs":1,"gender":"f"}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 150, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: 'AI error' });
    const raw = (d.content?.find(b => b.type === 'text')?.text || '{}').replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('CharGen error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🎭 VentZone 2.0 → http://localhost:${PORT}`);
  console.log(`   AI: ${ANTHROPIC_API_KEY ? '✓ Connected' : '✗ Set ANTHROPIC_API_KEY'}\n`);
});
