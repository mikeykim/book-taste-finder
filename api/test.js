module.exports = async function handler(req, res) {
  const API_KEY = process.env.GEMINI_API_KEY;

  if (!API_KEY) {
    return res.status(200).json({ error: 'No API key' });
  }

  // 모델별로 간단한 텍스트 요청을 보내서 어떤 에러가 나는지 확인
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  const results = {};

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: '안녕' }] }]
        })
      });
      const body = await r.text();
      results[model] = { status: r.status, body: body.slice(0, 300) };
    } catch (e) {
      results[model] = { error: e.message };
    }
  }

  res.status(200).json({ keyPreview: API_KEY.slice(0, 8) + '...', results });
};
