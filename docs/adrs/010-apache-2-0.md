# ADR-010: Apache License 2.0 als Open-Source-Lizenz

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound wird als Open-Source-Projekt veröffentlicht (NFA-040, NFA-042). Die Lizenzwahl beeinflusst:
- Welche Dritt-Bibliotheken kombinierbar sind.
- Wie andere das Tool weiterverwenden dürfen (Fork, kommerzielle Nutzung).
- Wie attraktiv das Projekt für Mitwirkende und kommerzielle Nutzer ist.

Wichtigste Lizenz-Familien:

| Lizenz | Typ | Charakter |
|---|---|---|
| MIT | permissiv | minimal, sehr beliebt im JS-Ökosystem |
| Apache 2.0 | permissiv | mit Patent-Schutz, sehr beliebt in Enterprise |
| BSD-2/3-Clause | permissiv | ähnlich MIT |
| GPL v3 | copyleft | Forks müssen GPL bleiben |
| AGPL v3 | copyleft (Netzwerk) | wie GPL, aber auch SaaS-Forks müssen offen sein |

## Entscheidung

**Apache License 2.0 für eigenen Code.**

Begleitend:
- **Third-Party-Lizenzen** in NOTICE dokumentiert.
- **NFA-041**: alle Dritt-Bibliotheken müssen Apache-2.0-kompatibel sein (MIT, BSD, Apache 2.0). GPL/AGPL/kommerziell-only ausgeschlossen.

## Konsequenzen

**Positiv:**
- **Patent-Schutz-Klauseln** schützen vor Patent-Aggression durch Mitwirkende.
- **Maximale Adoptionsbreite** — sowohl Open-Source-Forks als auch kommerzielle Nutzungen erlaubt.
- **Enterprise-freundlich**: viele Firmen bevorzugen Apache 2.0 gegenüber MIT wegen Patent-Klauseln.
- **Mainstream im .NET-Ökosystem** (.NET Foundation nutzt fast immer Apache 2.0 oder MIT).
- **NOTICE-Mechanismus** zwingt Forks, die Herkunft sichtbar zu machen.

**Negativ:**
- **Kein Copyleft**: Forks dürfen kommerziell-closed werden. Ein Closed-Source-Adobe-Konkurrent könnte unser Tool nehmen, Features ergänzen und kommerzialisieren ohne Code zurückzugeben.
- **Etwas mehr Boilerplate** als MIT (NOTICE-Pflicht, Header in Datei-Kommentaren empfohlen).

**Mitigation des Copyleft-Verzichts:**
- Bewusste Entscheidung: wir priorisieren maximale Verbreitung über Copyleft-Sicherung.
- Wenn dieses Risiko in der Zukunft real wird (z.B. ein klar erkennbarer Fork ohne Rückbeitrag), kann die Lizenz **für zukünftige Versionen** geändert werden (bestehende Code bleibt unter Apache 2.0).

## Alternativen erwogen

- **MIT**: minimal, aber ohne Patent-Klauseln. Verworfen zugunsten Apache 2.0 (etwas robuster).
- **GPL v3**: würde Closed-Source-Forks verhindern. Verworfen, weil es Mitwirken erschwert (GPL ist umstritten in Enterprise-Umfeldern und schließt manche Drittnutzer aus).
- **AGPL v3**: extrem restriktiv für SaaS-Nutzung. Verworfen, weil Pagebound primär Client-side ist und AGPL hier kaum Nutzen bringt.
- **Dual-Licensing (Apache + Kommerziell)**: bringt Solo-Aufwand für Vertrieb. Nicht im MVP-Scope.

## Referenz

- Lastenheft NFA-040, NFA-041, NFA-042
- `LICENSE` (Volltext Apache 2.0)
- `NOTICE` (Third-Party-Attribution)
