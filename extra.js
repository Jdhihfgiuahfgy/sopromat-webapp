"use strict";
// Конструктор: рамы (задача 8), пространственный ломаный стержень (1), нагрузки по эпюре M (9),
// таблица вариантов методички. Подключается до app.js; общие помощники (el, input, select, ev…) — из app.js.

const EXTRA = ["frame", "spatial", "inverse"];

// Таблица 2: P1 P2 P3 M1 M2 M3 m q a b/a c/a
const VARIANTS = {
  1: [1, 5, 2, 1, 3, 5, 1, 1, 2, 1, 3], 2: [2, 1, 3, 2, 4, 4, 2, 2, 3, 2, 2], 3: [3, 2, 4, 3, 5, 3, 3, 3, 4, 3, 1],
  4: [4, 3, 5, 4, 1, 2, 1, 1, 3, 3, 3], 5: [5, 4, 2, 5, 2, 1, 2, 2, 4, 2, 2], 6: [1, 5, 3, 2, 3, 5, 1, 3, 2, 2, 1],
  7: [2, 1, 4, 3, 4, 4, 2, 1, 4, 1, 2], 8: [3, 2, 5, 4, 5, 3, 3, 2, 3, 2, 3], 9: [4, 3, 2, 5, 2, 2, 2, 3, 2, 3, 1],
  10: [5, 4, 3, 3, 1, 1, 3, 1, 4, 1, 2], 11: [1, 5, 4, 4, 1, 3, 1, 2, 2, 3, 1], 12: [2, 1, 5, 5, 2, 2, 2, 3, 3, 2, 3],
  13: [3, 2, 2, 4, 3, 1, 3, 1, 4, 1, 2], 14: [4, 3, 3, 3, 4, 5, 2, 2, 2, 3, 1], 15: [5, 4, 4, 2, 5, 3, 3, 3, 3, 2, 3],
  16: [1, 5, 5, 1, 4, 3, 1, 1, 4, 1, 2], 17: [2, 1, 2, 5, 3, 2, 2, 2, 3, 1, 3], 18: [3, 2, 3, 4, 2, 3, 3, 3, 2, 2, 2],
  19: [4, 3, 4, 3, 1, 5, 2, 1, 2, 3, 1], 20: [5, 4, 5, 2, 2, 4, 1, 2, 3, 2, 3],
};

function applyVariant(n) {
  const row = VARIANTS[n];
  if (!row) return false;
  const vals = { P1: row[0], P2: row[1], P3: row[2], M1: row[3], M2: row[4], M3: row[5], m: row[6], q: row[7],
    a: row[8], b: row[9] + "*a", c: row[10] + "*a" };
  for (const [k, v] of Object.entries(vals)) {
    const cur = state.vars.find(x => x.name === k);
    if (cur) cur.value = String(v); else state.vars.push({ name: k, value: String(v) });
  }
  state.units = "t";
  if (!/вариант/i.test(state.title)) state.title = (state.title ? state.title + ", " : "") + "вариант " + n;
  else state.title = state.title.replace(/вариант\s*\d+/i, "вариант " + n);
  return true;
}

function blankExtra(kind, s) {
  if (kind === "frame") {
    s.nodes = [{ x: "0", y: "0" }, { x: "0", y: "a" }, { x: "a", y: "a" }];
    s.members = [{ a: 0, b: 1 }, { a: 1, b: 2 }];
    s.supports = [{ type: "fixed", node: 0, dir: "y" }];
  } else if (kind === "spatial") {
    s.nodes = [{ x: "0", y: "0", z: "0" }, { x: "0", y: "0", z: "a" }, { x: "a", y: "0", z: "a" }, { x: "a", y: "a", z: "a" }];
    s.supports = [{ type: "fixed", node: 0 }];
    s.sections = [{ name: "I", member: 0, pos: "0.5" }, { name: "II", member: 2, pos: "0.5" }];
  } else if (kind === "inverse") {
    s.mseg = [{ length: "a", m0: "0", m1: "M1", shape: "line" }, { length: "b", m0: "M1", m1: "0", shape: "parabola_left" }];
  }
  s.loads = [];
  return s;
}

