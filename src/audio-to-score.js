import { AudioToMidiConverter, audioToMidiDefaults, convertAudioToMidi } from '@musicbento/audio-to-midi';
import { toStereoChannels } from './audio-separation.js';
import { encodeNotesAsMidi } from './audio-midi-encode.js';

const AUDIO_EXTENSIONS = /\.(mp3|m4a|mp4|webm|wav)$/i;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 8 * 60;

async function transcribeWithNeuralBasicPitch(file, onProgress) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot decode audio for polyphonic transcription.');
  const context = new AudioContextClass();
  let decoded;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close().catch(() => {});
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('The audio duration could not be read.');
  if (decoded.duration > MAX_DURATION_SECONDS) throw new Error('For browser performance, convert recordings up to 8 minutes long.');
  const audio = { channelData: toStereoChannels(decoded), sampleRate: decoded.sampleRate };
  const { default: transcribe } = await import('@audio/neural-transcribe');
  const settings = {
    onsetThreshold: 0.5,
    frameThreshold: 0.3,
    minDuration: 0.08,
    minFreq: 27.5,
    maxFreq: 4186.01,
    batch: 8
  };
  onProgress?.('Running frame-aware polyphonic transcription across the full piano range…');
  let notes;
  if (navigator.gpu) {
    try {
      notes = await transcribe(audio, { ...settings, device: 'webgpu' });
    } catch {
      onProgress?.('GPU transcription was unavailable. Retrying with the browser CPU/WASM backend…');
      notes = await transcribe(audio, { ...settings, device: 'wasm' });
    }
  } else {
    notes = await transcribe(audio, { ...settings, device: 'wasm' });
  }
  if (!Array.isArray(notes) || !notes.length) throw new Error('The frame-aware model did not detect any usable notes.');
  const midiBlob = encodeNotesAsMidi(notes, { bpm: 120 });
  return { midiBlob, noteCount: notes.length, title: file.name.replace(AUDIO_EXTENSIONS, ''), engine: 'Frame-aware Basic Pitch (ONNX)' };
}

function waitForMediaEvent(media, successEvent, failureMessage) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(media.error?.message || failureMessage)); };
    const cleanup = () => {
      media.removeEventListener(successEvent, onSuccess);
      media.removeEventListener('error', onError);
    };
    media.addEventListener(successEvent, onSuccess, { once: true });
    media.addEventListener('error', onError, { once: true });
  });
}

