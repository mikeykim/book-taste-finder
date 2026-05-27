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

    const prompt = `이 책 표지 이미지를 분석해서 아래 JSON 형식으로만 응답하세요. JSON 외 텍스트 없이 순수 JSON만 출력하세요.
{"title":"책 제목","author":"저자","year":"출판연도","tags":["태그1","태그2"],"matchScore":75,"matchReasons":["이유1","이유2","이유3"],"verdict":"한 줄 평가"}
matchScore는 60~95 사이. 태그는 한국어 2~4개. verdict는 반말로 친근하게.`;

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
          maxOutputTokens: 512
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

    // Gemini 응답 파싱
    let geminiData;
    try {
      geminiData = JSON.parse(geminiText);
    } catch (e) {
      return res.status(502).json({
        error: 'Gemini response parse failed',
        detail: geminiText.slice(0, 500)
      });
    }

    // 모든 parts에서 JSON 찾기 (2.5 Flash는 thinking part가 별도로 옴)
    const parts = geminiData.candidates?.[0]?.content?.parts || [];

    if (parts.length === 0) {
      return res.status(502).json({
        error: 'Gemini returned no parts',
        detail: JSON.stringify(geminiData).slice(0, 800)
      });
    }

    // thinking이 아닌 파트들에서 텍스트 수집
    let allText = '';
    for (const part of parts) {
      if (part.thought) continue; // thinking 파트 건너뛰기
      if (part.text) allText += part.text + '\n';
    }

    // allText가 비어있으면 thinking 포함해서 다시 시도
    if (!allText.trim()) {
      for (const part of parts) {
        if (part.text) allText += part.text + '\n';
      }
    }

    if (!allText.trim()) {
      return res.status(502).json({
        error: 'No text in any part',
        detail: JSON.stringify(parts).slice(0, 800)
      });
    }

    // 코드블록 제거
    let cleaned = allText.trim();
    if (cleaned.includes('```')) {
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
    }

    // { } 사이 JSON 추출
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: 'No JSON in output',
        rawText: allText.slice(0, 800)
      });
    }

    let bookData;
    try {
      bookData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(502).json({
        error: 'JSON parse failed: ' + e.message,
        rawJson: jsonMatch[0].slice(0, 800)
      });
    }

    return res.status(200).json(bookData);

  } catch (err) {
    return res.status(500).json({
      error: 'Server error: ' + err.message
    });
  }
};
