"use strict";
// Конструктор задачи: собирает JSON-модель (тот же формат, что у решателя sopromat) и отправляет боту.

const tg = window.Telegram && window.Telegram.WebApp;
const LETTERS = "ABCDEFGHKLNSTUVW";
const STORE_KEY = "sopromat-model-v2";

const DEFAULTS = {
  beam: { material: { sigma: "160" } },
  axial: { material: { sigma: "160", E: "2e5" } },
  torsion: { material: { tau: "80", G: "8e4" } },
  frame: { material: {} },
  spatial: { material: {} },
  inverse: { material: {} },
};

let state = blank("beam");

function blank(kind) {
  const s = {
    kind, title: "", units: "kN",
    vars: [{ name: "a", value: "2" }],
    segments: [{ length: "a", k: "1" }],
    supports: [], loads: [],
    material: { ...DEFAULTS[kind].material },
    nodes: [], members: [], sections: [], mseg: [],
  };
  return EXTRA.includes(kind) ? blankExtra(kind, s) : s;
}

// ---------- калькулятор выражений (как в sopromat/expr.py) ----------

function normalize(s) {
  s = String(s).trim().replace(/,/g, ".").replace(/[×·]/g, "*").replace(/\^/g, "**").replace(/[−–]/g, "-");
  s = s.replace(/(^|[^A-Za-z_\d.])(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?![eE][+-]?\d)([A-Za-z_(])/g, "$1$2*$3");
  s = s.replace(/\)\s*([A-Za-z_\d(])/g, ")*$1");
  return s;
}

function parseExpr(text) {
  const src = normalize(text);
  const toks = src.match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_\d]*|\*\*|[-+*/()]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  function expr() {
    let node = term();
    while (peek() === "+" || peek() === "-") { const op = take(); node = { op, a: node, b: term() }; }
    return node;
  }
  function term() {
    let node = unary();
    while (peek() === "*" || peek() === "/") { const op = take(); node = { op, a: node, b: unary() }; }
    return node;
  }
  function unary() {
    if (peek() === "-") { take(); return { op: "neg", a: unary() }; }
    if (peek() === "+") { take(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek() === "**") { take(); return { op: "**", a: base, b: unary() }; }
    return base;
  }
  function primary() {
    const t = take();
    if (t === undefined) throw new Error("незаконченное выражение");
    if (t === "(") { const e = expr(); if (take() !== ")") throw new Error("нет закрывающей скобки"); return e; }
    if (/^\d/.test(t)) return { num: parseFloat(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (t === "sqrt" && peek() === "(") { take(); const e = expr(); take(); return { op: "sqrt", a: e }; }
      if (t === "pi") return { num: Math.PI };
      return { name: t };
    }
    throw new Error("непонятный символ «" + t + "»");
  }
  if (!toks.length) throw new Error("пустое значение");
  const tree = expr();
  if (i < toks.length) throw new Error("лишнее «" + toks[i] + "»");
  return tree;
}

function names(tree, out = new Set()) {
  if (!tree) return out;
  if (tree.name) out.add(tree.name);
  names(tree.a, out); names(tree.b, out);
  return out;
}

function evalTree(t, env) {
  if (t.num !== undefined) return t.num;
  if (t.name) {
    if (!(t.name in env)) throw new Error("не задана величина «" + t.name + "»");
    return env[t.name];
  }
  const a = evalTree(t.a, env);
  switch (t.op) {
    case "neg": return -a;
    case "sqrt": return Math.sqrt(a);
  }
  const b = evalTree(t.b, env);
  switch (t.op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": if (b === 0) throw new Error("деление на ноль"); return a / b;
    case "**": return Math.pow(a, b);
  }
  throw new Error("ошибка выражения");
}

function resolveVars(list) {
  const raw = {};
  list.forEach(v => { if (v.name.trim() && String(v.value).trim()) raw[v.name.trim()] = v.value; });
  const out = {}, visiting = new Set();
  function get(n) {
    if (n in out) return out[n];
    if (!(n in raw)) throw new Error("не задана величина «" + n + "»");
    if (visiting.has(n)) throw new Error("«" + n + "» ссылается сама на себя");
    visiting.add(n);
    const tree = parseExpr(raw[n]);
    const env = {};
    names(tree).forEach(k => { env[k] = get(k); });
    out[n] = evalTree(tree, env);
    visiting.delete(n);
    return out[n];
  }
  Object.keys(raw).forEach(get);
  return out;
}

function ev(text, env) {
  return evalTree(parseExpr(text), env);
}

// ---------- ввод ----------

const $ = id => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v);
  }
  children.flat().forEach(c => e.append(c instanceof Node ? c : document.createTextNode(c)));
  return e;
}

