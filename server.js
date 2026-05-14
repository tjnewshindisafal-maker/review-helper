const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// ============ STARTUP ENV CHECK ============
const REQUIRED_ENV = ['GROQ_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'ADMIN_PASS'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('ERROR: Missing required environment variables:', missing.join(', '));
  console.error('Create a .env file or set these variables before starting.');
  process.exit(1);
}
const ADMIN_PASS = process.env.ADMIN_PASS;
// ============ END ENV CHECK ============

const PLACES_CACHE_FILE = path.join(__dirname, 'places_cache.json');

function getPlacesCache() {
  try {
    if (fs.existsSync(PLACES_CACHE_FILE))
      return JSON.parse(fs.readFileSync(PLACES_CACHE_FILE, 'utf8'));
  } catch(e) {}
  return {};
}

function savePlacesCache(data) {
  fs.writeFileSync(PLACES_CACHE_FILE, JSON.stringify(data, null, 2));
}

async function fetchGooglePlaceData(placeId, apiKey) {
  const fields = 'name,rating,user_ratings_total,photos,opening_hours,formatted_address,formatted_phone_number,reviews';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error('Places API: ' + data.status);
  return data.result;
}

async function refreshAllPlacesData() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) { console.log('No GOOGLE_PLACES_API_KEY set — skipping Places refresh'); return; }

  const businesses = getBusinesses();
  const cache = getPlacesCache();
  let updated = 0;

  for (const [bizId, biz] of Object.entries(businesses)) {
    if (!biz.placeId) continue;
    try {
      console.log(`Fetching Google data for: ${biz.name}`);
      const place = await fetchGooglePlaceData(biz.placeId, apiKey);

      const photos = [];
      if (place.photos && place.photos.length > 0) {
        place.photos.slice(0, 6).forEach(photo => {
          const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photo.photo_reference}&key=${apiKey}`;
          photos.push({ url: photoUrl, attribution: photo.html_attributions?.[0] || '' });
        });
      }

      const reviews = (place.reviews || []).slice(0, 5).map(r => ({
        name: r.author_name, rating: r.rating, text: r.text, time: r.relative_time_description
      }));

      cache[bizId] = {
        rating: place.rating || 5.0,
        reviewCount: place.user_ratings_total || 0,
        photos, reviews,
        hours: place.opening_hours?.weekday_text || [],
        address: place.formatted_address || biz.fullAddress || '',
        phone: place.formatted_phone_number || biz.phone || '',
        fetchedAt: new Date().toISOString()
      };
      updated++;
      await new Promise(r => setTimeout(r, 500));
    } catch(e) { console.log(`Error fetching ${biz.name}:`, e.message); }
  }

  savePlacesCache(cache);
  console.log(`Places cache updated: ${updated} businesses`);
}

setTimeout(refreshAllPlacesData, 10000);
setInterval(refreshAllPlacesData, 24 * 60 * 60 * 1000);

const ALLOWED_ORIGINS = [
  'https://reviews.advizrmedia.com',
  'https://advizrmedia.com',
  'http://localhost:3000'
];

const rateLimitMap = new Map();
function rateLimit(ip, max = 30, windowMs = 60000) {
  const now = Date.now();
  const prev = rateLimitMap.get(ip) || [];
  const times = prev.filter(t => now - t < windowMs);
  if (times.length >= max) return false;
  times.push(now);
  rateLimitMap.set(ip, times);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateLimitMap.entries()) {
    if (times.every(t => now - t > 60000)) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

const BUSINESSES_FILE = path.join(__dirname, 'businesses.json');
let _businessCache = null;

function getBusinesses() {
  if (_businessCache) return _businessCache;
  _businessCache = JSON.parse(fs.readFileSync(BUSINESSES_FILE, 'utf8'));
  return _businessCache;
}

function saveBusinesses(data) {
  _businessCache = data;
  fs.writeFileSync(BUSINESSES_FILE, JSON.stringify(data, null, 2));
}

const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');
let _analyticsCache = null;

function getAnalytics() {
  if (_analyticsCache) return _analyticsCache;
  try {
    if (fs.existsSync(ANALYTICS_FILE))
      _analyticsCache = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
  } catch(e) {}
  _analyticsCache = _analyticsCache || {};
  return _analyticsCache;
}

function saveAnalytics(data) {
  _analyticsCache = data;
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));
}

function trackEvent(bizId, event) {
  const data = getAnalytics();
  if (!data[bizId]) data[bizId] = { scans:0, generated:0, submitted:0, negative:0 };
  data[bizId][event] = (data[bizId][event] || 0) + 1;
  data[bizId].lastActivity = new Date().toISOString();
  saveAnalytics(data);
}

const app = express();

app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const sensitiveRoutes = ['/add-business', '/delete-business', '/update-business', '/refresh-places', '/update-place-ids', '/analytics-all', '/analytics'];
  if (sensitiveRoutes.some(r => req.path.startsWith(r))) {
    if (!rateLimit(ip, 20, 60000)) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

app.use((req, res, next) => {
  const suspicious = ['.env', '.git', 'wp-admin', 'phpmy', '.php', 'shell', 'eval(', '../'];
  if (suspicious.some(s => req.path.toLowerCase().includes(s))) return res.status(404).send('Not found');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const tones = [
  'Write like a busy working professional who rarely reviews but was genuinely impressed.',
  'Write like a regular local customer casually recommending to neighbors.',
  'Write like someone who was skeptical at first but was pleasantly surprised.',
  'Write like a first-time visitor who did not expect such good service.',
  'Write like someone telling a close friend about this place over chai.',
  'Write like a middle-aged parent who brought family and was happy.',
  'Write like a young person who found this place through a friend.',
  'Write like someone who compared multiple options before choosing this.',
  'Write like a regular customer who has been coming for months.',
  'Write like someone who had a specific problem and got it solved perfectly.',
];
const structures = [
  'Start with what brought you there. Mention one specific thing that stood out. End with whether you will return.',
  'Start with the best thing you noticed. Add one small personal detail. End with recommendation.',
  'Start with your overall feeling in one word or phrase. Share one specific moment. End casually.',
  'Start with the problem you came with. Explain how it was handled. End with how you feel now.',
  'Start with how long you waited or how quick it was. Mention quality. End with rating.',
  'Start with comparing it to similar places. Share what made this better. End with recommendation.',
  'Start mid-story as if continuing a conversation. Share the highlight. End naturally.',
];
const openings = [
  '', '', '', 'Honestly, ', 'Really happy with ', 'Visited last week — ',
  'Finally found ', 'Came here after ', 'Came across this recently — ',
  'Been using this for ', 'A colleague suggested ', 'Stopped by last week — ',
];

const bizContext = {
  tech: 'You are a business owner or manager evaluating this tech solution.',
  clinic: 'You are a patient who visited for a health concern.',
  dental: 'You are a patient who visited for dental treatment.',
  salon: 'You are someone who visited for a personal grooming service.',
  restaurant: 'You are a food lover who dined here.',
  gym: 'You are someone who uses this facility for fitness.',
  default: 'You are a customer who used this service.'
};
function getBizContext(biz) {
  const name = (biz.name + ' ' + (biz.category||'')).toLowerCase();
  if(name.includes('software') || name.includes('tech') || name.includes('it ') || name.includes('digital')) return bizContext.tech;
  if(name.includes('dental') || name.includes('teeth') || name.includes('dentist')) return bizContext.dental;
  if(name.includes('clinic') || name.includes('hospital') || name.includes('health') || name.includes('doctor') || name.includes('heart')) return bizContext.clinic;
  if(name.includes('salon') || name.includes('spa') || name.includes('beauty') || name.includes('hair')) return bizContext.salon;
  if(name.includes('restaurant') || name.includes('food') || name.includes('biryani') || name.includes('cafe') || name.includes('dhaba')) return bizContext.restaurant;
  if(name.includes('gym') || name.includes('fitness') || name.includes('yoga')) return bizContext.gym;
  return bizContext.default;
}

const humanTouches = [
  'will definitely go back',
  'already referred 2-3 people',
  'booked my next appointment already',
  'worth the money honestly',
  'zero complaints',
  'pleasantly surprised tbh',
  'barely had to wait',
  'was comfortable throughout',
  'staff was helpful and not pushy',
  'no second thoughts about coming back',
  'the whole thing was hassle free',
  'got what I needed without any drama',
  'quite happy with the result',
  'not switching to anyone else',
  'did not feel like a typical place',
  'exactly what I was looking for',
  'relieved honestly',
  'have already recommended it',
  'process was simple and quick',
  'surprisingly smooth experience',
];

app.get('/business/:id', (req, res) => {
  try {
    const businesses = getBusinesses();
    const biz = businesses[req.params.id];
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    trackEvent(req.params.id, 'scans');
    res.json(biz);
  } catch (err) { res.status(500).json({ error: 'Could not load business data' }); }
});

app.post('/generate-review', async (req, res) => {
  try {
    const { bizId, department, service, stars, highlights, note, language } = req.body;
    const businesses = getBusinesses();
    const biz = businesses[bizId];
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    trackEvent(bizId, 'generated');
    let doctor = '';
    let keywords = biz.keywords || [];
    if (biz.type === 'multi' && department && biz.departments) {
      const dept = biz.departments.find(d => d.id === department);
      if (dept) { if (biz.showDoctor) doctor = dept.doctor || ''; keywords = dept.keywords || []; }
    } else { if (biz.showDoctor) doctor = biz.doctor || biz.staff || ''; }
    const randomTone = tones[Math.floor(Math.random() * tones.length)];
    const randomStructure = structures[Math.floor(Math.random() * structures.length)];
    const starWord = ['','very bad','disappointing','okay','really good','excellent'][stars] || 'good';
    const langMap = {
      english: 'Write in English only.',
      hindi: 'Write in Hindi only (Devanagari script).',
      marathi: 'Write in Marathi only (Devanagari script).',
      hinglish: 'Write in Hinglish (mix of Hindi and English, Roman script).'
    };
    const langInstruction = langMap[language] || langMap.english;
    const mentionBizName = Math.random() < 0.30;
    const mentionDoctor  = Math.random() < 0.20;
    const rOpening  = openings[Math.floor(Math.random() * openings.length)];
    const rTouch    = humanTouches[Math.floor(Math.random() * humanTouches.length)];
    const wLimit    = [55,65,70,75,80,85][Math.floor(Math.random() * 6)];
    const sCount    = [2,2,3,3,3,4][Math.floor(Math.random() * 6)];
    const reviewerContext = getBizContext(biz);
    const imperfectStyle = Math.random() < 0.4;
    const useAbbrev = Math.random() < 0.3;
    const prompt = `You are a real person writing a Google review from your own experience. You are NOT an AI. Write exactly how a normal Indian person types a review — not formally, not like a template.

${reviewerContext}

Your visit details:
- Business type: ${biz.category || 'local business'}, ${biz.location || 'Pune'}
${mentionBizName ? '- Business name: ' + biz.name + ' (mention casually once if it fits)' : '- Do not mention the business name'}
${service ? '- You used: ' + service : ''}
${doctor && mentionDoctor ? '- You may briefly mention: ' + doctor : ''}
- Your rating: ${stars}/5 — ${starWord}
- Things you liked: ${highlights && highlights.length ? highlights.join(', ') : 'overall experience'}
${note ? '- Extra detail: ' + note : ''}

How to write:
- ${randomTone}
- ${randomStructure}
${rOpening ? '- Start with: ' + rOpening : ''}
- Somewhere naturally say something like: "${rTouch}"
- ${langInstruction}
- Write ${sCount} to ${sCount + 1} sentences. Under ${wLimit} words total.
${imperfectStyle ? '- Write slightly casually — a short sentence, a thought that trails off. Real people are not perfect writers.' : '- Write naturally and conversationally, not like a formal testimonial.'}
${useAbbrev ? '- Can use casual words like tbh, v good where natural.' : ''}

Hard rules:
- Do NOT start with "I"
- Do NOT use: highly recommend, five stars, 5 stars, I am pleased, I would like to, In conclusion, Overall
- No hashtags, no emojis
- Do not sound like a marketing ad or an AI template
- Do NOT mention tea, coffee, chai unless it is a restaurant or cafe
- Do NOT mention spouse or family unless business type naturally involves them
- For tech or software: write as a business owner about results and support, not personal visits
- Do NOT add details not mentioned above
- Output ONLY the review text. No quotes. No label. No explanation.`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 200,
      temperature: 1.0,
      messages: [
        { role: 'system', content: 'You write short authentic Google reviews that sound like real people wrote them. Never sound like an AI or a marketing template.' },
        { role: 'user', content: prompt }
      ]
    });
    const reviewText = completion.choices[0]?.message?.content?.trim();
    res.json({ review: reviewText });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/track-submit', (req, res) => {
  if (req.body.bizId) trackEvent(req.body.bizId, 'submitted');
  res.json({ ok: true });
});

app.post('/negative-feedback', async (req, res) => {
  try {
    const { bizId, stars, service, feedback } = req.body;
    const businesses = getBusinesses();
    const biz = businesses[bizId];
    trackEvent(bizId, 'negative');
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: 'Low Rating Alert - ' + (biz?.name || bizId),
      html: '<h2>Low Rating Alert</h2><p><b>Business:</b> '+(biz?.name||bizId)+'</p><p><b>Rating:</b> '+stars+'/5</p>'+(service?'<p><b>Service:</b> '+service+'</p>':'')+(feedback?'<p><b>Feedback:</b> '+feedback+'</p>':'')+'<p style="color:#888">This was NOT posted on Google.</p>'
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/analytics/:bizId', (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  const data = getAnalytics();
  res.json(data[req.params.bizId] || { scans:0, generated:0, submitted:0, negative:0 });
});

app.get('/analytics-all', (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  const businesses = getBusinesses();
  const analytics = getAnalytics();
  res.json(Object.keys(businesses).map(id => ({
    id, name: businesses[id].name, icon: businesses[id].icon,
    ...(analytics[id] || { scans:0, generated:0, submitted:0, negative:0 })
  })));
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/b/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'biz.html')));
app.get('/site/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'site.html')));

app.get('/places-data/:id', (req, res) => {
  const cache = getPlacesCache();
  const data = cache[req.params.id];
  if (!data) return res.json({ cached: false });
  res.json({ cached: true, ...data });
});

app.post('/refresh-places', async (req, res) => {
  if (req.body.pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  refreshAllPlacesData();
  res.json({ ok: true, message: 'Refresh started in background' });
});

app.get('/business-list', (req, res) => {
  try {
    const businesses = getBusinesses();
    const list = Object.entries(businesses).map(([id, b]) => ({ id, name: b.name, icon: b.icon, placeId: b.placeId || '' }));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/wa-sender', (req, res) => res.sendFile(path.join(__dirname, 'public', 'wa-sender.html')));
app.get('/place-finder', (req, res) => res.sendFile(path.join(__dirname, 'public', 'place-finder.html')));

app.get('/find-place', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id,name,formatted_address&locationbias=circle:50000@18.5204,73.8567&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.candidates || !data.candidates.length) return res.status(404).json({ error: 'Business not found on Google Maps' });
    const place = data.candidates[0];
    res.json({ placeId: place.place_id, name: place.name, address: place.formatted_address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/update-place-ids', (req, res) => {
  const { updates, pass } = req.body;
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const businesses = getBusinesses();
    Object.entries(updates).forEach(([bizId, placeId]) => { if (businesses[bizId]) businesses[bizId].placeId = placeId; });
    saveBusinesses(businesses);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/update-business', (req, res) => {
  const { id, updates, pass } = req.body;
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const businesses = getBusinesses();
    if (!businesses[id]) return res.status(404).json({ error: 'Business not found' });
    Object.entries(updates).forEach(([key, val]) => { if (val !== undefined && val !== '') businesses[id][key] = val; });
    saveBusinesses(businesses);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/add-business', (req, res) => {
  const { id, name, icon, googleLink, location, placeId, services, keywords, pass } = req.body;
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  if (!id || !name || !googleLink) return res.status(400).json({ error: 'Missing fields' });
  try {
    const businesses = getBusinesses();
    if (businesses[id]) return res.status(400).json({ error: 'Business ID already exists' });
    businesses[id] = {
      name, icon: icon||'star', googleLink, location: location||'', placeId: placeId||'',
      type: 'other', showDoctor: false, showLocation: false,
      services: services||['General Service'],
      chips: ['Professional','Fast service','Affordable','Trustworthy','Good communication','Would recommend'],
      keywords: keywords||[]
    };
    saveBusinesses(businesses);
    res.json({ ok: true, url: '/b/' + id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/delete-business', (req, res) => {
  const { id, pass } = req.body;
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const businesses = getBusinesses();
    if (!businesses[id]) return res.status(404).json({ error: 'Not found' });
    delete businesses[id];
    saveBusinesses(businesses);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ReviewHelper running on http://localhost:' + PORT));
