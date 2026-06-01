# Deploy: pagebound.app.lupusmalus.dev (Infomaniak-Host)

Pagebound läuft als statische Blazor-WASM-App (nginx im Container) **neben**
`lupusmalus.dev` auf demselben Server — hinter dem dort schon laufenden
**Caddy**-Reverse-Proxy (automatisches HTTPS), im gemeinsamen externen
Docker-Netz `lupusmalus-net`.

## Pipeline

```
git push (main/Tag)
   └─ GitHub Actions (.github/workflows/publish-image.yml)
        └─ baut Dockerfile → ghcr.io/lupusmalusdeviant/pagebound:latest
                                   │
   Server (Infomaniak):  bash deploy.sh
        ├─ docker compose pull + up -d   (Container `pagebound` an lupusmalus-net)
        └─ hängt Caddy-Site-Block an /home/ubuntu/lupusmalus-web/Caddyfile
              → reverse_proxy pagebound:80  (+ HSTS, TLS via Caddy)
```

Das Image wird in CI gebaut (nicht auf dem 2-GB-Host) und vom Server nur gezogen
— genau wie `lupusmalus-web` / `deviant-sentinel`.

## DNS

`pagebound.app.lupusmalus.dev` → CNAME auf `lupusmalus.dev` (zeigt auf denselben
Host). Caddy holt das Zertifikat beim ersten Request automatisch.

## Einmalige Einrichtung & Updates

Dateien dieses Ordners auf den Server kopieren (oder Repo dort auschecken), dann:

```bash
# auf dem Server, im Ordner mit deploy.sh / docker-compose.yml / Caddyfile.pagebound
bash deploy.sh
```

`deploy.sh` ist **idempotent**: Erstlauf richtet alles ein, Folgeläufe ziehen nur
das neue Image und starten den Container neu. Der Caddy-Block wird nur einmal
angehängt (vorher Backup, danach `caddy validate` → bei Fehler Rollback).

### Überschreibbare Variablen

| Variable | Default |
|---|---|
| `PAGEBOUND_DIR` | `/home/ubuntu/pagebound` |
| `CADDY_DIR` | `/home/ubuntu/lupusmalus-web` |
| `CADDY_CONTAINER` | `lupusmalus-web-caddy-1` |

## Sicherheits-Header

Caddy setzt hier bewusst **nur HSTS** (+ versteckt den Server-Banner). Alle übrigen
Header (CSP mit `wasm-unsafe-eval` für Blazor, `X-Frame-Options`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`) liefert das nginx **im Pagebound-Image**
(`infra/docker/nginx.conf`) und werden durchgereicht — so gibt es keinen
doppelten/kollidierenden CSP.