const CARDS = {
  beam: ["cardSegments", "cardSupports", "cardLoads", "cardMaterial"],
  axial: ["cardSegments", "cardSupports", "cardLoads", "cardMaterial"],
  torsion: ["cardSegments", "cardSupports", "cardLoads", "cardMaterial"],
  frame: ["cardNodes", "cardMembers", "cardSupports", "cardLoads"],
  spatial: ["cardNodes", "cardSupports", "cardLoads", "cardSections"],
  inverse: ["cardMdiag"],
};
const ALL_CARDS = ["cardSegments", "cardSupports", "cardLoads", "cardMaterial", "cardNodes", "cardMembers", "cardSections", "cardMdiag"];

function showCards() {
  ALL_CARDS.forEach(id => { const e = $(id); if (e) e.hidden = !CARDS[state.kind].includes(id); });
  const hint = $("nodesHint");
  if (hint) hint.textContent = state.kind === "spatial"
    ? "Точки излома по порядку вдоль стержня. Оси: x — вправо, y — вглубь, z — вверх. Координаты через a."
    : "Углы, концы, опоры и точки приложения сил. x — вправо, y — вверх. Координаты через a (0, a, 2a).";
}

function nodeOpts(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([String(i), LETTERS[i] || "N" + i]);
  return out;
}

const FRAME_SUPPORTS = [["fixed", "Жёсткая заделка"], ["pin", "Шарнирно-неподвижная опора"], ["roller", "Шарнирно-подвижная опора"],
  ["slider", "Скользящая заделка (ползун)"], ["hinge", "Промежуточный шарнир"]];
const FRAME_DIRS = [["down", "↓ вниз"], ["up", "↑ вверх"], ["right", "→ вправо"], ["left", "← влево"]];
const AXIS_DIRS = [["-z", "−z (вниз)"], ["+z", "+z (вверх)"], ["+x", "+x (вправо)"], ["-x", "−x (влево)"], ["+y", "+y (вглубь)"], ["-y", "−y (к нам)"]];
const SHAPES = [["line", "прямая"], ["parabola_left", "парабола, вершина в начале"], ["parabola_right", "парабола, вершина в конце"]];

function renderExtra() {
  const k = state.kind;
  if (k === "frame" || k === "spatial") {
    const nodes = $("nodes"); nodes.innerHTML = "";
    state.nodes.forEach((n, i) => nodes.append(el("div", { class: "item " + (k === "spatial" ? "node3-row" : "node-row") },
      el("span", { class: "tag" }, LETTERS[i] || "N" + i),
      input(n.x, "x", v => { n.x = v; }), input(n.y, "y", v => { n.y = v; }),
      k === "spatial" ? input(n.z, "z", v => { n.z = v; }) : "",
      delBtn(() => removeNode(i)))));
  }
  if (k === "frame") {
    const mem = $("members"); mem.innerHTML = "";
    state.members.forEach((m, i) => mem.append(el("div", { class: "item sup-row" },
      select(nodeOpts(state.nodes.length), String(m.a), v => { m.a = +v; }),
      select(nodeOpts(state.nodes.length), String(m.b), v => { m.b = +v; }),
      delBtn(() => state.members.splice(i, 1)))));
  }
  const sups = $("supports"); sups.innerHTML = "";
  if (k === "frame") {
    state.supports.forEach((s, i) => sups.append(el("div", { class: "item load-row" },
      select(FRAME_SUPPORTS, s.type, v => { s.type = v; }),
      delBtn(() => state.supports.splice(i, 1)),
      el("div", { class: "wide" },
        select(nodeOpts(state.nodes.length), String(s.node), v => { s.node = +v; }),
        s.type === "roller" ? select([["y", "реакция ↕ (вертикальная)"], ["x", "реакция ↔ (горизонтальная)"]], s.dir || "y", v => { s.dir = v; })
          : s.type === "slider" ? select([["y", "держит ↕ и момент (скользит ↔)"], ["x", "держит ↔ и момент (скользит ↕)"]], s.dir || "y", v => { s.dir = v; })
            : el("span")))));
  } else if (k === "spatial") {
    const n = state.nodes.length;
    state.supports = [{ type: "fixed", node: state.supports[0] && state.supports[0].node === n - 1 ? n - 1 : 0 }];
    sups.append(el("div", { class: "item sup-row" }, el("span", {}, "Заделка в узле"),
      select([["0", LETTERS[0]], [String(n - 1), LETTERS[n - 1]]], String(state.supports[0].node), v => { state.supports[0].node = +v; }),
      el("span")));
  }
  if (k === "frame" || k === "spatial") {
    const loads = $("loads"); loads.innerHTML = "";
    state.loads.forEach((l, i) => {
      const dirs = l.type === "moment" && k === "frame" ? [["cw", "↻ по часовой"], ["ccw", "↺ против часовой"]]
        : k === "frame" ? FRAME_DIRS : AXIS_DIRS;
      loads.append(el("div", { class: "item load-row" },
        select([["force", "Сила"], ["moment", "Момент"]], l.type, v => { l.type = v; l.dir = (v === "moment" && k === "frame") ? "cw" : dirs[0][0]; }),
        delBtn(() => state.loads.splice(i, 1)),
        el("div", { class: "wide" },
          select(nodeOpts(state.nodes.length), String(l.node), v => { l.node = +v; }),
          select(dirs, l.dir, v => { l.dir = v; })),
        el("div", { class: "wide" }, input(l.value, "значение: P1, M1", v => { l.value = v; }), el("span"))));
    });
  }
  if (k === "spatial") {
    const sec = $("sections"); sec.innerHTML = "";
    const mopts = [];
    for (let i = 0; i + 1 < state.nodes.length; i++) mopts.push([String(i), (LETTERS[i] || "") + "–" + (LETTERS[i + 1] || "")]);
    state.sections.forEach((s, i) => sec.append(el("div", { class: "item node-row" },
      el("span", { class: "tag" }, "сеч."),
      input(s.name, "I", v => { s.name = v; }),
      select(mopts, String(s.member), v => { s.member = +v; }),
      input(s.pos, "доля: 0.5", v => { s.pos = v; }),
      delBtn(() => state.sections.splice(i, 1)))));
  }
  if (k === "inverse") {
    const md = $("mdiag"); md.innerHTML = "";
    state.mseg.forEach((s, i) => md.append(el("div", { class: "item load-row" },
      el("span", { class: "tag" }, "Участок " + roman(i) + " (" + LETTERS[i] + "–" + LETTERS[i + 1] + ")"),
      delBtn(() => state.mseg.splice(i, 1)),
      el("div", { class: "wide three" },
        input(s.length, "длина: a", v => { s.length = v; }),
        input(s.m0, "M в начале", v => { s.m0 = v; }),
        input(s.m1, "M в конце", v => { s.m1 = v; })),
      el("div", { class: "wide" }, select(SHAPES, s.shape, v => { s.shape = v; }), el("span")))));
  }
}

