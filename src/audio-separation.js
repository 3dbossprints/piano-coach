const MAX_SEPARATION_SECONDS = 8 * 60;

export function toStereoChannels(audioBuffer) {
  const length = audioBuffer.length;
  const source = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  if (source.length === 1) return [new Float32Array(source[0])];
  if (source.length === 2) return [new Float32Array(source[0]), new Float32Array(source[1])];

  // Standard 5.1-style downmix. Keep the centre channel (where film dialogue
  // is commonly placed) in both sides before the dialogue/music model runs.
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const centre = source[2];
  const lfe = source[3];
  const surroundLeft = source[4];
  const surroundRight = source[5];
  for (let i = 0; i < length; i++) {
    let l = source[0][i] || 0;
    let r = source[1][i] || 0;
    if (centre) { l += (centre[i] || 0) * 0.7071; r += (centre[i] || 0) * 0.7071; }
    if (lfe) { l += (lfe[i] || 0) * 0.5; r += (lfe[i] || 0) * 0.5; }
    if (surroundLeft) l += (surroundLeft[i] || 0) * 0.7071;
    if (surroundRight) r += (surroundRight[i] || 0) * 0.7071;
    for (let channel = 6; channel < source.length; channel++) {
      const value = (source[channel][i] || 0) * 0.35;
      if (channel % 2 === 0) l += value; else r += value;
    }
    left[i] = l;
    right[i] = r;
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 1 ? 1 / peak : 1;
  if (gain < 1) {
    for (let i = 0; i < length; i++) { left[i] *= gain; right[i] *= gain; }
  }
  return [left, right];
}

export function encodePcm16Wav(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !channels.every(channel => channel instanceof Float32Array)) {
    throw new TypeError('WAV encoding needs one or more Float32 audio channels.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('A valid audio sample rate is required.');
  const frameCount = channels[0].length;
  if (!frameCount || channels.some(channel => channel.length !== frameCount)) {
    throw new RangeError('All audio channels must contain the same non-zero number of samples.');
  }
  const channelCount = channels.length;
  const dataBytes = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = Math.max(-1, Math.min(1, Number(channels[channel][frame]) || 0));
      view.setInt16(offset, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
      offset += 2;
    }
  }
  return buffer;
}

export async function separateDialogueFromMusic(file, onProgress = () => {}) {
  if (typeof window === 'undefined') throw new Error('Dialogue separation is only available in a browser.');
  const deviceMemory = Number(navigator.deviceMemory);
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory < 8) {
    throw new Error('This device reports less than 8 GB of memory. To avoid the browser running out of memory, dialogue separation was skipped; the original audio will still be transcribed.');
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot decode audio for dialogue separation.');
  const context = new AudioContextClass();
  let decoded;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close().catch(() => {});
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('The audio duration could not be read.');
  if (decoded.duration > MAX_SEPARATION_SECONDS) {
    throw new Error('Dialogue separation currently supports recordings up to 8 minutes. The original audio will be transcribed instead.');
  }

  onProgress('Preparing stereo audio for dialogue/music separation…');
  const channels = toStereoChannels(decoded);
  const { default: separate } = await import('@audio/neural-separate');
  onProgress('Loading the local dialogue/music model (about 31 MB on first use; cached afterwards)…');
  const hasWebGpu = !!navigator.gpu;
  const progress = ({ chunk, totalChunks } = {}) => {
    if (Number.isFinite(chunk) && Number.isFinite(totalChunks) && totalChunks > 0) {
      onProgress('Separating dialogue from music · section ' + chunk + ' of ' + totalChunks + '…');
    }
  };
  let result;
  try {
    result = await separate(channels, {
      sampleRate: decoded.sampleRate,
      model: 'mrx',
      device: hasWebGpu ? 'webgpu' : 'wasm',
      progress
    });
  } catch (error) {
    if (!hasWebGpu) throw error;
    onProgress('GPU separation was unavailable. Retrying with the browser CPU/WASM backend…');
    result = await separate(channels, {
      sampleRate: decoded.sampleRate,
      model: 'mrx',
      device: 'wasm',
      progress
    });
  }
  let musicChannels = result?.stems?.music;
  if (musicChannels instanceof Float32Array) musicChannels = [musicChannels];
  if (!Array.isArray(musicChannels) || !musicChannels.length || !musicChannels.every(channel => channel instanceof Float32Array)) {
    throw new Error('The dialogue/music model did not return a usable music stem.');
  }
  const sampleRate = Number(result.sampleRate) || decoded.sampleRate;
  const wav = encodePcm16Wav(musicChannels, sampleRate);
  const stemName = (file.name || 'recording').replace(/\.[^.]+$/, '') + '-music-stem.wav';
  onProgress('Dialogue separated. Transcribing the music stem…');
  return new File([wav], stemName, { type: 'audio/wav', lastModified: Date.now() });
}
