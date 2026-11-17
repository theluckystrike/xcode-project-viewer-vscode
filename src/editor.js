'use strict';
// Read-only custom editor xcodeProj.viewer for project.pbxproj, registered with priority "option": the text editor
// stays the default (many people open the file only to fix a merge), and the viewer opens from the editor title
// button, the Explorer menu, the Command Palette or Open With. The extension host reads the file through VS Code's
// file system API (Remote SSH, WSL and containers work the same), builds the project model with src/core and hands
// it to the webview. The webview has no network access (CSP default-src 'none').
// A file with merge conflict markers, a file that is not a project, or a parse error gets a plain note with buttons:
// no error popup, and the viewer never reopens a tab by itself.
const vscode = require('vscode');
const path = require('path');
const X = require('./core/pbx');
const C = require('./core/check');
const S = require('./core/settings');
const { editorHtml } = require('./html');
const support = require('./support');

const VIEW = 'xcodeProj.viewer';
const PREFIX = 'xcodeProj';
const MAX_BYTES = 64 * 1024 * 1024;
const PBX_RE = /\.pbxproj$/i;
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const sizeText = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Where the project lives: { name, dir (Uri of the folder that holds the .xcodeproj), inBundle }. */
function projectPlace(uri) {
  const parent = path.posix.dirname(uri.path);
  const bundle = path.posix.basename(parent);
  if (/\.xcodeproj$/i.test(bundle)) return { name: bundle.replace(/\.xcodeproj$/i, ''), dir: uri.with({ path: path.posix.dirname(parent) }), inBundle: true };
  return { name: path.posix.basename(uri.path).replace(/\.pbxproj$/i, ''), dir: uri.with({ path: parent }), inBundle: false };
}
function srcRootUri(place, m) {
  return m.srcRoot ? vscode.Uri.joinPath(place.dir, m.srcRoot) : place.dir;
}
function entryUri(root, e) {
  if (e.abs) return root.with({ path: e.abs });
  return e.rel ? vscode.Uri.joinPath(root, e.rel) : root;
}

async function readText(uri) {
  const open = (vscode.workspace.textDocuments || []).find((t) => t.uri.toString() === uri.toString());
  if (open && open.isDirty) return { text: open.getText(), dirty: true };
  try { const st = await vscode.workspace.fs.stat(uri); if (st && st.size > MAX_BYTES) throw new Error(`This file is ${sizeText(st.size)}, more than the 64 MB the viewer reads.`); } catch (e) { if (/64 MB/.test(String(e && e.message))) throw e; }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { text: Buffer.from(bytes).toString('utf8'), dirty: false, size: bytes.byteLength };
}

