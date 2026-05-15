// =============================================================================
// Pagebound — IndexedDB Storage Bridge
// ----------------------------------------------------------------------------
// Minimal generic key-value persistence on top of IndexedDB, fronted by the
// `pageboundStorage` IIFE global so C# (Pagebound.Infrastructure/Storage/
// IndexedDbStorage) can keep its API surface tiny.
//
// Layout (per ADR-011 - IndexedDB primary, sidecar for export):
//   database:    "pagebound"
//   objectStore: "kv"  (one store, keyed by string)
//   versioned via a small schema-version constant
//
// Values are serialized as JSON-strings on the way in and parsed on the way
// out, so callers can use any JSON-safe shape without worrying about the
// quirks of the structured-clone algorithm (Date round-trip in particular).
// =============================================================================

const DB_NAME = "pagebound";
const DB_VERSION = 1;
const KV_STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(KV_STORE, mode);
        const store = tx.objectStore(KV_STORE);
        const result = body(store);
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result as T);
          result.onerror = () => reject(result.error ?? new Error("IndexedDB request failed"));
        } else {
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        }
      })
  );
}

export async function get(key: string): Promise<string | null> {
  const value = await run<unknown>("readonly", (store) => store.get(key));
  if (value === undefined || value === null) return null;
  // Stored shape is a JSON string; pass it back verbatim so C# deserializes.
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function set(key: string, jsonValue: string): Promise<void> {
  // We expect callers to pass a pre-serialized JSON string; storing it
  // verbatim keeps the contract symmetrical to `get`.
  await run("readwrite", (store) => store.put(jsonValue, key));
}

export async function remove(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}

export async function exists(key: string): Promise<boolean> {
  const count = await run<number>("readonly", (store) => store.count(key));
  return count > 0;
}

/**
 * Native byte storage — speichert die übergebene Uint8Array direkt in IndexedDB
 * (Structured-Clone-Algorithmus ohne JSON-Roundtrip). Wird für die PDF-Bytes
 * der Library-Einträge genutzt (FA-060), damit das Re-Öffnen einer PDF aus der
 * Library kein erneutes Datei-Auswählen erfordert.
 */
export async function setBlob(key: string, bytes: Uint8Array): Promise<void> {
  await run("readwrite", (store) => store.put(bytes, key));
}

export async function getBlob(key: string): Promise<Uint8Array | null> {
  const value = await run<unknown>("readonly", (store) => store.get(key));
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export async function keys(prefix: string): Promise<string[]> {
  const db = await openDb();
  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(KV_STORE, "readonly");
    const store = tx.objectStore(KV_STORE);
    const request = store.openKeyCursor();
    const found: string[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(found);
        return;
      }
      const k = cursor.key;
      if (typeof k === "string" && (prefix === "" || k.startsWith(prefix))) {
        found.push(k);
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB cursor failed"));
  });
}