function input(value, placeholder, onInput) {
  return el("input", { value: value ?? "", placeholder: placeholder || "", oninput: e => { onInput(e.target.value); changed(); } });
}

function select(options, value, onChange) {
  const s = el("select", { onchange: e => { onChange(e.target.value); changed(true); } },
    options.map(([v, t]) => el("option", { value: v }, t)));
  s.value = value;
  return s;
}

function delBtn(fn) {
  return el("button", { class: "del", title: "Удалить", onclick: () => { fn(); changed(true); } }, "×");
}

function nodeOptions() {
  const out = [];
  for (let i = 0; i <= state.segments.length; i++) out.push([String(i), LETTERS[i] || "N" + i]);
  return out;
}

const LOAD_TYPES = {
  beam: [["force", "Сила"], ["moment", "Момент"], ["dist", "Распределённая q"]],
  axial: [["force", "Сила"], ["dist", "Распределённая"]],
  torsion: [["moment", "Момент"], ["dist", "Распределённый m"]],
};

function dirOptions(kind, type) {
  if (kind === "beam") {
    if (type === "moment") return [["cw", "↻ по часовой"], ["ccw", "↺ против часовой"]];
    return [["down", "↓ вниз"], ["up", "↑ вверх"]];
  }
  if (kind === "axial") return [["right", "→ вправо"], ["left", "← влево"]];
  return [["pos", "⟲ верх → (+)"], ["neg", "⟳ верх ← (−)"]];
}

const SUPPORT_TYPES = {
  beam: [["fixed", "Жёсткая заделка"], ["pin", "Шарнирно-неподвижная опора"], ["roller", "Шарнирно-подвижная опора"],
    ["slider", "Скользящая заделка (ползун)"], ["hinge", "Промежуточный шарнир"]],
  axial: [["fixed", "Жёсткая заделка"], ["pin", "Шарнирно-неподвижная опора"]],
  torsion: [["fixed", "Жёсткая заделка"], ["bearing", "Подшипник (вращению не мешает)"]],
};

const MATERIAL_FIELDS = {
  beam: [["sigma", "[σ], МПа"]],
  axial: [["sigma", "[σ], МПа"], ["E", "E, МПа"], ["A", "A, см² (если задана)"]],
  torsion: [["tau", "[τ], МПа"], ["G", "G, МПа"], ["theta", "[θ], град/м"], ["d", "d, мм (если задан)"]],
};

