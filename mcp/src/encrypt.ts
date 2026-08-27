// =============================================================================
// PDF encryption (AES-256, ISO 32000-2 /V5 /R6) for the Pagebound MCP server.
// Port of the web app's WebCrypto encryptor (wwwroot/js/pdf-manipulator-bridge.ts
// → encryptPdf). Runs on Node's standard WebCrypto (globalThis.crypto.subtle,
// available since Node 20) — no native dependencies. Only SHA-256/384/512 + AES,
// no MD5. Streams are encrypted (/CFM AESV3), strings stay /Identity (MVP, same
// as the web app). The document opens password-protected in any compliant reader.
// =============================================================================
import { PDFDocument } from "pdf-lib";
import { NO_METADATA_BUMP, ToolError } from "./pdf.js";

const subtle = globalThis.crypto.subtle;
const EMPTY = new Uint8Array(0);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  const algo = bits === 256 ? "SHA-256" : bits === 384 ? "SHA-384" : "SHA-512";
  return new Uint8Array(await subtle.digest(algo, data));
}

/** AES-CBC ohne Padding: verschlüsselt block-alignte Daten, schneidet den PKCS7-Extra-Block ab. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const enc = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, k, data));
  return enc.slice(0, data.length);
}

/** AES-256-CBC mit zufälligem IV + PKCS7 (Stream-/String-Daten, /CFM AESV3). IV wird vorangestellt. */
async function aesCbcEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const k = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, k, plaintext));
  return concatBytes(iv, ct);
}

