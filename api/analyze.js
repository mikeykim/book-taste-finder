module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    if (!body || !body.image) {
      return res.status(400).json({ error: 'no image in body' });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const base64Data = body.image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

    const prompt = `이 책 표지를 보고 JSON으로 답해. matchReasons는 10자 이내 짧은 문장 3개. verdict는 10자 이내.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const reqBody = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            title:        { type: 'string' },
            author:       { type: 'string' },
            year:         { type: 'string' },
            tags:         { type: 'array', items: { type: 'string' } },
            matchScore:   { type: 'integer' },
            matchReasons: { type: 'array', items: { type: 'string' } },
            verdict:      { type: 'string' }
          },
          required: ['title', 'author', 'tags', 'matchScore', 'matchReasons', 'verdict']
        }
      }
    });

    // 최대 3회 재시도 (503 과부하 대응)
    let geminiRes, geminiText;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));

      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody
      });
      geminiText = await geminiRes.text();

      if (geminiRes.ok || (geminiRes.status !== 503 && geminiRes.status !== 429)) break;
    }

    if (!geminiRes.ok) {
      return res.status(502).json({
        error: 'Gemini HTTP ' + geminiRes.status,
        detail: geminiText.slice(0, 500)
      });
    }

    let geminiData;
    try {
      geminiData = JSON.parse(geminiText);
    } catch (e) {
      return res.status(502).json({
        error: 'Gemini response not JSON',
        detail: geminiText.slice(0, 500)
      });
    }

    // 모든 parts에서 텍스트 수집 (thinking 파트 제외)
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    let outputText = '';
    for (const part of parts) {
      if (part.thought) continue;
      if (part.text) outputText += part.text;
    }

    if (!outputText) {
      return res.status(502).json({
        error: 'No output text',
        detail: JSON.stringify(geminiData).slice(0, 800)
      });
    }

    let bookData;
    try {
      bookData = JSON.parse(outputText);
    } catch (e) {
      // JSON이 깨졌으면 { } 추출 시도
      const m = outputText.match(/\{[\s\S]*\}/);
      if (m) {
        bookData = JSON.parse(m[0]);
      } else {
        return res.status(502).json({
          error: 'Output not parseable',
          rawText: outputText.slice(0, 800)
        });
      }
    }

    return res.status(200).json(bookData);

  } catch (err) {
    return res.status(500).json({
      error: 'Server error: ' + err.message
    });
  }
};
