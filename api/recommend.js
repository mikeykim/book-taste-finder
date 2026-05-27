module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { books } = req.body;
    if (!books || !Array.isArray(books) || books.length < 2) {
      return res.status(400).json({ error: '최소 2권의 책 기록이 필요해요' });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    // 책 목록을 간단한 텍스트로 변환 (토큰 절약)
    const bookList = books.slice(0, 20).map(b =>
      `"${b.title}" (${b.author}) - ${(b.tags || []).join(', ')}`
    ).join('\n');

    const prompt = `아래는 한 사용자가 읽은 책 목록이야.

${bookList}

이 사용자의 독서 취향을 분석해서, 다음에 읽으면 좋을 책 4권을 추천해줘.
- 이미 읽은 책은 추천하지 마
- 실제로 존재하는 책만 추천해
- 한국에서 구할 수 있는 책으로
- 추천 이유는 사용자의 취향과 연결해서 15자 이내로 짧게

JSON 배열로만 응답해.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    let geminiRes, geminiText;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title:  { type: 'string' },
                  author: { type: 'string' },
                  why:    { type: 'string' }
                },
                required: ['title', 'author', 'why']
              }
            }
          }
        })
      });
      geminiText = await geminiRes.text();
      if (geminiRes.ok || (geminiRes.status !== 503 && geminiRes.status !== 429)) break;
    }

    if (!geminiRes.ok) {
      return res.status(502).json({
        error: 'Gemini HTTP ' + geminiRes.status,
        detail: geminiText.slice(0, 300)
      });
    }

    let geminiData;
    try { geminiData = JSON.parse(geminiText); } catch (e) {
      return res.status(502).json({ error: 'Response parse failed' });
    }

    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    let outputText = '';
    for (const part of parts) {
      if (part.thought) continue;
      if (part.text) outputText += part.text;
    }

    let recommendations;
    try {
      recommendations = JSON.parse(outputText);
    } catch (e) {
      const m = outputText.match(/\[[\s\S]*\]/);
      if (m) recommendations = JSON.parse(m[0]);
      else return res.status(502).json({ error: 'No JSON array', rawText: outputText.slice(0, 500) });
    }

    return res.status(200).json(recommendations);

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
