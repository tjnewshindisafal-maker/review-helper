const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function getBusinesses() {
  const raw = fs.readFileSync(path.join(__dirname, 'businesses.json'), 'utf8');
  return JSON.parse(raw);
}

const tones = [
  'Write like a busy person who rarely writes reviews but felt strongly enough to do it.',
  'Write like a regular local customer who genuinely recommends this place.',
  'Write like someone who was skeptical at first but was pleasantly surprised.',
  'Write like a first-time customer who was very impressed.',
  'Write like someone recommending this place to a close friend in casual language.',
  'Write like a person who tried multiple options before choosing this one.',
];

const structures = [
  'Start with what brought you there, then what impressed you, end with recommendation.',
  'Start with the best thing you noticed, add a specific detail, end with whether you will return.',
  'Start with overall feeling, mention one specific moment, end with rating opinion.',
  'Start with the problem you came with, explain how it was solved, end with satisfaction.',
  'Start with a specific detail you noticed, explain why it mattered, end with overall impression.',
];

app.get('/business/:id', (req, res) => {
  try {
    const businesses = getBusinesses();
    const biz = businesses[req.params.id];
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    res.json(biz);
  } catch (err) {
    res.status(500).json({ error: 'Could not load business data' });
  }
});

app.post('/generate-review', async (req, res) => {
  try {
    const { bizId, department, service, stars, highlights, note } = req.body;
    const businesses = getBusinesses();
    const biz = businesses[bizId];
    if (!biz) return res.status(404).json({ error: 'Business not found' });

    let doctor = '';
    let keywords = biz.keywords || [];

    if (biz.type === 'multi' && department && biz.departments) {
      const dept = biz.departments.find(d => d.id === department);
      if (dept) {
        if (biz.showDoctor) doctor = dept.doctor || '';
        keywords = dept.keywords || [];
      }
    } else {
      if (biz.showDoctor) {
        doctor = biz.doctor || biz.staff || '';
      }
    }

    const randomTone = tones[Math.floor(Math.random() * tones.length)];
    const randomStructure = structures[Math.floor(Math.random() * structures.length)];
    const starWord = ['', 'very bad', 'disappointing', 'okay', 'really good', 'excellent'][stars] || 'good';

    const prompt = `You are a real human customer writing a genuine Google review. You are NOT an AI. Sound 100% like a real person.

Business: "${biz.name}"
${service ? `Service taken: ${service}` : ''}
${doctor ? `Doctor/Staff: ${doctor} — mention their name naturally in the review.` : ''}
Star rating: ${stars}/5 — ${starWord} experience
What they liked: ${highlights?.length ? highlights.join(', ') : 'overall experience'}
${note ? `Personal note: ${note}` : ''}
${keywords.length ? `Naturally include 1-2 of these keywords where they fit: ${keywords.join(', ')}` : ''}

Tone: ${randomTone}
Structure: ${randomStructure}

STRICT RULES:
- 2 to 4 sentences only. Max 90 words.
- Simple everyday language. No fancy words.
- Include ONE specific realistic detail.
- Mix short and long sentences naturally.
- Small grammar imperfections are okay.
- Never start with "I" — start differently.
- No hashtags, no emojis, no "highly recommend", no "five stars", no "A++".
- Do NOT sound like AI or marketing copy.
- Output ONLY the review text. No quotes. Nothing else.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 200,
      temperature: 1.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const review = completion.choices[0]?.message?.content?.trim();
    res.json({ review });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ReviewHelper running on http://localhost:${PORT}`));
