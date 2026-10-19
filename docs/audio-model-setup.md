# Audio-capable practice review setup

The practice review sends a 45-second mono WAV excerpt from the recording to `/api/analyze-audio`. The server forwards that actual audio to OpenAI's audio-capable Chat Completions model; the existing local polyphonic note transcription still runs separately to provide pitch and onset evidence.

## Required deployment setting

In the Vercel project settings for Piano Coach, add this environment variable for Production (and Preview if desired):

- `OPENAI_API_KEY`: a server-side OpenAI API key with API billing/access enabled.

Optional:
- `OPENAI_AUDIO_MODEL`: defaults to `gpt-audio-1.5`. This default is used because the smaller `gpt-audio-mini` listing is marked deprecated in the current model catalogue.

Redeploy after changing environment variables. Do not add the API key to Vite variables (such as `VITE_OPENAI_API_KEY`) or commit it to the repository; those would expose the secret to browsers.

## What gets sent

The browser converts a representative 45-second excerpt to 16 kHz mono PCM WAV and sends it to the same-origin API endpoint, along with the piece title and optional target-note text. The endpoint returns concise performance observations. The local note transcription is also retained, so feedback can combine audible musical impressions with detected note/onset/duration evidence.

Only the selected excerpt is reviewed by the audio model, not the entire recording. Audio review requires a configured API key and may incur API charges. Without configuration, the endpoint returns an explicit configuration error and the app falls back to its local note-analysis feedback.
