let ttsPromise = null;
let activeJob = 0;

async function getTTS() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const module = await import("https://esm.run/kokoro-js");
      return module.KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        { dtype: "q8" }
      );
    })().catch(error => {
      ttsPromise = null;
      throw error;
    });
  }
  return ttsPromise;
}

self.addEventListener("message", async event => {
  const data = event.data || {};
  if (data.type === "cancel") {
    activeJob = data.jobId;
    return;
  }
  if (data.type !== "speak") return;
  const jobId = data.jobId;
  activeJob = jobId;
  try {
    self.postMessage({ type: "status", jobId, message: "Loading local neural voice…" });
    const tts = await getTTS();
    if (activeJob !== jobId) return;
    const generated = await tts.generate(String(data.text || ""), { voice: "af_heart" });
    if (activeJob !== jobId) return;
    const samples = generated.audio || generated;
    if (!samples || !samples.length) throw new Error("Neural voice returned no audio.");
    const audio = samples instanceof Float32Array ? samples : Float32Array.from(samples);
    self.postMessage({
      type: "audio",
      jobId,
      audio,
      sampleRate: generated.sampling_rate || 24000
    }, [audio.buffer]);
  } catch (error) {
    if (activeJob === jobId) {
      self.postMessage({ type: "error", jobId, message: error && error.message ? error.message : String(error) });
    }
  }
});
