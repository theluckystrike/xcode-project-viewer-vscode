'use strict';
// Merge conflict helper (Zovo Pro): resolves git conflict blocks in project.pbxproj and cleans what merges leave
// behind, as a list of line edits on the original text, so every untouched line (and every /* name */ comment Xcode
// writes next to an id) stays as it is.
//
// A conflict block is resolved entry by entry. An entry is one line, or several lines that open and close one
// { } or ( ) value (a whole object). Entries are matched by their key: the object id, the setting name or the list
// item. Both sides' new entries are kept (two branches that each added a file keep both files). When both sides set
// the same key to different values, the side the user picked wins; with a diff3 base section, a side that left the
// base value unchanged gives way to the side that changed it, and an entry one side deleted stays deleted. A block
// whose sides do not hold whole entries is replaced by the picked side as a whole.
// Then: an object defined twice with the same text loses the second copy, build file entries for files that no
// longer exist are removed, and list items that point to missing objects or repeat an item are removed.
// No VS Code import: the host turns the edits into a WorkspaceEdit that the user previews before anything changes.
const openstep = require('./openstep');
const { scan } = require('./scan');
const X = require('./pbx');

function splitText(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const finalNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

/** Depth change of one line, outside quoted strings and comments. */
function depthOf(line, state) {
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state.comment) { if (c === '*' && line[i + 1] === '/') { state.comment = false; i++; } continue; }
    if (state.quote) { if (c === '\\') i++; else if (c === state.quote) state.quote = ''; continue; }
    if (c === '"' || c === "'") state.quote = c;
    else if (c === '/' && line[i + 1] === '*') { state.comment = true; i++; } else if (c === '/' && line[i + 1] === '/') break;
    else if (c === '{' || c === '(') d++;
    else if (c === '}' || c === ')') d--;
  }
  return d;
}

const KEY_RE = /^\s*("(?:[^"\\]|\\.)*"|[^\s=,;/(){}"]+)\s*(?:\/\*.*?\*\/\s*)?(=|,|$)/;
/** Entries of one side: [{ lines, text, key, type }] or null when the side does not hold whole entries. */
function entriesOf(lines) {
  const out = [];
  const state = { quote: '', comment: false };
  let cur = null;
  let depth = 0;
  for (const l of lines) {
    if (!cur) cur = { lines: [] };
    cur.lines.push(l);
    depth += depthOf(l, state);
    if (depth < 0) return null;
    if (depth === 0 && !state.quote && !state.comment) {
      const m = KEY_RE.exec(cur.lines[0]);
      const onlyComment = /^\s*(\/\*.*\*\/)?\s*$/.test(cur.lines[0]) && cur.lines.length === 1;
      cur.text = cur.lines.join('\n');
      cur.key = !onlyComment && m ? m[1].replace(/^"|"$/g, '') : null;
      cur.type = m ? (m[2] === '=' ? 'set' : 'item') : '';
      cur.norm = cur.text.replace(/\s+/g, ' ').trim();
      out.push(cur);
      cur = null;
    }
  }
  if (cur || depth !== 0 || state.quote || state.comment) return null;
  return out;
}

/** Resolves one conflict block. prefer: 'ours' | 'theirs'. */
function resolveBlock(ours, theirs, baseLines, prefer) {
  const eo = entriesOf(ours);
  const et = entriesOf(theirs);
  const eb = baseLines ? entriesOf(baseLines) : null;
  if (!eo || !et || (baseLines && !eb)) {
    return { lines: (prefer === 'theirs' ? theirs : ours).slice(), decision: 'side', clashes: [], added: 0, dropped: 0 };
  }
  const has = (list, e) => list.some((x) => x.norm === e.norm);
  const byKey = (list, e) => (e.key ? list.find((x) => x.key === e.key && x.type === e.type) : null);
  const result = [];
  const clashes = [];
  let dropped = 0;
  for (const e of eo) {
    // deleted by theirs: in the base, unchanged by ours, gone from theirs
    if (eb && has(eb, e) && !has(et, e) && !byKey(et, e)) { dropped++; continue; }
    result.push(e);
  }
  let added = 0;
  for (const e of et) {
    if (has(eo, e)) continue;
    if (eb && has(eb, e) && !has(eo, e) && !byKey(eo, e)) { dropped++; continue; } // deleted by ours
    const o = byKey(result, e);
    if (o) {
      if (e.type === 'item') continue;
      let win = prefer;
      if (eb) { const b = byKey(eb, e); if (b && b.norm === o.norm) win = 'theirs'; else if (b && b.norm === e.norm) win = 'ours'; }
      clashes.push({ key: e.key, ours: o.text.trim(), theirs: e.text.trim(), kept: win, auto: win !== prefer || !!eb });
      if (win === 'theirs') result[result.indexOf(o)] = e;
      continue;
    }
    result.push(e);
    added++;
  }
  return { lines: result.flatMap((e) => e.lines), decision: 'both', clashes, added, dropped };
}

