# /loop-Prompt für die Abarbeitung der Findings (Opus 4.8)

In einer neuen Session (Modell: Opus 4.8) im Repo-Root `X:\CodingAdventures2\PDF-Tool` folgenden Prompt eingeben:

```
/loop Arbeite die Aufträge aus docs/findings/FINDINGS-2026-07-03.md ab — pro Iteration genau EINEN Auftrag, in der Reihenfolge der Tabelle „Empfohlene Reihenfolge" am Ende des Dokuments (Runde 1 zuerst, innerhalb einer Runde aufsteigend nach Nummer).

Setup (nur in der allerersten Iteration):
1. Falls es uncommittete Änderungen gibt (FreeText-Feature + docs/), committe sie zuerst als Basis: "feat(reader): Freitext-Werkzeug + Datum-Stempel (FreeText-Annotationen)" bzw. "docs: Codebase-Blueprints + Review-Findings".
2. Lege docs/findings/PROGRESS.md an: eine Checkbox-Zeile pro Auftrag F-01 bis F-21 in Abarbeitungsreihenfolge, Status [ ] offen / [x] erledigt / [!] blockiert (mit 1-Zeilen-Begründung).

Pro Iteration:
1. Lies docs/findings/PROGRESS.md und wähle den ERSTEN offenen Auftrag.
2. Lies den zugehörigen Abschnitt in docs/findings/FINDINGS-2026-07-03.md VOLLSTÄNDIG — insbesondere „Abschnitt 0: Globale Regeln" (NO Telemetry, NO Server, keine neuen Laufzeit-Dependencies, i18n immer in de.json UND en.json, AnnotationType-Enum nie umsortieren). Diese Regeln sind hart und gelten für jeden Auftrag.
3. Setze NUR diesen einen Auftrag um. Halte dich exakt an SOLL und NICHT. Wenn IST-Beschreibung und Code abweichen (Zeilennummern können verschoben sein — die Methodennamen zählen), folge dem Code und notiere die Abweichung in PROGRESS.md.
4. Verifiziere: dotnet build Pagebound.slnx && dotnet test tests/Pagebound.Core.Tests müssen grün sein; bei Änderungen an src/Pagebound.Web/wwwroot/js/*.ts zusätzlich npm run build:js im Ordner src/Pagebound.Web. Prüfe die Akzeptanzkriterien des Auftrags — bei UI-Aufträgen (z.B. F-21) per Browser-Preview (preview_start "pagebound-web"; eine Test-PDF lässt sich über IndexedDB pdf:bytes:<sha256> + /reader?pdf=<sha256> injizieren).
5. Committe den Auftrag einzeln, deutsch, Conventional-Commit-Stil mit Auftrags-ID, z.B. "fix(reader): F-01 Signaturstatus nach Freitext-Drag neu berechnen". KEIN Push.
6. Hake den Auftrag in PROGRESS.md ab (mit Commit-Hash). Schlägt die Umsetzung nach 2 ernsthaften Anläufen fehl, markiere [!] mit Begründung und mache im nächsten Durchlauf mit dem nächsten Auftrag weiter — nicht endlos an einem Auftrag hängen.

Ende: Wenn PROGRESS.md keinen offenen Auftrag mehr enthält, beende den Loop (kein neues Wakeup planen) und schreibe eine Abschluss-Zusammenfassung: erledigte Aufträge, blockierte Aufträge mit Grund, Gesamtergebnis von Build/Tests.
```

## Hinweise

- **Modellwahl:** Vor dem Start in der neuen Session Opus 4.8 als Modell wählen (Model-Picker der App bzw. `claude --model claude-opus-4-8`).
- **Selbstgetaktet:** `/loop` ohne Intervall lässt das Modell das Tempo selbst bestimmen — jede Iteration = ein Auftrag, dadurch bleibt jeder Commit klein und reviewbar.
- **Abbruch/Fortsetzung:** Der Loop ist über `docs/findings/PROGRESS.md` jederzeit unterbrech- und fortsetzbar — auch eine spätere Session steigt einfach wieder mit demselben Prompt ein.
- **Reihenfolge-Kritisch:** F-10 erst NACH F-02/F-04 (steht so in der Rundentabelle); F-21 (Seitennavigation nach unten) ist Teil von Runde 3.
