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

    const prompt = `이 책 표지 이미지를 분석하세요. title은 책 제목, author는 저자, year는 출판연도(모르면 빈 문자열), tags는 한국어 장르 태그 2~4개, matchScore는 60~95 사이 정수, matchReasons는 이 책의 특징을 설명하는 한국어 문장 3개, verdict는 친근한 반말 한 줄 평가.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
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
      })
    });

    const geminiText = await geminiRes.text();

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
