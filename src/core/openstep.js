'use strict';
// OpenStep (old-style ASCII) property lists: { key = value; } dictionaries, ( a, b ) arrays, "quoted" and bare
// strings, <0fbd 7766> data, // and /* */ comments, and the GNUstep typed values <*I12> <*R1.5> <*BY> <*D...>.
// The format has no numbers, booleans or dates of its own: CoreFoundation reads them as strings. Saving writes strings,
// data, arrays and dictionaries; other types are written as their text (the editor says so before it saves).

const MAX_DEPTH = 512;
const BARE = /[A-Za-z0-9_$+/:.\-]/;

function parse(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let i = 0;
  let line = 1;
  let comments = false;
  const fail = (msg) => { const e = new Error(`Line ${line}: ${msg}`); e.line = line; throw e; };
  function skip() {
    for (;;) {
      const c = text[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { comments = true; while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') {
        comments = true;
        const e = text.indexOf('*/', i + 2);
        if (e < 0) fail('A /* comment is not closed');
        for (let k = i; k < e; k++) if (text[k] === '\n') line++;
        i = e + 2;
        continue;
      }
      return;
    }
  }
  function quoted(q) {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('A quoted string is not closed');
      const c = text[i];
      if (c === q) { i++; return out; }
      if (c === '\n') line++;
      if (c !== '\\') { out += c; i++; continue; }
      const n = text[i + 1];
      i += 2;
      switch (n) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'a': out += '\x07'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case 'U': case 'u': {
          const h = /^[0-9a-fA-F]{1,4}/.exec(text.slice(i, i + 4));
          if (!h) fail('Bad \\U escape');
          out += String.fromCharCode(parseInt(h[0], 16));
          i += h[0].length;
          break;
        }
        default:
          if (n >= '0' && n <= '7') {
            const o = /^[0-7]{1,3}/.exec(text.slice(i - 1, i + 2))[0];
            out += String.fromCharCode(parseInt(o, 8));
            i += o.length - 1;
          } else if (n === undefined) fail('A quoted string is not closed');
          else out += n;
      }
    }
  }
  function bare() {
    const s = i;
    while (i < text.length && BARE.test(text[i])) i++;
    if (i === s) fail(`Unexpected "${text[i]}"`);
    return text.slice(s, i);
  }
  function value(depth) {
    if (depth > MAX_DEPTH) fail('The plist is nested too deeply');
    skip();
    const c = text[i];
    if (c === '{') {
      i++;
      const entries = [];
      const seen = new Map();
      for (;;) {
        skip();
        if (text[i] === '}') { i++; return { t: 'dict', v: entries }; }
        if (i >= text.length) fail('A { dictionary is not closed');
        const k = key();
        skip();
        if (text[i] !== '=') fail(`Expected "=" after the key "${k}"`);
        i++;
        const v = value(depth + 1);
        skip();
        if (text[i] === ';') i++;
        else if (text[i] !== '}') fail(`Expected ";" after the value of "${k}"`);
        if (seen.has(k)) entries[seen.get(k)][1] = v;
        else { seen.set(k, entries.length); entries.push([k, v]); }
      }
    }
    if (c === '(') {
      i++;
      const items = [];
      for (;;) {
        skip();
        if (text[i] === ')') { i++; return { t: 'array', v: items }; }
        if (i >= text.length) fail('A ( array is not closed');
        items.push(value(depth + 1));
        skip();
        if (text[i] === ',') { i++; continue; }
        if (text[i] !== ')') fail('Expected "," or ")" in an array');
      }
    }
    if (c === '<') {
      if (text[i + 1] === '*') return typed();
      const e = text.indexOf('>', i);
      if (e < 0) fail('<data> is not closed');
      const hex = text.slice(i + 1, e).replace(/\s+/g, '');
      if (!/^([0-9a-fA-F]{2})*$/.test(hex)) fail('<data> must be pairs of hex digits');
      i = e + 1;
      return { t: 'data', v: Buffer.from(hex, 'hex').toString('base64') };
    }
    if (c === '"' || c === "'") return { t: 'string', v: quoted(c) };
    if (i >= text.length) fail('A value is missing');
    return { t: 'string', v: bare() };
  }
  function typed() {
    const e = text.indexOf('>', i);
    if (e < 0) fail('<* value is not closed');
    const kind = text[i + 2];
    const body = text.slice(i + 3, e).trim();
    i = e + 1;
    if (kind === 'I') return { t: 'integer', v: BigInt(body).toString() };
    if (kind === 'R') return { t: 'real', v: Number(body) };
    if (kind === 'B') return { t: 'bool', v: body === 'Y' };
    if (kind === 'D') {
      const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/.exec(body);
      const d = new Date(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : body);
      if (Number.isNaN(d.getTime())) fail(`"${body}" is not a date`);
      return { t: 'date', v: d.toISOString().replace('.000Z', 'Z') };
    }
    fail(`Unknown typed value <*${kind}`);
  }
  function key() {
    const c = text[i];
    if (c === '"' || c === "'") return quoted(c);
    return bare();
  }

  skip();
  let root;
  let stringsFile = false;
  if (text[i] === '{' || text[i] === '(' || text[i] === '<' || i >= text.length) {
    root = i >= text.length ? { t: 'dict', v: [] } : value(0);
  } else {
    // a .strings-style file: "key" = "value"; pairs with no outer braces
    const save = i;
    const k = key();
    skip();
    if (text[i] === '=' || text[i] === ';') {
      i = save;
      stringsFile = true;
      const entries = [];
      const seen = new Map();
      while (skip(), i < text.length) {
        const kk = key();
        skip();
        let v = { t: 'string', v: kk };
        if (text[i] === '=') { i++; v = value(1); skip(); }
        if (text[i] !== ';') fail(`Expected ";" after "${kk}"`);
        i++;
        if (seen.has(kk)) entries[seen.get(kk)][1] = v;
        else { seen.set(kk, entries.length); entries.push([kk, v]); }
      }
      root = { t: 'dict', v: entries };
    } else {
      root = { t: 'string', v: k };
    }
  }
  skip();
  if (i < text.length) fail('Text after the end of the plist');
  return { root, style: { stringsFile, comments, eol: /\r\n/.test(text) ? '\r\n' : '\n' } };
}

