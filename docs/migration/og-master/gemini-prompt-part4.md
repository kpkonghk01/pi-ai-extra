# og-master migration, Part 4 of 4: small fixes

Continue the same task. Parts 1–3 are already applied, and their rules and edit format still apply. The app already works after Part 3. This part fixes four separate problems; each step is independent.

## Step 1: save the template presets (組合儲存庫) in IndexedDB

Five groups × six templates × up to 250 KB is about 10 MB of base64, more than the browser's localStorage (about 5 MB). Today a save that does not fit only logs to the console while the UI says 「已成功儲存」, and the group is gone after a reload. The generated-image gallery already uses IndexedDB; the presets now use it too.

The presets saved in localStorage so far are kept: they are still read as the starting state, and they are copied to IndexedDB on the first load. The localStorage copy itself is no longer written, and it is not deleted.

**Create** `services/presetService.ts`:

```ts
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
```

**Find** in `App.tsx`:

```ts
import { HistoryService } from './services/historyService';
```

**Replace with:**

```ts
import { HistoryService } from './services/historyService';
import { PresetService } from './services/presetService';
```

Replace the effect that wrote the presets to localStorage:

**Find** in `App.tsx`:

```ts
  useEffect(() => {
    try {
      localStorage.setItem('collage_preset_groups', JSON.stringify(presetGroups));
    } catch (e) {
      console.error("Failed to save preset groups to localStorage:", e);
    }
  }, [presetGroups]);
```

**Replace with:**

```ts
  // Preset groups live in IndexedDB: 30 templates do not fit in localStorage (about 5 MB).
  // The initial state above still reads the old localStorage copy, which is kept unchanged as a
  // backup; it is written to IndexedDB on the first load.
  const [presetsLoaded, setPresetsLoaded] = useState<boolean>(false);

  useEffect(() => {
    PresetService.load()
      .then((saved) => {
        if (saved && Array.isArray(saved) && saved.length === 5) {
          setPresetGroups(saved);
        }
      })
      .catch((e) => console.error("Failed to load preset groups:", e))
      .finally(() => setPresetsLoaded(true));
  }, []);

  useEffect(() => {
    if (!presetsLoaded) return;
    PresetService.save(presetGroups).catch((e) => {
      console.error("Failed to save preset groups:", e);
      showToast("樣板組合儲存失敗，重新整理後可能會遺失。(Failed to save preset groups)", "error");
    });
  }, [presetGroups, presetsLoaded]);
```

Keep the `presetGroups` state initializer above it unchanged: it still reads `collage_preset_groups` from localStorage.

## Step 2: download file types

Downloads were always named `.jpg`, even for PNG results from cropping or logo placement. The editor always used `.png`, even for JPEG results.

**Find** in `App.tsx`:

```ts
const dataUrlToFile = (dataUrl: string, filename: string): File => {
```

**Replace with:**

```ts
/** File extension for an image data URL: PNG results (crop, logo) stay .png, everything else is .jpg. */
const imageExtension = (url: string): string => (url.startsWith('data:image/png') ? 'png' : 'jpg');

const dataUrlToFile = (dataUrl: string, filename: string): File => {
```

**Find** in `App.tsx`:

```ts
        // Changed to .jpg
        downloadBlob(blob, `collage-${img.ratio}-${img.id}.jpg`);
```

**Replace with:**

```ts
        downloadBlob(blob, `collage-${img.ratio}-${img.id}.${imageExtension(img.url)}`);
```

**Find** in `App.tsx`:

```ts
            // Changed to .jpg
            zip.file(`collage-${i + 1}-${img.ratio}.jpg`, base64Data, {base64: true});
```

**Replace with:**

```ts
            zip.file(`collage-${i + 1}-${img.ratio}.${imageExtension(img.url)}`, base64Data, {base64: true});
```

**Find** in `components/ImageEditor.tsx`:

```ts
      a.download = `edited-image-${Date.now()}.png`;
```

**Replace with:**

```ts
      a.download = `edited-image-${Date.now()}.${previewUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`;
```

## Step 3: outdated text

The app no longer uses only "Gemini 3 Pro Image Preview".

**Find** in `App.tsx`:

```tsx
            To use the <strong>Gemini 3 Pro Image Preview</strong> model for high-fidelity collage generation, you must connect a Google Cloud Project with billing enabled.
```

**Replace with:**

```tsx
            To use the <strong>Google Gemini</strong> image models for high-fidelity collage generation, you must connect a Google Cloud Project with billing enabled.
```

**Find** in `index.html`:

```html
    <meta property="og:description" content="A professional tool to generate Open Graph images by mimicking uploaded style templates using Gemini 3 Pro Image Preview." />
```

**Replace with:**

```html
    <meta property="og:description" content="A professional tool to generate Open Graph images by mimicking uploaded style templates, using Google Gemini, ToAPIs and KIE image models." />
```

**Find** in `metadata.json`:

```json
  "description": "A professional tool to generate Open Graph images by mimicking uploaded style templates using Gemini 3 Pro Image Preview.",
```

**Replace with:**

```json
  "description": "A professional tool to generate Open Graph images by mimicking uploaded style templates, using Google Gemini, ToAPIs and KIE image models.",
```

Remove the stylesheet link to `/index.css`, which does not exist. Styles come from the Tailwind script in `index.html`.

**Find** in `index.html`:

```html
<link rel="stylesheet" href="/index.css">
</head>
```

**Replace with:**

```html
</head>
```

## Step 4: AI logo erase in the image editor

The mask box was sized from the unpadded corner, so near the image edges it fell short or extended past the image. And when the cleaned image could not be loaded, the editor waited forever.

**Find** in `components/ImageEditor.tsx`:

```ts
      ctx.fillRect(
        Math.max(0, box.x - pad),
        Math.max(0, box.y - pad),
        Math.min(W - box.x, box.w + pad * 2),
        Math.min(H - box.y, box.h + pad * 2)
      );
```

**Replace with:**

```ts
      // The padded box, clipped to the image. The old width and height were measured from the
      // unpadded corner, so the mask fell short or overshot near the edges.
      const maskX = Math.max(0, box.x - pad);
      const maskY = Math.max(0, box.y - pad);
      ctx.fillRect(
        maskX,
        maskY,
        Math.min(W, box.x + box.w + pad) - maskX,
        Math.min(H, box.y + box.h + pad) - maskY
      );
```

**Find** in `components/ImageEditor.tsx`:

```ts
        await new Promise((res) => { cleanedImg.onload = res; });
```

**Replace with:**

```ts
        await new Promise((res, rej) => {
          cleanedImg.onload = res;
          cleanedImg.onerror = () => rej(new Error('無法讀取 AI 擦除後的圖片。'));
        });
```

## Step 5: check Part 4

1. `npm run lint` and `npm run build` pass.
2. `App.tsx` no longer contains `localStorage.setItem('collage_preset_groups'` or `// Changed to .jpg`. No file contains `Gemini 3 Pro Image Preview`.
3. Save templates to all five preset groups, reload the page: all five groups are still there.
4. Reply with every file you created or changed, and every step where the code did not match exactly and how you applied it.
