# ADR-005: JSON-Sidecar mit Schema-Versionierung

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Annotation-Daten, Tags, Notizen und Integritäts-Hashes müssen persistiert werden (FA-070 ff.). Die PDF-Datei selbst eignet sich dafür nur eingeschränkt:

- PDF-Annotation-Standard ist begrenzt expressiv (z.B. keine Markdown-Notizen, keine Tags).
- Schreiben in PDF erfordert Re-Serialisierung — bei jedem Highlight nicht zumutbar.
- PDF ist binär, nicht git-friendly.
- User soll bei Bedarf Annotation-Daten ohne PDF teilen können.

## Entscheidung

**Annotation-Daten werden in einer JSON-Sidecar-Datei neben dem PDF persistiert** — Default-Schema: `<filename>.pdf.pagebound.json`.

Details:
- **Format**: JSON gemäß JSON Schema Draft-07; vollständig dokumentiert in `docs/03-pflichtenheft.md` Abschnitt 5.
- **Schema-Versionierung**: Top-Level-Feld `"schemaVersion": "1.0"`. Migrator-Kette erlaubt Forward- und Backward-Kompatibilität.
- **Speicherort**: zwei unterstützte Orte (FA-072):
  - Default: neben der PDF (`/Documents/paper.pdf` ⇒ `/Documents/paper.pdf.pagebound.json`).
  - Optional: zentraler Workspace (`<workspaceRoot>/<pdfHash>.pagebound.json`).
- **Auto-Erkennung**: beim Öffnen einer PDF werden beide Orte geprüft (FA-073).
- **Verschlüsselung**: optional pro Sidecar, AES-256-GCM mit PBKDF2-SHA-256 ≥ 600 000 Iterationen (FA-074, NFA-023).

## Konsequenzen

**Positiv:**
- Mensch-lesbar (öffenbar im Texteditor), gut für Debugging und Migration.
- Git-friendly (Diffs sinnvoll).
- Beliebig erweiterbar ohne PDF-Format-Konflikte.
- Unabhängig vom PDF-Reader: Andere Tools können die Sidecars lesen, wenn das Schema dokumentiert ist.

**Negativ:**
- **User muss daran denken, beim Kopieren der PDF das Sidecar mitzunehmen.** Wenn jemand die PDF per Mail verschickt, geht der Kontext (Annotationen) verloren.
- **Im Browser**: Sidecar-Schreiben braucht entweder File System Access API (Chromium) oder einen Upload-/Download-Fallback (Firefox/Safari).
- **Konflikt-Potenzial**: Sidecar an zwei Orten gleichzeitig vorhanden → Konflikt-Dialog für User nötig.

**Mitigation:**
- UI weist beim ersten Annotieren freundlich darauf hin: „Ihre Notizen werden in `paper.pdf.pagebound.json` neben der PDF gespeichert."
- „Export-Bundle" (PDF + Sidecar als ZIP) als spätere Convenience-Funktion (Roadmap, Post-0.7).
- Falls Sidecar verloren geht, kann User die zentrale Workspace-Variante als Backup nutzen.

## Alternativen erwogen

- **Annotationen im PDF einbetten** — schränkt Datenmodell stark ein, keine Markdown-Notizen möglich, jeder Speichervorgang re-serialisiert die ganze PDF.
- **Zentraler Workspace als Default** — verworfen, weil dann beim Mit-Versand des PDFs die Annotationen sicher fehlen (kein Sidecar daneben). Default-„neben PDF" entkoppelt das Projekt von einer zentralen Datenbank.
- **Markdown mit YAML-Frontmatter (Obsidian-Stil)** — schlechter maschinenlesbar, schema-frei. Markdown-Export für Notizen kommt separat über FA-080 ff.

## Referenz

- Lastenheft FA-070 bis FA-074
- Pflichtenheft Abschnitt 5.1, 5.2 (Schema und Migration)
