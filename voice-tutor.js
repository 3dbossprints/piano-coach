(() => {
  const history = [];
  let recognition = null;
  let listening = false;
  const $ = id => document.getElementById(id);

  function addMessage(role, content) {
    const list = $("tutorMessages");
    const item = document.createElement("div");
    item.style.cssText = "padding:11px 13px;border-radius:13px;max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;" +
      (role === "user"
        ? "margin-left:auto;background:#e5eee4;color:#20231f;"
        : "margin-right:auto;background:#f0efe8;color:#20231f;");
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

  async function sendTutorMessage(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    const send = $("tutorSend");
    const input = $("tutorInput");
    input.value = "";
    history.push({ role: "user", content: text });
    addMessage("user", text);
    const pending = addMessage("assistant", "Thinking…");
    send.disabled = true;
    send.textContent = "Thinking…";
    try {
      const keyField = $("openaiKey");
      const headers = { "Content-Type": "application/json" };
      if (keyField && keyField.value.trim()) headers["X-OpenAI-API-Key"] = keyField.value.trim();
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: history })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The tutor request failed.");
      pending.textContent = data.reply;
      history.push({ role: "assistant", content: data.reply });
      if (history.length > 12) history.splice(0, history.length - 12);
      say(data.reply);
    } catch (error) {
      pending.textContent = "I couldn't reach the AI tutor: " + error.message + "\nCheck that the site is deployed with the /api/tutor endpoint and that an API key is configured.";
      history.pop();
    } finally {
      send.disabled = false;
      send.textContent = "Ask tutor";
      input.focus();
    }
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $("tutorVoiceStatus").textContent = "Voice input isn't supported in this browser. Try a current version of Chrome or Edge, or type your question.";
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
      $("tutorVoiceStatus").textContent = "Listening… ask your piano question.";
    };
    recognition.onresult = event => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      $("tutorInput").value = transcript;
      if (event.results[event.results.length - 1].isFinal) {
        $("tutorVoiceStatus").textContent = "Question captured. Sending it to your tutor…";
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
      addMessage("assistant", "Hi! I'm your piano practice tutor. Ask me about notes, rhythm, technique, practice planning, or preparing for a grade.");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    });
    addMessage("assistant", "Hi! I'm your piano practice tutor. Ask me about notes, rhythm, technique, practice planning, or preparing for a grade. I can answer by voice too.");
  });
})();
