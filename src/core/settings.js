'use strict';
// Build settings with their inherited values. For one target and one configuration the levels are, lowest first:
// the project's .xcconfig (when the host could read it), the project's own settings, the target's .xcconfig, the
// target's own settings. "$(inherited)" in a level takes the value of the levels below it. Xcode's built-in
// defaults (SDK and platform) are not part of the project file, so they are not shown.
// Also: CSV and Markdown export (Pro) and the side-by-side comparison of two targets (Pro). No VS Code import.

const LEVELS = ['projectXcconfig', 'project', 'targetXcconfig', 'target'];
const LEVEL_LABEL = { projectXcconfig: 'Project .xcconfig', project: 'Project', targetXcconfig: 'Target .xcconfig', target: 'Target' };

/** Parses .xcconfig text: { settings: { KEY: value }, includes: [path], lines: { KEY: line } }. */
function parseXcconfig(text) {
  const settings = {};
  const lines = {};
  const includes = [];
  String(text || '').split(/\r?\n/).forEach((raw, k) => {
    let l = raw;
    // strip // comments outside quotes
    let q = false;
    for (let i = 0; i < l.length; i++) { if (l[i] === '"') q = !q; else if (!q && l[i] === '/' && l[i + 1] === '/') { l = l.slice(0, i); break; } }
    l = l.trim();
    if (!l) return;
    const inc = /^#include\??\s+"([^"]+)"/.exec(l);
    if (inc) { includes.push(inc[1]); return; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])*)\s*=\s*(.*?);?$/.exec(l);
    if (m) { settings[m[1]] = m[2]; lines[m[1]] = k + 1; }
  });
  return { settings, includes, lines };
}

