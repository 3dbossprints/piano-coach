const DB_NAME = 'music-coach-score-library';
const DB_VERSION = 1;
const STORE_NAME = 'scores';
let databasePromise;

const SHEET_EXTENSIONS = /\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp|svg)$/i;
const PLAYABLE_EXTENSIONS = /\.(musiccoach|musicxml|xml|mid|midi)$/i;

export function isSheetMusicLibraryItem(item) {
  if (!item || typeof item.name !== 'string') return false;
  return SHEET_EXTENSIONS.test(item.name) || (item.kind === 'practice-score' && Array.isArray(item.score?.notes));
}

export function isPlayableSheetMusicItem(item) {
  if (!isSheetMusicLibraryItem(item)) return false;
  return PLAYABLE_EXTENSIONS.test(item.name) || item.type === 'application/vnd.piano-coach.musiccoach' || (item.kind === 'practice-score' && Array.isArray(item.score?.notes));
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
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
    if (records.length) return records.filter(isSheetMusicLibraryItem);
    const legacy = readLegacyLibrary();
    if (legacy.length) await writeToDatabase(db, legacy);
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
