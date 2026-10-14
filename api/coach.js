export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST for feedback requests." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI feedback is not configured yet. Add OPENAI_API_KEY in Vercel Project Settings → Environment Variables, then redeploy." });
  }
  try {
    const body = req.body || {};
    const notes = Array.isArray(body.notes) ? body.notes.slice(0, 500).map(n => String(n).slice(0, 8)) : [];
    if (!notes.length) return res.status(400).json({ error: "No detected notes were provided." });
    const piece = String(body.piece || "unspecified exercise").slice(0, 160);
    const targetNotes = String(body.targetNotes || "").slice(0, 1000);
    const prompt = [
      "You are a kind, precise beginner-friendly piano practice coach.",
      "The data below is a rough monophonic pitch-detector log, not a complete transcription or a recording. It may contain missed notes, octave errors, and duplicates.",
      "Never claim you heard timing, dynamics, articulation, chords, or exact errors unless the supplied data supports that claim. If expected notes are absent, do not invent which notes are wrong.",
      "Give concise, constructive feedback: what can be inferred, any comparison to the target sequence if supplied, one or two practical next steps, and a reminder to slow down and check with the printed score/teacher when uncertain.",
      "Exercise or piece: " + piece,
      "Expected note sequence (user-provided, may be empty): " + (targetNotes || "(not supplied)"),
      "Detected note events in order: " + notes.join(" ")
    ].join("\n");
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You give careful piano-practice feedback and clearly distinguish evidence from guesses." },
          { role: "user", content: prompt }
        ],
        max_tokens: 450,
        temperature: 0.3
      })
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(502).json({ error: data && data.error && data.error.message ? data.error.message : "The AI provider could not complete the request." });
    }
    const feedback = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!feedback) return res.status(502).json({ error: "The AI provider returned no feedback." });
    return res.status(200).json({ feedback });
  } catch (error) {
    return res.status(500).json({ error: "The feedback service encountered an error. Please try again." });
  }
}
