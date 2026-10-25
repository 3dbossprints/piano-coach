const SOURCE_CONFIG = {
  archive: { id: 'internet-archive', name: 'Internet Archive', type: 'open-archive' },
  imslp: { id: 'imslp', name: 'IMSLP', type: 'open-score-library' },
  apple: { id: 'apple-music', name: 'Apple Music / iTunes', type: 'recording-catalogue' }
};

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.end(JSON.stringify(value));
}

async function getJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'PianoCoach/1.0 (sheet music search)' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function statusEntry(config, status, count, url, message = '') {
  return { id: config.id, name: config.name, status, count, url, message };
}

async function searchInternetArchive(query) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 8) || [];
  const encodedTerms = terms.map(term => '(title:' + term + ' OR creator:' + term + ' OR description:' + term + ')');
  const searchQuery = (encodedTerms.length ? encodedTerms.join(' AND ') : 'title:' + query) + ' AND mediatype:texts';
  const params = new URLSearchParams();
  params.set('q', searchQuery);
  ['identifier', 'title', 'creator', 'year', 'mediatype'].forEach(field => params.append('fl[]', field));
  params.set('rows', '20');
  params.set('page', '1');
  params.set('output', 'json');
  const url = 'https://archive.org/advancedsearch.php?' + params.toString();
  const data = await getJson(url);
  const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
  const results = docs.filter(doc => doc.identifier && doc.title).map(doc => ({
    id: 'ia-' + doc.identifier,
    source: SOURCE_CONFIG.archive.name,
    sourceId: SOURCE_CONFIG.archive.id,
    category: 'sheet-music archive',
    kind: 'score',
    title: String(doc.title),
    artist: Array.isArray(doc.creator) ? doc.creator.join(', ') : String(doc.creator || 'Creator not listed'),
    album: doc.year ? String(doc.year) : 'Internet Archive item',
    year: doc.year || null,
    art: 'https://archive.org/services/img/' + encodeURIComponent(doc.identifier),
    preview: '',
    url: 'https://archive.org/details/' + encodeURIComponent(doc.identifier),
    rightsNote: 'Check the item page for copyright status and permitted reuse.'
  }));
  return { results, status: statusEntry(SOURCE_CONFIG.archive, results.length ? 'ok' : 'no-results', results.length, url) };
}

async function searchImslp(query) {
  const url = 'https://imslp.org/api.php?' + new URLSearchParams({
    action: 'query', list: 'search', srsearch: query, srlimit: '15', format: 'json', origin: '*'
  }).toString();
  const data = await getJson(url);
  const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
  const results = hits.map(hit => {
    const title = String(hit.title || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
    const pageUrl = 'https://imslp.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
    return {
      id: 'imslp-' + (hit.pageid || title),
      source: SOURCE_CONFIG.imslp.name,
      sourceId: SOURCE_CONFIG.imslp.id,
      category: 'public-domain score catalogue',
      kind: 'score',
      title,
      artist: 'IMSLP catalogue entry',
      album: 'Public-domain / permission-dependent score library',
      year: null,
      art: '',
      preview: '',
      url: pageUrl,
      rightsNote: 'Verify the page and territory-specific rights before downloading or reusing a score.'
    };
  });
  return { results, status: statusEntry(SOURCE_CONFIG.imslp, results.length ? 'ok' : 'no-results', results.length, url) };
}

async function searchApple(query) {
  const url = 'https://itunes.apple.com/search?' + new URLSearchParams({
    term: query, entity: 'song', limit: '15', country: 'GB'
  }).toString();
  const data = await getJson(url);
  const results = (Array.isArray(data?.results) ? data.results : []).map(track => ({
    id: 'apple-' + track.trackId,
    source: SOURCE_CONFIG.apple.name,
    sourceId: SOURCE_CONFIG.apple.id,
    category: 'recording',
    kind: 'audio',
    title: String(track.trackName || 'Untitled track'),
    artist: String(track.artistName || 'Unknown artist'),
    album: String(track.collectionName || 'Recording'),
    year: track.releaseDate ? String(track.releaseDate).slice(0, 4) : null,
    art: track.artworkUrl100 || '',
    preview: track.previewUrl || '',
    url: track.trackViewUrl || '',
    rightsNote: 'Recording metadata and preview availability are provided by Apple; this is not a sheet-music licence.'
  })).filter(track => track.url || track.preview);
  return { results, status: statusEntry(SOURCE_CONFIG.apple, results.length ? 'ok' : 'no-results', results.length, url) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Use GET with a q query parameter.' });
  }
  const query = String(req.query?.q || '').trim().slice(0, 160);
  if (!query) return json(res, 400, { error: 'Enter a title, composer or artist to search.' });
  const directLinks = {
    imslp: 'https://imslp.org/index.php?title=Special:Search&search=' + encodeURIComponent(query),
    mutopia: 'https://www.google.com/search?q=' + encodeURIComponent('site:mutopiaproject.org ' + query + ' score'),
    musescore: 'https://www.google.com/search?q=' + encodeURIComponent('site:musescore.com ' + query + ' sheet music'),
    musicnotes: 'https://www.google.com/search?q=' + encodeURIComponent('site:musicnotes.com ' + query + ' sheet music'),
    sheetMusicPlus: 'https://www.google.com/search?q=' + encodeURIComponent('site:sheetmusicplus.com ' + query + ' sheet music'),
    youtube: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query + ' piano score')
  };
  const attempts = await Promise.allSettled([searchInternetArchive(query), searchImslp(query), searchApple(query)]);
  const results = [];
  const sources = [];
  attempts.forEach((attempt, index) => {
    const configs = [SOURCE_CONFIG.archive, SOURCE_CONFIG.imslp, SOURCE_CONFIG.apple];
    const config = configs[index];
    if (attempt.status === 'fulfilled') {
      results.push(...attempt.value.results);
      sources.push(attempt.value.status);
    } else {
      sources.push(statusEntry(config, 'unavailable', 0, '', 'This catalogue could not be reached during this search.'));
    }
  });
  const unique = new Map();
  results.forEach(result => {
    const key = result.sourceId + ':' + result.title.toLocaleLowerCase() + ':' + result.artist.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, result);
  });
  const finalResults = Array.from(unique.values()).slice(0, 45);
  return json(res, 200, {
    query,
    results: finalResults,
    sources,
    directLinks,
    message: finalResults.length
      ? 'Results are combined from the catalogues that responded. This is not an exhaustive search of every publisher or community site.'
      : 'No catalogue returned results. Try a composer surname, a shorter title, or open one of the source-specific searches.'
  });
}