function render() {
  $("kindSel").value = state.kind;
  document.querySelectorAll("#units button").forEach(b => b.classList.toggle("on", b.dataset.v === state.units));
  $("title").value = state.title;

  const vars = $("vars"); vars.innerHTML = "";
  state.vars.forEach((v, i) => vars.append(el("div", { class: "item var-row" },
    input(v.name, "имя (P1, q, a)", x => { v.name = x.trim(); }),
    input(v.value, "значение", x => { v.value = x; }),
    delBtn(() => state.vars.splice(i, 1)))));

  showCards();
  if (EXTRA.includes(state.kind)) { renderExtra(); draw(); return; }

  const segs = $("segments"); segs.innerHTML = "";
  const kname = state.kind === "axial" ? "A ×" : "d ×";
  state.segments.forEach((s, i) => segs.append(el("div", { class: "item seg-row" + (state.kind === "beam" ? " beam" : "") },
    el("span", { class: "tag" }, roman(i)),
    input(s.length, "длина: a, 2a, 1.5", x => { s.length = x; }),
    state.kind === "beam" ? "" : input(s.k, kname + " (1, 2)", x => { s.k = x; }),
    delBtn(() => removeSegment(i)))));

  const sups = $("supports"); sups.innerHTML = "";
  state.supports.forEach((s, i) => {
    // заделки и опоры стержня — только на концах; шарнир — только внутри; подшипник и опоры балки — где угодно
    const n = state.segments.length;
    const ends = [["0", LETTERS[0]], [String(n), LETTERS[n]]];
    let opts = nodeOptions();
    if (["fixed", "slider"].includes(s.type) || (state.kind === "axial")) opts = ends;
    if (s.type === "hinge") opts = nodeOptions().slice(1, -1);
    if (!opts.some(o => o[0] === String(s.node)) && opts.length) s.node = +opts[0][0];
    sups.append(el("div", { class: "item sup-row" },
      select(SUPPORT_TYPES[state.kind], s.type, x => { s.type = x; }),
      select(opts.length ? opts : nodeOptions(), String(s.node), x => { s.node = +x; }),
      delBtn(() => state.supports.splice(i, 1))));
  });

  const loads = $("loads"); loads.innerHTML = "";
  state.loads.forEach((l, i) => {
    const pos = l.type === "dist"
      ? el("div", { class: "wide three" },
        select(nodeOptions(), String(l.from), x => { l.from = +x; }),
        select(nodeOptions(), String(l.to), x => { l.to = +x; }),
        select(dirOptions(state.kind, l.type), l.dir, x => { l.dir = x; }))
      : el("div", { class: "wide" },
        select(nodeOptions(), String(l.node), x => { l.node = +x; }),
        select(dirOptions(state.kind, l.type), l.dir, x => { l.dir = x; }));
    const vals = l.type === "dist"
      ? el("div", { class: "wide" },
        input(l.value, "в начале: q", x => { l.value = x; }),
        input(l.value2, "в конце (= начало)", x => { l.value2 = x; }))
      : el("div", { class: "wide" },
        input(l.value, "значение: P1, M1, ?", x => { l.value = x; }),
        l.value === "?" ? input(l.label || "", "обозначение (M)", x => { l.label = x; }) : el("span"));
    loads.append(el("div", { class: "item load-row" },
      select(LOAD_TYPES[state.kind], l.type, x => { l.type = x; l.dir = dirOptions(state.kind, x)[0][0]; fixLoad(l); }),
      delBtn(() => state.loads.splice(i, 1)), pos, vals));
  });

  const mat = $("material"); mat.innerHTML = "";
  MATERIAL_FIELDS[state.kind].forEach(([k, t]) => mat.append(el("label", { class: "field" }, el("span", {}, t),
    input(state.material[k] || "", "", x => { state.material[k] = x; }))));
  draw();
}

function roman(i) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][i] || String(i + 1);
}

function fixLoad(l, n = state.segments.length) {
  if (l.type === "dist") {
    if (l.from === undefined || l.from < 0) l.from = 0;
    if (l.to === undefined || l.to < 0 || l.to > n) l.to = Math.min(n, (l.from || 0) + 1);
    if (l.value2 === undefined) l.value2 = "";
  } else if (l.node === undefined || l.node < 0 || l.node > n) l.node = 0;
}

function removeSegment(i) {
  state.segments.splice(i, 1);
  const n = state.segments.length;
  const fix = v => (v > i ? v - 1 : v);
  state.supports.forEach(s => { s.node = Math.min(fix(s.node), n); });
  state.loads.forEach(l => {
    if (l.type === "dist") { l.from = Math.min(fix(l.from), n); l.to = Math.min(fix(l.to), n); }
    else l.node = Math.min(fix(l.node), n);
  });
}

let saveTimer = null;
function changed(structural) {
  if (structural) render(); else draw();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* нет хранилища */ } }, 400);
}

// ---------- модель для бота ----------

function toModel() {
  const vars = {};
  state.vars.forEach(v => { if (v.name.trim() && String(v.value).trim()) vars[v.name.trim()] = String(v.value).trim(); });
  const loads = state.loads.map(l => {
    const o = { type: l.type, value: String(l.value || "").trim(), dir: l.dir };
    if (l.type === "dist") { o.from = l.from; o.to = l.to; if (String(l.value2 || "").trim()) o.value2 = String(l.value2).trim(); }
    else o.node = l.node;
    if (o.value === "?" && l.label) o.label = l.label.trim();
    return o;
  });
  if (EXTRA.includes(state.kind)) {
    const base = { kind: state.kind, title: state.title.trim(), units: state.units, vars };
    if (state.from_photo) base.from_photo = true;
    return extraToModel(base);
  }
  const material = {};
  MATERIAL_FIELDS[state.kind].forEach(([k]) => { if (String(state.material[k] || "").trim()) material[k] = String(state.material[k]).trim(); });
  const m = {
    kind: state.kind, title: state.title.trim(), units: state.units, vars,
    segments: state.segments.map(s => ({ length: s.length, k: state.kind === "beam" ? "1" : (s.k || "1") })),
    supports: state.supports.map(s => ({ type: s.type, node: s.node })),
    loads, material,
  };
  if (state.from_photo) m.from_photo = true;
  return m;
}

