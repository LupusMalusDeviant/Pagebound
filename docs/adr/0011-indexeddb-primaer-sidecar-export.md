# ADR-0011: IndexedDB als primärer Speicher, Sidecar für Export/Austausch

- Status: **Akzeptiert**
- Bezug: `src/Pagebound.Web/wwwroot/js/storage-bridge.ts`, `src/Pagebound.Infrastructure/Storage/IndexedDbStorage`, `src/Pagebound.Infrastructure/Sidecars/JsonSidecarService.cs`, [Blueprint: Storage & Persistenz](../blueprints/storage-persistenz.md)

> Nachträglich dokumentiert (F-19) — hält die im Code bereits umgesetzte
> Entscheidung fest.

## Kontext

Ohne Server muss der Zustand (Annotationen, Library-Einträge, PDF-Bytes-Cache)
clientseitig persistiert werden und über Browser-Sitzungen hinweg erhalten
bleiben. Gleichzeitig sollen Nutzer ihre Annotationen exportieren, teilen und in
eine andere Instanz importieren können.

## Entscheidung

- **Primärspeicher: IndexedDB.** Eine minimale Key-Value-Schicht (`pageboundStorage`)
  über einer Datenbank `pagebound` mit einem Object-Store `kv` (string-Keys),
  versioniert über eine kleine Schema-Version-Konstante. JSON-sichere Werte gehen
  als JSON-String rein/raus; PDF-Bytes werden als `Uint8Array` direkt
  (Structured-Clone, ohne JSON-Roundtrip) gespeichert.
- **Austausch/Export: Sidecar (JSON).** Ein separates `*.pagebound.json`-Sidecar
  (Download/Upload) trägt Schema-Version, PdfMeta, Library-Eintrag, Annotationen
  und Integritäts-Record. Es ist die portable, menschenlesbare Austauschform —
  die IndexedDB bleibt die laufende Quelle der Wahrheit.

## Konsequenzen

- **+** Persistenz ohne Server; großer Bytes-Cache (Cap 100 MB/PDF) möglich.
- **+** Sidecar ist portabel/diffbar und entkoppelt Export vom internen Storage.
- **−** Zwei Serialisierungsformen (Structured-Clone in IndexedDB, JSON im
  Sidecar) müssen konsistent bleiben (gleiche Optionen).
- **−** Bestehende IndexedDB-Daten und Sidecars müssen lesbar bleiben — keine
  destruktiven Migrationen, `AnnotationType`-Enum nie umsortieren (vgl.
  [ADR-0001](0001-interface-first.md)).