function removeNode(i) {
  state.nodes.splice(i, 1);
  const fix = v => (v > i ? v - 1 : v);
  if (state.members) state.members = state.members.filter(m => m.a !== i && m.b !== i).map(m => ({ a: fix(m.a), b: fix(m.b) }));
  state.supports = state.supports.filter(s => s.node !== i).map(s => ({ ...s, node: fix(s.node) }));
  state.loads = state.loads.filter(l => l.node !== i).map(l => ({ ...l, node: fix(l.node) }));
  if (state.sections) state.sections = state.sections.filter(s => s.member < state.nodes.length - 1);
}

function addExtra(what) {
  const k = state.kind;
  if (what === "node") {
    const last = state.nodes[state.nodes.length - 1] || { x: "0", y: "0", z: "0" };
    state.nodes.push(k === "spatial" ? { x: last.x, y: last.y, z: last.z } : { x: last.x, y: last.y });
    if (k === "frame" && state.nodes.length > 1) state.members.push({ a: state.nodes.length - 2, b: state.nodes.length - 1 });
  } else if (what === "member") {
    state.members.push({ a: 0, b: Math.min(1, state.nodes.length - 1) });
  } else if (what === "section") {
    state.sections.push({ name: ["I", "II", "III", "IV"][state.sections.length] || "S", member: 0, pos: "0.5" });
  } else if (what === "mseg") {
    const prev = state.mseg[state.mseg.length - 1];
    state.mseg.push({ length: "a", m0: prev ? prev.m1 : "0", m1: "0", shape: "line" });
  } else if (what === "load") {
    state.loads.push({ type: "force", node: state.nodes.length - 1, value: "", dir: k === "frame" ? "down" : "-z" });
  } else if (what === "support") {
    state.supports.push({ type: state.supports.length ? "roller" : "pin", node: state.nodes.length - 1, dir: "y" });
  }
}

