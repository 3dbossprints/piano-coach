(() => {
  const history = [];
  let recognition = null;
  let listening = false;
  let enginePromise = null;
  const $ = id => document.getElementById(id);
  const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

  function addMessage(role, content) {
    const list = $("tutorMessages");
    const item = document.createElement("div");
    item.style.cssText = "padding:11px 13px;border-radius:13px;max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;" +
      (role === "user" ? "margin-left:auto;background:#e5eee4;color:#20231f;" : "margin-right:auto;background:#f0efe8;color:#20231f;");
    item.textContent = content;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    return item;
  }

  function say(text) {
    if (!("speechSynthesis" in window) || !$("tutorSpeak").checked) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  async function getLocalEngine() {
    if (!("gpu" in navigator)) {
      throw new Error("This browser does not expose WebGPU. Try an up-to-date Chrome or Edge browser on a compatible device.");
    }
    if (!enginePromise) {
      $("tutorVoiceStatus").textContent = "Loading the local 1B piano tutor. The first download is large (roughly 1 GB) and can take a while; keep this tab open.";
      enginePromise = (async () => {
        const webllm = await import("https://esm.run/@mlc-ai/web-llm");
        return webllm.CreateMLCEngine(MODEL_ID, {
          initProgressCallback: report => {
            if (report && report.text) $("tutorVoiceStatus").textContent = "Local model: " + report.text;
          }
        });
      })().catch(error => {
        enginePromise = null;
        throw error;
      });
    }
    return enginePromise;
  }

  async function sendTutorMessage(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    const send = $("tutorSend");
    const input = $("tutorInput");
    input.value = "";
    history.push({ role: "user", content: text });
    addMessage("user", text);
    const pending = addMessage("assistant", "Starting local tutor…");
    send.disabled = true;
    send.textContent = "Loading local AI…";
    try {
      const engine = await getLocalEngine();
      pending.textContent = "Thinking on your device…";
      $("tutorVoiceStatus").textContent = "Your tutor is running locally in this browser. Questions are processed on this device.";
      const messages = [
        { role: "system", content: "You are Piano Coach, a warm, patient, accurate piano teacher. Help learners with note reading, rhythm, technique, practice routines, music theory, and Trinity College London piano grades Initial through Grade 8. Give clear step-by-step advice suited to the learner. Ask a clarifying question when needed. Do not claim to hear the user's playing or inspect sheet music unless data is explicitly provided. For exam requirements that may change, say to verify against the current official Trinity syllabus. Encourage relaxed technique and sensible breaks. Keep answers practical and concise." },
        ...history.slice(-12)
      ];
      const result = await engine.chat.completions.create({ messages, temperature: 0.7, max_tokens: 450 });
      const reply = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
      if (!reply) throw new Error("The local model returned an empty answer. Please try again.");
      pending.textContent = reply;
      history.push({ role: "assistant", content: reply });
      if (history.length > 12) history.splice(0, history.length - 12);
      say(reply);
    } catch (error) {
      pending.textContent = "I couldn't start the on-device AI: " + (error && error.message ? error.message : String(error)) +
        "\nTry a current browser with WebGPU support and enough free memory. The local model must download the first time; no OpenAI key is used by this tutor.";
      history.pop();
      $("tutorVoiceStatus").textContent = "Local tutor not ready. See the message above for troubleshooting.";
    } finally {
      send.disabled = false;
      send.textContent = "Ask tutor";
      input.focus();
    }
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $("tutorVoiceStatus").textContent = "Voice input isn't supported in this browser. Try current Chrome or Edge, or type your question.";
      return;
    }
    if (recognition && listening) {
      recognition.stop();
      listening = false;
      $("tutorVoice").textContent = "🎙 Ask by voice";
      $("tutorVoiceStatus").textContent = "Voice input stopped.";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      listening = true;
      $("tutorVoice").textContent = "Stop listening";
      $("tutorVoiceStatus").textContent = "Listening for your question…";
    };
    recognition.onresult = event => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      $("tutorInput").value = transcript;
      if (event.results[event.results.length - 1].isFinal) {
        listening = false;
        $("tutorVoice").textContent = "🎙 Ask by voice";
        sendTutorMessage(transcript);
      }
    };
    recognition.onerror = event => {
      listening = false;
      $("tutorVoice").textContent = "🎙 Ask by voice";
      $("tutorVoiceStatus").textContent = "Voice input error (" + event.error + "). You can type your question instead.";
    };
    recognition.onend = () => {
      listening = false;
      $("tutorVoice").textContent = "🎙 Ask by voice";
    };
    try { recognition.start(); } catch (error) {
      $("tutorVoiceStatus").textContent = "Couldn't start the microphone. Check browser permissions.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tutorSend").addEventListener("click", () => sendTutorMessage($("tutorInput").value));
    $("tutorInput").addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendTutorMessage($("tutorInput").value);
      }
    });
    $("tutorVoice").addEventListener("click", startVoiceInput);
    $("tutorClear").addEventListener("click", () => {
      history.length = 0;
      $("tutorMessages").replaceChildren();
      addMessage("assistant", "Hi! I'm your on-device piano tutor. Ask about notes, rhythm, technique, practice planning, or Trinity grades.");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    });
    addMessage("assistant", "Hi! I'm your on-device piano tutor. I run a local 1B model in your browser, without an OpenAI API key. The first use downloads the model; after that, it can run on this device.");
  });
})();