function fromModel(m) {
  const s = blank(m.kind || "beam");
  s.title = m.title || "";
  s.units = m.units === "t" ? "t" : "kN";
  s.vars = Object.entries(m.vars || {}).map(([name, value]) => ({ name, value: String(value) }));
  s.from_photo = !!m.from_photo;
  if (EXTRA.includes(m.kind)) return extraFromModel(m, s);
  s.segments = (m.segments || []).map(x => ({ length: String(x.length), k: String(x.k || "1") }));
  if (!s.segments.length) s.segments = [{ length: "a", k: "1" }];
  s.supports = (m.supports || []).map(x => ({ type: x.type, node: +x.node }));
  s.loads = (m.loads || []).map(x => ({ type: x.type, node: x.node ?? -1, from: x.from ?? -1, to: x.to ?? -1,
    value: String(x.value ?? ""), value2: String(x.value2 ?? ""), dir: x.dir, label: x.label || "" }));
  s.loads.forEach(l => fixLoad(l, s.segments.length));
  s.material = { ...(m.material || {}) };
  s.from_photo = !!m.from_photo;
  return s;
}

// ---------- проверка и предпросмотр ----------

function analyze() {
  const errors = [];
  let env = {};
  try { env = resolveVars(state.vars); } catch (e) { errors.push(e.message); }
  const factor = state.units === "t" ? 10 : 1;
  const xs = [0];
  state.segments.forEach((s, i) => {
    let L = 1;
    try { L = ev(s.length, env); if (!(L > 0)) throw new Error("длина должна быть > 0"); }
    catch (e) { errors.push("участок " + roman(i) + ": " + e.message); L = 1; }
    xs.push(xs[xs.length - 1] + L);
  });
  const loads = state.loads.map((l, i) => {
    const r = { ...l, v: 1, v2: 1 };
    try {
      if (l.value === "?") r.v = null; else r.v = ev(l.value, env) * factor;
      if (l.type === "dist") r.v2 = String(l.value2 || "").trim() ? ev(l.value2, env) * factor : r.v;
    } catch (e) { errors.push("нагрузка " + (i + 1) + ": " + e.message); }
    return r;
  });
  if (state.kind === "beam" && !state.supports.some(s => s.type !== "hinge")) errors.push("добавьте опоры");
  if (!state.loads.length) errors.push("добавьте нагрузки");
  return { xs, loads, errors };
}

const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(v) {
  if (v === null || v === undefined || !isFinite(v)) return "?";
  return String(Math.round(v * 1000) / 1000).replace(".", ",");
}

