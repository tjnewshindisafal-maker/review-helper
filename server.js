const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');


// ============ GOOGLE PLACES CACHE SYSTEM ============
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

async function fetchPlacePhoto(photoRef, apiKey, maxWidth = 800) {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buffer = await res.buffer();
  return buffer.toString('base64');
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
      
      // Fetch up to 5 photos as base64
      const photos = [];
      if (place.photos && place.photos.length > 0) {
        for (const photo of place.photos.slice(0, 5)) {
          try {
            const b64 = await fetchPlacePhoto(photo.photo_reference, apiKey);
            if (b64) photos.push({ 
              data: b64, 
              attribution: photo.html_attributions?.[0] || '' 
            });
          } catch(e) { console.log('Photo fetch error:', e.message); }
        }
      }

      // Extract reviews
      const reviews = (place.reviews || []).slice(0, 5).map(r => ({
        name: r.author_name,
        rating: r.rating,
        text: r.text,
        time: r.relative_time_description
      }));

      cache[bizId] = {
        rating: place.rating || 5.0,
        reviewCount: place.user_ratings_total || 0,
        photos,
        reviews,
        hours: place.opening_hours?.weekday_text || [],
        address: place.formatted_address || biz.fullAddress || '',
        phone: place.formatted_phone_number || biz.phone || '',
        fetchedAt: new Date().toISOString()
      };
      updated++;
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch(e) { 
      console.log(`Error fetching ${biz.name}:`, e.message); 
    }
  }
  
  savePlacesCache(cache);
  console.log(`Places cache updated: ${updated} businesses`);
}

// Run once on startup (after 10 sec delay)
setTimeout(refreshAllPlacesData, 10000);

// Run every 24 hours at midnight
setInterval(refreshAllPlacesData, 24 * 60 * 60 * 1000);
// ============ END GOOGLE PLACES CACHE ============

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'advizrmedia@gmail.com',
    pass: process.env.EMAIL_PASS || 'bnyh vgyb ibwv cjey'
  }
});

const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');
function getAnalytics() {
  try { if (fs.existsSync(ANALYTICS_FILE)) return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')); } catch(e) {}
  return {};
}
function saveAnalytics(data) { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2)); }
function trackEvent(bizId, event) {
  const data = getAnalytics();
  if (!data[bizId]) data[bizId] = { scans:0, generated:0, submitted:0, negative:0 };
  data[bizId][event] = (data[bizId][event] || 0) + 1;
  data[bizId].lastActivity = new Date().toISOString();
  saveAnalytics(data);
}
function getBusinesses() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'businesses.json'), 'utf8'));
}

const tones = [
  'Write like a busy person who rarely writes reviews but felt strongly enough to do it.',
  'Write like a regular local customer who genuinely recommends this place.',
  'Write like someone who was skeptical at first but was pleasantly surprised.',
  'Write like a first-time customer who was very impressed.',
  'Write like someone recommending this place to a close friend in casual language.',
];
const structures = [
  'Start with what brought you there, then what impressed you, end with recommendation.',
  'Start with the best thing you noticed, add a specific detail, end with whether you return.',
  'Start with overall feeling, mention one specific moment, end with rating opinion.',
  'Start with the problem you came with, explain how it was solved, end with satisfaction.',
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
    const prompt = `You are a real human customer writing a genuine Google review. NOT an AI.
Business: "${biz.name}"
${service ? 'Service: '+service : ''}
${doctor ? 'Doctor/Staff: '+doctor+' - mention naturally.' : ''}
Rating: ${stars}/5 - ${starWord}
Liked: ${highlights?.length ? highlights.join(', ') : 'overall experience'}
${note ? 'Note: '+note : ''}
${keywords.length ? 'Include 1-2 keywords naturally: '+keywords.join(', ') : ''}
Language: ${langInstruction}
Tone: ${randomTone}
Structure: ${randomStructure}
RULES: 2-4 sentences. Max 90 words. Simple language. ONE specific detail. Never start with I. No hashtags, no emojis. Output ONLY review text.`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 200,
      temperature: 1.1,
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ review: completion.choices[0]?.message?.content?.trim() });
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
      from: 'advizrmedia@gmail.com',
      to: 'advizrmedia@gmail.com',
      subject: 'Low Rating Alert - ' + (biz?.name || bizId),
      html: '<h2>Low Rating Alert</h2><p><b>Business:</b> '+(biz?.name||bizId)+'</p><p><b>Rating:</b> '+stars+'/5</p>'+(service?'<p><b>Service:</b> '+service+'</p>':'')+(feedback?'<p><b>Feedback:</b> '+feedback+'</p>':'')+'<p style="color:#888">This was NOT posted on Google.</p>'
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/analytics/:bizId', (req, res) => {
  const data = getAnalytics();
  res.json(data[req.params.bizId] || { scans:0, generated:0, submitted:0, negative:0 });
});

