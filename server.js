const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PUT YOUR GROQ API KEY HERE
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/generate-review', async (req, res) => {
  const { bizName, stars, highlights, note } = req.body;

  const prompt = `Write a short, genuine-sounding Google review (3-5 sentences, 50-100 words) in English for a service business called "${bizName || 'our business'}".
Rating: ${stars} out of 5 stars.
${highlights?.length ? 'Highlights: ' + highlights.join(', ') + '.' : ''}
${note ? 'Customer note: ' + note : ''}
Rules: Write in first person. Sound natural and conversational. Match tone to star rating. No hashtags. No emojis. Output ONLY the review text, nothing else.`;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
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
