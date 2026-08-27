# cms-verify — unabhängige Gegenprobe zur PDF-Signatur

Prüft eine von Pagebound signierte PDF mit einer **fremden** Implementierung:
.NET (`System.Security.Cryptography.Pkcs`) statt node-forge. Damit lässt sich
das prüfen, was die eigenen Tests nicht können — ob die Signatur auch
außerhalb des eigenen Kodierers gilt.

```bash
dotnet run --project tools/cms-verify -- pfad/zur/signierten.pdf
```

## Warum es das gibt

Der Smoke-Test des MCP-Pakets prüft die Signatur mit **derselben** Bibliothek,
die sie erzeugt hat. Genau daran ist ein Fehler jahrelang vorbeigelaufen: die
signierten Attribute standen nicht in DER-Reihenfolge, was nur auffällt, wenn
ein Prüfer sie vor dem Vergleich **neu kodiert**. Gefunden hat es ein fremder
Prüfer, nicht die eigene Suite.

Das Werkzeug macht deshalb **zwei** Prüfungen:

1. **Über die empfangenen Bytes** (`SignedCms.CheckSignature`) — so prüfen
   Adobe Reader und, wie hier nachgemessen, auch .NET selbst. Nachsichtig:
   unsortierte Attribute fallen hier *nicht* auf.
2. **Über die neu kodierten Attribute** — der strenge Weg (BouncyCastle,
   eIDAS-Validatoren). Die signierten Attribute werden nach DER neu kodiert
   (ein `SET` wird dabei sortiert) und die Signatur gegen diesen Digest
   geprüft. Wurde ursprünglich über eine unsortierte Menge signiert, passt der
   Digest nicht mehr.

Nur wenn **beide** bestehen, ist die Signatur für strenge Prüfer brauchbar.

Zusätzlich wird `signingCertificateV2` (RFC 5035) aufgeschlüsselt: ob
`hashAlgorithm` korrekt weggelassen wurde (DER-Vorgabewert), ob `certHash`
wirklich der SHA-256 des eingebetteten Zertifikats ist und ob `issuerSerial` zu
Aussteller und Seriennummer passt.

## Beispielausgabe

```
1) SignedCms.CheckSignature (über die empfangenen Bytes): BESTANDEN

2) DER-Neukodierung der Attribute: 249 Bytes
   Signatur über die NEU kodierten Attribute: BESTANDEN
   → Auch strenge Prüfer (BouncyCastle, eIDAS) akzeptieren.
```

Der Rückgabewert ist `0`, wenn beide Prüfungen bestehen, sonst `1` — für den
Einsatz in Skripten.
