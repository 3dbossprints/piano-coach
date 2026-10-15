(() => {
  const history = [];
  let recognition = null;
  let listening = false;
  let voiceModeEnabled = false;
  let voiceReplyWillSpeak = false;
  let enginePromise = null;
  let kokoroWorker = null;
  let kokoroAudioContext = null;
  let neuralJobId = 0;
  let neuralPending = null;
  let neuralSource = null;
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

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    availableVoices = window.speechSynthesis.getVoices() || [];
    const select = $("tutorVoiceChoice");
    if (!select) return;
    const selected = select.value || "kokoro";
    select.replaceChildren(new Option("Natural AI voice", "kokoro"), new Option("Device voice (fast fallback)", "auto"));
    select.value = [...select.options].some(option => option.value === selected) ? selected : "kokoro";
  }

  function stopTutorSpeech() {
    neuralJobId++;
    if (neuralPending) { neuralPending.reject(new Error("Speech stopped")); neuralPending = null; }
    if (neuralSource) { try { neuralSource.stop(); } catch (_) {} neuralSource = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $("tutorVoiceStatus").textContent = "Speech stopped.";
  }

  function getKokoroWorker() {
    if (!kokoroWorker) {
      kokoroWorker = new Worker("./kokoro-worker.js", { type: "module" });
      kokoroWorker.onmessage = event => {
        if (!neuralPending || event.data.id !== neuralPending.id) return;
        const pending = neuralPending; neuralPending = null;
        if (event.data.error) pending.reject(new Error(event.data.error)); else pending.resolve(event.data);
      };
      kokoroWorker.onerror = event => {
        if (neuralPending) { const pending = neuralPending; neuralPending = null; pending.reject(new Error(event.message || "AI voice worker failed")); }
      };
    }
    return kokoroWorker;
  }

  function speechChunks(text) {
    const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
    const chunks = []; let part = "";
    for (const sentence of sentences) {
      for (const word of sentence.trim().split(/\\s+/)) {
        if ((part + " " + word).trim().length > 220 && part) { chunks.push(part); part = word; }
        else part = (part + " " + word).trim();
      }
      if (part) { chunks.push(part); part = ""; }
    }
    return chunks.filter(Boolean);
  }

  async function sayNeural(text) {
    const job = ++neuralJobId;
    try {
      $("tutorVoiceStatus").textContent = "Preparing natural AI voice… first use downloads a voice model."; 
      const worker = getKokoroWorker();
      if (!kokoroAudioContext) kokoroAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      await kokoroAudioContext.resume();
      for (const chunk of speechChunks(text)) {
        if (job !== neuralJobId) return;
        const id = job + "-" + Math.random().toString(36).slice(2);
        const result = await new Promise((resolve, reject) => { neuralPending = { id, resolve, reject }; worker.postMessage({ id, text: chunk }); });
        if (job !== neuralJobId) return;
        const samples = result.audio instanceof Float32Array ? result.audio : new Float32Array(result.audio);
        const buffer = kokoroAudioContext.createBuffer(1, samples.length, result.sampleRate || 24000);
        buffer.copyToChannel(samples, 0);
        await new Promise(resolve => {
          neuralSource = kokoroAudioContext.createBufferSource(); neuralSource.buffer = buffer;
          neuralSource.connect(kokoroAudioContext.destination);
          neuralSource.onended = () => { neuralSource = null; resolve(); }; neuralSource.start();
        });
      }
      if (job === neuralJobId) finishVoiceReply();
    } catch (error) {
      if (job !== neuralJobId) return;
      $("tutorVoiceStatus").textContent = "Natural AI voice failed to load; using device voice instead. " + (error.message || error);
      sayDevice(text, true);
    }
  }

  function sayDevice(text, keepJob = false) {
    if (!("speechSynthesis" in window)) {
      $("tutorVoiceStatus").textContent = "Speech synthesis is not supported in this browser.";
      finishVoiceReply();
      return;
    }
    if (!keepJob) stopTutorSpeech();
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
    utterance.onstart = () => { $("tutorVoiceStatus").textContent = "Speaking tutor reply…"; };
    utterance.onend = finishVoiceReply;
    utterance.onerror = () => { $("tutorVoiceStatus").textContent = "Browser speech could not play. Try another voice."; finishVoiceReply(); };
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }

  function say(text) {
    if (!$("tutorSpeak").checked) { if (voiceModeEnabled) finishVoiceReply(); return; }
    if (($("tutorVoiceChoice")?.value || "kokoro") === "kokoro") {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      sayNeural(text);
    } else sayDevice(text);
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
      const systemPrompt = "You are Piano Coach, a warm, patient piano teacher. Help with note reading, rhythm, technique, practice routines, theory and Trinity College London grades Initial through Grade 8. Give concise, speakable answers with practical steps; avoid tables and excessive formatting because the same answer appears as text and speech. You may use detected note labels and an expected sequence if provided, but the microphone detector is approximate and can miss notes or confuse octaves. You cannot infer rhythm, dynamics, chords, fingering or tone quality from note labels alone. You have not heard raw audio and must not claim you have. Do not claim to read uploaded PDF or image notation; the app can parse basic notes from MusicXML. Verify changing exam requirements against the official Trinity syllabus. Encourage relaxed technique and sensible breaks." + (contextText ? "\n\nCurrent piano session context:\n" + contextText : "");
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-12)
      ];
      const result = await engine.chat.completions.create({ messages, temperature: 0.7, max_tokens: 450 });
      const reply = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
      if (!reply) throw new Error("The local model returned an empty answer. Please try again.");
      pending.textContent = reply;
      history.push({ role: "assistant", content: reply });
      if (history.length > 12) history.splice(0, history.length - 12);
      voiceReplyWillSpeak = voiceModeEnabled && $("tutorSpeak").checked;
      say(reply);
    } catch (error) {
      pending.textContent = "I couldn't start the on-device AI: " + (error && error.message ? error.message : String(error)) +
        "\nTry a current browser with WebGPU support and enough free memory. The local model must download the first time; no OpenAI key is used by this tutor.";
      history.pop();
      voiceReplyWillSpeak = false;
      $("tutorVoiceStatus").textContent = "Local tutor not ready. See the message above for troubleshooting.";
    } finally {
      send.disabled = false;
      send.textContent = "Ask tutor";
      input.focus();
      if (voiceModeEnabled && !voiceReplyWillSpeak) { voiceReplyWillSpeak = false; resumeVoiceMode(); }
    }
  }

  function resumeVoiceMode() {
    if (!voiceModeEnabled || !recognition || listening) return;
    try { recognition.start(); } catch (_) {}
  }

  function finishVoiceReply() {
    if (!voiceModeEnabled) return;
    voiceReplyWillSpeak = false;
    $("tutorVoiceStatus").textContent = "Voice mode is on. Listening for your next question…";
    resumeVoiceMode();
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $("tutorVoiceStatus").textContent = "Voice input isn't supported in this browser. Try current Chrome or Edge, or type your question.";
      return;
    }
    if (voiceModeEnabled) {
      voiceModeEnabled = false;
      listening = false;
      if (recognition) { try { recognition.stop(); } catch (_) {} }
      recognition = null;
      $("tutorVoice").textContent = "🎙 Start voice mode";
      $("tutorVoice").setAttribute("aria-pressed", "false");
      $("tutorVoiceStatus").textContent = "Voice mode is off.";
      return;
    }
    voiceModeEnabled = true;
    voiceReplyWillSpeak = false;
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onstart = () => {
      listening = true;
      $("tutorVoice").textContent = "🎙 Voice mode is on · turn off";
      $("tutorVoice").setAttribute("aria-pressed", "true");
      $("tutorVoiceStatus").textContent = "Voice mode is on. Ask a question naturally; it will listen again after the tutor replies.";
    };
    recognition.onresult = event => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += phrase + " ";
        else interimTranscript += phrase;
      }
      if (interimTranscript) $("tutorInput").value = interimTranscript;
      if (finalTranscript.trim()) {
        const transcript = finalTranscript.trim();
        $("tutorInput").value = transcript;
        voiceReplyWillSpeak = true;
        try { recognition.stop(); } catch (_) {}
        sendTutorMessage(transcript);
      }
    };
    recognition.onerror = event => {
      listening = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        voiceModeEnabled = false;
        $("tutorVoice").textContent = "🎙 Start voice mode";
        $("tutorVoice").setAttribute("aria-pressed", "false");
        $("tutorVoiceStatus").textContent = "Microphone permission was denied. Allow microphone access and try again.";
      } else if (voiceModeEnabled) {
        $("tutorVoiceStatus").textContent = "Voice input paused (" + event.error + "). Trying to resume…";
        resumeVoiceMode();
      }
    };
    recognition.onend = () => {
      listening = false;
      if (voiceModeEnabled && !voiceReplyWillSpeak) resumeVoiceMode();
    };
    try { recognition.start(); }
    catch (_) {
      voiceModeEnabled = false;
      $("tutorVoice").textContent = "🎙 Start voice mode";
      $("tutorVoice").setAttribute("aria-pressed", "false");
      $("tutorVoiceStatus").textContent = "Couldn't start the microphone. Check browser permissions.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tutorWidget = $("voiceTutor");
    const tutorWidgetToggle = $("tutorWidgetToggle");
    if (tutorWidget && tutorWidgetToggle) {
      tutorWidgetToggle.addEventListener("click", () => {
        const collapsed = tutorWidget.classList.toggle("tutor-collapsed");
        tutorWidgetToggle.textContent = collapsed ? "Open tutor" : "Minimize";
        tutorWidgetToggle.setAttribute("aria-expanded", String(!collapsed));
        if (!collapsed) {
          $("tutorVoiceStatus").textContent = "Ready. The local AI loads only when you send your first question.";
          $("tutorInput").focus();
        }
      });
    }
    $("tutorSend").addEventListener("click", () => sendTutorMessage($("tutorInput").value));
    $("tutorStopSpeech")?.addEventListener("click", () => { stopTutorSpeech(); if (voiceModeEnabled) { voiceReplyWillSpeak = false; resumeVoiceMode(); } });
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
      stopTutorSpeech();
    });
    addMessage("assistant", "Hi! I'm your on-device piano tutor. I run a local 1B model in your browser, without an OpenAI API key. The first use downloads the model; after that, it can run on this device.");
  });
})();