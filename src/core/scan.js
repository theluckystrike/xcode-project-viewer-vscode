'use strict';
// Line index of an OpenStep (old-style) property list such as project.pbxproj. src/core/openstep.js (copied unchanged
// from the Plist Viewer & Editor listing) reads the values; this scanner only records where things are: the line of
// every dictionary key (and the line where its value ends), the line of every array item, and keys written twice in
// the same dictionary (the parser keeps the last one, a merge can leave both). It is lenient: it never throws, so it
// also runs on text the parser refuses.

const SEP = '\u0000';
const BARE = /[^\s;,=(){}<>"'/]/;

function scan(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  let i = 0;
  let line = 1;
  const entries = new Map(); // path -> [{ line, endLine, value? }]
  const items = new Map(); // array path -> [{ v, line }]
  const dups = []; // { path: [..], key, lines: [..] }

  function skip() {
    for (;;) {
      const c = text[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2);
        const end = e < 0 ? n : e + 2;
        for (let k = i; k < end; k++) if (text[k] === '\n') line++;
        i = end;
        continue;
      }
      return;
    }
  }
  function str() {
    const q = text[i];
    if (q === '"' || q === "'") {
      i++;
      let out = '';
      while (i < n && text[i] !== q) {
        if (text[i] === '\n') line++;
        if (text[i] === '\\' && i + 1 < n) { out += text[i + 1]; if (text[i + 1] === '\n') line++; i += 2; continue; }
        out += text[i++];
      }
      i++;
      return out;
    }
    const s = i;
    while (i < n && BARE.test(text[i])) i++;
    if (i === s) { if (text[i] === '\n') line++; i++; return null; }
    return text.slice(s, i);
  }
  function value(path, depth) {
    skip();
    const c = text[i];
    if (depth > 256) { i = n; return null; }
    if (c === '{') { dict(path, depth + 1); return undefined; }
    if (c === '(') { array(path, depth + 1); return undefined; }
    if (c === '<') {
      const e = text.indexOf('>', i);
      const end = e < 0 ? n : e + 1;
      for (let k = i; k < end; k++) if (text[k] === '\n') line++;
      i = end;
      return null;
    }
    if (i >= n) return null;
    return str();
  }
  function dict(path, depth) {
    i++;
    for (;;) {
      skip();
      if (i >= n) return;
      if (text[i] === '}') { i++; return; }
      if (text[i] === ';' || text[i] === ',' || text[i] === ')') { i++; continue; }
      const kl = line;
      const k = str();
      if (k === null) continue;
      skip();
      if (text[i] !== '=') continue;
      i++;
      const p = path.concat(k);
      const v = value(p, depth);
      skip();
      if (text[i] === ';') i++;
      const rec = { line: kl, endLine: line };
      if (typeof v === 'string') rec.value = v;
      const key = p.join(SEP);
      if (!entries.has(key)) entries.set(key, []);
      entries.get(key).push(rec);
    }
  }
  function array(path, depth) {
    i++;
    const list = [];
    const key = path.join(SEP);
    for (;;) {
      skip();
      if (i >= n) break;
      if (text[i] === ')') { i++; break; }
      if (text[i] === ',' || text[i] === ';' || text[i] === '}') { i++; continue; }
      const l = line;
      const v = value(path.concat('[]'), depth);
      if (v === null && text[i - 1] !== '>') continue;
      list.push({ v: typeof v === 'string' ? v : null, line: l, endLine: line });
      skip();
      if (text[i] === ',') i++;
    }
    if (!items.has(key)) items.set(key, list); else items.get(key).push(...list);
  }

  skip();
  if (text[i] === '{') dict([], 0);
  // duplicate keys: the same path recorded more than once (each path is unique to one dictionary in a pbxproj,
  // except below arrays, where "[]" joins the items of one array)
  const twice = new Set();
  for (const [k, recs] of entries) if (recs.length > 1 && !k.includes(`${SEP}[]${SEP}`)) twice.add(k);
  for (const k of twice) {
    const p = k.split(SEP);
    let inner = false; // a key inside an object that is itself written twice is not a duplicate of its own
    for (let j = 1; j < p.length && !inner; j++) if (twice.has(p.slice(0, j).join(SEP))) inner = true;
    if (inner) continue;
    dups.push({ path: p.slice(0, -1), key: p[p.length - 1], lines: entries.get(k).map((r) => r.line) });
  }
  return {
    entries, items, dups, lineCount: line,
    /** Line of a key (path given as parts), or 0. The first one when the key is there twice. */
    lineOf(...parts) { const r = entries.get(parts.join(SEP)); return r ? r[0].line : 0; },
    rangeOf(...parts) { const r = entries.get(parts.join(SEP)); return r ? r[0] : null; },
    all(...parts) { return entries.get(parts.join(SEP)) || []; },
    itemsOf(...parts) { return items.get(parts.join(SEP)) || []; },
  };
}

module.exports = { scan, SEP };
