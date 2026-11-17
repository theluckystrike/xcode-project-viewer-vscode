'use strict';
// Semantic diff of two project.pbxproj versions (Zovo Pro): what changed in the project, not which lines moved.
// Targets are matched by id, then by name; files by id, then by path. The report lists targets added or removed,
// files added, removed, moved to another group or renamed, files added to or removed from a target's build phases,
// build settings added, removed or changed per target and configuration, Swift packages and target dependencies.
// No VS Code import.
const S = require('./settings');

function fileInfo(m) {
  const out = new Map();
  for (const id of Object.keys(m.objects)) {
    const o = m.objects[id];
    if (!o || (o.isa !== 'PBXFileReference' && o.isa !== 'PBXFileSystemSynchronizedRootGroup')) continue;
    const r = m.resolve(id);
    const parent = m.parent.get(id);
    out.set(id, { id, name: m.nameOf(id), path: m.shownPath(r), group: parent ? groupPath(m, parent) : '', line: m.lineOf(id) });
  }
  return out;
}
function groupPath(m, id) {
  const parts = [];
  let cur = id;
  for (let i = 0; cur && i < 64; i++) {
    if (cur === m.project.mainGroup) break;
    parts.unshift(m.nameOf(cur));
    cur = m.parent.get(cur);
  }
  return parts.join('/') || '(top)';
}

function matchTargets(a, b) {
  const pairs = [];
  const usedB = new Set();
  for (const t of a.targets) {
    let u = b.targets.find((x) => x.id === t.id);
    if (!u) u = b.targets.find((x) => x.name === t.name && !usedB.has(x.id) && !a.targets.some((y) => y.id === x.id));
    if (u) { usedB.add(u.id); pairs.push([t, u]); }
  }
  return { pairs, onlyA: a.targets.filter((t) => !pairs.some(([x]) => x === t)), onlyB: b.targets.filter((t) => !usedB.has(t.id)) };
}

function diff(a, b) {
  const r = { targetsAdded: [], targetsRemoved: [], targetsRenamed: [], filesAdded: [], filesRemoved: [], filesMoved: [], filesRenamed: [], membership: [], settings: [], packagesAdded: [], packagesRemoved: [], packagesChanged: [], depsAdded: [], depsRemoved: [], phasesAdded: [], phasesRemoved: [], objectsA: a.objectCount, objectsB: b.objectCount };
  const T = matchTargets(a, b);
  for (const t of T.onlyB) r.targetsAdded.push({ name: t.name, type: t.typeLabel, line: t.line });
  for (const t of T.onlyA) r.targetsRemoved.push({ name: t.name, type: t.typeLabel, line: t.line });
  for (const [x, y] of T.pairs) if (x.name !== y.name) r.targetsRenamed.push({ from: x.name, to: y.name, line: y.line });

  // files
  const fa = fileInfo(a), fb = fileInfo(b);
  const byPathA = new Map([...fa.values()].map((f) => [f.path, f]));
  const matchedA = new Set();
  for (const f of fb.values()) {
    let g = fa.get(f.id);
    if (!g) { const p = byPathA.get(f.path); if (p && !fb.has(p.id)) g = p; }
    if (!g) { r.filesAdded.push({ name: f.name, path: f.path, group: f.group, line: f.line }); continue; }
    matchedA.add(g.id);
    if (g.group !== f.group) r.filesMoved.push({ name: f.name, from: g.group, to: f.group, line: f.line });
    if (g.path !== f.path && g.group === f.group) r.filesRenamed.push({ from: g.path, to: f.path, line: f.line });
  }
  for (const g of fa.values()) if (!matchedA.has(g.id)) r.filesRemoved.push({ name: g.name, path: g.path, group: g.group, line: g.line });

  // per matched target: build phase membership, dependencies, packages, settings
  const key = (f) => f.path || f.name;
  for (const [x, y] of T.pairs) {
    const kinds = new Set([...x.phases.map((p) => p.name), ...y.phases.map((p) => p.name)]);
    for (const k of kinds) {
      const px = x.phases.filter((p) => p.name === k), py = y.phases.filter((p) => p.name === k);
      if (!px.length) { r.phasesAdded.push({ target: y.name, phase: k, line: py[0].line }); }
      if (!py.length) { r.phasesRemoved.push({ target: y.name, phase: k }); }
      const sx = new Map(px.flatMap((p) => p.files).map((f) => [key(f), f]));
      const sy = new Map(py.flatMap((p) => p.files).map((f) => [key(f), f]));
      for (const [kk, f] of sy) if (!sx.has(kk)) r.membership.push({ target: y.name, phase: k, change: 'added', name: f.name, path: f.path, line: f.line });
      for (const [kk, f] of sx) if (!sy.has(kk)) r.membership.push({ target: y.name, phase: k, change: 'removed', name: f.name, path: f.path, line: 0 });
    }
    const dx = new Set(x.deps.map((d) => d.name)), dy = new Set(y.deps.map((d) => d.name));
    for (const d of dy) if (!dx.has(d)) r.depsAdded.push({ target: y.name, name: d });
    for (const d of dx) if (!dy.has(d)) r.depsRemoved.push({ target: y.name, name: d });
    const kx = new Set(x.packages.map((p) => p.product)), ky = new Set(y.packages.map((p) => p.product));
    for (const p of ky) if (!kx.has(p)) r.depsAdded.push({ target: y.name, name: `${p} (package product)` });
    for (const p of kx) if (!ky.has(p)) r.depsRemoved.push({ target: y.name, name: `${p} (package product)` });
    settingsDiff(r, y.name, x.configList.configs, y.configList.configs, b, y);
  }
  settingsDiff(r, '(project)', a.projectConfigs.configs, b.projectConfigs.configs, b, null);

  // packages by URL or path
  const pk = (p) => p.url || p.path || p.name;
  const pa = new Map(a.packages.map((p) => [pk(p), p])), pb = new Map(b.packages.map((p) => [pk(p), p]));
  for (const [k, p] of pb) {
    const q = pa.get(k);
    if (!q) r.packagesAdded.push({ name: p.name, where: p.url || p.path, requirement: p.requirement, line: p.line });
    else if (q.requirement !== p.requirement) r.packagesChanged.push({ name: p.name, from: q.requirement, to: p.requirement, line: p.line });
  }
  for (const [k, p] of pa) if (!pb.has(k)) r.packagesRemoved.push({ name: p.name, where: p.url || p.path, requirement: p.requirement });

  r.total = r.targetsAdded.length + r.targetsRemoved.length + r.targetsRenamed.length + r.filesAdded.length + r.filesRemoved.length + r.filesMoved.length + r.filesRenamed.length + r.membership.length + r.settings.length + r.packagesAdded.length + r.packagesRemoved.length + r.packagesChanged.length + r.depsAdded.length + r.depsRemoved.length + r.phasesAdded.length + r.phasesRemoved.length;
  return r;
}