function extraToModel(base) {
  const k = state.kind;
  if (k === "inverse") {
    base.segments = state.mseg.map(s => ({ length: s.length }));
    base.mdiagram = state.mseg.map(s => ({ m0: s.m0 || "0", m1: s.m1 || "0", shape: s.shape }));
    return base;
  }
  base.nodes = state.nodes.map(n => k === "spatial" ? { x: n.x || "0", y: n.y || "0", z: n.z || "0" } : { x: n.x || "0", y: n.y || "0" });
  base.loads = state.loads.map(l => ({ type: l.type, node: l.node, value: String(l.value || "").trim(), dir: l.dir }));
  if (k === "frame") {
    base.members = state.members.map(m => ({ a: m.a, b: m.b }));
    base.supports = state.supports.map(s => ({ type: s.type, node: s.node, dir: s.dir || "y" }));
  } else {
    base.supports = state.supports.map(s => ({ type: "fixed", node: s.node }));
    base.sections = state.sections.map(s => ({ name: s.name, member: s.member, pos: s.pos || "0.5" }));
  }
  return base;
}

function extraFromModel(m, s) {
  const k = m.kind;
  if (k === "inverse") {
    const segs = m.segments || [], md = m.mdiagram || [];
    s.mseg = segs.map((x, i) => ({ length: String(x.length), m0: String((md[i] || {}).m0 ?? "0"), m1: String((md[i] || {}).m1 ?? "0"), shape: (md[i] || {}).shape || "line" }));
    return s;
  }
  s.nodes = (m.nodes || []).map(n => ({ x: String(n.x ?? "0"), y: String(n.y ?? "0"), z: String(n.z ?? "0") }));
  s.loads = (m.loads || []).map(l => ({ type: l.type, node: +l.node, value: String(l.value ?? ""), dir: l.dir }));
  if (k === "frame") {
    s.members = (m.members || []).map(x => ({ a: +x.a, b: +x.b }));
    s.supports = (m.supports || []).map(x => ({ type: x.type, node: +x.node, dir: x.dir || "y" }));
  } else {
    s.supports = (m.supports || []).map(x => ({ type: "fixed", node: +x.node }));
    s.sections = (m.sections || []).map(x => ({ name: x.name, member: +x.member, pos: String(x.pos ?? "0.5") }));
  }
  return s;
}

// ---------- проверка и предпросмотр ----------

function analyzeExtra() {
  const errors = [];
  let env = {};
  try { env = resolveVars(state.vars); } catch (e) { errors.push(e.message); }
  const k = state.kind;
  const val = (t, what) => { try { return ev(t || "0", env); } catch (e) { errors.push(what + ": " + e.message); return 0; } };
  if (k === "inverse") {
    const xs = [0], segs = [];
    state.mseg.forEach((s, i) => {
      let L = val(s.length, "длина участка " + roman(i));
      if (!(L > 0)) { errors.push("участок " + roman(i) + ": длина должна быть > 0"); L = 1; }
      segs.push({ L, m0: val(s.m0, "M участка " + roman(i)), m1: val(s.m1, "M участка " + roman(i)), shape: s.shape });
      xs.push(xs[xs.length - 1] + L);
    });
    if (!segs.length) errors.push("добавьте участки эпюры");
    return { errors, xs, segs };
  }
  const pts = state.nodes.map((n, i) => [val(n.x, "x узла " + LETTERS[i]), val(n.y, "y узла " + LETTERS[i]), k === "spatial" ? val(n.z, "z узла " + LETTERS[i]) : 0]);
  if (k === "frame" && state.members.length !== state.nodes.length - 1) errors.push("стержней должно быть на один меньше, чем узлов (рама без замкнутых контуров)");
  if (k === "frame") {
    const links = { fixed: 3, pin: 2, slider: 2, roller: 1, hinge: 0 };
    const unk = state.supports.reduce((s, x) => s + (links[x.type] || 0), 0);
    const deg = v => state.members.filter(m => m.a === v || m.b === v).length;
    const need = 3 + state.supports.filter(x => x.type === "hinge").reduce((s, x) => s + Math.max(0, deg(x.node) - 1), 0);
    if (unk !== need) errors.push("опорных связей " + unk + ", а нужно " + need + " (3 + по одной на каждый шарнир)");
  }
  if (k === "spatial" && !state.sections.length) errors.push("добавьте сечения I–I, II–II");
  if (!state.loads.length) errors.push("добавьте нагрузки");
  state.loads.forEach((l, i) => { if (!String(l.value || "").trim()) errors.push("нагрузка " + (i + 1) + ": укажите значение"); });
  return { errors, pts };
}

