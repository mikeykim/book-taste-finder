// Vercel Serverless Function — Gemini 2.5 Flash 연동
// 환경변수: GEMINI_API_KEY (Vercel 대시보드 → Settings → Environment Variables)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'image (base64) is required' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  // base64 data URL에서 순수 base64 추출
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

  const prompt = `이 책 표지 이미지를 분석해서 다음 JSON 형식으로만 응답해주세요. 다른 텍스트 없이 JSON만 출력하세요.

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
태그는 한국어로, 2~4개 이내로 작성해주세요.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
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
            maxOutputTokens: 512,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return res.status(502).json({ error: 'AI API error' });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({ error: 'Empty AI response' });
    }

    // JSON 파싱
    const bookData = JSON.parse(text);
    return res.status(200).json(bookData);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
