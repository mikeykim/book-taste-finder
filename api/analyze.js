// Vercel Serverless Function — Gemini 연동
// 환경변수: GEMINI_API_KEY

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const body = req.body;
  if (!body || !body.image) {
    return res.status(400).json({ error: 'image (base64) is required' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // base64 data URL → 순수 base64
  const base64Data = body.image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

  const prompt = `이 책 표지 이미지를 분석해서 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트 없이 순수 JSON만 출력하세요.

{
  "title": "책 제목",
  "author": "저자",
  "year": "출판연도 (모르면 빈 문자열)",
  "tags": ["장르태그1", "장르태그2", "장르태그3"],
  "matchScore": 75,
  "matchReasons": [
    "이 책의 결에 대한 설명",
    "어떤 독자에게 맞는지",
    "읽을 때 기대할 수 있는 것"
  ],
  "verdict": "한 줄 평가 (예: 너랑 잘 맞을 것 같아!)"
}

matchScore는 60~95 사이에서 책의 대중적 평가와 접근성을 고려해 정해주세요.
태그는 한국어로, 2~4개 이내로 작성해주세요.
verdict는 반말로 친근하게 작성해주세요.`;

  // 모델 목록 (순서대로 시도)
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  let lastError = '';
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

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
            maxOutputTokens: 512
          }
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        lastError = `[${model}] HTTP ${geminiRes.status}: ${errText.slice(0, 200)}`;
        continue;
      }

      const geminiData = await geminiRes.json();
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        lastError = `[${model}] Empty response: ${JSON.stringify(geminiData).slice(0, 200)}`;
        continue;
      }

      // JSON 추출 (```json ... ``` 감싸기 대응)
      let jsonStr = text.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const bookData = JSON.parse(jsonStr);
      return res.status(200).json(bookData);

    } catch (err) {
      lastError = `[${model}] Exception: ${err.message}`;
      continue;
    }
  }

  return res.status(502).json({ error: lastError || 'All AI models failed' });
};
