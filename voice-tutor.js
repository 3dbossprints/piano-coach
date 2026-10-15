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

  let availableVoices = [];
  let kokoroPromise = null;
  let kokoroAudioContext = null;
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    availableVoices = window.speechSynthesis.getVoices() || [];
    const select = $("tutorVoiceChoice");
    if (!select) return;
    const selected = select.value || "auto";
    select.replaceChildren(new Option("Best available voice", "auto"), new Option("Natural AI voice (local, experimental)", "kokoro"));
    availableVoices.forEach((voice, index) => {
      select.add(new Option(voice.name + " (" + voice.lang + ")" + (voice.localService ? " · on device" : ""), String(index)));
    });
    select.value = [...select.options].some(option => option.value === selected) ? selected : "auto";
  }
  async function sayNeural(text) {
    try {
      $("tutorVoiceStatus").textContent = "Loading local neural voice (extra download on first use)…";
      if (!kokoroPromise) kokoroPromise = (async () => {
        const module = await import("https://esm.run/kokoro-js");
        return module.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
      })().catch(error => { kokoroPromise = null; throw error; });
      const tts = await kokoroPromise;
      const generated = await tts.generate(text, { voice: "af_heart" });
      const samples = generated.audio || generated;
      const rate = generated.sampling_rate || 24000;
      if (!samples || !samples.length) throw new Error("Neural voice returned no audio.");
      if (!kokoroAudioContext) kokoroAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      await kokoroAudioContext.resume();
      const buffer = kokoroAudioContext.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
      const source = kokoroAudioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(kokoroAudioContext.destination);
      source.start();
      $("tutorVoiceStatus").textContent = "Speaking with the local neural voice. Audio is generated on this device.";
    } catch (error) {
      $("tutorVoiceStatus").textContent = "Local neural voice unavailable (" + (error.message || String(error)) + "). Falling back to the device speech voice.";
      say(text, true);
    }
  }
  function say(text, fallback = false) {
    if (!$("tutorSpeak").checked) return;
    if (!fallback && $("tutorVoiceChoice")?.value === "kokoro") { sayNeural(text); return; }
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const choice = $("tutorVoiceChoice")?.value || "auto";
    if (choice !== "auto" && availableVoices[Number(choice)]) utterance.voice = availableVoices[Number(choice)];
    else {
      const english = availableVoices.filter(voice => /^en(-|$)/i.test(voice.lang));
      const natural = english.find(voice => /natural|neural|aria|jenny|samantha|ava|zira|google.*english|enhanced/i.test(voice.name));
      if (natural || english[0]) utterance.voice = natural || english[0];
    }
    utterance.rate = Number($("tutorRate")?.value || 0.92);
    utterance.pitch = 1.02;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  function pianoContext() {
    try { return typeof window.getPianoCoachSnapshot === "function" ? window.getPianoCoachSnapshot() : null; }
    catch (_) { return null; }
  }

  async function getLocalEngine() {
    if (!("gpu" in navigator)) throw new Error("This browser does not expose WebGPU. Try an up-to-date Chrome or Edge browser on a compatible device.");
    if (!enginePromise) {
      $("tutorVoiceStatus").textContent = "Loading the local 1B piano tutor. The first download is large (roughly 1 GB) and can take a while; keep this tab open.";
      enginePromise = (async () => {
        const webllm = await import("https://esm.run/@mlc-ai/web-llm");
        return webllm.CreateMLCEngine(MODEL_ID, {
          initProgressCallback: report => {
            if (report && report.text) $("tutorVoiceStatus").textContent = "Local model: " + report.text;
          }
        });
      })().catch(error => { enginePromise = null; throw error; });
    }
    return enginePromise;
  }

  async function sendTutorMessage(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    const send = $("tutorSend"), input = $("tutorInput");
    input.value = "";
    history.push({ role: "user", content: text });
    addMessage("user", text);
    const pending = addMessage("assistant", "Starting local tutor…");
    send.disabled = true;
    send.textContent = "Loading local AI…";
    try {
      const engine = await getLocalEngine();
      pending.textContent = "Thinking on your device…";
      $("tutorVoiceStatus").textContent = "Your tutor is running locally in this browser. Chat prompts are processed on this device.";
      const snapshot = pianoContext();
      const contextText = snapshot ? "Current session context (detector is approximate):\n" +
        "Grade: " + snapshot.grade + "\nPiece/exercise: " + (snapshot.piece || "not specified") +
        "\nExpected notes: " + (snapshot.targetNotes || "not provided") +
        "\nRecently detected notes: " + (snapshot.detectedNotes.length ? snapshot.detectedNotes.join(" ") : "none captured") +
        "\nUploaded scores: " + (snapshot.scores.length ? snapshot.scores.map(score => score.name + " [" + score.type + "]").join(", ") : "none") +
        "\nOnly MusicXML can currently be converted to expected note labels; uploaded PDFs and images are not automatically read." : "";
      const messages = [
        { role: "system", content: "You are Piano Coach, a warm, patient piano teacher. Help with note reading, rhythm, technique, practice routines, theory and Trinity College London grades Initial through Grade 8. Give clear practical steps. You may use detected note labels and an expected sequence if provided, but the microphone detector is approximate and can miss notes or confuse octaves. You cannot infer rhythm, dynamics, chords, fingering or tone quality from note labels alone. You have not heard raw audio and must not claim you have. Do not claim to read uploaded PDF or image notation; the app can parse basic notes from MusicXML. Verify changing exam requirements against the official Trinity syllabus. Encourage relaxed technique and sensible breaks." },
        ...(contextText ? [{ role: "system", content: contextText }] : []),
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
      recognition.stop(); listening = false;
      $("tutorVoice").textContent = "🎙 Ask by voice";
      $("tutorVoiceStatus").textContent = "Voice input stopped.";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      listening = true; $("tutorVoice").textContent = "Stop listening";
      $("tutorVoiceStatus").textContent = "Listening for your question…";
    };
    recognition.onresult = event => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      $("tutorInput").value = transcript;
      if (event.results[event.results.length - 1].isFinal) {
        listening = false; $("tutorVoice").textContent = "🎙 Ask by voice";
        sendTutorMessage(transcript);
      }
    };
    recognition.onerror = event => {
      listening = false; $("tutorVoice").textContent = "🎙 Ask by voice";
      $("tutorVoiceStatus").textContent = "Voice input error (" + event.error + "). You can type your question instead.";
    };
    recognition.onend = () => { listening = false; $("tutorVoice").textContent = "🎙 Ask by voice"; };
    try { recognition.start(); } catch (error) { $("tutorVoiceStatus").textContent = "Couldn't start the microphone. Check browser permissions."; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tutorSend").addEventListener("click", () => sendTutorMessage($("tutorInput").value));
    $("tutorInput").addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendTutorMessage($("tutorInput").value); }
    });
    $("tutorVoice").addEventListener("click", startVoiceInput);
    $("tutorReview").addEventListener("click", () => {
      const snapshot = pianoContext();
      if (!snapshot || !snapshot.detectedNotes.length) {
        $("tutorVoiceStatus").textContent = "No playing notes captured yet. Enable the microphone, start note tracking in AI practice feedback, and play a short passage first.";
        return;
      }
      sendTutorMessage("Review my recent playing using the detected notes and expected notes in the session context. Tell me what seems correct, where the sequence differs, and how to practise the difficult part. Explain the limits of approximate single-note pitch detection; do not infer rhythm, dynamics, chords, fingering or tone quality from note labels alone.");
      $("voiceTutor").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if ("speechSynthesis" in window) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
      $("tutorVoiceChoice").addEventListener("focus", loadVoices);
    }
    $("tutorClear").addEventListener("click", () => {
      history.length = 0; $("tutorMessages").replaceChildren();
      addMessage("assistant", "Hi! I'm your on-device piano tutor. Ask about notes, rhythm, technique, practice planning, or Trinity grades.");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    });
    addMessage("assistant", "Hi! I'm your on-device piano tutor. I run a local 1B model in your browser, without an OpenAI API key. The first use downloads the model; after that, it can run on this device.");
  });
})();