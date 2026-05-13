# ADR-011: IndexedDB als primäre Persistenz, Sidecar-Datei als Export

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Aus den Anforderungen ergibt sich eine Spannung:

- **NFA-011** verlangt **aggressives Auto-Save**: jede Highlight-, Notiz-, Annotation-Änderung soll sofort persistiert werden.
- **FA-070** verlangt eine **Sidecar-JSON-Datei neben der PDF** als primäres Datenmodell.

In Browsern ist das Schreiben auf das **echte Dateisystem** über die File System Access API zwar möglich, aber:
- Nur in Chromium-Browsern (Firefox/Safari haben kein Schreibrecht ohne Download-Dialog).
- Bei jeder Änderung in die Datei zu schreiben würde das OS-Filesystem mit hunderten kleiner Schreibvorgänge pro Sitzung belasten.
- File-Lock-Konflikte mit externen Tools (Editor, Sync-Clients) wahrscheinlich.

## Entscheidung

**Wir trennen Live-Persistenz und Datei-Persistenz:**

1. **IndexedDB ist die primäre, latenzfreie Persistenz**: jede Annotation-Änderung wird sofort in IndexedDB geschrieben.
2. **Sidecar-Datei wird beim PDF-Schließen geschrieben** (auto), oder **manuell** über „Speichern unter" (User-Aktion).
3. **UI-Indikator**: dezenter Hinweis im Status-Bereich („Ungespeicherte Änderungen seit ⏰") wenn IndexedDB neuer als die Sidecar-Datei ist.
4. **Beim Öffnen einer PDF**: Pagebound vergleicht IndexedDB-Stand mit Sidecar-Datei-Stand. Bei Konflikt → Konflikt-Dialog (User wählt: IndexedDB-Stand, Sidecar-Stand, Merge).

## Konsequenzen

**Positiv:**
- **Auto-Save bleibt aggressiv** ohne Filesystem-Spam.
- **Performance**: IndexedDB ist um Größenordnungen schneller als File-Write.
- **Cross-Browser**: IndexedDB funktioniert überall, Sidecar-File-Handling nur dort, wo möglich.
- **Robustheit**: bei Browser-Crash sind Daten in IndexedDB; Sidecar wäre ggf. noch alter Stand, aber kein Datenverlust.

**Negativ:**
- **Kognitive Last für User**: zwei Persistenz-Stufen. Verstanden werden muss: „Ich habe gerade highlighted, aber das ist nicht in der Sidecar — es ist in IndexedDB. Erst beim Schließen oder Speichern wird die Sidecar aktualisiert."
- **Konflikt-Potenzial**: wenn jemand die Sidecar extern editiert (z.B. in einem Texteditor oder Git-Pull) während IndexedDB einen anderen Stand hat → Konflikt-Dialog.
- **Browser-Quota für IndexedDB**: Limit ist großzügig (typisch GB-Bereich), aber bei sehr großen Libraries (5000 PDFs) gegebenenfalls knapp. Mitigation: PDFs selbst werden nicht in IndexedDB gespeichert (Datei-Handles bleiben), nur Metadaten und Sidecar-Kopie.

**Mitigation:**
- **Onboarding-Erklärung** beim ersten Öffnen klärt das Modell.
- **Auto-Sidecar-Save beim PDF-Schließen** als Default — User merkt im Normalbetrieb nichts.
- **„Speichern"-Shortcut (Strg+S)** schreibt sofort die Sidecar; User-Familiarität bleibt erhalten.

## Alternativen erwogen

- **Direkt in Sidecar bei jeder Änderung schreiben**: erzeugt Performance-Probleme und File-Lock-Konflikte.
- **Nur IndexedDB, keine Sidecar**: widerspricht FA-070 (User soll Sidecar-Datei mitnehmen können beim PDF-Kopieren).
- **Sidecar in regelmäßigem Intervall (alle 30 s) schreiben**: Kompromiss, aber unnötig komplex; Schließ-Trigger reicht.

## Referenz

- Lastenheft NFA-011 (Auto-Save), FA-070 (Sidecar)
- Pflichtenheft Abschnitt 5.3 (IndexedDB-Schema), Abschnitt 4.7 (`ISidecarService`)
- ADR-005 (JSON-Sidecar-Format)