/** Algorithm 2.B — iterierter Hardening-Hash. */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concatBytes(password, salt, udata));
  let e: Uint8Array = new Uint8Array(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const block = concatBytes(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    e = await aesCbcNoPad(k.slice(0, 16), k.slice(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
  }
  return k.slice(0, 32);
}

interface R6Keys { u: Uint8Array; ue: Uint8Array; o: Uint8Array; oe: Uint8Array; perms: Uint8Array; }

/** Algorithmen 8–10: /U /UE /O /OE /Perms aus File-Key + Passwörtern. */
async function deriveR6Keys(
  ownerPw: Uint8Array, userPw: Uint8Array, fileKey: Uint8Array, permissions: number, encryptMetadata: boolean
): Promise<R6Keys> {
  const rnd = () => crypto.getRandomValues(new Uint8Array(8));
  const uVal = rnd(), uKey = rnd();
  const uHash = await hash2B(userPw, uVal, EMPTY);
  const u = concatBytes(uHash, uVal, uKey);
  const uInter = await hash2B(userPw, uKey, EMPTY);
  const ue = await aesCbcNoPad(uInter, new Uint8Array(16), fileKey);
  const oVal = rnd(), oKey = rnd();
  const oHash = await hash2B(ownerPw, oVal, u);
  const o = concatBytes(oHash, oVal, oKey);
  const oInter = await hash2B(ownerPw, oKey, u);
  const oe = await aesCbcNoPad(oInter, new Uint8Array(16), fileKey);
  const block = new Uint8Array(16);
  block[0] = permissions & 0xff; block[1] = (permissions >> 8) & 0xff;
  block[2] = (permissions >> 16) & 0xff; block[3] = (permissions >> 24) & 0xff;
  block[4] = block[5] = block[6] = block[7] = 0xff;
  block[8] = encryptMetadata ? 0x54 : 0x46; // 'T' / 'F'
  block[9] = 0x61; block[10] = 0x64; block[11] = 0x62; // 'a','d','b'
  block.set(crypto.getRandomValues(new Uint8Array(4)), 12);
  const perms = await aesCbcNoPad(fileKey, new Uint8Array(16), block);
  return { u, ue, o, oe, perms };
}

// --- PDF structure rewrite ---------------------------------------------------

function latin1Decode(b: Uint8Array): string { return new TextDecoder("latin1").decode(b); }
function latin1Encode(s: string): Uint8Array { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; }
function toHex(b: Uint8Array): string { let s = ""; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s.toUpperCase(); }
function preparePassword(pw: string): Uint8Array { const b = new TextEncoder().encode(pw || ""); return b.length <= 127 ? b : b.slice(0, 127); }

interface PdfObjEntry { num: number; gen: number; isStream: boolean; objBytes?: Uint8Array; dictText?: string; streamData?: Uint8Array; }

function indexOfStreamKw(text: string, from: number, end: number): number {
  let i = from;
  while (i < end) {
    const idx = text.indexOf("stream", i);
    if (idx < 0 || idx >= end) return -1;
    const prevD = idx > 0 && text[idx - 1] === "d";
    const after = idx + 6;
    const eol = after < text.length && (text[after] === "\r" || text[after] === "\n");
    if (!prevD && eol) return idx;
    i = idx + 6;
  }
  return -1;
}

function parsePdfStructure(pdf: Uint8Array): { header: Uint8Array; objects: PdfObjEntry[]; maxObj: number; rootRef: string; infoRef: string | null } {
  const text = latin1Decode(pdf);
  const isD = (c: string) => c >= "0" && c <= "9";
  const isWs = (c: string) => c === " " || c === "\r" || c === "\n" || c === "\t" || c === "\f" || c === "\0";

  const sx = text.lastIndexOf("startxref");
  if (sx < 0) throw new ToolError("Verschlüsselung fehlgeschlagen: kein startxref (PDF nicht klassisch strukturiert).", "UNSUPPORTED");
  let p = sx + 9;
  while (p < text.length && !isD(text[p])) p++;
  let s = p; while (p < text.length && isD(text[p])) p++;
  const xrefOffset = parseInt(text.slice(s, p), 10);

  const offsets = new Map<number, number>();
  let xp = xrefOffset;
  while (xp < text.length && isWs(text[xp])) xp++;
  if (text.slice(xp, xp + 4) !== "xref") throw new ToolError("Verschlüsselung fehlgeschlagen: kein klassisches xref (evtl. xref-Stream).", "UNSUPPORTED");
  xp += 4;
  while (true) {
    while (xp < text.length && isWs(text[xp])) xp++;
    if (xp >= text.length || !isD(text[xp])) break;
    s = xp; while (isD(text[xp])) xp++; const start = parseInt(text.slice(s, xp), 10);
    while (isWs(text[xp])) xp++;
    s = xp; while (isD(text[xp])) xp++; const count = parseInt(text.slice(s, xp), 10);
    while (xp < text.length && text[xp] !== "\n") xp++; xp++;
    for (let i = 0; i < count; i++) {
      const entry = text.slice(xp, xp + 20);
      const off = parseInt(entry.slice(0, 10), 10);
      if (entry[17] === "n") offsets.set(start + i, off);
      xp += 20;
    }
  }
  if (offsets.size === 0) throw new ToolError("Verschlüsselung fehlgeschlagen: xref ohne In-Use-Objekte.", "PDF_CORRUPT");

  const tp = text.indexOf("trailer", xrefOffset);
  const trailer = tp >= 0 ? text.slice(tp, Math.min(text.length, tp + 4000)) : "";
  const rootM = trailer.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootM) throw new ToolError("Verschlüsselung fehlgeschlagen: kein /Root im Trailer.", "PDF_CORRUPT");
  const infoM = trailer.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);

  const maxObj = Math.max(...offsets.keys());
  const sorted = [...offsets.entries()].sort((a, b) => a[1] - b[1]);
  const header = pdf.slice(0, sorted[0][1]);

  const objects: PdfObjEntry[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const start = sorted[idx][1];
    const end = idx + 1 < sorted.length ? sorted[idx + 1][1] : xrefOffset;
    let q = start;
    while (isWs(text[q])) q++;
    let a = q; while (isD(text[q])) q++; const num = parseInt(text.slice(a, q), 10);
    while (isWs(text[q])) q++;
    a = q; while (isD(text[q])) q++; const gen = parseInt(text.slice(a, q), 10);
    while (isWs(text[q])) q++;
    q += 3; // "obj"
    const bodyStart = q;
    const kw = indexOfStreamKw(text, bodyStart, end);
    if (kw < 0) {
      const eo = text.indexOf("endobj", bodyStart);
      const sliceEnd = eo >= 0 && eo < end ? eo + 6 : end;
      objects.push({ num, gen, isStream: false, objBytes: pdf.slice(start, sliceEnd) });
    } else {
      const dictText = text.slice(bodyStart, kw);
      let dataStart = kw + 6;
      if (text[dataStart] === "\r") dataStart++;
      if (text[dataStart] === "\n") dataStart++;
      let dataEnd: number;
      const lenM = dictText.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      const len = lenM ? parseInt(lenM[1], 10) : -1;
      if (len >= 0 && dataStart + len <= end) dataEnd = dataStart + len;
      else { let es = text.indexOf("endstream", dataStart); dataEnd = es < 0 || es > end ? end : es; if (text[dataEnd - 1] === "\n") dataEnd--; if (text[dataEnd - 1] === "\r") dataEnd--; }
      objects.push({ num, gen, isStream: true, dictText, streamData: pdf.slice(dataStart, dataEnd) });
    }
  }
  return { header, objects, maxObj, rootRef: `${rootM[1]} ${rootM[2]} R`, infoRef: infoM ? `${infoM[1]} ${infoM[2]} R` : null };
}

