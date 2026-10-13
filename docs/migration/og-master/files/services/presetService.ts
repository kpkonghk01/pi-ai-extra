import { PresetGroup } from '../types';

/**
 * Stores the style-template preset groups (組合儲存庫) in IndexedDB. Five groups of up to six
 * compressed templates are about 10 MB of base64, more than localStorage holds (about 5 MB).
 */
const DB_NAME = 'og_collage_presets_db';
const STORE_NAME = 'presets';
const DB_VERSION = 1;
const PRESETS_KEY = 'collage_preset_groups';

let dbPromise: Promise<IDBDatabase> | null = null;

const getDB = (): Promise<IDBDatabase> => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
};

export const PresetService = {
  /** The saved groups, or null when nothing has been saved to IndexedDB yet. */
  async load(): Promise<PresetGroup[] | null> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(PRESETS_KEY);
      request.onsuccess = () => resolve((request.result as PresetGroup[] | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  },

  async save(groups: PresetGroup[]): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(groups, PRESETS_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
};
