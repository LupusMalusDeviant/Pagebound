// =============================================================================
// pagebound-pdf-mcp-server — Mindmap-Renderer (rein, kein d3/DOM)
// ----------------------------------------------------------------------------
// Zeichnet einen Mindmap-Baum als statisches Vektor-SVG. Spiegelt den
// Fallback-Renderer der PWA (buildMindmapSvg). Damit kann der MCP Mindmap-Bloecke
// in design_render_html / _interactive_html als scharfe SVG ausgeben.
// (Die PWA nutzt zusaetzlich d3-hierarchy fuer ein huebscheres Tidy-Layout und
//  ein interaktives Widget — serverseitig reicht dieses schlanke Layout.)
// =============================================================================

export interface MindmapNode {
  id?: string;
  label: string;
  children: MindmapNode[];
}

const PALETTE = ["#3f6651", "#4A7C59", "#C16641", "#5b7c99", "#8a6d3b", "#7c5b8a"];
const NODE_H = 30, PAD_X = 14, ROW_GAP = 12, COL_GAP = 54, FONT = 13, BG = "#F9F8F6";

function nodeWidth(label: string): number {
  return Math.max(54, Math.min(240, (label || " ").length * 7.1 + PAD_X * 2));
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Zeichnet einen Mindmap-Baum als horizontalen Baum (Wurzel links) → SVG-String + Maße. */
export function renderMindmapSvg(root: MindmapNode): { svg: string; w: number; h: number } {
  const depthMaxW: number[] = [];
  const measure = (n: MindmapNode, d: number): void => {
    depthMaxW[d] = Math.max(depthMaxW[d] ?? 0, nodeWidth(n.label));
    (n.children ?? []).forEach((c) => measure(c, d + 1));
  };
  measure(root, 0);

  const colX: number[] = []; let acc = 12;
  for (let d = 0; d < depthMaxW.length; d++) { colX[d] = acc; acc += depthMaxW[d] + COL_GAP; }

  const pos = new Map<MindmapNode, { x: number; y: number; w: number; d: number }>();
  let leaf = 0;
  const assign = (n: MindmapNode, d: number): number => {
    const w = nodeWidth(n.label);
    const kids = n.children ?? [];
    let y: number;
    if (kids.length === 0) { y = leaf * ROW_GAP + ROW_GAP / 2 + leaf * NODE_H; leaf++; }
    else { const ys = kids.map((c) => assign(c, d + 1)); y = (ys[0] + ys[ys.length - 1]) / 2; }
    pos.set(n, { x: colX[d], y, w, d });
    return y;
  };
  assign(root, 0);

  let maxX = 0, maxY = 0;
  pos.forEach((p) => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + NODE_H); });
  const W = Math.ceil(maxX + 12), H = Math.ceil(maxY + 8);

  let links = "", nodes = "";
  const walk = (n: MindmapNode): void => {
    const p = pos.get(n)!;
    for (const c of n.children ?? []) {
      const cp = pos.get(c)!;
      const x1 = p.x + p.w, y1 = p.y, x2 = cp.x, y2 = cp.y, mx = (x1 + x2) / 2;
      links += `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#9aa6a0" stroke-width="2"/>`;
      walk(c);
    }
    const fill = PALETTE[Math.min(p.d, PALETTE.length - 1)];
    nodes += `<g><rect x="${p.x}" y="${p.y - NODE_H / 2}" width="${p.w}" height="${NODE_H}" rx="${NODE_H / 2}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`
      + `<text x="${p.x + p.w / 2}" y="${p.y}" dominant-baseline="central" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="${FONT}" font-weight="600" fill="#fff">${esc(n.label)}</text></g>`;
  };
  walk(root);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="100%" height="100%" fill="${BG}"/>${links}${nodes}</svg>`;
  return { svg, w: W, h: H };
}

/** Begrenzt einen importierten/erzeugten Mindmap-Baum: Labels als Klartext,
 *  Tiefe ≤ 8, ≤ 100 Kinder je Knoten, gültige Ids. Spiegel von C# SanitizeMindNode. */
export function sanitizeMindNode(n: unknown, depth: number): MindmapNode {
  const obj = (n && typeof n === "object" ? n : {}) as Partial<MindmapNode>;
  let label = String(obj.label ?? "").replace(/[<>]/g, " ").trim();
  if (label.length > 200) label = label.slice(0, 200);
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id : undefined;
  let children: MindmapNode[] = [];
  if (depth < 8 && Array.isArray(obj.children)) {
    children = obj.children.slice(0, 100).map((c) => sanitizeMindNode(c, depth + 1));
  }
  return { ...(id ? { id } : {}), label, children };
}
