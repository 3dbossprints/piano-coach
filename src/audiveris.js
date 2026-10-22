const endpoint = (import.meta.env.VITE_AUDIVERIS_API_URL || '').trim();

/**
 * Sends the original score file to a self-hosted Audiveris HTTP adapter.
 * The adapter must accept multipart/form-data field "file" and return
 * uncompressed MusicXML (XML text), not Audiveris' zipped .mxl file.
 */
export async function recognizeWithAudiveris(file) {
  if (!endpoint) {
    throw new Error(
      'The Audiveris service is not connected yet. Configure VITE_AUDIVERIS_API_URL with the URL of an Audiveris OMR service, then redeploy. The old single-staff guesser has been removed.'
    );
  }

  const form = new FormData();
  form.append('file', file, file.name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: { Accept: 'application/vnd.recordare.musicxml+xml, application/xml, text/xml' }
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OMR service returned HTTP ${response.status}${detail ? ': ' + detail : ''}`);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('json')) {
      const payload = await response.json();
      if (!payload.musicxml || typeof payload.musicxml !== 'string') {
        throw new Error(payload.error || 'OMR service JSON response did not contain a musicxml string.');
      }
      return { musicxml: payload.musicxml };
    }
    const musicxml = await response.text();
    if (!musicxml.trim().startsWith('<?xml') && !musicxml.trim().startsWith('<score-partwise') && !musicxml.trim().startsWith('<score-timewise')) {
      throw new Error('The OMR service did not return uncompressed MusicXML. Configure it to return the exported .xml content, not a .mxl ZIP.');
    }
    return { musicxml };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Audiveris took longer than 3 minutes. Try a smaller or shorter score.');
    if (error instanceof TypeError) throw new Error('Could not reach the Audiveris service. Check its URL, CORS settings and that the service is online.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
