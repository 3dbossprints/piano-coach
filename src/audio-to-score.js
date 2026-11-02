import { audioToMidiDefaults, convertAudioToMidi } from '@musicbento/audio-to-midi';

const AUDIO_EXTENSIONS = /\.(mp3|m4a|mp4|webm)$/i;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 8 * 60;

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
    const audioTracks = sourceStream.getAudioTracks();
    if (!audioTracks.length) throw new Error('No audio track was found in this MP4 video.');
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

export async function transcribeAudioFile(file, onProgress) {
  if (!file || !AUDIO_EXTENSIONS.test(file.name || '')) {
    throw new Error('Choose an MP3, M4A, MP4 or WebM file.');
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error('Choose an audio/video file smaller than 100 MB.');
  }
  let audioFile = file;
  if (/\.mp4$/i.test(file.name)) {
    audioFile = await extractMp4Audio(file, onProgress);
  }
  onProgress?.('Loading the local audio transcription model. The first conversion may take a little longer…');
  const result = await convertAudioToMidi(audioFile, audioToMidiDefaults, {
    onProgress(progress) {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress) * 100)));
      onProgress?.('Transcribing audio into notes… ' + percent + '%');
    },
  });
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
  };
}
