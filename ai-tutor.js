/* Piano Coach built-in, browser-local tutor. No API key or backend required.
   First use downloads model weights from Hugging Face; browser cache is reused afterward. */
(function(){
  const MODEL = 'onnx-community/Llama-3.2-1B-Instruct-q4f16';
  const CPU_MODEL = 'onnx-community/Llama-3.2-1B-Instruct';
  let generator = null, loading = null, deviceUsed = null;
  function emit(cb, message, percent) { if (typeof cb === 'function') cb({message, percent}); }
  async function init(onProgress) {
    if (generator) return generator;
    if (loading) return loading;
    loading = (async () => {
      emit(onProgress, 'Loading the local AI engine…', 0);
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const progress_callback = (p) => {
        if (p.status === 'progress') emit(onProgress, 'Downloading model files for first use…', p.progress);
        else if (p.status === 'initiate') emit(onProgress, 'Preparing ' + (p.file || 'model file') + '…', 0);
        else if (p.status === 'done') emit(onProgress, 'Model file ready.', 100);
      };
      if (navigator.gpu) {
        try {
          generator = await pipeline('text-generation', MODEL, { device: 'webgpu', dtype: 'q4f16', progress_callback });
          deviceUsed = 'WebGPU';
          return generator;
        } catch (gpuError) {
          emit(onProgress, 'GPU model loading failed; trying compatible CPU/WASM mode…', 0);
        }
      }
      generator = await pipeline('text-generation', CPU_MODEL, { device: 'wasm', dtype: 'q4', progress_callback });
      deviceUsed = 'CPU/WASM';
      return generator;
    })().catch(err => { loading = null; generator = null; throw err; });
    return loading;
  }
  async function ask(question, options={}) {
    const prompt = String(question || '').trim();
    if (!prompt) throw new Error('Type a question first.');
    const pipe = await init(options.onProgress);
    emit(options.onProgress, 'Thinking about your question…', 100);
    const system = 'You are Piano Coach, a practical and encouraging piano teacher chatting directly with a learner. Answer the latest user message itself; do not open with a generic greeting, onboarding line, or “What can I help you with today?” Do not repeat the question. Start with the useful answer, then give clear, specific steps or a short example. Keep most answers under 180 words unless the learner asks for detail. Ask at most one clarifying question only when genuinely needed. Use prior chat messages to understand follow-ups. For practice feedback, use only the notes and timing data provided; never claim to have heard audio unless audio-analysis data is supplied. Be honest about uncertainty. Do not ask for API keys or suggest installing a separate app.';
    const history = Array.isArray(options.history) ? options.history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 1800) })) : [];
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: prompt }];
    const out = await pipe(messages, { max_new_tokens: Math.min(160, options.max_new_tokens || 160), do_sample: false, repetition_penalty: 1.08, return_full_text: false });
    let answer = out?.[0]?.generated_text;
    if (Array.isArray(answer)) answer = answer.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
    if (typeof answer !== 'string') answer = String(answer || '');
    answer = answer.replace(/^\s*(assistant|piano coach)\s*[:\-]?\s*/i,'').trim();
    if (!answer) throw new Error('The local model returned an empty answer. Please try a shorter question.');
    return { answer, model: MODEL, device: deviceUsed };
  }
  window.PianoCoachAI = { ask, load: init, model: MODEL };
})();