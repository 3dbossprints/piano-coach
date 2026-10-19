// Vercel serverless endpoint. Configure OPENAI_API_KEY in Vercel project environment variables.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Audio review is not configured yet: add OPENAI_API_KEY to the deployment environment.' });
  }
  try {
    const { audioBase64, title, targetNotes, excerptSeconds, excerptStartSeconds } = req.body || {};
    if (typeof audioBase64 !== 'string' || !audioBase64.length) {
      return res.status(400).json({ error: 'Missing audio data.' });
    }
    if (audioBase64.length > 5_000_000) {
      return res.status(413).json({ error: 'Audio excerpt is too large. Please try a shorter recording.' });
    }
    const instructions = [
      'You are an expert piano performance coach. You are receiving actual audio, not only a note transcript.',
      'Listen to the supplied piano audio excerpt and give grounded observations about audible timing, note clarity, steadiness, dynamics and musical phrasing when discernible.',
      'Do not invent exact pitches or claim full-song coverage: this is only an excerpt from the performance.',
      'If the audio is noisy or the musical details cannot be judged reliably, say so. Be supportive, concise, and give 2-3 actionable practice suggestions.',
      'Piece: ' + String(title || 'Untitled practice').slice(0, 160),
      'Learner target notes (may be incomplete): ' + String(targetNotes || 'not provided').slice(0, 1000),
      'Audio excerpt duration: ' + Math.min(45, Math.max(0, Number(excerptSeconds) || 0)) + ' seconds; excerpt starts at ' + Math.max(0, Number(excerptStartSeconds) || 0) + ' seconds.'
    ].join('\n');
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_AUDIO_MODEL || 'gpt-audio-1.5',
        modalities: ['text'],
        max_completion_tokens: 260,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: instructions },
            { type: 'input_audio', input_audio: { data: audioBase64, format: 'wav' } }
          ]
        }]
      })
    });
    const result = await upstream.json();
    if (!upstream.ok) {
      const message = result?.error?.message || 'Audio model request failed.';
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: message });
    }
    const feedback = result?.choices?.[0]?.message?.content;
    if (typeof feedback !== 'string' || !feedback.trim()) {
      return res.status(502).json({ error: 'Audio model returned an empty review.' });
    }
    return res.status(200).json({ feedback: feedback.trim(), model: process.env.OPENAI_AUDIO_MODEL || 'gpt-audio-1.5' });
  } catch (error) {
    return res.status(500).json({ error: 'Audio review failed: ' + (error?.message || 'unknown error') });
  }
}