const valueText = (v) => (Array.isArray(v) ? v.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ') : String(v === undefined || v === null ? '' : v));

/** Replaces $(inherited) / ${inherited} in v with below (both as text). */
function inherit(v, below) {
  const t = valueText(v);
  if (!/\$[({]inherited[)}]/.test(t)) return t;
  return t.replace(/\$[({]inherited[)}]/g, below || '').replace(/\s+/g, ' ').trim();
}

/**
 * Rows for target t (or null for the project alone) and configuration name.
 * xcconfigs: Map/obj of build configuration id -> { settings } read from the base configuration file (optional).
 */
function resolveSettings(m, targetId, configName, xcconfigs) {
  const xc = (cid) => (xcconfigs && cid ? (xcconfigs instanceof Map ? xcconfigs.get(cid) : xcconfigs[cid]) : null);
  const pc = m.projectConfigs.configs.find((c) => c.name === configName) || null;
  const t = targetId ? m.targets.find((x) => x.id === targetId) : null;
  const tc = t ? t.configList.configs.find((c) => c.name === configName) || null : null;
  const level = {
    projectXcconfig: pc && xc(pc.id) ? xc(pc.id).settings : {},
    project: pc ? pc.settings : {},
    targetXcconfig: tc && xc(tc.id) ? xc(tc.id).settings : {},
    target: tc ? tc.settings : {},
  };
  const use = t ? LEVELS : LEVELS.slice(0, 2);
  const keys = new Set();
  for (const L of use) for (const k of Object.keys(level[L])) keys.add(k);
  const rows = [];
  for (const key of [...keys].sort()) {
    let val = '';
    let from = '';
    const raw = {};
    for (const L of use) {
      if (!Object.prototype.hasOwnProperty.call(level[L], key)) continue;
      raw[L] = valueText(level[L][key]);
      val = inherit(level[L][key], val);
      from = L;
    }
    const line = from === 'target' && tc ? m.idx.lineOf('objects', tc.id, 'buildSettings', key)
      : from === 'project' && pc ? m.idx.lineOf('objects', pc.id, 'buildSettings', key) : 0;
    rows.push({ key, value: val, from, fromLabel: LEVEL_LABEL[from], raw, line, inherited: !!t && from !== 'target' && from !== 'targetXcconfig', usesInherited: Object.values(raw).some((v) => /\$[({]inherited[)}]/.test(v)) });
  }
  return { rows, target: t ? t.name : 'Project', config: configName, hasTargetConfig: !!tc, hasProjectConfig: !!pc, xcconfig: { project: pc ? pc.basePath : '', target: tc ? tc.basePath : '' } };
}

/** Every target x configuration (project-level rows under "Project"). */
function allRows(m, xcconfigs) {
  const out = [];
  for (const cfg of m.configNames) {
    for (const r of resolveSettings(m, null, cfg, xcconfigs).rows) out.push({ target: '(project)', config: cfg, ...r });
    for (const t of m.targets) for (const r of resolveSettings(m, t.id, cfg, xcconfigs).rows) out.push({ target: t.name, config: cfg, ...r });
  }
  return out;
}

// Cells that a spreadsheet would run as a formula get a leading apostrophe. Compiler flags such as -O stay as they are.
const FORMULA = /^[=+@\t\r]|^-[\d.(]/;
const csvCell = (s) => { const t = String(s === undefined || s === null ? '' : s); const f = FORMULA.test(t); return f || /[",\n\r]/.test(t) ? `"${(f ? "'" : '') + t.replace(/"/g, '""')}"` : t; };
function toCsv(rows) {
  const head = ['Target', 'Configuration', 'Setting', 'Value', 'Set at', 'Target value', 'Target .xcconfig value', 'Project value', 'Project .xcconfig value'];
  const lines = [head.join(',')];
  for (const r of rows) lines.push([r.target, r.config, r.key, r.value, r.fromLabel, r.raw.target, r.raw.targetXcconfig, r.raw.project, r.raw.projectXcconfig].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
const mdCell = (s) => String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
function toMarkdown(rows, title) {
  const out = [`# Build settings: ${mdCell(title)}`, '', 'Values with $(inherited) resolved through the project and target levels. Xcode\'s own SDK defaults are not part of the project file and are not listed.', ''];
  const groups = new Map();
  for (const r of rows) { const k = `${r.target}\u0000${r.config}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const [k, list] of groups) {
    const [t, c] = k.split('\u0000');
    out.push(`## ${mdCell(t)}, ${mdCell(c)}`, '', '| Setting | Value | Set at |', '| --- | --- | --- |');
    for (const r of list) out.push(`| \`${mdCell(r.key)}\` | ${r.value ? `\`${mdCell(r.value)}\`` : ''} | ${r.fromLabel} |`);
    out.push('');
  }
  return out.join('\n');
}

/** Two targets side by side: per configuration and setting, the resolved value in A and B. */
function compareTargets(m, idA, idB, xcconfigs) {
  const a = m.targets.find((t) => t.id === idA);
  const b = m.targets.find((t) => t.id === idB);
  if (!a || !b) throw new Error('Both targets must be in this project.');
  const configs = [...new Set([...a.configList.configs.map((c) => c.name), ...b.configList.configs.map((c) => c.name)])];
  const rows = [];
  for (const cfg of configs) {
    const ra = new Map(resolveSettings(m, idA, cfg, xcconfigs).rows.map((r) => [r.key, r]));
    const rb = new Map(resolveSettings(m, idB, cfg, xcconfigs).rows.map((r) => [r.key, r]));
    for (const key of [...new Set([...ra.keys(), ...rb.keys()])].sort()) {
      const x = ra.get(key), y = rb.get(key);
      const va = x ? x.value : null, vb = y ? y.value : null;
      rows.push({ config: cfg, key, a: va, b: vb, fromA: x ? x.fromLabel : '', fromB: y ? y.fromLabel : '', lineA: x ? x.line : 0, lineB: y ? y.line : 0, same: va === vb, kind: va === null ? 'onlyB' : vb === null ? 'onlyA' : va === vb ? 'same' : 'changed' });
    }
  }
  return { a: a.name, b: b.name, configs, rows, differ: rows.filter((r) => !r.same).length };
}
function compareToCsv(c) {
  const lines = [['Configuration', 'Setting', c.a, c.b, 'Same'].map(csvCell).join(',')];
  for (const r of c.rows) lines.push([r.config, r.key, r.a === null ? '(not set)' : r.a, r.b === null ? '(not set)' : r.b, r.same ? 'yes' : 'no'].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
function compareToMarkdown(c) {
  const out = [`# Build settings: ${mdCell(c.a)} and ${mdCell(c.b)}`, '', `${c.differ} setting${c.differ === 1 ? '' : 's'} differ across ${c.configs.length} configuration${c.configs.length === 1 ? '' : 's'}. Only the differences are listed.`, ''];
  for (const cfg of c.configs) {
    const list = c.rows.filter((r) => r.config === cfg && !r.same);
    if (!list.length) continue;
    out.push(`## ${mdCell(cfg)}`, '', `| Setting | ${mdCell(c.a)} | ${mdCell(c.b)} |`, '| --- | --- | --- |');
    for (const r of list) out.push(`| \`${mdCell(r.key)}\` | ${r.a === null ? '_not set_' : `\`${mdCell(r.a)}\``} | ${r.b === null ? '_not set_' : `\`${mdCell(r.b)}\``} |`);
    out.push('');
  }
  return out.join('\n');
}

module.exports = { parseXcconfig, resolveSettings, allRows, toCsv, toMarkdown, compareTargets, compareToCsv, compareToMarkdown, inherit, valueText, LEVELS, LEVEL_LABEL };
