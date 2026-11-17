'use strict';
// Broken reference checks on a loaded project (src/core/pbx.js). Each warning has a level (error, warning, note),
// a plain message and the line to jump to. Files missing on disk are checked by the extension host (it reads the
// disk through VS Code); diskEntries() lists what it should look for. No VS Code import.
const X = require('./pbx');

const LIST_NAMES = { children: 'group children', files: 'build phase files', buildPhases: 'build phases', targets: 'targets', dependencies: 'dependencies', buildConfigurations: 'build configurations', packageReferences: 'package references', packageProductDependencies: 'package products', buildRules: 'build rules', fileSystemSynchronizedGroups: 'synchronized folders', exceptions: 'folder exceptions', localPackages: 'local packages' };

function check(m) {
  const out = [];
  const { objects, idx } = m;
  const name = (id) => m.nameOf(id) || id;
  // 1. references to objects that are not there
  for (const r of X.references(m)) {
    if (objects[r.to]) continue;
    out.push({ level: 'error', kind: 'dangling', line: r.line, id: r.from, ref: r.to, field: r.field,
      message: `${name(r.from)} (${(objects[r.from] || {}).isa || 'object'}) points to ${r.to} in ${r.list ? LIST_NAMES[r.field] || r.field : r.field}, but no object has that id.` });
  }
  // 2. keys written twice in one dictionary (object ids after a merge, build settings)
  for (const d of idx.dups) {
    if (d.path.length === 1 && d.path[0] === 'objects') {
      out.push({ level: 'error', kind: 'dupObject', line: d.lines[1], id: d.key, lines: d.lines, message: `The object id ${d.key} (${name(d.key)}) is defined ${d.lines.length} times (lines ${d.lines.join(', ')}). Xcode keeps only one of them.` });
    } else {
      const where = d.path[0] === 'objects' && d.path[1] ? `${name(d.path[1])}${d.path.length > 2 ? ` ${d.path.slice(2).join('.')}` : ''}` : d.path.join('.');
      out.push({ level: 'warning', kind: 'dupKey', line: d.lines[1], id: d.path[1] || '', key: d.key, lines: d.lines, message: `"${d.key}" is set ${d.lines.length} times in ${where} (lines ${d.lines.join(', ')}). Only the last one counts.` });
    }
  }
  // 3. the same id twice in one list
  for (const id of Object.keys(objects)) {
    const o = objects[id];
    if (!o || typeof o !== 'object') continue;
    for (const f of X.REF_LIST) {
      if (!Array.isArray(o[f])) continue;
      const seen = new Map();
      const lines = idx.itemsOf('objects', id, f);
      o[f].forEach((v, k) => {
        if (seen.has(v)) out.push({ level: 'warning', kind: 'dupItem', line: (lines[k] && lines[k].line) || 0, id, ref: v, field: f, message: `${name(v)} is listed twice in the ${LIST_NAMES[f] || f} of ${name(id)}.` });
        else seen.set(v, k);
      });
    }
  }
  // 4. one file built twice in the same phase (two build file entries with the same file)
  for (const t of m.targets) {
    for (const ph of t.phases) {
      const by = new Map();
      for (const f of ph.files) {
        if (!f.ref) continue;
        if (by.has(f.ref) && by.get(f.ref) !== f.buildFile) out.push({ level: 'warning', kind: 'dupBuildFile', line: f.line || ph.line, id: f.buildFile, ref: f.ref, message: `${f.name} is in the ${ph.name} phase of ${t.name} twice, through two build file entries.` });
        else by.set(f.ref, f.buildFile);
      }
    }
  }
  // 5. build file entries no phase uses, and file references no group holds
  const usedBuild = new Set();
  for (const id of Object.keys(objects)) { const o = objects[id]; if (o && Array.isArray(o.files)) for (const b of o.files) usedBuild.add(b); }
  for (const id of Object.keys(objects)) {
    const o = objects[id];
    if (!o) continue;
    if (o.isa === 'PBXBuildFile' && !usedBuild.has(id)) out.push({ level: 'note', kind: 'unusedBuildFile', line: m.lineOf(id), id, message: `The build file entry for ${name(id)} is not in any build phase.` });
    if (o.isa === 'PBXFileReference' && !m.parent.has(id) && !isReferencedElsewhere(m, id)) out.push({ level: 'note', kind: 'orphanFile', line: m.lineOf(id), id, message: `${name(id)} is a file reference that no group holds.` });
  }
  const order = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.line || 0) - (b.line || 0));
}

function isReferencedElsewhere(m, id) {
  if (!m._refTo) { m._refTo = new Set(); for (const r of X.references(m)) if (r.field !== 'children') m._refTo.add(r.to); }
  return m._refTo.has(id);
}

/** Files and folders the host should look for on disk: [{ id, name, rel, abs, line, group }]. */
function diskEntries(m) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.checkable && n.kind !== 'missing' && (n.base === 'SRCROOT' || n.base === 'ABS')) out.push({ id: n.id, name: n.name, rel: n.base === 'SRCROOT' ? n.rel : '', abs: n.base === 'ABS' ? n.rel : '', line: n.line, group: !!(n.children && n.children.length) || ['group', 'sync', 'variant', 'version'].includes(n.kind) });
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(m.tree);
  return out;
}

module.exports = { check, diskEntries };