app.get('/analytics-all', (req, res) => {
  if (req.query.pass !== (process.env.ADMIN_PASS || 'admin123')) return res.status(401).json({ error: 'Unauthorized' });
  const businesses = getBusinesses();
  const analytics = getAnalytics();
  res.json(Object.keys(businesses).map(id => ({
    id, name: businesses[id].name, icon: businesses[id].icon,
    ...(analytics[id] || { scans:0, generated:0, submitted:0, negative:0 })
  })));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Mini website — /b/reshine, /b/drkirti etc.
app.get('/b/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'biz.html'));
});

// Full landing page — /site/reshine
app.get('/site/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'site.html'));
});



// Get cached Google Places data for a business
app.get('/places-data/:id', (req, res) => {
  const cache = getPlacesCache();
  const data = cache[req.params.id];
  if (!data) return res.json({ cached: false });
  res.json({ cached: true, ...data });
});

// Manual refresh trigger (admin only)
app.post('/refresh-places', async (req, res) => {
  if (req.body.pass !== (process.env.ADMIN_PASS || 'admin123')) 
    return res.status(401).json({ error: 'Unauthorized' });
  refreshAllPlacesData();
  res.json({ ok: true, message: 'Refresh started in background' });
});



// Public business list for place finder
app.get('/business-list', (req, res) => {
  try {
    const businesses = getBusinesses();
    const list = Object.entries(businesses).map(([id, b]) => ({
      id, name: b.name, icon: b.icon, placeId: b.placeId || ''
    }));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Place ID Finder tool
app.get('/place-finder', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'place-finder.html'));
});

// Find Place ID by text search
app.get('/find-place', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=place_id,name,formatted_address&locationbias=circle:50000@18.5204,73.8567&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.candidates || !data.candidates.length) 
      return res.status(404).json({ error: 'Business not found on Google Maps' });
    const place = data.candidates[0];
    res.json({ placeId: place.place_id, name: place.name, address: place.formatted_address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Bulk update place IDs
app.post('/update-place-ids', (req, res) => {
  const { updates, pass } = req.body;
  if (pass !== (process.env.ADMIN_PASS || 'admin123')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const businesses = getBusinesses();
    Object.entries(updates).forEach(([bizId, placeId]) => {
      if (businesses[bizId]) businesses[bizId].placeId = placeId;
    });
    fs.writeFileSync(path.join(__dirname, 'businesses.json'), JSON.stringify(businesses, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/add-business', (req, res) => {
  const { id, name, icon, googleLink, location, placeId, services, keywords, pass } = req.body;
  if(pass !== (process.env.ADMIN_PASS || 'admin123')) return res.status(401).json({error:'Unauthorized'});
  if(!id || !name || !googleLink) return res.status(400).json({error:'Missing fields'});
  try {
    const businesses = getBusinesses();
    if(businesses[id]) return res.status(400).json({error:'Business ID already exists'});
    businesses[id] = {
      name, icon: icon||'star', googleLink,
      location: location||'',
      placeId: placeId||'',
      type: 'other', showDoctor: false, showLocation: false,
      services: services||['General Service'],
      chips: ['Professional','Fast service','Affordable','Trustworthy','Good communication','Would recommend'],
      keywords: keywords||[]
    };
    fs.writeFileSync(path.join(__dirname, 'businesses.json'), JSON.stringify(businesses, null, 2));
    res.json({ok:true, url:'/?b='+id});
  } catch(err) { res.status(500).json({error:err.message}); }
});


app.post('/delete-business', (req, res) => {
  const { id, pass } = req.body;
  if(pass !== (process.env.ADMIN_PASS || 'admin123')) return res.status(401).json({error:'Unauthorized'});
  try {
    const businesses = getBusinesses();
    if(!businesses[id]) return res.status(404).json({error:'Not found'});
    delete businesses[id];
    fs.writeFileSync(path.join(__dirname, 'businesses.json'), JSON.stringify(businesses, null, 2));
    res.json({ok:true});
  } catch(err) { res.status(500).json({error:err.message}); }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ReviewHelper running on http://localhost:'+PORT));
