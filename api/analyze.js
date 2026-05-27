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

    const prompt = `이 책 표지를 분석해서 JSON으로 답해줘.

규칙:
- title: 정확한 책 제목
- author: 저자 이름
- year: 출판연도 (모르면 빈 문자열)
- tags: 이 책을 설명하는 한국어 키워드 2~4개 (예: 성장, 가족, 철학, 에세이, 스릴러 등)
- matchScore: 이 책의 대중적 평가와 접근성을 고려한 60~95 사이 점수
- matchReasons: 정확히 3개의 짧은 문장 (각각 15자 이내):
  첫 번째: 이 책의 분위기를 한 줄로 (예: "잔잔하고 따뜻한 결")
  두 번째: 이 책의 읽기 난이도 (예: "부담 없이 읽히는 책")
  세 번째: 이 책의 장르 특성 (예: "한국 현대 소설")
- verdict: 책을 좋아하는 친구에게 추천하듯 따뜻한 반말 한마디 (예: "마음이 따뜻해지는 책이야", "한번 빠지면 멈출 수 없어", "조용한 밤에 읽기 딱이야")`;

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