function settingsDiff(r, target, ca, cb, mb) {
  const names = [...new Set([...ca.map((c) => c.name), ...cb.map((c) => c.name)])];
  for (const n of names) {
    const x = ca.find((c) => c.name === n), y = cb.find((c) => c.name === n);
    const sx = x ? x.settings : {}, sy = y ? y.settings : {};
    for (const k of [...new Set([...Object.keys(sx), ...Object.keys(sy)])].sort()) {
      const vx = k in sx ? S.valueText(sx[k]) : null, vy = k in sy ? S.valueText(sy[k]) : null;
      if (vx === vy) continue;
      r.settings.push({ target, config: n, key: k, a: vx, b: vy, change: vx === null ? 'added' : vy === null ? 'removed' : 'changed', line: y && vy !== null ? mb.idx.lineOf('objects', y.id, 'buildSettings', k) : 0 });
    }
  }
}

const md = (s) => String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (s) => (s === null || s === undefined || s === '' ? '' : `\`${md(s)}\``);
function toMarkdown(r, nameA, nameB) {
  const out = [`# Xcode project changes: ${md(nameA)} to ${md(nameB)}`, ''];
  if (!r.total) { out.push('No changes to targets, files, build phases, build settings, packages or dependencies.', ''); return out.join('\n'); }
  out.push(`${r.total} change${r.total === 1 ? '' : 's'}. Objects: ${r.objectsA} before, ${r.objectsB} after.`, '');
  const list = (title, arr, fmt) => { if (!arr.length) return; out.push(`## ${title} (${arr.length})`, ''); for (const x of arr) out.push(`- ${fmt(x)}`); out.push(''); };
  list('Targets added', r.targetsAdded, (x) => `${md(x.name)} (${md(x.type)})`);
  list('Targets removed', r.targetsRemoved, (x) => `${md(x.name)} (${md(x.type)})`);
  list('Targets renamed', r.targetsRenamed, (x) => `${md(x.from)} to ${md(x.to)}`);
  list('Files added', r.filesAdded, (x) => `${code(x.path)} in group ${md(x.group)}`);
  list('Files removed', r.filesRemoved, (x) => `${code(x.path)} from group ${md(x.group)}`);
  list('Files moved to another group', r.filesMoved, (x) => `${md(x.name)}: ${md(x.from)} to ${md(x.to)}`);
  list('Files renamed', r.filesRenamed, (x) => `${code(x.from)} to ${code(x.to)}`);
  list('Build phases added', r.phasesAdded, (x) => `${md(x.phase)} in ${md(x.target)}`);
  list('Build phases removed', r.phasesRemoved, (x) => `${md(x.phase)} in ${md(x.target)}`);
  if (r.membership.length) {
    out.push(`## Target membership (${r.membership.length})`, '', '| Target | Phase | Change | File |', '| --- | --- | --- | --- |');
    for (const x of r.membership) out.push(`| ${md(x.target)} | ${md(x.phase)} | ${x.change} | ${code(x.path || x.name)} |`);
    out.push('');
  }
  if (r.settings.length) {
    out.push(`## Build settings (${r.settings.length})`, '', '| Target | Configuration | Setting | Before | After |', '| --- | --- | --- | --- | --- |');
    for (const x of r.settings) out.push(`| ${md(x.target)} | ${md(x.config)} | ${code(x.key)} | ${x.a === null ? '_not set_' : code(x.a)} | ${x.b === null ? '_not set_' : code(x.b)} |`);
    out.push('');
  }
  list('Swift packages added', r.packagesAdded, (x) => `${md(x.name)} (${md(x.where)}, ${md(x.requirement)})`);
  list('Swift packages removed', r.packagesRemoved, (x) => `${md(x.name)} (${md(x.where)})`);
  list('Swift package versions changed', r.packagesChanged, (x) => `${md(x.name)}: ${md(x.from)} to ${md(x.to)}`);
  list('Dependencies added', r.depsAdded, (x) => `${md(x.target)} now depends on ${md(x.name)}`);
  list('Dependencies removed', r.depsRemoved, (x) => `${md(x.target)} no longer depends on ${md(x.name)}`);
  return out.join('\n');
}

module.exports = { diff, toMarkdown, groupPath };
