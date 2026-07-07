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
interface MindApi { setSelected: (id: string | null) => void; updateTree: (data: MNode) => void; }
interface Inst { el: HTMLElement; json: string; dotNet: any; api: MindApi; }
const instances = new Map<string, Inst>();

/** Baut/aktualisiert das Live-Widget im Host-Element. Bei geändertem Baum wird das
 *  bestehende Widget INKREMENTELL aktualisiert — Zoom/Pan und der Auf-/Zuklapp-
 *  Zustand bleiben erhalten — statt es komplett neu aufzubauen. */
export function mount(elementId: string, blockId: string, treeJson: string, selectedId: string | null, dotNet: any): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const data = parseTree(treeJson);
  if (!data) return;
  const existing = instances.get(elementId);
  if (existing && existing.el === el) {
    existing.dotNet = dotNet;
    if (existing.json !== treeJson) { existing.json = treeJson; existing.api.updateTree(data); }
    existing.api.setSelected(selectedId);
    return;
  }
  el.innerHTML = "";
  const api = buildInteractive(el, data, blockId, selectedId, () => instances.get(elementId)?.dotNet);
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
): MindApi {
  const height = container.clientHeight || 360;
  const dur = 400;
  const collapsedIds = new Set<string>();   // Klapp-Zustand, überlebt Baum-Updates
  let editingId: string | null = null;      // Knoten im Inline-Umbenennen

  const zoomB = d3zoom<any, any>().scaleExtent([0.2, 2.5]).on("zoom", (e: any) => g.attr("transform", e.transform));
  const svg = select(container).append("svg")
    .attr("width", "100%").attr("height", "100%")
    .style("display", "block").style("background", BG)
    .call(zoomB as any).on("dblclick.zoom", null);
  const g = svg.append("g");
  svg.call((zoomB as any).transform, zoomIdentity.translate(60, height / 2).scale(0.85));

  const layout = d3tree<MNode>().nodeSize([NODE_H + 10, 240]);
  let currentSel = selectedId;

  // Neuaufbau der d3-Hierarchie mit Wiederherstellung des Klapp-Zustands
  // (bottom-up, damit auch verschachtelte Klappungen erhalten bleiben).
  function applyCollapse(node: any): void {
    if (!node.children) return;
    node.children.forEach(applyCollapse);
    if (collapsedIds.has(node.data.id)) { node._children = node.children; node.children = null; }
  }
  function buildRoot(d: MNode): any {
    const r: any = hierarchy<MNode>(d, (n) => n.children);
    applyCollapse(r);
    r.x0 = height / 2; r.y0 = 0;
    return r;
  }
  let root: any = buildRoot(data);

  function toggle(d: any) {
    if (d.children) { d._children = d.children; d.children = null; collapsedIds.add(d.data.id); }
    else if (d._children) { d.children = d._children; d._children = null; collapsedIds.delete(d.data.id); }
  }
  function diagonal(s: any, t: any): string {
    const x1 = s.y + (s.w || 0), y1 = s.x, x2 = t.y, y2 = t.x, mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  function applySelected() {
    g.selectAll<any, any>("g.mnode").each(function (d: any) {
      const on = d.data.id === currentSel;
      const gg = select(this);
      gg.select("rect.mrect")
        .attr("stroke", on ? "#111827" : "#fff")
        .attr("stroke-width", on ? 3 : 1.5);
      gg.select("g.mact-add").style("display", on && !editingId ? "inline" : "none");
      gg.select("g.mact-del").style("display", on && !editingId && d.depth > 0 ? "inline" : "none");
    });
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
      .on("click", (e: any, d: any) => { e.stopPropagation(); if (editingId) return; getDotNet()?.invokeMethodAsync("OnMindNodeClicked", blockId, d.data.id).catch(() => { /* Komponente disposed */ }); })
      .on("dblclick", (e: any, d: any) => { e.stopPropagation(); startEdit(d); });

    enter.append("rect").attr("class", "mrect")
      .attr("y", -NODE_H / 2).attr("height", NODE_H).attr("rx", NODE_H / 2)
      .attr("x", 0).attr("width", (d: any) => d.w)
      .attr("stroke", "#fff").attr("stroke-width", 1.5);
    enter.append("text").attr("class", "mtext")
      .attr("dy", "0.32em").attr("text-anchor", "middle")
      .style("font-family", "system-ui,Segoe UI,Arial,sans-serif").style("font-size", FONT + "px")
      .style("font-weight", "600").style("fill", "#fff").style("pointer-events", "none")
      .text((d: any) => d.data.label);

    // Klapp-Badge (nur wenn Kinder vorhanden) — Klick klappt auf/zu.
    const toggleG = enter.append("g").attr("class", "mtoggle").style("cursor", "pointer")
      .on("click", (e: any, d: any) => { e.stopPropagation(); toggle(d); update(d); });
    toggleG.append("circle").attr("r", 8).attr("fill", "#fff").attr("stroke", "#9aa6a0").attr("stroke-width", 1.5);
    toggleG.append("text").attr("class", "mtogtxt").attr("text-anchor", "middle").attr("dy", "0.34em")
      .style("font-size", "15px").style("font-weight", "700").style("fill", "#4A7C59").style("pointer-events", "none");

    // Aktions-Buttons, nur am gewählten Knoten sichtbar (siehe applySelected).
    const addG = enter.append("g").attr("class", "mact-add").style("display", "none").style("cursor", "pointer")
      .on("click", (e: any, d: any) => { e.stopPropagation(); getDotNet()?.invokeMethodAsync("OnMindNodeAddChild", blockId, d.data.id).catch(() => { /* Komponente disposed */ }); });
    addG.append("title").text("+");
    addG.append("circle").attr("r", 9).attr("fill", "#4A7C59");
    addG.append("text").text("+").attr("text-anchor", "middle").attr("dy", "0.33em")
      .style("font-size", "17px").style("font-weight", "700").style("fill", "#fff").style("pointer-events", "none");
    const delG = enter.append("g").attr("class", "mact-del").style("display", "none").style("cursor", "pointer")
      .on("click", (e: any, d: any) => { e.stopPropagation(); getDotNet()?.invokeMethodAsync("OnMindNodeDeleteNode", blockId, d.data.id).catch(() => { /* Komponente disposed */ }); });
    delG.append("title").text("×");
    delG.append("circle").attr("r", 9).attr("fill", "#C1553A");
    delG.append("text").text("×").attr("text-anchor", "middle").attr("dy", "0.33em")
      .style("font-size", "17px").style("font-weight", "700").style("fill", "#fff").style("pointer-events", "none");

    const merged = enter.merge(node);
    merged.transition().duration(dur).attr("transform", (d: any) => `translate(${d.y},${d.x})`);
    merged.select("rect.mrect").attr("width", (d: any) => d.w)
      .attr("fill", (d: any) => d._children ? COLLAPSED_FILL : PALETTE[Math.min(d.depth, PALETTE.length - 1)]);
    merged.select("text.mtext").attr("x", (d: any) => d.w / 2).text((d: any) => d.data.label);
    merged.select("g.mtoggle")
      .attr("transform", (d: any) => `translate(${d.w + 13},0)`)
      .style("display", (d: any) => (d.children || d._children) ? null : "none");
    merged.select("g.mtoggle text.mtogtxt").text((d: any) => d._children ? "+" : "–");
    merged.select("g.mact-add").attr("transform", (d: any) => `translate(${d.w / 2 - 15},${-NODE_H / 2 - 15})`);
    merged.select("g.mact-del").attr("transform", (d: any) => `translate(${d.w / 2 + 15},${-NODE_H / 2 - 15})`);

    // Beim Zuklappen/Löschen entfallende Knoten SOFORT entfernen (kein transition-
    // gebundenes .remove(): häufige Re-Renders können die Transition unterbrechen,
    // dann feuert das .remove() nie und der Knoten „klebt" sichtbar fest).
    node.exit().interrupt().remove();

    const link = g.selectAll<any, any>("path.mlink").data(links, (d: any) => d.target.data.id);
    link.enter().insert("path", "g.mnode").attr("class", "mlink")
      .attr("fill", "none").attr("stroke", "#9aa6a0").attr("stroke-width", 2)
      .attr("d", () => diagonal({ x: source.x0, y: source.y0, w: 0 }, { x: source.x0, y: source.y0 }))
      .merge(link).transition().duration(dur).attr("d", (d: any) => diagonal(d.source, d.target));
    link.exit().interrupt().remove();

    nodes.forEach((d) => { d.x0 = d.x; d.y0 = d.y; });
    applySelected();
  }

  // Inline-Umbenennen: foreignObject-Eingabefeld direkt über dem Knoten.
  function startEdit(d: any): void {
    editingId = d.data.id;
    currentSel = d.data.id;
    const gEl = g.selectAll<any, any>("g.mnode").filter((n: any) => n.data.id === d.data.id);
    gEl.selectAll("foreignObject.medit").remove();
    const w = Math.max(120, d.w || 120);
    const fo: any = gEl.append("foreignObject").attr("class", "medit")
      .attr("x", 0).attr("y", -NODE_H / 2).attr("width", w).attr("height", NODE_H);
    const input: any = fo.append("xhtml:input");
    input.attr("type", "text").property("value", d.data.label ?? "")
      .style("width", (w - 6) + "px").style("height", (NODE_H - 6) + "px").style("box-sizing", "border-box")
      .style("margin", "3px").style("border", "2px solid #111827").style("border-radius", NODE_H / 2 + "px")
      .style("padding", "0 12px").style("font-family", "system-ui,Segoe UI,Arial,sans-serif")
      .style("font-size", FONT + "px").style("font-weight", "600").style("text-align", "center").style("outline", "none");
    const el: HTMLInputElement = input.node();
    let done = false;
    const commit = (save: boolean) => {
      if (done) return;
      done = true;
      const val = el.value;
      editingId = null;
      fo.remove();
      if (save && val !== d.data.label) getDotNet()?.invokeMethodAsync("OnMindNodeRenamed", blockId, d.data.id, val).catch(() => { /* Komponente disposed */ });
      else applySelected();
    };
    el.addEventListener("keydown", (ev: KeyboardEvent) => {
      ev.stopPropagation();  // globale Editor-Shortcuts (Strg+Z/S/Entf) nicht auslösen
      if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
    });
    el.addEventListener("blur", () => commit(true));
    applySelected();       // Aktions-Buttons während der Eingabe ausblenden
    setTimeout(() => { el.focus(); el.select(); }, 0);
  }

  update(root);
  return {
    setSelected: (id: string | null) => { currentSel = id; applySelected(); },
    updateTree: (d: MNode) => {
      const prev = root;
      root = buildRoot(d);
      root.x0 = prev.x0; root.y0 = prev.y0;
      update(root);
    },
  };
}
