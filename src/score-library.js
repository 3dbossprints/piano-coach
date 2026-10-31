const DB_NAME = 'music-coach-score-library';
const DB_VERSION = 2;
const STORE_NAME = 'scores';
const META_STORE = 'meta';
const MIGRATION_KEY = 'legacy-local-storage-imported';
let databasePromise;

const SHEET_EXTENSIONS = /\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp|svg)$/i;
const PLAYABLE_EXTENSIONS = /\.(musiccoach|musicxml|xml|mid|midi)$/i;

export function isSheetMusicLibraryItem(item) {
  if (!item || typeof item.name !== 'string') return false;
  return SHEET_EXTENSIONS.test(item.name) || (item.kind === 'practice-score' && Array.isArray(item.score?.notes));
}

function decodeDataUri(item) {
  if (typeof item?.data !== 'string') return null;
  const comma = item.data.indexOf(',');
  if (comma < 0) return null;
  const metadata = item.data.slice(0, comma);
  const payload = item.data.slice(comma + 1);
  try {
    if (/;base64/i.test(metadata)) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return { bytes, text: new TextDecoder().decode(bytes) };
    }
    const text = decodeURIComponent(payload);
    return { bytes: new TextEncoder().encode(text), text };
  } catch {
    return null;
  }
}

export function isPlayableSheetMusicItem(item) {
  if (!isSheetMusicLibraryItem(item)) return false;
  if (item.kind === 'practice-score' && Array.isArray(item.score?.notes)) return true;
  const name = item.name.toLowerCase();
  const isMusicCoach = name.endsWith('.musiccoach') || item.type === 'application/vnd.piano-coach.musiccoach';
  const isMusicXml = /\.(musicxml|xml)$/i.test(name);
  const isMidi = /\.(mid|midi)$/i.test(name);
  if (!isMusicCoach && !isMusicXml && !isMidi) return false;

  // Older metadata-only cards can still be opened and validated when selected.
  if (typeof item.data !== 'string') return true;
  const decoded = decodeDataUri(item);
  if (!decoded) return false;
  if (isMidi) {
    return decoded.bytes.length >= 14
      && decoded.bytes[0] === 0x4d
      && decoded.bytes[1] === 0x54
      && decoded.bytes[2] === 0x68
      && decoded.bytes[3] === 0x64;
  }
  if (isMusicXml) return /<score-(?:partwise|timewise)\b/i.test(decoded.text);
  try {
    const score = JSON.parse(decoded.text);
    return score?.format === 'musiccoach' && Array.isArray(score.notes);
  } catch {
    return false;
  }
}

function clearLegacyLibrary() {
  try { localStorage.removeItem('pc_files'); } catch { /* Storage may be disabled. */ }
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open browser score storage.'));
      request.onblocked = () => reject(new Error('Browser score storage is blocked by another tab.'));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function readLegacyLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem('pc_files') || '[]');
    return Array.isArray(parsed) ? parsed.filter(isSheetMusicLibraryItem) : [];
  } catch {
    return [];
  }
}

function readMigrationMarker(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(MIGRATION_KEY);
    request.onsuccess = () => resolve(request.result === true);
    request.onerror = () => reject(request.error || new Error('Could not inspect browser score storage.'));
  });
}

function markMigrationComplete(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(true, MIGRATION_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Could not update browser score storage.'));
    tx.onabort = () => reject(tx.error || new Error('Browser score storage transaction was cancelled.'));
  });
}

export async function loadBrowserScoreLibrary() {
  try {
    const db = await openDatabase();
    if (!db) return readLegacyLibrary();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read saved scores.'));
    });
    const savedScores = records.filter(isSheetMusicLibraryItem);
    const migrated = await readMigrationMarker(db);
    if (savedScores.length || migrated) {
      if (!migrated) await markMigrationComplete(db);
      clearLegacyLibrary();
      return savedScores;
    }
    // One-time migration for users upgrading from the old localStorage library.
    const legacy = readLegacyLibrary();
    if (legacy.length) await writeToDatabase(db, legacy);
    await markMigrationComplete(db);
    clearLegacyLibrary();
    return legacy;
  } catch {
    return readLegacyLibrary();
  }
}

function writeToDatabase(db, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    items.filter(isSheetMusicLibraryItem).forEach((item, index) => {
      const id = item.id ?? (String(item.name || 'score') + ':' + index);
      store.put({ ...item, id });
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Could not save scores in this browser.'));
    tx.onabort = () => reject(tx.error || new Error('Browser score storage transaction was cancelled.'));
  });
}

export async function saveBrowserScoreLibrary(items) {
  const scores = (Array.isArray(items) ? items : []).filter(isSheetMusicLibraryItem);
  try {
    const db = await openDatabase();
    if (db) {
      await writeToDatabase(db, scores);
      await markMigrationComplete(db);
      // Do not leave a stale localStorage backup that could resurrect deleted scores.
      clearLegacyLibrary();
      return { persisted: true, storage: 'indexeddb' };
    }
  } catch {
    // Fall through to the small-storage compatibility path.
  }
  try {
    localStorage.setItem('pc_files', JSON.stringify(scores));
    return { persisted: true, storage: 'localstorage' };
  } catch {
    throw new Error('Your browser could not save this score. Free browser storage or export a .musicdata backup.');
  }
}
