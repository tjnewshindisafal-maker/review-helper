const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const businesses = {
  orthoderma: {
    name: 'Orthoderma Skin & Joint Clinic',
    googleLink: 'https://g.page/r/Ca3mxnzw0BJ1EBM/review',
    type: 'multi',
    departments: [
      {
        id: 'ortho',
        label: 'Orthopedic / Joint',
        icon: '🦴',
        doctor: 'Dr. Pradeep Jadhav',
        services: ['Knee Replacement', 'Hip Replacement', 'Spine Treatment', 'Joint Pain', 'Fracture Treatment', 'Sports Injury', 'Arthritis', 'General Checkup'],
        chips: ['Pain relief', 'Expert surgeon', 'Successful surgery', 'Quick recovery', 'Caring staff', 'Clean facility', 'Affordable', 'Good follow-up'],
        keywords: ['orthopedic', 'joint replacement', 'knee', 'hip', 'spine', 'bone', 'surgery', 'pain relief']
      },
      {
        id: 'derm',
        label: 'Dermatology / Skin',
        icon: '✨',
        doctor: 'Dr. Parineeta Khade',
        services: ['Acne Treatment', 'Skin Allergy', 'Hair Loss', 'Anti-aging', 'Pigmentation', 'Eczema', 'Psoriasis', 'General Skin Checkup'],
        chips: ['Clear skin results', 'Expert dermatologist', 'Safe treatment', 'Affordable', 'Good skincare advice', 'Quick results', 'Caring staff', 'Clean clinic'],
        keywords: ['dermatology', 'skin', 'acne', 'treatment', 'skincare', 'dermatologist', 'skin clinic']
      }
    ]
  },
  potdar: {
    name: 'Dr. Potdar Dental Care',
    googleLink: 'https://g.page/r/CS9Y-L-vdJsnEBM/review',
    type: 'dental',
    doctor: 'Dr. Chetan Bhat',
    services: ['Root Canal', 'Dental Implant', 'Teeth Cleaning', 'Braces / Aligners', 'Tooth Extraction', 'Teeth Whitening', 'Dentures', 'General Checkup'],
    chips: ['Painless treatment', 'Expert dentist', 'Modern equipment', 'Clean clinic', 'Affordable', 'Friendly staff', 'Quick appointment', 'Great results'],
    keywords: ['dental', 'dentist', 'teeth', 'painless', 'implant', 'oral health', 'dental clinic', 'Ravet', 'Nigdi']
  },
  vaishali: {
    name: "Dr. Vaishali's Dental Care",
    googleLink: 'https://g.page/r/CQ4eaFS-aTdQEBM/review',
    type: 'dental',
    doctor: 'Dr. Vaishali',
    services: ['Root Canal', 'Dental Implant', 'Teeth Cleaning', 'Braces / Aligners', 'Tooth Extraction', 'Teeth Whitening', 'Kids Dentistry', 'General Checkup'],
    chips: ['Painless treatment', 'Gentle doctor', 'Modern equipment', 'Clean clinic', 'Affordable', 'Friendly staff', 'Kid friendly', 'Great results'],
    keywords: ['dental', 'dentist', 'teeth', 'painless', 'implant', 'oral health', 'Wakad', 'Pune']
  },
  reshine: {
    name: 'Reshine Studio',
    googleLink: 'https://g.page/r/CXxA0WugHjVuEBM/review',
    type: 'automotive',
    staff: 'Sameer',
    services: ['PPF (Paint Protection Film)', 'Ceramic Coating', 'Full Car Detailing', 'Interior Detailing', 'Car Wash', 'Headlight Restoration', 'Dent Removal', 'Window Tinting'],
    chips: ['Perfect finish', 'Expert team', 'Quality materials', 'Affordable', 'On-time delivery', 'Trustworthy', 'Great detailing', 'Professional work'],
    keywords: ['PPF', 'car detailing', 'ceramic coating', 'car wash', 'paint protection', 'auto detailing', 'Kharadi', 'Pune']
  },
  anelectronics: {
    name: 'A N Electronics',
    googleLink: 'https://g.page/r/CRJozOTFeW6PEBM/review',
    type: 'electronics',
    staff: 'Ali',
    services: ['LED TV Repair', 'LCD TV Repair', 'Mobile Repair', 'Laptop Repair', 'AC Repair', 'Washing Machine Repair', 'PCB Repair', 'General Service'],
    chips: ['Fast repair', 'Affordable price', 'Genuine parts', 'Expert technician', 'Quick service', 'Trustworthy', 'Good warranty', 'Professional'],
    keywords: ['LED TV repair', 'LCD repair', 'electronics repair', 'TV service', 'technician', 'mobile repair']
  }
};

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
  'Start with overall feeling, mention one specific moment or person, end with rating opinion.',
  'Start with the problem you came with, explain how it was solved, end with satisfaction.',
  'Start with a specific detail you noticed, explain why it mattered, end with overall impression.',
];

app.get('/business/:id', (req, res) => {
  const biz = businesses[req.params.id];
  if (!biz) return res.status(404).json({ error: 'Business not found' });
  res.json(biz);
});

app.post('/generate-review', async (req, res) => {
  const { bizId, department, service, stars, highlights, note } = req.body;

  const biz = businesses[bizId];
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  let doctor = '';
  let keywords = [];
  let bizType = biz.type;

  if (biz.type === 'multi' && department) {
    const dept = biz.departments.find(d => d.id === department);
    if (dept) {
      doctor = dept.doctor;
      keywords = dept.keywords;
    }
  } else {
    doctor = biz.doctor || '';
    keywords = biz.keywords || [];
    if (biz.staff) doctor = biz.staff;
  }

  const randomTone = tones[Math.floor(Math.random() * tones.length)];
  const randomStructure = structures[Math.floor(Math.random() * structures.length)];
  const starWord = ['', 'very bad', 'disappointing', 'okay', 'really good', 'excellent'][stars] || 'good';

  const prompt = `You are a real human customer writing a genuine Google review. You are NOT an AI. Sound 100% like a real person.

Business: "${biz.name}"
${service ? `Service taken: ${service}` : ''}
${doctor ? `Doctor/Staff name: ${doctor}` : ''}
Star rating: ${stars}/5 — ${starWord} experience
What they liked: ${highlights?.length ? highlights.join(', ') : 'overall experience'}
${note ? `Personal note: ${note}` : ''}

Naturally include 1-2 of these SEO keywords where they fit: ${keywords.join(', ')}
${doctor ? `Mention ${doctor} naturally in the review — as if you remember them personally.` : ''}
${service ? `Mention the "${service}" service naturally.` : ''}

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

  try {
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