function draw() {
  const box = $("preview");
  box.innerHTML = "";
  box.append(svg("defs", {}));
  box.firstChild.innerHTML =
    '<marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0 L8,4 L0,8 z" fill="#c0392b"/></marker>';
  if (EXTRA.includes(state.kind)) { drawExtra(box); return; }
  const { xs, loads, errors } = analyze();
  const L = xs[xs.length - 1] || 1;
  const X = x => 30 + (x / L) * 300;
  const Y = 88;
  const ink = (attrs) => svg("path", { class: "ink", ...attrs });
  const st = $("status");
  st.textContent = errors.length ? "⚠ " + errors[0] : "Схема без ошибок. Длина " + fmt(L) + " м.";
  st.className = "status" + (errors.length ? " err" : "");

  if (state.kind === "beam") {
    box.append(svg("line", { x1: X(0), y1: Y, x2: X(L), y2: Y, stroke: "currentColor", "stroke-width": 4, class: "ink" }));
  } else {
    const kmax = Math.max(...state.segments.map(s => { try { return ev(s.k || "1", {}); } catch (e) { return 1; } }), 1);
    state.segments.forEach((s, i) => {
      let k = 1; try { k = ev(s.k || "1", {}); } catch (e) { /* */ }
      const h = 8 + 8 * (k / kmax);
      box.append(svg("rect", { x: X(xs[i]), y: Y - h, width: X(xs[i + 1]) - X(xs[i]), height: 2 * h, class: "ink", "stroke-width": 1.3 }));
    });
    box.append(svg("line", { x1: 20, y1: Y, x2: 340, y2: Y, class: "dim", "stroke-dasharray": "6 3 2 3" }));
  }
  // опоры
  state.supports.forEach(s => {
    const x = X(xs[s.node] ?? 0);
    if (s.type === "fixed") {
      const side = s.node === 0 ? -1 : 1;
      box.append(ink({ d: `M${x},${Y - 22} L${x},${Y + 22}`, "stroke-width": 2.2 }));
      for (let k = -20; k <= 22; k += 6) box.append(ink({ d: `M${x},${Y + k} l${side * 6},-6`, "stroke-width": 0.8 }));
    } else if (s.type === "pin" || s.type === "roller") {
      box.append(ink({ d: `M${x},${Y + 2} l-8,15 l16,0 z`, "stroke-width": 1.2 }));
      const gy = Y + 17 + (s.type === "roller" ? 4 : 0);
      if (s.type === "roller") box.append(ink({ d: `M${x - 11},${Y + 19} l22,0` }));
      box.append(ink({ d: `M${x - 11},${gy} l22,0` }));
      for (let k = -10; k <= 10; k += 5) box.append(ink({ d: `M${x + k},${gy} l-4,4`, "stroke-width": 0.7 }));
    } else if (s.type === "hinge") {
      box.append(svg("circle", { cx: x, cy: Y, r: 4, fill: "var(--card)", class: "ink", "stroke-width": 1.4 }));
    } else if (s.type === "slider") {
      const side = s.node === 0 ? -1 : 1, wx = x + side * 10;
      box.append(ink({ d: `M${wx},${Y - 18} L${wx},${Y + 18}`, "stroke-width": 2.2 }));
      for (let k = -16; k <= 18; k += 6) box.append(ink({ d: `M${wx},${Y + k} l${side * 6},-6`, "stroke-width": 0.8 }));
      for (const dy of [-7, 7]) box.append(svg("circle", { cx: x + side * 5, cy: Y + dy, r: 3, fill: "var(--card)", class: "ink" }));
    } else if (s.type === "bearing") {
      box.append(svg("rect", { x: x - 6, y: Y + 15, width: 12, height: 5, fill: "none", class: "ink" }));
      box.append(svg("rect", { x: x - 6, y: Y - 20, width: 12, height: 5, fill: "none", class: "ink" }));
      box.append(ink({ d: `M${x - 10},${Y + 20} l20,0` }));
    }
  });
  // нагрузки
  loads.forEach(l => {
    if (l.type === "dist") {
      const a = X(xs[l.from] ?? 0), b = X(xs[l.to] ?? 0);
      const v1 = Math.abs(l.v ?? 1), v2 = Math.abs(l.v2 ?? 1), vm = Math.max(v1, v2) || 1;
      const lab = (l.value2 && l.value2 !== l.value) ? (v2 > v1 ? l.value2 : l.value) : l.value;
      if (state.kind === "beam") {
        const down = l.dir === "down";
        const h1 = 22 * v1 / vm, h2 = 22 * v2 / vm;
        const yb = down ? Y - 3 : Y + 3, s = down ? -1 : 1;
        box.append(svg("path", { class: "ld", d: `M${a},${yb + s * h1} L${b},${yb + s * h2}` }));
        const n = Math.max(3, Math.round((b - a) / 12));
        for (let k = 0; k <= n; k++) {
          const xx = a + (b - a) * k / n, hh = h1 + (h2 - h1) * k / n;
          if (hh > 3) box.append(svg("path", { class: "ld", d: `M${xx},${yb + s * hh} L${xx},${yb}`, "marker-end": "url(#ah)", "stroke-width": 1 }));
        }
        box.append(svg("text", { x: (a + b) / 2, y: down ? Y - 30 : Y + 40, "text-anchor": "middle", class: "ldt" }, lab));
      } else {
        const n = Math.max(2, Math.round((b - a) / 16));
        const sgn = (l.dir === "right" || l.dir === "pos") ? 1 : -1;
        for (let k = 0; k < n; k++) {
          const xx = a + (b - a) * (k + 0.2) / n;
          box.append(svg("path", { class: "ld", d: `M${xx},${Y - 24} l${sgn * 9},0`, "marker-end": "url(#ah)", "stroke-width": 1 }));
        }
        box.append(svg("text", { x: (a + b) / 2, y: Y - 32, "text-anchor": "middle", class: "ldt" }, lab));
      }
    }
  });
  loads.forEach(l => {
    if (l.type === "dist") return;
    const x = X(xs[l.node] ?? 0);
    const lab = l.value === "?" ? (l.label || "X") + " = ?" : l.value;
    if (state.kind === "beam" && l.type === "force") {
      const down = l.dir === "down";
      box.append(svg("path", { class: "ld", d: down ? `M${x},${Y - 45} L${x},${Y - 4}` : `M${x},${Y + 45} L${x},${Y + 4}`, "marker-end": "url(#ah)", "stroke-width": 1.8 }));
      box.append(svg("text", { x: x + 4, y: down ? Y - 40 : Y + 48, class: "ldt" }, lab));
    } else if (state.kind === "beam" && l.type === "moment") {
      const ccw = l.dir === "ccw";
      const r = 13;
      const d = ccw ? `M${x + r},${Y + 6} A${r},${r} 0 1 0 ${x - r},${Y + 6}` : `M${x - r},${Y + 6} A${r},${r} 0 1 1 ${x + r},${Y + 6}`;
      box.append(svg("path", { class: "ld", d, "marker-end": "url(#ah)", "stroke-width": 1.6 }));
      box.append(svg("text", { x, y: Y - 18, "text-anchor": "middle", class: "ldt" }, lab));
    } else if (state.kind === "axial") {
      const sgn = l.dir === "right" ? 1 : -1;
      box.append(svg("path", { class: "ld", d: `M${x},${Y} l${sgn * 26},0`, "marker-end": "url(#ah)", "stroke-width": 2.2 }));
      box.append(svg("text", { x: x + sgn * 13, y: Y - 22, "text-anchor": "middle", class: "ldt" }, lab));
    } else {
      const sgn = l.dir === "pos" ? 1 : -1;
      box.append(svg("path", { class: "ld", d: `M${x},${Y - 26} L${x},${Y + 26}`, "stroke-width": 1.6 }));
      box.append(svg("path", { class: "ld", d: `M${x},${Y - 26} l${sgn * 12},0`, "marker-end": "url(#ah)", "stroke-width": 1.4 }));
      box.append(svg("path", { class: "ld", d: `M${x},${Y + 26} l${-sgn * 12},0`, "marker-end": "url(#ah)", "stroke-width": 1.4 }));
      box.append(svg("text", { x, y: Y - 31, "text-anchor": "middle", class: "ldt" }, lab));
    }
  });
  // буквы узлов и размеры
  xs.forEach((x, i) => box.append(svg("text", { x: X(x), y: Y + (state.kind === "beam" ? 36 : 32), "text-anchor": "middle", "font-weight": "bold" }, LETTERS[i] || "N" + i)));
  const dy = 156;
  state.segments.forEach((s, i) => {
    const a = X(xs[i]), b = X(xs[i + 1]);
    box.append(svg("path", { class: "dim", d: `M${a},${dy - 6} L${a},${dy + 4} M${b},${dy - 6} L${b},${dy + 4} M${a},${dy} L${b},${dy}` }));
    const isNum = /^[\d.,]+$/.test(String(s.length).trim());
    box.append(svg("text", { x: (a + b) / 2, y: dy - 4, "text-anchor": "middle", class: "dimt" },
      (isNum ? "" : s.length + " = ") + fmt(xs[i + 1] - xs[i]) + " м"));
    box.append(svg("text", { x: (a + b) / 2, y: dy + 12, "text-anchor": "middle", class: "dimt" }, roman(i)));
  });
}