function bumpVersion(header: Uint8Array): Uint8Array {
  const h = header.slice();
  for (let i = 0; i + 7 < h.length; i++) {
    if (h[i] === 0x25 && h[i + 1] === 0x50 && h[i + 2] === 0x44 && h[i + 3] === 0x46 && h[i + 4] === 0x2d && h[i + 5] === 0x31 && h[i + 6] === 0x2e) {
      if (h[i + 7] < 0x37) h[i + 7] = 0x37;
      break;
    }
  }
  return h;
}

function withFreshLength(dict: string, len: number): string {
  const stripped = dict.replace(/\/Length\s+\d+(\s+\d+\s+R)?/, "");
  const open = stripped.indexOf("<<");
  const at = open >= 0 ? open + 2 : 0;
  return stripped.slice(0, at) + ` /Length ${len}` + stripped.slice(at).replace(/\s+$/, "");
}

function buildEncryptDict(keys: R6Keys, permissions: number, encryptMetadata: boolean): string {
  return "<< /Filter /Standard /V 5 /R 6 /Length 256 " +
    `/P ${permissions} /EncryptMetadata ${encryptMetadata ? "true" : "false"} ` +
    "/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> " +
    "/StmF /StdCF /StrF /Identity " +
    `/U <${toHex(keys.u)}> /UE <${toHex(keys.ue)}> /O <${toHex(keys.o)}> /OE <${toHex(keys.oe)}> /Perms <${toHex(keys.perms)}> >>`;
}

/**
 * Verschlüsselt eine PDF mit AES-256 (R6). `ownerPassword` schützt zusätzlich die
 * Rechte; ist es leer, wird `userPassword` für beide gesetzt (wie in der Web-App,
 * wo ein Passwort sowohl zum Öffnen als auch als Owner dient).
 */
export async function encryptPdf(
  pdfBytes: Uint8Array,
  userPassword: string,
  ownerPassword?: string,
  permissions = -1,
  encryptMetadata = true
): Promise<Uint8Array> {
  const normDoc = await PDFDocument.load(pdfBytes, { ...NO_METADATA_BUMP, ignoreEncryption: true });
  const normalized = await normDoc.save({ useObjectStreams: false });
  const struct = parsePdfStructure(normalized);

  const user = preparePassword(userPassword);
  const owner = preparePassword(ownerPassword && ownerPassword.length ? ownerPassword : userPassword);
  // BEWUSSTE AUSNAHME von der Reproduzierbarkeit: Dateischlüssel, IVs und die
  // Datei-/ID sind Zufall und müssen es sein. Zwei Verschlüsselungen derselben
  // Eingabe ergeben deshalb verschiedene Bytes — das ist Kryptographie, kein
  // Schlendrian.
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const keys = await deriveR6Keys(owner, user, fileKey, permissions, encryptMetadata);

  const encNum = struct.maxObj + 1;
  const size = encNum + 1;
  const parts: Uint8Array[] = [];
  let pos = 0;
  const offsets = new Map<number, number>();
  const pushBytes = (b: Uint8Array) => { parts.push(b); pos += b.length; };
  const pushStr = (s: string) => pushBytes(latin1Encode(s));

  pushBytes(bumpVersion(struct.header));

  for (const o of struct.objects.slice().sort((a, b) => a.num - b.num)) {
    offsets.set(o.num, pos);
    if (!o.isStream) {
      pushBytes(o.objBytes!);
      if (o.objBytes!.length === 0 || o.objBytes![o.objBytes!.length - 1] !== 0x0a) pushStr("\n");
    } else {
      const enc = await aesCbcEncrypt(fileKey, o.streamData!);
      pushStr(`${o.num} ${o.gen} obj\n`);
      pushStr(withFreshLength(o.dictText!, enc.length));
      pushStr("\nstream\n");
      pushBytes(enc);
      pushStr("\nendstream\nendobj\n");
    }
  }

  offsets.set(encNum, pos);
  pushStr(`${encNum} 0 obj\n`);
  pushStr(buildEncryptDict(keys, permissions, encryptMetadata));
  pushStr("\nendobj\n");

  const xrefOffset = pos;
  pushStr(`xref\n0 ${size}\n`);
  pushStr("0000000000 65535 f \n");
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n);
    pushStr(`${(off ?? 0).toString().padStart(10, "0")} 00000 ${off !== undefined ? "n" : "f"} \n`);
  }
  const id = toHex(crypto.getRandomValues(new Uint8Array(16)));
  pushStr("trailer\n<< ");
  pushStr(`/Size ${size} /Root ${struct.rootRef}`);
  if (struct.infoRef) pushStr(` /Info ${struct.infoRef}`);
  pushStr(` /Encrypt ${encNum} 0 R /ID [<${id}><${id}>] >>\n`);
  pushStr(`startxref\n${xrefOffset}\n%%EOF\n`);

  let total = 0; for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let off = 0; for (const part of parts) { out.set(part, off); off += part.length; }
  return out;
}
