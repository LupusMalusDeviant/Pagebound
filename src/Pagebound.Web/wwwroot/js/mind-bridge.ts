// =============================================================================
// Pagebound — Mindmap-Bridge (D3)
// ----------------------------------------------------------------------------
// Global `pageboundMind`, genutzt vom Mindmap-Block des WYSIWYG-Editors.
//   • renderMindmapSvg / renderMindmapDataUrl — statischer, vektor-scharfer
//     Tidy-Tree (d3-hierarchy) für Dokument + Druck/PDF.
//   • mount / unmount / setSelected — interaktives D3-Widget im Editor
//     (Zoom/Pan, Doppelklick zum Auf-/Zuklappen, Klick = Knoten auswählen).
// Der editierbare Baum bleibt im C#-Modell; D3 zeichnet nur dessen aktuellen
// Stand. 100 % lokal, kein Netz.
// =============================================================================

import { hierarchy, tree as d3tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition"; // erweitert Selection um .transition()

interface MNode { id: string; label: string; children: MNode[]; }

const PALETTE = ["#3f6651", "#4A7C59", "#C16641", "#5b7c99", "#8a6d3b", "#7c5b8a"];
const COLLAPSED_FILL = "#b45309";
const NODE_H = 30, PAD_X = 14, ROW_GAP = 12, COL_GAP = 54, FONT = 13, BG = "#F9F8F6";

function nodeWidth(label: string): number {
  return Math.max(54, Math.min(240, (label || " ").length * 7.1 + PAD_X * 2));
}
function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function parseTree(json: string): MNode | null {
  try {
    const t = JSON.parse(json);
    if (!t || typeof t !== "object") return null;
    if (!Array.isArray(t.children)) t.children = [];
    return t;
  } catch { return null; }
}

// =============================================================================
// Statischer Render (Dokument / Druck) — vollständig aufgeklappter Tidy-Tree.
// =============================================================================
export function renderMindmapSvg(treeJson: string): string {
  const root = parseTree(treeJson);
  if (!root) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;
  const h: any = hierarchy<MNode>(root, (d) => d.children);
  d3tree<MNode>().nodeSize([NODE_H + ROW_GAP, 1])(h); // h.x = vertikale Tidy-Position

  const depthMaxW: number[] = [];
  h.each((d: any) => { depthMaxW[d.depth] = Math.max(depthMaxW[d.depth] || 0, nodeWidth(d.data.label)); });
  const colX: number[] = []; let acc = 12;
  for (let i = 0; i < depthMaxW.length; i++) { colX[i] = acc; acc += depthMaxW[i] + COL_GAP; }

  let minX = Infinity, maxX = -Infinity, maxRight = 0;
  h.each((d: any) => {
    d.yPos = colX[d.depth]; d.w = nodeWidth(d.data.label);
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); maxRight = Math.max(maxRight, d.yPos + d.w);
  });
  const offY = -minX + NODE_H / 2 + 8;
  const W = Math.ceil(maxRight + 12), H = Math.ceil((maxX - minX) + NODE_H + 16);

  let links = "", nodes = "";
  h.each((d: any) => {
    const cy = d.x + offY;
    if (d.parent) {
      const p = d.parent;
      const x1 = p.yPos + p.w, y1 = p.x + offY, x2 = d.yPos, y2 = cy, mx = (x1 + x2) / 2;
      links += `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#9aa6a0" stroke-width="2"/>`;
    }
    const fill = PALETTE[Math.min(d.depth, PALETTE.length - 1)];
    nodes += `<g><rect x="${d.yPos}" y="${cy - NODE_H / 2}" width="${d.w}" height="${NODE_H}" rx="${NODE_H / 2}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`
      + `<text x="${d.yPos + d.w / 2}" y="${cy}" dominant-baseline="central" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="${FONT}" font-weight="600" fill="#fff">${esc(d.data.label)}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="${BG}"/>${links}${nodes}</svg>`;
}

export function renderMindmapDataUrl(treeJson: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(renderMindmapSvg(treeJson));
}

// =============================================================================
// Interaktives Widget (Editor) — eine Instanz je Host-Element-Id.
// =============================================================================
interface Inst { el: HTMLElement; json: string; dotNet: any; api: { setSelected: (id: string | null) => void }; }
const instances = new Map<string, Inst>();

/** Baut/aktualisiert das Live-Widget im Host-Element. Idempotent: gleicher Baum → nur Auswahl/Ref aktualisieren. */
export function mount(elementId: string, blockId: string, treeJson: string, selectedId: string | null, dotNet: any): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const existing = instances.get(elementId);
  if (existing && existing.json === treeJson) {
    existing.dotNet = dotNet;
    existing.api.setSelected(selectedId);
    return;
  }
  el.innerHTML = "";
  const root = parseTree(treeJson);
  if (!root) return;
  const api = buildInteractive(el, root, blockId, selectedId, () => instances.get(elementId)?.dotNet);
  instances.set(elementId, { el, json: treeJson, dotNet, api });
  api.setSelected(selectedId);
}

export function setSelected(elementId: string, nodeId: string | null): void {
  instances.get(elementId)?.api.setSelected(nodeId);
}

export function unmount(elementId: string): void {
  const inst = instances.get(elementId);
  if (inst) { inst.el.innerHTML = ""; instances.delete(elementId); }
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Montiert alle `.pb-mind-host[data-mind-tree]` als interaktive Viewer (Zoom/Pan,
 *  Doppelklick = auf-/zuklappen; keine Auswahl/.NET). Für exportierte HTML-Decks. */
export function mountAllViewers(): void {
  document.querySelectorAll<HTMLElement>(".pb-mind-host[data-mind-tree]").forEach((el, i) => {
    if (!el.id) el.id = "pbmind-export-" + i;
    let json = "";
    try { json = b64ToUtf8(el.getAttribute("data-mind-tree") || ""); } catch { json = ""; }
    if (json) mount(el.id, "", json, null, null);
  });
}

function buildInteractive(
  container: HTMLElement, data: MNode, blockId: string,
  selectedId: string | null, getDotNet: () => any,
) {
  const height = container.clientHeight || 360;
  const dur = 400;

  const zoomB = d3zoom<any, any>().scaleExtent([0.2, 2.5]).on("zoom", (e: any) => g.attr("transform", e.transform));
  const svg = select(container).append("svg")
    .attr("width", "100%").attr("height", "100%")
    .style("display", "block").style("background", BG)
    .call(zoomB as any).on("dblclick.zoom", null);
  const g = svg.append("g");
  svg.call((zoomB as any).transform, zoomIdentity.translate(60, height / 2).scale(0.85));

  const root: any = hierarchy<MNode>(data, (d) => d.children);
  root.x0 = height / 2; root.y0 = 0;
  const layout = d3tree<MNode>().nodeSize([NODE_H + 10, 240]);
  let currentSel = selectedId;

  function toggle(d: any) {
    if (d.children) { d._children = d.children; d.children = null; }
    else { d.children = d._children; d._children = null; }
  }
  function diagonal(s: any, t: any): string {
    const x1 = s.y + (s.w || 0), y1 = s.x, x2 = t.y, y2 = t.x, mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  function applySelected() {
    g.selectAll<any, any>("g.mnode rect.mrect")
      .attr("stroke", (d: any) => d.data.id === currentSel ? "#111827" : "#fff")
      .attr("stroke-width", (d: any) => d.data.id === currentSel ? 3 : 1.5);
  }

  function update(source: any) {
    layout(root);
    const nodes: any[] = root.descendants();
    const links: any[] = root.links();

    // Spalten-x je Tiefe aus der größten sichtbaren Knotenbreite.
    const depthMaxW: number[] = [];
    nodes.forEach((d) => { depthMaxW[d.depth] = Math.max(depthMaxW[d.depth] || 0, nodeWidth(d.data.label)); });
    const colX: number[] = []; let acc = 0;
    for (let i = 0; i < depthMaxW.length; i++) { colX[i] = acc; acc += depthMaxW[i] + COL_GAP; }
    nodes.forEach((d) => { d.y = colX[d.depth]; d.w = nodeWidth(d.data.label); });

    const node = g.selectAll<any, any>("g.mnode").data(nodes, (d: any) => d.data.id);
    const enter = node.enter().append("g").attr("class", "mnode")
      .attr("transform", `translate(${source.y0},${source.x0})`)
      .style("cursor", "pointer")
      .on("click", (e: any, d: any) => { e.stopPropagation(); getDotNet()?.invokeMethodAsync("OnMindNodeClicked", blockId, d.data.id); })
      .on("dblclick", (e: any, d: any) => { e.stopPropagation(); toggle(d); update(d); });

    enter.append("rect").attr("class", "mrect")
      .attr("y", -NODE_H / 2).attr("height", NODE_H).attr("rx", NODE_H / 2)
      .attr("x", 0).attr("width", (d: any) => d.w)
      .attr("stroke", "#fff").attr("stroke-width", 1.5);
    enter.append("text").attr("class", "mtext")
      .attr("dy", "0.32em").attr("text-anchor", "middle")
      .style("font-family", "system-ui,Segoe UI,Arial,sans-serif").style("font-size", FONT + "px")
      .style("font-weight", "600").style("fill", "#fff").style("pointer-events", "none")
      .text((d: any) => d.data.label);

    const merged = enter.merge(node);
    merged.transition().duration(dur).attr("transform", (d: any) => `translate(${d.y},${d.x})`);
    merged.select("rect.mrect").attr("width", (d: any) => d.w)
      .attr("fill", (d: any) => d._children ? COLLAPSED_FILL : PALETTE[Math.min(d.depth, PALETTE.length - 1)]);
    merged.select("text.mtext").attr("x", (d: any) => d.w / 2).text((d: any) => d.data.label);

    node.exit().transition().duration(dur).attr("transform", `translate(${source.y},${source.x})`).remove();

    const link = g.selectAll<any, any>("path.mlink").data(links, (d: any) => d.target.data.id);
    link.enter().insert("path", "g.mnode").attr("class", "mlink")
      .attr("fill", "none").attr("stroke", "#9aa6a0").attr("stroke-width", 2)
      .attr("d", () => diagonal({ x: source.x0, y: source.y0, w: 0 }, { x: source.x0, y: source.y0 }))
      .merge(link).transition().duration(dur).attr("d", (d: any) => diagonal(d.source, d.target));
    link.exit().transition().duration(dur)
      .attr("d", () => diagonal({ x: source.x, y: source.y, w: 0 }, { x: source.x, y: source.y })).remove();

    nodes.forEach((d) => { d.x0 = d.x; d.y0 = d.y; });
    applySelected();
  }

  update(root);
  return { setSelected: (id: string | null) => { currentSel = id; applySelected(); } };
}
