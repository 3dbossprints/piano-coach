/* Piano Coach built-in, browser-local tutor. No API key or backend required.
   First use downloads model weights from Hugging Face; browser cache is reused afterward. */
(function(){
  const MODEL = 'onnx-community/Llama-3.2-1B-Instruct-q4f16';
  // A genuinely smaller quantised fallback: do not retry the 1B model on CPU after GPU OOM.
  const CPU_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
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
    let pipe = await init(options.onProgress);
    emit(options.onProgress, 'Thinking about your question…', 100);
    const system = 'You are Piano Coach, a practical and encouraging piano teacher chatting directly with a learner. Answer the latest user message itself; do not open with a generic greeting, onboarding line, or “What can I help you with today?” Do not repeat the question. Start with the useful answer, then give clear, specific steps or a short example. Keep most answers under 180 words unless the learner asks for detail. Ask at most one clarifying question only when genuinely needed. Use prior chat messages to understand follow-ups. For practice feedback, use only the notes and timing data provided; never claim to have heard audio unless audio-analysis data is supplied. Be honest about uncertainty. Do not ask for API keys or suggest installing a separate app.';
    const history = Array.isArray(options.history) ? options.history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8).map(m => ({ role: m.role, content: m.content.slice(0, 1800) })) : [];
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: prompt }];
    const generationOptions = { max_new_tokens: options.max_new_tokens || 160, do_sample: false, repetition_penalty: 1.08, return_full_text: false };
    let out;
    try {
      out = await pipe(messages, generationOptions);
    } catch (executionError) {
      // Release the WebGPU model before retrying with a smaller quantised WASM model.
      emit(options.onProgress, 'GPU memory is limited. Releasing the GPU model and switching to the smaller CPU model…', 0);
      try { if (generator && typeof generator.dispose === 'function') await generator.dispose(); } catch {}
      generator = null;
      pipe = null; // Drop the local reference as well so the WebGPU session can be reclaimed.
      loading = null;
      deviceUsed = null;
      try {
        loading = (async () => {
          const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
          emit(options.onProgress, 'Loading the lightweight CPU tutor (first use may download model files)…', 0);
          const cpu = await pipeline('text-generation', CPU_MODEL, {
            device: 'wasm',
            dtype: 'q4',
            progress_callback: (p) => {
              if (p.status === 'progress') emit(options.onProgress, 'Downloading lightweight CPU model…', p.progress);
              else if (p.status === 'initiate') emit(options.onProgress, 'Preparing CPU model file…', 0);
              else if (p.status === 'done') emit(options.onProgress, 'CPU model file ready.', 100);
            }
          });
          deviceUsed = 'CPU/WASM · lightweight fallback';
          return cpu;
        })();
        generator = await loading;
        loading = null;
        emit(options.onProgress, 'Retrying your feedback with the lightweight CPU model…', 80);
        out = await generator(messages, generationOptions);
      } catch (cpuError) {
        generator = null;
        loading = null;
        deviceUsed = null;
        throw new Error('The GPU model ran out of memory and the lightweight CPU fallback could not run (' + (cpuError?.message || cpuError) + '). Close other tabs using AI or reload and try again.');
      }
    }
    let answer = out?.[0]?.generated_text;
    if (Array.isArray(answer)) answer = answer.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
    if (typeof answer !== 'string') answer = String(answer || '');
    answer = answer.replace(/^\s*(assistant|piano coach)\s*[:\-]?\s*/i,'').trim();
    if (!answer) throw new Error('The local model returned an empty answer. Please try a shorter question.');
    return { answer, model: MODEL, device: deviceUsed };
  }
  window.PianoCoachAI = { ask, load: init, model: MODEL };
})();