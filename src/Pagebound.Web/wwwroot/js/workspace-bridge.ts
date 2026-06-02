// =============================================================================
// Pagebound — Sidecar-Workspace Bridge (FA-072 / FA-073)
// ----------------------------------------------------------------------------
// Lets the user pick a central folder for sidecar files via the File System
// Access *directory* API (`showDirectoryPicker`, Chromium-only). The chosen
// FileSystemDirectoryHandle is persisted in IndexedDB (structured clone — handles
// survive a reload), so reopening a PDF can auto-detect its sidecar at
// `{pdfHash}.pagebound.json` in that folder (FA-073).
//
// On browsers without the API every entry point degrades gracefully:
// isSupported() === false and the read/write helpers return null/false, so the
// C# caller falls back to the manual download/upload flow.
//
// Exposed as the `pageboundWorkspace` IIFE global (see esbuild.mjs).
// =============================================================================

const DB_NAME = "pagebound";
const DB_VERSION = 1;
const KV_STORE = "kv";
const HANDLE_KEY = "workspace:dirHandle";

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

// FileSystemDirectoryHandle is not in older lib.dom typings — keep it loose.
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

// FSA permission gate. OPFS handles (used in tests) lack queryPermission and are
// implicitly granted, so a missing function means "allowed".
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

export async function getWorkspaceName(): Promise<string | null> {
  const h = await getHandle();
  return h ? (h.name ?? null) : null;
}

export async function pickWorkspace(): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    const handle: DirHandle = await (globalThis as any).showDirectoryPicker({ mode: "readwrite" });
    await ensurePermission(handle, "readwrite");
    await idbPut(HANDLE_KEY, handle);
    return handle.name ?? "workspace";
  } catch {
    // AbortError (user cancelled) or anything else → no workspace set.
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  try { await idbDel(HANDLE_KEY); } catch { /* ignore */ }
}

export async function saveSidecar(hash: string, json: string): Promise<boolean> {
  const handle = await getHandle();
  if (!handle) return false;
  if (!(await ensurePermission(handle, "readwrite"))) return false;
  try {
    const fileHandle = await handle.getFileHandle(`${hash}.pagebound.json`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadSidecar(hash: string): Promise<string | null> {
  const handle = await getHandle();
  if (!handle) return null;
  if (!(await ensurePermission(handle, "read"))) return null;
  try {
    const fileHandle = await handle.getFileHandle(`${hash}.pagebound.json`, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    // NotFoundError when there is no sidecar for this PDF — that's expected.
    return null;
  }
}
