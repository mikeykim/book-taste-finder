module.exports = function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  res.status(200).json({
    hasKey: !!key,
    keyPreview: key ? key.slice(0, 6) + '...' : 'NOT SET',
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('API')),
    nodeVersion: process.version
  });
};
