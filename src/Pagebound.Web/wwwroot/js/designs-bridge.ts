// =============================================================================
// Pagebound — Design-Ordner Bridge (Designer)
// ----------------------------------------------------------------------------
// Lässt den Nutzer einen Ordner auf dem Ausführungssystem wählen, in dem
// Designer-Vorlagen als `*.pbdesign.json` liegen. Gleiches Muster wie die
// Sidecar-Workspace-Bridge: File-System-Access-Directory-API (Chromium-only),
// das Verzeichnis-Handle wird in IndexedDB persistiert und übersteht Reloads
// (mit Permission-Re-Prompt beim ersten Zugriff pro Session).
//
// Auf Browsern ohne die API degradiert alles sauber: isSupported() === false,
// die Helfer liefern null/false/[] — der Designer blendet die Sektion aus.
//
// Exposed als `pageboundDesigns` IIFE-Global (siehe esbuild.mjs).
// =============================================================================

const DB_NAME = "pagebound";
const DB_VERSION = 1;
const KV_STORE = "kv";
const HANDLE_KEY = "designs:dirHandle";
const FILE_SUFFIX = ".pbdesign.json";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(db => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readonly");
    const req = tx.objectStore(KV_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut(key: string, value: unknown): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readwrite");
    tx.objectStore(KV_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDel(key: string): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readwrite");
    tx.objectStore(KV_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// FileSystemDirectoryHandle fehlt in älteren lib.dom-Typings — bewusst lose.
type DirHandle = any;

export function isSupported(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === "function";
}

async function getHandle(): Promise<DirHandle | null> {
  try {
    return (await idbGet<DirHandle>(HANDLE_KEY)) ?? null;
  } catch {
    return null;
  }
}

async function ensurePermission(handle: DirHandle, mode: "read" | "readwrite"): Promise<boolean> {
  if (!handle || typeof handle.queryPermission !== "function") return true;
  const opts = { mode };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (typeof handle.requestPermission === "function"
        && (await handle.requestPermission(opts)) === "granted") return true;
    return false;
  } catch {
    return false;
  }
}

// Dateinamen kommen aus Nutzereingaben (Dokumenttitel) — keine Pfad-Tricks
// zulassen und das Suffix erzwingen.
function safeFileName(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name.endsWith(FILE_SUFFIX) ? name : name + FILE_SUFFIX;
}

export async function getFolderName(): Promise<string | null> {
  const h = await getHandle();
  return h ? (h.name ?? null) : null;
}

export async function pickFolder(): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    const handle: DirHandle = await (globalThis as any).showDirectoryPicker({ mode: "readwrite" });
    await ensurePermission(handle, "readwrite");
    await idbPut(HANDLE_KEY, handle);
    return handle.name ?? "designs";
  } catch {
    // AbortError (Nutzer hat abgebrochen) o. ä. → kein Ordner gesetzt.
    return null;
  }
}

export async function clearFolder(): Promise<void> {
  try { await idbDel(HANDLE_KEY); } catch { /* ignore */ }
}

export interface DesignEntry {
  fileName: string;
  title: string;
  updatedAt: number; // ms epoch (file.lastModified), 0 wenn unbekannt
}

/** Listet alle `*.pbdesign.json` im Ordner, Titel aus dem JSON (Best-Effort). */
export async function listDesigns(): Promise<DesignEntry[]> {
  const handle = await getHandle();
  if (!handle) return [];
  if (!(await ensurePermission(handle, "read"))) return [];
  const out: DesignEntry[] = [];
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== "file" || !name.endsWith(FILE_SUFFIX)) continue;
      let title = name.slice(0, -FILE_SUFFIX.length);
      let updatedAt = 0;
      try {
        const file = await entry.getFile();
        updatedAt = file.lastModified ?? 0;
        const parsed = JSON.parse(await file.text());
        if (typeof parsed?.title === "string" && parsed.title.trim()) title = parsed.title.trim();
      } catch {
        /* defekte Datei: trotzdem listen, Titel = Dateiname */
      }
      out.push({ fileName: name, title, updatedAt });
    }
  } catch {
    return [];
  }
  out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return out;
}

export async function readDesign(fileName: string): Promise<string | null> {
  const safe = safeFileName(fileName);
  const handle = await getHandle();
  if (!safe || !handle) return null;
  if (!(await ensurePermission(handle, "read"))) return null;
  try {
    const fileHandle = await handle.getFileHandle(safe, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

export async function writeDesign(fileName: string, json: string): Promise<boolean> {
  const safe = safeFileName(fileName);
  const handle = await getHandle();
  if (!safe || !handle) return false;
  if (!(await ensurePermission(handle, "readwrite"))) return false;
  try {
    const fileHandle = await handle.getFileHandle(safe, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function deleteDesign(fileName: string): Promise<boolean> {
  const safe = safeFileName(fileName);
  const handle = await getHandle();
  if (!safe || !handle) return false;
  if (!(await ensurePermission(handle, "readwrite"))) return false;
  try {
    await handle.removeEntry(safe);
    return true;
  } catch {
    return false;
  }
}

export async function designExists(fileName: string): Promise<boolean> {
  const safe = safeFileName(fileName);
  const handle = await getHandle();
  if (!safe || !handle) return false;
  if (!(await ensurePermission(handle, "read"))) return false;
  try {
    await handle.getFileHandle(safe, { create: false });
    return true;
  } catch {
    return false;
  }
}