/** One entry of the text is safe to remove as whole lines when nothing else starts or ends on them. */
function wholeLines(lines, start, end, key) {
  const first = lines[start - 1];
  const last = lines[end - 1];
  if (first === undefined || last === undefined) return false;
  const m = KEY_RE.exec(first);
  if (!m || m[1].replace(/^"|"$/g, '') !== key) return false;
  const tail = last.replace(/\/\*.*?\*\//g, '').trim();
  return tail.endsWith(';') || tail.endsWith(',') || (start === end && /^\s*("?[^\s",]+"?)\s*(\/\*.*?\*\/)?\s*$/.test(first));
}

/**
 * Plans the fix. Returns { ok, error?, blocks, removed, unresolved, finalText, edits: [{ start, end, text, group, label }] }.
 * start/end are 1-based original line numbers (end inclusive); text is the replacement (lines joined with the EOL,
 * with a final EOL, or '' to delete).
 */
function plan(text, opts = {}) {
  const prefer = opts.prefer === 'theirs' ? 'theirs' : 'ours';
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const { lines, eol, finalNewline } = splitText(text);
  const conflicts = X.findConflicts(text);
  const open = conflicts.find((b) => !b.end);
  if (open) return { ok: false, error: `The conflict that starts at line ${open.start} has no closing >>>>>>> line. Fix it by hand first.`, blocks: [], removed: [], unresolved: [], edits: [] };

  // the text after resolving every block: entries keep their original line (orig) or their block
  const entries = [];
  const blocks = [];
  let k = 1;
  conflicts.forEach((b, bi) => {
    for (; k < b.start; k++) entries.push({ text: lines[k - 1], orig: k, block: -1 });
    const ours = lines.slice(b.start, (b.base || b.mid) - 1);
    const baseL = b.base ? lines.slice(b.base, b.mid - 1) : null;
    const theirs = lines.slice(b.mid, b.end - 1);
    const r = resolveBlock(ours, theirs, baseL, prefer);
    for (const t of r.lines) entries.push({ text: t, orig: 0, block: bi });
    blocks.push({ start: b.start, end: b.end, ours: b.ours, theirs: b.theirs, diff3: !!b.base, decision: r.decision, clashes: r.clashes, added: r.added, dropped: r.dropped, oursLines: ours.length, theirsLines: theirs.length, keptLines: r.lines.length });
    k = b.end + 1;
  });
  for (; k <= lines.length; k++) entries.push({ text: lines[k - 1], orig: k, block: -1 });

  const joined = entries.map((e) => e.text);
  const resolvedText = joined.join(eol) + (finalNewline ? eol : '');
  let parsed;
  try { parsed = X.plain(openstep.parse(resolvedText).root); } catch (e) {
    return { ok: false, error: `After resolving the conflicts the file would not read as a property list (${e.message}). Resolve the blocks by hand in the text editor.`, blocks, removed: [], unresolved: [], edits: [] };
  }
  const objects = parsed && parsed.objects && typeof parsed.objects === 'object' ? parsed.objects : null;
  if (!objects) return { ok: false, error: 'This file has no "objects" dictionary, so it is not an Xcode project file.', blocks, removed: [], unresolved: [], edits: [] };
  const idx = scan(resolvedText);
  const removed = []; // { line (1-based in resolved text), end, kind, message }
  const unresolved = [];
  const gone = new Set();
  const drop = (start, end, kind, message) => { for (let l = start; l <= end; l++) gone.add(l); removed.push({ start, end, kind, message }); };
  const name = (id) => X.nameOf(objects, id) || id;

  // 1. objects defined twice
  for (const d of idx.dups) {
    if (!(d.path.length === 1 && d.path[0] === 'objects')) {
      if (d.path[0] === 'objects') unresolved.push({ line: d.lines[1], message: `"${d.key}" is set ${d.lines.length} times in ${name(d.path[1])} (lines ${d.lines.join(', ')}).` });
      continue;
    }
    const recs = idx.all('objects', d.key);
    const textOf = (r) => joined.slice(r.line - 1, r.endLine).join('\n').replace(/\s+/g, ' ').trim();
    const first = textOf(recs[0]);
    for (const r of recs.slice(1)) {
      if (textOf(r) === first && wholeLines(joined, r.line, r.endLine, d.key)) drop(r.line, r.endLine, 'dupObject', `Removed the second copy of ${d.key} (${name(d.key)}).`);
      else unresolved.push({ line: r.line, message: `${d.key} (${name(d.key)}) is defined twice with different content (lines ${recs.map((x) => x.line).join(', ')}). Keep one by hand.` });
    }
  }
  // 2. build file entries whose file or package product is gone
  for (const id of Object.keys(objects)) {
    const o = objects[id];
    if (!o || o.isa !== 'PBXBuildFile') continue;
    const ref = o.fileRef || o.productRef;
    if (ref && objects[ref]) continue;
    const r = idx.all('objects', id).slice(-1)[0];
    if (r && wholeLines(joined, r.line, r.endLine, id)) { drop(r.line, r.endLine, 'deadBuildFile', `Removed the build file entry ${id}: it points to ${ref || 'nothing'}, which is not in the project.`); objects[id] = undefined; } else unresolved.push({ line: r ? r.line : 0, message: `The build file entry ${id} points to ${ref || 'nothing'}, which is not in the project.` });
  }
  // 3. list items that point to missing objects, or repeat an item
  for (const id of Object.keys(objects)) {
    const o = objects[id];
    if (!o || typeof o !== 'object') continue;
    for (const f of X.REF_LIST) {
      if (!Array.isArray(o[f])) continue;
      const items = idx.itemsOf('objects', id, f);
      const seen = new Set();
      for (const it of items) {
        if (typeof it.v !== 'string') continue;
        const missing = !objects[it.v];
        const twice = seen.has(it.v);
        seen.add(it.v);
        if (!missing && !twice) continue;
        if (gone.has(it.line)) continue;
        if (it.line !== it.endLine || !wholeLines(joined, it.line, it.line, it.v)) { unresolved.push({ line: it.line, message: `${it.v} in the ${f} of ${name(id)} ${missing ? 'points to a missing object' : 'is listed twice'}; it shares its line with other text.` }); continue; }
        drop(it.line, it.line, missing ? 'dangling' : 'dupItem', missing ? `Removed ${it.v} from the ${f} of ${name(id)}: no object has that id.` : `Removed the second ${it.v} (${name(it.v)}) from the ${f} of ${name(id)}.`);
      }
    }
  }
  // single references that still point nowhere are reported, not changed
  const after = { ...objects };
  for (const id of Object.keys(after)) if (!after[id]) delete after[id];
  for (const id of Object.keys(after)) {
    const o = after[id];
    for (const f of X.REF_ONE) {
      if (typeof o[f] !== 'string' || !o[f] || after[o[f]]) continue;
      if (f === 'containerPortal' && o[f] === parsed.rootObject) continue;
      if (o.isa === 'PBXBuildFile') continue;
      unresolved.push({ line: idx.lineOf('objects', id, f) || idx.lineOf('objects', id), message: `${name(id)} points to ${o[f]} in ${f}, which is not in the project.` });
    }
  }

  // the final text and the edits on the original lines
  const keep = entries.filter((e, i) => !gone.has(i + 1));
  const finalText = keep.map((e) => e.text).join(eol) + (finalNewline ? eol : '');
  try { openstep.parse(finalText); } catch (e) {
    return { ok: false, error: `The fixed file would not read as a property list (${e.message}). Nothing was changed.`, blocks, removed, unresolved, edits: [] };
  }
  const edits = [];
  blocks.forEach((b, bi) => {
    const kept = entries.filter((e, i) => e.block === bi && !gone.has(i + 1)).map((e) => e.text);
    const what = b.decision === 'side' ? `kept the ${prefer === 'theirs' ? 'incoming' : 'current'} side as a whole (its lines are not whole entries)`
      : `kept both sides${b.added ? `, ${b.added} entr${b.added === 1 ? 'y' : 'ies'} added from the incoming side` : ''}${b.clashes.length ? `, ${b.clashes.length} setting${b.clashes.length === 1 ? '' : 's'} set on both sides: ${b.clashes.map((c) => `${c.key} from the ${c.kept === 'theirs' ? 'incoming' : 'current'} side`).join(', ')}` : ''}${b.dropped ? `, ${b.dropped} deleted entr${b.dropped === 1 ? 'y' : 'ies'} left out` : ''}`;
    edits.push({ start: b.start, end: b.end, text: kept.length ? kept.join(eol) + eol : '', group: 'Merge conflicts', label: `Conflict at line ${b.start}: ${what}` });
  });
  for (const r of removed) {
    const origLines = [];
    for (let l = r.start; l <= r.end; l++) { const e = entries[l - 1]; if (e && e.orig) origLines.push(e.orig); }
    if (!origLines.length) continue; // inside a resolved block: already left out of its replacement
    edits.push({ start: origLines[0], end: origLines[origLines.length - 1], text: '', group: r.kind === 'dangling' || r.kind === 'deadBuildFile' ? 'Broken references' : 'Duplicate entries', label: r.message });
  }
  edits.sort((a, b) => a.start - b.start);
  return { ok: true, prefer, blocks, removed, unresolved, finalText, edits, eol, lineCount: lines.length, finalNewline };
}

/** Applies plan edits to the original text (for tests and as a cross-check of the host's WorkspaceEdit). */
function applyEdits(text, edits) {
  const { lines, eol, finalNewline } = splitText(text);
  const out = [];
  let k = 1;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    for (; k < e.start; k++) out.push(lines[k - 1] + eol);
    if (e.text) out.push(e.text);
    k = e.end + 1;
  }
  for (; k <= lines.length; k++) out.push(lines[k - 1] + (k < lines.length || finalNewline ? eol : ''));
  return out.join('');
}

module.exports = { plan, applyEdits, resolveBlock, entriesOf, splitText };
