// =============================================================================
// Pagebound — File-System-Access-API Bridge
// ----------------------------------------------------------------------------
// Stellt Chromium-spezifisches showOpenFilePicker + persistentes
// FileSystemFileHandle bereit, damit Library-Einträge auch ohne Bytes-Cache
// per One-Click wieder geöffnet werden können. Handles werden in der
// gleichen "pagebound"-IndexedDB unter dem Key `pdf:handle:{hash}` abgelegt
// (Structured-Clone, kein JSON-Roundtrip — FileSystemFileHandle ist eine
// spezielle DOM-Klasse, die der Browser nativ persistiert).
//
// Firefox/Safari: `supportsFileHandles()` liefert false, alle Picker-Aufrufe
// liefern null — der C#-Code fällt auf seinen Bytes-Cache-Pfad zurück.
//
// Entsprechende C#-Klasse: Pagebound.Infrastructure.Storage.FileSystemAccessHandleService.
// =============================================================================

const DB_NAME = "pagebound";
const DB_VERSION = 1;
const STORE = "kv";
const PREFIX = "pdf:handle:";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ----------------------------------------------------------------------------

export function supportsFileHandles(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function";
}

export interface PickedPdf {
  bytes: Uint8Array;
  filename: string;
  /** ID auf das frisch erzeugte Handle in der `pendingHandles`-Map.
   *  Sobald der C#-Code den PDF-Hash kennt, wird per `persistHandle` das
   *  Handle unter dem Hash-Key in IndexedDB gespeichert. */
  tempId: string;
}

/** In-Memory-Map fürs Handover Pick → Hash → Persist. Mehr State brauchen
 *  wir nicht — ein Pick lebt nur bis zum nächsten persistHandle-Aufruf. */
const pendingHandles = new Map<string, FileSystemFileHandle>();

export async function pickPdf(): Promise<PickedPdf | null> {
  if (!supportsFileHandles()) return null;
  try {
    const picker = (window as any).showOpenFilePicker as (
      opts?: unknown
    ) => Promise<FileSystemFileHandle[]>;
    const handles = await picker({
      types: [
        {
          description: "PDF",
          accept: { "application/pdf": [".pdf"] }
        }
      ],
      multiple: false,
      excludeAcceptAllOption: false
    });
    const handle = handles?.[0];
    if (!handle) return null;
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingHandles.set(tempId, handle);
    return { bytes, filename: file.name, tempId };
  } catch (err: any) {
    // Aborted picker (user cancel) → keine Action.
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

export async function persistHandle(tempId: string, hash: string): Promise<boolean> {
  const handle = pendingHandles.get(tempId);
  if (!handle) return false;
  pendingHandles.delete(tempId);
  try {
    await idbPut(PREFIX + hash, handle);
    return true;
  } catch {
    return false;
  }
}

export interface ReopenedPdf {
  bytes: Uint8Array;
  filename: string;
}

export async function tryReopenByHash(hash: string): Promise<ReopenedPdf | null> {
  try {
    const handle = await idbGet<FileSystemFileHandle>(PREFIX + hash);
    if (!handle) return null;
    // queryPermission/requestPermission sind Teil des FSA-Specs. Wenn "granted"
    // sofort lesen; bei "prompt" zeigt der Browser einen kurzen Permission-Dialog
    // (kein File-Picker — nur Ja/Nein für die schon ausgewählte Datei). Bei
    // "denied" geben wir null zurück, dann fällt der Caller auf seinen
    // nächstniedrigeren Mechanismus (Bytes-Cache oder File-Picker).
    const opts: FileSystemHandlePermissionDescriptor = { mode: "read" };
    let perm = await (handle as any).queryPermission?.(opts) as PermissionState | undefined;
    if (perm !== "granted") {
      perm = await (handle as any).requestPermission?.(opts) as PermissionState | undefined;
    }
    if (perm !== "granted") return null;
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, filename: file.name };
  } catch {
    return null;
  }
}

export async function clearHandle(hash: string): Promise<void> {
  try {
    await idbDelete(PREFIX + hash);
  } catch {
    // ignore
  }
}
