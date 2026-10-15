/* Piano Coach built-in, browser-local tutor. No API key or backend required.
   First use downloads model weights from Hugging Face; browser cache is reused afterward. */
(function(){
  const MODEL = 'onnx-community/Qwen2.5-1.5B-Instruct';
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
          generator = await pipeline('text-generation', MODEL, { device: 'webgpu', dtype: 'q4', progress_callback });
          deviceUsed = 'WebGPU';
          return generator;
        } catch (gpuError) {
          emit(onProgress, 'GPU model loading failed; trying compatible CPU/WASM mode…', 0);
        }
      }
      generator = await pipeline('text-generation', MODEL, { device: 'wasm', dtype: 'q4', progress_callback });
      deviceUsed = 'CPU/WASM';
      return generator;
    })().catch(err => { loading = null; generator = null; throw err; });
    return loading;
  }
  async function ask(question, options={}) {
    const prompt = String(question || '').trim();
    if (!prompt) throw new Error('Type a question first.');
    const pipe = await init(options.onProgress);
    emit(options.onProgress, 'Thinking with the local model (' + deviceUsed + ')…', 100);
    const messages = [
      { role: 'system', content: 'You are Piano Coach, a warm, practical piano tutor for learners. Give clear, concise, actionable advice. For playing feedback, discuss only notes and timing data supplied to you; never claim to have heard audio unless data is provided. Do not ask for API keys or suggest installing a separate app.' },
      { role: 'user', content: prompt }
    ];
    const out = await pipe(messages, { max_new_tokens: options.max_new_tokens || 180, do_sample: true, temperature: 0.65, return_full_text: false });
    let answer = out?.[0]?.generated_text;
    if (Array.isArray(answer)) answer = answer.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
    if (typeof answer !== 'string') answer = String(answer || '');
    answer = answer.replace(/^\s*assistant\s*/i,'').trim();
    if (!answer) throw new Error('The local model returned an empty answer. Please try a shorter question.');
    return { answer, model: MODEL, device: deviceUsed };
  }
  window.PianoCoachAI = { ask, load: init, model: MODEL };
})();