/** Reads .xcconfig files that build configurations are based on (and the files they #include). */
async function readXcconfigs(m, root) {
  const out = new Map();
  const cache = new Map();
  async function readOne(u, depth) {
    const key = u.toString();
    if (cache.has(key)) return cache.get(key);
    let r = null;
    try {
      const t = Buffer.from(await vscode.workspace.fs.readFile(u)).toString('utf8');
      const p = S.parseXcconfig(t);
      const settings = {};
      if (depth < 5) for (const inc of p.includes) { const sub = await readOne(vscode.Uri.joinPath(u, '..', inc), depth + 1); if (sub) Object.assign(settings, sub.settings); }
      // a later assignment's $(inherited) takes the value from the included files (as Xcode reads xcconfig files)
      for (const [k, v] of Object.entries(p.settings)) settings[k] = k in settings ? S.inherit(v, settings[k]) : v;
      r = { settings, path: u.path };
    } catch (e) { r = null; }
    cache.set(key, r);
    return r;
  }
  const configs = [].concat(m.projectConfigs.configs, ...m.targets.map((t) => t.configList.configs));
  for (const c of configs) {
    if (!c.basePath || /^\$\(/.test(c.basePath)) continue;
    const u = c.basePath.startsWith('/') ? root.with({ path: c.basePath }) : vscode.Uri.joinPath(root, c.basePath);
    const r = await readOne(u, 0);
    if (r) out.set(c.id, r);
  }
  return out;
}

/** Reads and parses a project file. Shared by the viewer and the Pro tools. text overrides the file (unsaved edits). */
async function loadFile(uri, text) {
  const name = path.posix.basename(uri.path);
  const place = projectPlace(uri);
  const out = { uri, name, place, size: 0, kind: 'error', model: null, error: '' };
  try {
    if (typeof text !== 'string') { const r = await readText(uri); text = r.text; out.dirty = r.dirty; }
  } catch (e) { out.error = String((e && e.message) || e); return out; }
  out.size = Buffer.byteLength(text, 'utf8');
  out.text = text;
  if (!text.trim()) { out.kind = 'empty'; out.error = 'This file is empty.'; return out; }
  if (/\u0000/.test(text.slice(0, 4096))) { out.kind = 'notproj'; out.error = 'This file holds binary data, not the text of an Xcode project.'; return out; }
  try {
    out.model = X.load(text, { projectName: place.name });
  } catch (e) {
    out.error = String((e && e.message) || e);
    if (e instanceof X.ConflictError) { out.kind = 'conflict'; out.conflicts = e.blocks; } else if (e instanceof X.NotProjectError) out.kind = 'notproj';
    else { out.kind = 'error'; out.errorLine = e && e.line ? e.line : 0; }
    return out;
  }
  out.kind = 'pbx';
  out.root = srcRootUri(place, out.model);
  out.warnings = C.check(out.model);
  out.xcconfigs = place.inBundle ? await readXcconfigs(out.model, out.root).catch(() => new Map()) : new Map();
  return out;
}

/** Looks for the files and folders of the project on disk. Returns { checked, missing: [{ id, name, path, line }] }. */
async function diskCheck(data, limit = 20000) {
  const m = data.model;
  if (!data.place.inBundle) return { checked: 0, skipped: true, missing: [] };
  const list = C.diskEntries(m).slice(0, limit);
  const missing = [];
  for (let i = 0; i < list.length; i += 64) {
    await Promise.all(list.slice(i, i + 64).map(async (e) => {
      const u = entryUri(data.root, e);
      try { await vscode.workspace.fs.stat(u); } catch (err) { missing.push({ id: e.id, name: e.name, path: e.rel || e.abs, line: e.line, group: e.group }); }
    }));
  }
  missing.sort((a, b) => a.line - b.line);
  return { checked: list.length, skipped: false, missing };
}

function viewModel(data) {
  const m = data.model;
  const slimTarget = (t) => ({
    id: t.id, name: t.name, typeLabel: t.typeLabel, productType: t.productType, productName: t.productName, product: t.product, line: t.line, isa: t.isa, buildTool: t.buildTool,
    phases: t.phases, deps: t.deps, packages: t.packages, sync: t.sync,
    configs: t.configList.configs.map((c) => ({ id: c.id, name: c.name, line: c.line, basePath: c.basePath, count: c.count })), defaultConfig: t.configList.defaultName,
  });
  const strip = (n) => (n ? { id: n.id, name: n.name, kind: n.kind, line: n.line, full: n.full, base: n.base, fileType: n.fileType, targets: n.targets, missingObject: !!n.missingObject, children: (n.children || []).map(strip) } : null);
  return {
    facts: m.facts, objectVersion: m.objectVersion, objectCount: m.objectCount, fileCount: m.fileCount, groupCount: m.groupCount,
    projectName: data.place.name, inBundle: data.place.inBundle,
    targets: m.targets.map(slimTarget), tree: strip(m.tree), packages: m.packages,
    projectConfigs: m.projectConfigs.configs.map((c) => ({ id: c.id, name: c.name, line: c.line, basePath: c.basePath, count: c.count })),
    configNames: m.configNames, defaultConfig: m.projectConfigs.defaultName,
    warnings: data.warnings, xcconfigs: [...data.xcconfigs.values()].map((x) => x.path),
  };
}

class PbxDocument {
  constructor(uri) { this.uri = uri; this.panels = new Set(); this.listeners = []; this.data = null; this.disk = null; this.rendered = null; this.gen = 0; }
  get name() { return path.posix.basename(this.uri.path); }
  async load(text) {
    this.gen++;
    try { this.data = await loadFile(this.uri, text); } catch (e) { this.data = { kind: 'error', error: String((e && e.message) || e), name: this.name }; }
    this.disk = null;
    this.rendered = null;
  }
  dispose() { for (const l of this.listeners) { try { l.dispose(); } catch (e) { /* gone */ } } }
}

class PbxEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
    this._success = new WeakSet();
  }
  dispose() { for (const d of this.docs) d.dispose(); this.docs.clear(); }

  async openCustomDocument(uri) {
    const doc = new PbxDocument(uri);
    await doc.load();
    this.docs.add(doc);
    let timer = null;
    const refresh = (text) => { clearTimeout(timer); timer = setTimeout(async () => { await doc.load(text); for (const p of doc.panels) this.init(doc, p.webview); if (this.hooks.onChange) this.hooks.onChange(doc); }, 400); };
    doc.refresh = refresh;
    try {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.posix.basename(uri.path)));
      doc.listeners.push(w, w.onDidChange(() => refresh()), w.onDidCreate(() => refresh()));
    } catch (e) { /* no watcher: the view still works */ }
    if (vscode.workspace.onDidChangeTextDocument) {
      doc.listeners.push(vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.uri.toString() === uri.toString() && e.contentChanges && e.contentChanges.length) refresh(e.document.getText()); }));
    }
    if (vscode.workspace.onDidSaveTextDocument) doc.listeners.push(vscode.workspace.onDidSaveTextDocument((d) => { if (d.uri.toString() === uri.toString()) refresh(); }));
    return { uri, dispose: () => { this.docs.delete(doc); doc.dispose(); if (this.active === doc) this.active = null; }, _doc: doc };
  }

  async resolveCustomEditor(handle, panel) {
    const doc = handle._doc;
    doc.panels.add(panel);
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true, localResourceRoots: [media],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; if (this.hooks.onActive) this.hooks.onActive(doc); } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => { doc.panels.delete(panel); if (this.activePanel === panel) { this.activePanel = null; if (this.active === doc) this.active = null; if (this.hooks.onActive) this.hooks.onActive(null); } });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try { await this.onMessage(doc, panel, m); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); }
    });
  }

  send(webview, msg) { try { const r = webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } }

  init(doc, webview) {
    const d = doc.data || { kind: 'error', error: 'The file could not be read.' };
    const base = { type: 'init', name: doc.name, kind: d.kind, sizeText: sizeText(d.size || 0), settings: { showPro: setting('showProTools', true) !== false } };
    if (d.kind !== 'pbx') {
      this.send(webview, { ...base, error: d.error || 'The file could not be read.', errorLine: d.errorLine || 0, conflicts: (d.conflicts || []).map((b) => ({ start: b.start, end: b.end, ours: b.ours, theirs: b.theirs, lines: b.end ? b.end - b.start + 1 : 0 })), canOpenText: true });
      if (d.kind === 'error' && this.hooks.onFailure) this.hooks.onFailure(doc);
      return;
    }
    this.send(webview, { ...base, model: viewModel(d) });
    this.startDisk(doc);
  }

  /** The on-disk check runs once per load; every panel of the document gets the result. */
  startDisk(doc) {
    const d = doc.data;
    if (!d || d.kind !== 'pbx') return;
    const gen = doc.gen;
    const post = () => { for (const p of doc.panels) this.send(p.webview, { type: 'disk', ...doc.disk }); };
    if (doc.disk && doc.disk.done) { post(); return; }
    if (doc.diskRun && doc.diskRun.gen === gen) return;
    const run = { gen };
    doc.diskRun = run;
    run.promise = diskCheck(d).then((r) => { if (doc.gen !== gen) return; doc.disk = { ...r, done: true }; post(); }, () => { if (doc.gen === gen) { doc.disk = { checked: 0, missing: [], skipped: true, done: true }; post(); } });
  }

  /** The panel showing uri (the active one first), or null. */
  panelFor(uri) {
    const key = uri.toString();
    if (this.active && this.active.uri.toString() === key && this.activePanel) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.uri.toString() === key) for (const p of d.panels) return { doc: d, panel: p };
    return null;
  }

  /** The viewer tab in front (its document), or null when the front tab is something else. */
  front() {
    if (this.activePanel && this.activePanel.active && this.active) return this.active;
    for (const d of this.docs) for (const p of d.panels) if (p.active) return d;
    return null;
  }

  async revealLine(uri, line) {
    const l = Math.max(0, (Number(line) || 1) - 1);
    const range = new vscode.Range(l, 0, l, 0);
    const td = await vscode.workspace.openTextDocument(uri);
    const ed = await vscode.window.showTextDocument(td, { viewColumn: vscode.ViewColumn.Beside, selection: range, preview: true, preserveFocus: false });
    try { if (ed && ed.revealRange) ed.revealRange(range, vscode.TextEditorRevealType ? vscode.TextEditorRevealType.InCenter : undefined); } catch (e) { /* optional */ }
    return ed;
  }

  async onMessage(doc, panel, m) {
    const w = panel.webview;
    switch (m.type) {
      case 'ready': this.init(doc, w); return;
      case 'rendered':
        doc.rendered = { targets: Number(m.targets) || 0, files: Number(m.files) || 0, at: Date.now() };
        if (!this._success.has(doc) && doc.data && doc.data.kind === 'pbx') { this._success.add(doc); if (this.hooks.onSuccess) this.hooks.onSuccess(doc); }
        return;
      case 'settings': {
        const d = doc.data;
        if (!d || d.kind !== 'pbx') return;
        const r = S.resolveSettings(d.model, m.target || null, String(m.config || ''), d.xcconfigs);
        this.send(w, { type: 'settings', req: m.req, target: m.target || '', config: m.config, ...r });
        return;
      }
      case 'openText': case 'openRaw': await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default'); return;
      case 'reveal': await this.revealLine(doc.uri, m.line); return;
      case 'tool': if (this.hooks.runTool) await this.hooks.runTool(String(m.tool || ''), doc.uri); return;
      case 'copy': if (typeof m.text === 'string') { await vscode.env.clipboard.writeText(m.text.slice(0, 100000)); vscode.window.setStatusBarMessage(`Copied ${m.what || 'the text'}`, 3000); } return;
      default:
    }
  }
}

module.exports = { PbxEditorProvider, PbxDocument, loadFile, diskCheck, projectPlace, viewModel, VIEW, PBX_RE, sizeText };
