import { KokoroTTS } from "https://esm.sh/kokoro-js@1.2.1";

let ttsPromise = null;
async function getTTS() {
  if (!ttsPromise) ttsPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
  return ttsPromise;
}
self.onmessage = async event => {
  const { id, text } = event.data || {};
  try {
    const tts = await getTTS();
    const output = await tts.generate(String(text || ""), { voice: "af_heart" });
    const audio = output.audio;
    const sampleRate = output.sampling_rate || output.sample_rate || 24000;
    const buffer = audio instanceof Float32Array ? audio : new Float32Array(audio);
    self.postMessage({ id, audio: buffer, sampleRate }, [buffer.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error && error.message ? error.message : String(error) });
  }
};