function quote(s) {
  if (s.length && /^[A-Za-z0-9_$/:.\-]+$/.test(s)) return s; // CoreFoundation reads "+" only inside quotes
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

/** Types the format cannot hold, with their key paths (for the warning before saving). */
function lossy(root) {
  const out = [];
  (function walk(n, p) {
    if (n.t === 'dict') n.v.forEach(([k, c]) => walk(c, p ? `${p}.${k}` : k));
    else if (n.t === 'array') n.v.forEach((c, i) => walk(c, `${p}[${i}]`));
    else if (!['string', 'data'].includes(n.t)) out.push(p || 'Root');
  })(root, '');
  return out;
}

function scalar(n) {
  switch (n.t) {
    case 'string': return quote(n.v);
    case 'data': return '<' + Buffer.from(n.v, 'base64').toString('hex').replace(/(.{8})(?=.)/g, '$1 ') + '>';
    case 'bool': return n.v ? 'YES' : 'NO';
    case 'date': return quote(n.v);
    case 'real': return quote(String(n.v));
    default: return quote(String(n.v));
  }
}

function write(root, style = {}) {
  const eol = style.eol || '\n';
  const ind = '\t';
  function emit(n, depth) {
    const pad = ind.repeat(depth);
    if (n.t === 'dict') {
      if (!n.v.length) return '{ }';
      return '{' + eol + n.v.map(([k, c]) => pad + ind + quote(k) + ' = ' + emit(c, depth + 1) + ';').join(eol) + eol + pad + '}';
    }
    if (n.t === 'array') {
      if (!n.v.length) return '( )';
      return '(' + eol + n.v.map((c) => pad + ind + emit(c, depth + 1)).join(',' + eol) + eol + pad + ')';
    }
    return scalar(n);
  }
  if (style.stringsFile && root.t === 'dict') return root.v.map(([k, c]) => quote(k) + ' = ' + emit(c, 0) + ';').join(eol) + eol;
  return emit(root, 0) + eol;
}

module.exports = { parse, write, lossy, quote };