// ---------- отправка ----------

function solve() {
  const { errors } = EXTRA.includes(state.kind) ? analyzeExtra() : analyze();
  if (errors.length) { alertMsg("Исправьте схему: " + errors[0]); return; }
  const data = JSON.stringify(toModel());
  if (new Blob([data]).size > 4000) { alertMsg("Слишком большая схема для отправки (больше 4 КБ)."); return; }
  if (tg && tg.initData !== undefined && tg.sendData && tg.platform !== "unknown") {
    try { tg.sendData(data); return; } catch (e) { /* открыт не с кнопки клавиатуры */ }
    alertMsg("Откройте конструктор кнопкой «📐 Конструктор задачи» внизу чата с ботом — тогда «Решить» сработает.");
    return;
  }
  const dbg = $("debug"); dbg.hidden = false; dbg.textContent = data;
}

function alertMsg(text) {
  if (tg && tg.showAlert && tg.platform !== "unknown") tg.showAlert(text); else alert(text);
}

// ---------- запуск ----------

async function decodeHash() {
  const m = location.hash.match(/m=([jz])([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  if (m[1] === "j") return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return JSON.parse(await new Response(stream).text());
}

function wire() {
  $("kindSel").addEventListener("change", e => {
    const kind = e.target.value;
    if (kind === state.kind) return;
    const keepVars = state.vars, keepTitle = state.title, keepUnits = state.units, keepSegs = state.segments;
    const oneD = k => !EXTRA.includes(k);
    const was = state.kind;
    state = blank(kind);
    state.vars = keepVars; state.title = keepTitle; state.units = keepUnits;
    if (oneD(was) && oneD(kind)) state.segments = keepSegs;
    changed(true);
  });
  document.querySelectorAll("#units button").forEach(b => b.addEventListener("click", () => { state.units = b.dataset.v; changed(true); }));
  $("title").addEventListener("input", e => { state.title = e.target.value; changed(); });
  $("addVar").onclick = () => { state.vars.push({ name: "", value: "" }); changed(true); };
  $("tableVars").onclick = () => {
    const n = parseInt($("variantNo").value, 10);
    if (!applyVariant(n)) { alertMsg("Введите номер варианта от 1 до 20."); return; }
    changed(true);
  };
  $("addNode").onclick = () => { addExtra("node"); changed(true); };
  $("addMember").onclick = () => { addExtra("member"); changed(true); };
  $("addSection").onclick = () => { addExtra("section"); changed(true); };
  $("addMseg").onclick = () => { addExtra("mseg"); changed(true); };
  $("addSeg").onclick = () => { state.segments.push({ length: "a", k: "1" }); changed(true); };
  $("addSup").onclick = () => {
    if (EXTRA.includes(state.kind)) { addExtra("support"); changed(true); return; }
    const n = state.segments.length;
    const used = new Set(state.supports.map(s => s.node));
    state.supports.push({ type: state.kind === "beam" ? (state.supports.length ? "roller" : "pin") : "fixed", node: used.has(0) ? n : 0 });
    changed(true);
  };
  $("addLoad").onclick = () => {
    if (EXTRA.includes(state.kind)) { addExtra("load"); changed(true); return; }
    const type = LOAD_TYPES[state.kind][0][0];
    const l = { type, node: Math.min(1, state.segments.length), from: 0, to: 1, value: "", value2: "", dir: dirOptions(state.kind, type)[0][0] };
    fixLoad(l);
    state.loads.push(l);
    changed(true);
  };
  $("reset").onclick = () => { state = blank(state.kind); changed(true); };
  $("solveBtn").onclick = solve;
}

(async function init() {
  if (tg) {
    tg.ready(); tg.expand();
    // выпадающие списки рисуются системой: подсказываем ей тему Telegram, иначе белый текст на белом
    if (tg.colorScheme) document.documentElement.style.colorScheme = tg.colorScheme;
    if (tg.onEvent) tg.onEvent("themeChanged", () => { document.documentElement.style.colorScheme = tg.colorScheme; });
  }
  wire();
  let model = null;
  try { model = await decodeHash(); } catch (e) { console.warn("hash", e); }
  if (model) state = fromModel(model);
  else {
    try { const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); if (saved && saved.kind) state = saved; } catch (e) { /* */ }
  }
  render();
})();