async function extractMp4Audio(file, onProgress) {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot extract audio from MP4 video. Try exporting the audio as MP3 or M4A.');
  }
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  let sourceStream;
  let recorder;
  try {
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = false;
    video.src = url;
    const metadata = waitForMediaEvent(video, 'loadedmetadata', 'Could not read the MP4 video.');
    await metadata;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('The MP4 file has no readable audio/video duration.');
    }
    if (video.duration > MAX_DURATION_SECONDS) {
      throw new Error('For browser performance, convert videos up to 8 minutes long. Trim this video or export its audio first.');
    }
    const capture = video.captureStream || video.mozCaptureStream;
    if (!capture) throw new Error('This browser cannot extract the audio track from MP4. Try MP3 or M4A instead.');
    sourceStream = capture.call(video);
    // Chromium may not expose the audio track until the media element starts
    // playback. Prime the stream, then rewind before recording so the beginning
    // of the soundtrack is not lost.
    await video.play();
    const audioTracks = sourceStream.getAudioTracks();
    if (!audioTracks.length) throw new Error('No audio track was found in this MP4 video.');
    video.pause();
    if (video.currentTime > 0.01) {
      const seeked = waitForMediaEvent(video, 'seeked', 'Could not rewind the MP4 video.');
      video.currentTime = 0;
      await seeked;
    }
    const audioOnlyStream = new MediaStream(audioTracks);
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser cannot create a temporary audio stream for MP4 conversion.');
    const chunks = [];
    recorder = new MediaRecorder(audioOnlyStream, { mimeType });
    const recorded = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', () => reject(new Error('Could not extract the MP4 audio track.')));
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
    });
    recorder.start(1000);
    onProgress?.('Extracting the audio track from your MP4 video…');
    await video.play();
    await new Promise((resolve, reject) => {
      video.addEventListener('ended', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('The MP4 video could not be decoded by this browser.')), { once: true });
    });
    if (recorder.state !== 'inactive') recorder.stop();
    const audioBlob = await recorded;
    if (!audioBlob.size) throw new Error('The MP4 video did not produce a readable audio track.');
    return new File([audioBlob], file.name.replace(/\.mp4$/i, '.webm'), { type: audioBlob.type || 'audio/webm' });
  } finally {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    sourceStream?.getTracks().forEach(track => track.stop());
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function transcribeAudioFile(file, onProgress, { removeDialogue = false } = {}) {
  if (!file || !AUDIO_EXTENSIONS.test(file.name || '')) {
    throw new Error('Choose an MP3, M4A, MP4 or WebM file.');
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error('Choose an audio/video file smaller than 100 MB.');
  }
  let audioFile = file;
  if (/\.mp4$/i.test(file.name) || (/\.webm$/i.test(file.name) && /^video\//i.test(file.type || ''))) {
    audioFile = await extractMp4Audio(file, onProgress);
  }
  const separation = { applied: false, warning: '' };
  if (removeDialogue) {
    try {
      const { separateDialogueFromMusic } = await import('./audio-separation.js');
      audioFile = await separateDialogueFromMusic(audioFile, onProgress);
      separation.applied = true;
    } catch (error) {
      separation.warning = String(error?.message || error);
      onProgress?.('Dialogue separation was unavailable. Continuing with the original audio…');
    }
  }
  let result;
  let engine = 'MusicBento Basic Pitch fallback';
  try {
    result = await transcribeWithNeuralBasicPitch(audioFile, onProgress);
    engine = result.engine;
  } catch (neuralError) {
    onProgress?.('The frame-aware model could not run (' + String(neuralError?.message || neuralError) + '). Trying the compatible transcription fallback…');
    const options = {
      onStatus(status) {
        const messages = {
          'loading-model': 'Loading the fallback audio transcription model…',
          'decoding-audio': 'Reading the audio track…',
          'transcribing': 'Detecting notes and chords…',
          'preparing-midi': 'Building the MIDI note sequence…'
        };
        onProgress?.(messages[status] || 'Converting recording…');
      },
      onProgress(progress) {
        const value = Number(progress);
        if (Number.isFinite(value)) {
          const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
          onProgress?.('Transcribing audio into notes… ' + percent + '%');
        }
      },
    };
    try {
      result = await convertAudioToMidi(audioFile, audioToMidiDefaults, options);
    } catch (error) {
      const detail = String(error?.message || error);
      const errorCode = String(error?.code || '');
      const gpuFailure = /webgl|webgpu|gpu|shader|context lost|backend/i.test(detail + ' ' + errorCode);
      if (!gpuFailure) throw error;
      onProgress?.('Graphics acceleration is unavailable. Retrying fallback transcription with the CPU backend…');
      const cpuConverter = new AudioToMidiConverter({ ...audioToMidiDefaults, backend: 'cpu' });
      result = await cpuConverter.convert(audioFile, options);
    }
  }
  const midiBlob = result?.midiBlob || (result?.midiBytes
    ? new Blob([result.midiBytes], { type: 'audio/midi' })
    : null);
  if (!midiBlob || !midiBlob.size) {
    throw new Error('The audio model did not detect any notes. Try a clearer recording with one prominent instrument.');
  }
  return {
    midiBlob,
    noteCount: Number(result.noteCount) || 0,
    title: result.title || file.name.replace(AUDIO_EXTENSIONS, ''),
    separation,
    transcriptionEngine: engine,
  };
}