function drawExtra(box) {
  const res = analyzeExtra();
  const st = $("status");
  st.textContent = res.errors.length ? "⚠ " + res.errors[0] : "Схема без ошибок.";
  st.className = "status" + (res.errors.length ? " err" : "");
  if (state.kind === "inverse") return drawInverse(box, res);
  const k = state.kind;
  const ang = 35 * Math.PI / 180;
  const P = p => k === "spatial" ? [p[0] + 0.5 * p[1] * Math.cos(ang), p[2] + 0.5 * p[1] * Math.sin(ang)] : [p[0], p[1]];
  const q = res.pts.map(P);
  if (!q.length) return;
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6);
  const sc = Math.min(250 / Math.max(hi[0] - lo[0], 1e-6), 95 / Math.max(hi[1] - lo[1], 1e-6), 190 / span);
  const cx = 180 - (lo[0] + hi[0]) / 2 * sc, cy = 92 + (lo[1] + hi[1]) / 2 * sc;
  const T = p => [cx + p[0] * sc, cy - p[1] * sc];
  const line = (a, b, cls, extra = {}) => box.append(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls, ...extra }));
  const pairs = k === "frame" ? state.members.map(m => [m.a, m.b]) : q.slice(1).map((_, i) => [i, i + 1]);
  pairs.forEach(([a, b]) => { if (q[a] && q[b]) line(T(q[a]), T(q[b]), "ink", { "stroke-width": 3.5, stroke: "currentColor" }); });
  q.forEach((p, i) => { const t = T(p); box.append(svg("text", { x: t[0] + 5, y: t[1] - 5, "font-weight": "bold" }, LETTERS[i] || "")); });
  state.supports.forEach(s => {
    if (!q[s.node]) return;
    const t = T(q[s.node]);
    if (s.type === "fixed") {
      box.append(svg("path", { class: "ink", d: `M${t[0] - 12},${t[1] + 2} L${t[0] + 12},${t[1] + 2}`, "stroke-width": 2.2 }));
      for (let d = -10; d <= 12; d += 5) box.append(svg("path", { class: "ink", d: `M${t[0] + d},${t[1] + 2} l-4,6`, "stroke-width": 0.8 }));
    } else {
      if (s.type === "hinge") {
        box.append(svg("circle", { cx: t[0], cy: t[1], r: 4.5, fill: "var(--card)", class: "ink", "stroke-width": 1.5 }));
        return;
      }
      if (s.type === "slider") {
        box.append(svg("path", { class: "ink", d: `M${t[0] - 12},${t[1] + 12} L${t[0] + 12},${t[1] + 12}`, "stroke-width": 2.2 }));
        for (const dx of [-5, 5]) box.append(svg("circle", { cx: t[0] + dx, cy: t[1] + 6, r: 3, fill: "var(--card)", class: "ink" }));
        for (let d = -10; d <= 12; d += 5) box.append(svg("path", { class: "ink", d: `M${t[0] + d},${t[1] + 12} l-4,6`, "stroke-width": 0.8 }));
        return;
      }
      box.append(svg("path", { class: "ink", d: `M${t[0]},${t[1] + 1} l-7,13 l14,0 z`, "stroke-width": 1.2 }));
      if (s.type === "roller") box.append(svg("path", { class: "ink", d: `M${t[0] - 9},${t[1] + 17} l18,0` }));
    }
  });
  const fdir = { down: [0, -1], up: [0, 1], right: [1, 0], left: [-1, 0] };
  state.loads.forEach(l => {
    if (!q[l.node]) return;
    const t = T(q[l.node]);
    if (k === "frame" && l.type === "moment") {
      const r = 12, ccw = l.dir === "ccw";
      const d = ccw ? `M${t[0] + r},${t[1] + 5} A${r},${r} 0 1 0 ${t[0] - r},${t[1] + 5}` : `M${t[0] - r},${t[1] + 5} A${r},${r} 0 1 1 ${t[0] + r},${t[1] + 5}`;
      box.append(svg("path", { class: "ld", d, "marker-end": "url(#ah)" }));
      box.append(svg("text", { x: t[0], y: t[1] - 16, "text-anchor": "middle", class: "ldt" }, l.value));
      return;
    }
    let v;
    if (k === "frame") v = fdir[l.dir] || [0, -1];
    else {
      const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[l.dir.slice(1)] || [0, 0, 1];
      const sg = l.dir[0] === "-" ? -1 : 1;
      const a = P([0, 0, 0]), b = P(ax.map(c => c * sg));
      v = [b[0] - a[0], b[1] - a[1]];
      const n = Math.hypot(v[0], v[1]) || 1; v = [v[0] / n, v[1] / n];
    }
    const L = 30, s0 = [t[0] - v[0] * L, t[1] + v[1] * L];
    box.append(svg("path", { class: "ld", d: `M${s0[0]},${s0[1]} L${t[0] - v[0] * 3},${t[1] + v[1] * 3}`, "marker-end": "url(#ah)", "stroke-width": 1.8 }));
    box.append(svg("text", { x: s0[0] - v[0] * 6, y: s0[1] + v[1] * 6 + 4, "text-anchor": "middle", class: "ldt" }, (l.type === "moment" ? "⟲" : "") + l.value));
  });
  if (k === "spatial") {
    state.sections.forEach(s => {
      const a = q[s.member], b = q[s.member + 1];
      if (!a || !b) return;
      let f = 0.5; try { f = ev(s.pos || "0.5", {}); } catch (e) { /* */ }
      const c = T([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      const d = [T(b)[0] - T(a)[0], T(b)[1] - T(a)[1]], n = Math.hypot(d[0], d[1]) || 1;
      const w = [-d[1] / n * 11, d[0] / n * 11];
      box.append(svg("path", { d: `M${c[0] - w[0]},${c[1] - w[1]} L${c[0] + w[0]},${c[1] + w[1]}`, stroke: "#1f5fbf", "stroke-dasharray": "3 2", "stroke-width": 1.5, fill: "none" }));
      box.append(svg("text", { x: c[0] + w[0] * 1.4, y: c[1] + w[1] * 1.4 + 4, fill: "#1f5fbf", "font-weight": "bold" }, s.name));
    });
  }
}

function drawInverse(box, res) {
  const segs = res.segs || [];
  if (!segs.length) return;
  const L = res.xs[res.xs.length - 1] || 1;
  const X = x => 30 + x / L * 300, Y0 = 85;
  const mmax = Math.max(1e-9, ...segs.map(s => Math.max(Math.abs(s.m0), Math.abs(s.m1))));
  const Y = m => Y0 + m / mmax * 55;
  box.append(svg("line", { x1: X(0), y1: Y0, x2: X(L), y2: Y0, class: "ink", stroke: "currentColor", "stroke-width": 3 }));
  segs.forEach((s, i) => {
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const z = s.L * k / 20;
      let m;
      if (s.shape === "line") m = s.m0 + (s.m1 - s.m0) * z / s.L;
      else if (s.shape === "parabola_left") m = s.m0 + (s.m1 - s.m0) * (z / s.L) ** 2;
      else m = s.m1 + (s.m0 - s.m1) * ((s.L - z) / s.L) ** 2;
      pts.push([X(res.xs[i] + z), Y(m)]);
    }
    const d = `M${X(res.xs[i])},${Y0} ` + pts.map(p => `L${p[0]},${p[1]}`).join(" ") + ` L${X(res.xs[i + 1])},${Y0} Z`;
    box.append(svg("path", { d, fill: "rgba(242,227,201,0.7)", stroke: "#888", "stroke-width": 1.2 }));
    box.append(svg("text", { x: X(res.xs[i]) + 3, y: Y(s.m0) + (s.m0 >= 0 ? 12 : -4), class: "dimt" }, fmt(s.m0)));
    box.append(svg("text", { x: X(res.xs[i + 1]) - 3, y: Y(s.m1) + (s.m1 >= 0 ? 12 : -4), class: "dimt", "text-anchor": "end" }, fmt(s.m1)));
    if (s.shape !== "line") {
      const z = s.shape === "parabola_left" ? 0 : s.L, m = s.shape === "parabola_left" ? s.m0 : s.m1;
      box.append(svg("circle", { cx: X(res.xs[i] + z), cy: Y(m), r: 3, fill: "currentColor" }));
    }
    box.append(svg("text", { x: (X(res.xs[i]) + X(res.xs[i + 1])) / 2, y: 165, "text-anchor": "middle", class: "dimt" }, roman(i) + ": " + fmt(s.L) + " м"));
  });
  res.xs.forEach((x, i) => box.append(svg("text", { x: X(x), y: 18, "text-anchor": "middle", "font-weight": "bold" }, LETTERS[i] || "")));
  box.append(svg("text", { x: 4, y: Y0 + 4 }, "M"));
}
