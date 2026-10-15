export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST to chat with the piano tutor." });
  }

  try {
    const apiKey = String(req.headers["x-openai-api-key"] || process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ error: "Add your OpenAI API key in the AI Coach panel, or configure OPENAI_API_KEY in Vercel." });
    }

    const body = req.body || {};
    const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    const messages = history
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({ role: m.role, content: m.content.slice(0, 2500) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Ask the tutor a question first." });
    }

    const systemPrompt = [
      "You are Piano Coach, a warm, practical piano teacher for a learner working toward Trinity Piano Initial through Grade 8.",
      "Adapt to the learner's level. If their grade is unknown, ask briefly or start with accessible language.",
      "Give clear, actionable explanations, short practice drills, note-reading help, rhythm-counting guidance, technique reminders, and realistic practice plans.",
      "When asked about Trinity requirements, repertoire, or exam rules, be transparent that syllabuses can change and recommend checking the current official Trinity syllabus.",
      "Do not claim to hear, see, or assess a performance unless the user provides relevant evidence. This chat endpoint receives text only, not live audio or sheet music.",
      "Never promise exam success. Encourage relaxed technique and consulting a qualified teacher for pain, persistent tension, or individual fingering questions.",
      "Keep most answers concise and end with one useful next step or a question when appropriate."
    ].join(" ");

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 600,
        temperature: 0.4
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(502).json({
        error: data && data.error && data.error.message
          ? data.error.message
          : "The AI tutor could not complete the request."
      });
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) return res.status(502).json({ error: "The AI tutor returned an empty answer." });
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: "The tutor service encountered an error. Please try again." });
  }
}
