'use strict';
// The three Zovo Pro tools: Merge conflict helper, Compare two project versions, Build settings export and compare.
// Each asks pro.allowed() on every click and calls pro.produced() only after its result is there (the fix applied
// after the diff preview and saved, the report or table drawn in its panel, the export file written and opened), so
// Escape, Cancel, Discard in the preview or an error never uses a free try. Everything runs on this computer; files
// are read and written through VS Code's file system API, and the fix is shown as a diff
// and applied through a WorkspaceEdit only after Apply and Save.
const vscode = require('vscode');
const path = require('path');
const G = require('./core/merge');
const D = require('./core/diff');
const S = require('./core/settings');
const { loadFile, PBX_RE, projectPlace } = require('./editor');
const { panelHtml } = require('./html');
const support = require('./support');

const PREFIX = 'xcodeProj';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FILTERS = { 'Xcode project files': ['pbxproj'], 'All files': ['*'] };
const MAX_ROWS = 5000;
const FIX_SCHEME = 'xcodeproj-fix';
const APPLY = 'Apply and Save';
const REMOVED = { dupObject: 'objects defined twice', deadBuildFile: 'build files that point to nothing', dangling: 'references to missing objects', dupItem: 'entries listed twice' };
const label = (uri) => { const p = projectPlace(uri); return p.inBundle ? `${p.name}.xcodeproj` : path.posix.basename(uri.path); };
async function writeText(uri, text) { await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8')); }
const slug = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

function createTools({ context, provider, pro, reach }) {
  const panels = {};
  // read-only documents with the fixed text of the merge helper, shown in its diff preview
  const fixTexts = new Map();
  let fixSeq = 0;
  if (vscode.workspace.registerTextDocumentContentProvider) context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(FIX_SCHEME, { provideTextDocumentContent: (u) => fixTexts.get(u.toString()) || '' }));
  async function closeDiff(fixUri) {
    try {
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.modified && t.input.modified.toString() === fixUri.toString());
      if (tabs.length) await vscode.window.tabGroups.close(tabs);
    } catch (e) { /* no tab API: the preview tab stays until closed */ }
  }

  function openPanel(kind, title) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const old = panels[kind];
    if (old && !old.disposed) old.panel.dispose();
    const panel = vscode.window.createWebviewPanel(`${PREFIX}.${kind}`, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    });
    panel.webview.html = panelHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title, head: reach ? (n) => reach.headHtml(n) : undefined, showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    let readyFn;
    const p = { panel, kind, disposed: false, actions: null, shown: null };
    p.ready = new Promise((r) => { readyFn = r; });
    p.post = (msg) => { try { const r = panel.webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } };
    p.show = async (o) => { await p.ready; p.post({ type: 'show', ...o }); };
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try {
        if (m.type === 'ready') readyFn();
        else if (m.type === 'shown') { if (p.shown) { const f = p.shown; p.shown = null; await f(m); } }
        else if (m.type === 'action' && p.actions) await p.actions(m.id, m);
      } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); }
    });
    panel.onDidDispose(() => { p.disposed = true; if (panels[kind] === p) delete panels[kind]; });
    panels[kind] = p;
    return p;
  }

  /** The file a tool works on: the clicked one, else the viewer tab in front, else the active text editor's
   *  project.pbxproj, else the last viewer used, else a dialog. */
  async function targetFile(arg, title) {
    if (arg && arg.scheme) return arg;
    const front = provider.front();
    if (front) return front.uri;
    const ed = vscode.window.activeTextEditor;
    if (ed && PBX_RE.test(ed.document.uri.path)) return ed.document.uri;
    if (provider.active) return provider.active.uri;
    const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Choose', title, filters: FILTERS });
    return r && r[0];
  }

  /** The loaded project of uri: the viewer's own when it is open, else read now (unsaved text edits included). */
  async function dataFor(uri) {
    for (const d of provider.docs) if (d.uri.toString() === uri.toString() && d.data && d.data.kind === 'pbx') return d.data;
    const data = await loadFile(uri);
    if (data.kind === 'conflict') throw new Error(`${label(uri)} has merge conflict markers. Run the Merge Conflict Helper first.`);
    if (data.kind !== 'pbx') throw new Error(`${label(uri)} could not be read as an Xcode project: ${data.error}`);
    return data;
  }

  async function pickOther(uriA, title) {
    const items = [];
    const seen = new Set([uriA.toString()]);
    for (const d of provider.docs) if (!seen.has(d.uri.toString()) && d.data && d.data.kind === 'pbx') { seen.add(d.uri.toString()); items.push({ label: label(d.uri), description: 'open in the viewer', detail: vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(d.uri) : d.uri.fsPath, uri: d.uri }); }
    let files = [];
    try { files = await vscode.workspace.findFiles('**/*.pbxproj', '**/{node_modules,Pods,Carthage,.build}/**', 300); } catch (e) { files = []; }
    for (const u of files) if (!seen.has(u.toString())) { seen.add(u.toString()); items.push({ label: label(u), description: vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(u) : u.fsPath, uri: u }); }
    items.push({ label: 'Choose a file...', description: 'another project.pbxproj', file: true });
    const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title, placeHolder: 'The project version to compare with (the newer one)', matchOnDescription: true, matchOnDetail: true });
    if (!pick) return undefined;
    if (!pick.file) return pick.uri;
    const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare', title, filters: FILTERS });
    return r && r[0];
  }

  // ---------- 1. Merge conflict helper ----------
  async function merge(arg, extra = {}) {
    if (!(await pro.allowed('merge', arg))) return undefined;
    const uri = await targetFile(arg, 'Merge conflict helper: choose a project.pbxproj');
    if (!uri) return undefined;
    const td = await vscode.workspace.openTextDocument(uri);
    const text = td.getText();
    let p = G.plan(text, { prefer: 'ours' });
    if (!p.ok) { vscode.window.showErrorMessage(`${label(uri)}: ${p.error}`); return undefined; }
    const needsPick = p.blocks.some((b) => b.decision === 'side' || b.clashes.some((c) => !c.auto));
    if (needsPick) {
      let prefer = extra.prefer;
      if (!prefer) {
        const b0 = p.blocks.find((b) => b.decision === 'side' || b.clashes.length) || p.blocks[0];
        const clashes = p.blocks.reduce((s, b) => s + b.clashes.filter((c) => !c.auto).length, 0);
        const sides = p.blocks.filter((b) => b.decision === 'side').length;
        const what = [clashes ? `${clashes} setting${clashes === 1 ? ' is' : 's are'} set on both sides` : '', sides ? `${sides} block${sides === 1 ? '' : 's'} cannot be merged entry by entry` : ''].filter(Boolean).join(' and ');
        const pick = await vscode.window.showQuickPick([
          { label: 'Keep the current side', description: b0 && b0.ours ? `<<<<<<< ${b0.ours}` : 'HEAD, the branch you are on', id: 'ours' },
          { label: 'Keep the incoming side', description: b0 && b0.theirs ? `>>>>>>> ${b0.theirs}` : 'the branch being merged in', id: 'theirs' },
        ], { ignoreFocusOut: true, title: `Merge conflict helper: ${label(uri)}`, placeHolder: `${what}. Which side wins there? New entries from both sides are kept either way.` });
        if (!pick) return undefined;
        prefer = pick.id;
      }
      p = G.plan(text, { prefer });
      if (!p.ok) { vscode.window.showErrorMessage(`${label(uri)}: ${p.error}`); return undefined; }
    }
    if (!p.edits.length) {
      vscode.window.showInformationMessage(`${label(uri)}: nothing to fix. No conflict markers, objects defined twice, repeated list entries or references to missing objects.${p.unresolved.length ? ` ${p.unresolved.length} item${p.unresolved.length === 1 ? '' : 's'} need a look by hand: ${p.unresolved[0].message}` : ''}`);
      return { plan: p, applied: false };
    }
    // The preview: the file and the fixed text side by side in a diff editor, then one question. (A WorkspaceEdit
    // with needsConfirmation would open the Refactor Preview with every change unticked, so Apply there changes nothing.)
    const nb = p.blocks.length, nr = p.removed.length;
    const fixUri = uri.with({ scheme: FIX_SCHEME, query: `fix=${++fixSeq}` });
    fixTexts.set(fixUri.toString(), p.finalText);
    try { await vscode.commands.executeCommand('vscode.diff', uri, fixUri, `${label(uri)}: current file and the fix`, { preview: true }); } catch (e) { /* the question still lists the changes */ }
    const what = [nb ? `${nb} conflict block${nb === 1 ? '' : 's'} resolved` : '', nr ? `${nr} entr${nr === 1 ? 'y' : 'ies'} removed (${[...new Set(p.removed.map((x) => REMOVED[x.kind]).filter(Boolean))].join(', ') || 'repeated or broken entries'})` : ''].filter(Boolean).join(', ');
    const go = await vscode.window.showWarningMessage(`Apply the fix to ${label(uri)} and save it?`, {
      modal: true,
      detail: `${what}. The diff shows every change: the current file on the left, the fixed file on the right.${p.unresolved.length ? ` ${p.unresolved.length} item${p.unresolved.length === 1 ? '' : 's'} cannot be fixed here and stay as they are.` : ''} Nothing is written before you click Apply and Save.`,
    }, APPLY);
    const done = async () => { await closeDiff(fixUri); fixTexts.delete(fixUri.toString()); };
    if (go !== APPLY) { await done(); return { plan: p, applied: false }; }
    const we = new vscode.WorkspaceEdit();
    const last = td.lineCount - 1;
    for (const e of p.edits) {
      const end = e.end >= td.lineCount ? new vscode.Position(last, td.lineAt(last).text.length) : new vscode.Position(e.end, 0);
      we.replace(uri, new vscode.Range(new vscode.Position(e.start - 1, 0), end), e.text);
    }
    const applied = await vscode.workspace.applyEdit(we);
    if (!applied) { await done(); return { plan: p, applied: false }; }
    const after = await vscode.workspace.openTextDocument(uri);
    if (after.getText() === text) { await done(); return { plan: p, applied: false }; }
    await after.save();
    await done();
    const doc = [...provider.docs].find((d) => d.uri.toString() === uri.toString());
    if (doc && doc.refresh) doc.refresh();
    vscode.window.setStatusBarMessage(`Fixed ${label(uri)}: ${nb} conflict${nb === 1 ? '' : 's'} resolved, ${nr} entr${nr === 1 ? 'y' : 'ies'} removed. Saved.`, 6000);
    await pro.produced('merge');
    if (p.unresolved.length) {
      const msg = vscode.window.showWarningMessage(`${label(uri)} is fixed and saved. ${p.unresolved.length} item${p.unresolved.length === 1 ? '' : 's'} need a look by hand: ${p.unresolved[0].message}`, 'Go to Line');
      if (msg && msg.then) msg.then((go) => (go === 'Go to Line' ? provider.revealLine(uri, p.unresolved[0].line) : undefined), () => undefined);
    }
    return { plan: p, applied: true };
  }

  // ---------- 2. Compare two project versions ----------
  async function compare(arg, extra = {}) {
    if (!(await pro.allowed('compare', arg))) return undefined;
    const uriA = await targetFile(arg, 'Compare: choose the older project.pbxproj (A)');
    if (!uriA) return undefined;
    const uriB = extra.other || await pickOther(uriA, `Compare ${label(uriA)} with...`);
    if (!uriB) return undefined;
    if (uriB.toString() === uriA.toString()) { vscode.window.showErrorMessage('Choose another file: a project compared with itself has no changes.'); return undefined; }
    const a = await dataFor(uriA);
    const b = await dataFor(uriB);
    const r = D.diff(a.model, b.model);
    const nameA = vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(uriA) : label(uriA);
    const nameB = vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(uriB) : label(uriB);
    const title = `Compare: ${label(uriA)} and ${label(uriB)}`;
    const p = openPanel('compare', title);
    p.result = r;
    p.shown = async () => { await pro.produced('compare'); };
    p.actions = async (id, m) => {
      if (id === 'md') {
        const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(projectPlace(uriB).dir, `${slug(projectPlace(uriB).name)}-changes.md`), filters: { Markdown: ['md'] }, title: 'Save the comparison as Markdown' });
        if (!dest) return;
        await writeText(dest, D.toMarkdown(r, nameA, nameB));
        p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)}.` });
      } else if (id === 'line' && m && m.line) await provider.revealLine(uriB, m.line);
    };
    const sec = (title2, id, arr, row) => `<h3>${title2} <span class="muted">(${arr.length})</span></h3>${arr.length ? `<ul id="${id}">${arr.slice(0, MAX_ROWS).map((x) => `<li>${row(x)}</li>`).join('')}</ul>` : `<p id="${id}" class="muted">None.</p>`}`;
    const ln = (x, text) => (x.line ? `<a href="#" class="act-line" data-line="${x.line}">${text}</a>` : text);
    const settingsRows = r.settings.slice(0, MAX_ROWS).map((x) => `<tr class="${x.change === 'added' ? 'added' : x.change === 'removed' ? 'removed' : ''}"><td>${esc(x.target)}</td><td>${esc(x.config)}</td><td><code>${ln(x, esc(x.key))}</code></td><td><code>${x.a === null ? '' : esc(x.a)}</code></td><td><code>${x.b === null ? '' : esc(x.b)}</code></td></tr>`).join('');
    const memRows = r.membership.slice(0, MAX_ROWS).map((x) => `<tr class="${x.change}"><td>${esc(x.target)}</td><td>${esc(x.phase)}</td><td>${x.change}</td><td><code>${ln(x, esc(x.path || x.name))}</code></td></tr>`).join('');
    const html = `<p class="row"><button class="tb act" data-id="md">Save as Markdown...</button> <span id="saved" class="muted"></span></p>
<div class="stats"><div><b id="nTotal">${r.total}</b><span>changes</span></div><div><b id="nFilesAdded">${r.filesAdded.length}</b><span>files added</span></div><div><b id="nFilesRemoved">${r.filesRemoved.length}</b><span>files removed</span></div><div><b id="nMembership">${r.membership.length}</b><span>target membership changes</span></div><div><b id="nSettings">${r.settings.length}</b><span>build setting changes</span></div></div>
<p class="muted">A: ${esc(nameA)} (${r.objectsA} objects). B: ${esc(nameB)} (${r.objectsB} objects). Targets are matched by id, then by name; files by id, then by path. Links go to the line in B.</p>
${sec('Targets added', 'targetsAdded', r.targetsAdded, (x) => `${ln(x, esc(x.name))} <span class="muted">${esc(x.type)}</span>`)}
${sec('Targets removed', 'targetsRemoved', r.targetsRemoved, (x) => `${esc(x.name)} <span class="muted">${esc(x.type)}</span>`)}
${r.targetsRenamed.length ? sec('Targets renamed', 'targetsRenamed', r.targetsRenamed, (x) => `${esc(x.from)} to ${ln(x, esc(x.to))}`) : ''}
${sec('Files added', 'filesAdded', r.filesAdded, (x) => `<code>${ln(x, esc(x.path))}</code> <span class="muted">in ${esc(x.group)}</span>`)}
${sec('Files removed', 'filesRemoved', r.filesRemoved, (x) => `<code>${esc(x.path)}</code> <span class="muted">from ${esc(x.group)}</span>`)}
${sec('Files moved to another group', 'filesMoved', r.filesMoved, (x) => `${ln(x, esc(x.name))}: ${esc(x.from)} to ${esc(x.to)}`)}
${r.filesRenamed.length ? sec('Files renamed', 'filesRenamed', r.filesRenamed, (x) => `<code>${esc(x.from)}</code> to <code>${ln(x, esc(x.to))}</code>`) : ''}
<h3>Target membership <span class="muted">(${r.membership.length})</span></h3>${memRows ? `<table id="memTable" class="sort"><thead><tr><th>Target</th><th>Phase</th><th>Change</th><th>File</th></tr></thead><tbody>${memRows}</tbody></table>` : '<p class="muted">None.</p>'}
<h3>Build settings <span class="muted">(${r.settings.length})</span></h3>${settingsRows ? `<table id="setTable" class="sort"><thead><tr><th>Target</th><th>Configuration</th><th>Setting</th><th>A</th><th>B</th></tr></thead><tbody>${settingsRows}</tbody></table>` : '<p class="muted">None.</p>'}
${sec('Swift packages added', 'packagesAdded', r.packagesAdded, (x) => `${ln(x, esc(x.name))} <code>${esc(x.where)}</code> ${esc(x.requirement)}`)}
${sec('Swift packages removed', 'packagesRemoved', r.packagesRemoved, (x) => `${esc(x.name)} <code>${esc(x.where)}</code>`)}
${r.packagesChanged.length ? sec('Swift package versions changed', 'packagesChanged', r.packagesChanged, (x) => `${ln(x, esc(x.name))}: ${esc(x.from)} to ${esc(x.to)}`) : ''}
${sec('Dependencies added', 'depsAdded', r.depsAdded, (x) => `${esc(x.target)} now depends on ${esc(x.name)}`)}
${sec('Dependencies removed', 'depsRemoved', r.depsRemoved, (x) => `${esc(x.target)} no longer depends on ${esc(x.name)}`)}`;
    await p.show({ title, html });
    return r;
  }

  // ---------- 3. Build settings export and compare ----------
  async function buildSettings(arg, extra = {}) {
    if (!(await pro.allowed('settings', arg))) return undefined;
    const uri = await targetFile(arg, 'Build settings: choose a project.pbxproj');
    if (!uri) return undefined;
    const data = await dataFor(uri);
    const m = data.model;
    let action = extra.action;
    if (!action) {
      const pick = await vscode.window.showQuickPick([
        { label: 'Export all build settings as CSV', description: `${m.targets.length} targets, ${m.configNames.length} configurations`, id: 'csv' },
        { label: 'Export all build settings as Markdown', description: 'one table per target and configuration', id: 'md' },
        { label: 'Compare two targets side by side', description: 'every configuration, differences marked', id: 'compare' },
      ], { ignoreFocusOut: true, title: `Build settings: ${label(uri)}`, placeHolder: 'Values with $(inherited) resolved through the project and target levels' });
      if (!pick) return undefined;
      action = pick.id;
    }
    if (action === 'csv' || action === 'md') {
      const rows = S.allRows(m, data.xcconfigs);
      const out = action === 'csv' ? S.toCsv(rows) : S.toMarkdown(rows, label(uri));
      const ext = action === 'csv' ? 'csv' : 'md';
      const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(data.place.dir, `${slug(data.place.name)}-build-settings.${ext}`), filters: action === 'csv' ? { CSV: ['csv'] } : { Markdown: ['md'] }, title: `Save every build setting of ${label(uri)} as ${action === 'csv' ? 'CSV' : 'Markdown'}` });
      if (!dest) return undefined;
      if (dest.toString() === uri.toString()) { vscode.window.showErrorMessage('Choose another file name: the export never writes over the project file.'); return undefined; }
      await writeText(dest, out);
      const td = await vscode.workspace.openTextDocument(dest);
      await vscode.window.showTextDocument(td, { viewColumn: vscode.ViewColumn.Beside, preview: true });
      vscode.window.setStatusBarMessage(`Saved ${path.posix.basename(dest.path)} (${rows.length.toLocaleString('en-US')} settings)`, 4000);
      await pro.produced('settings');
      return { dest, rows: rows.length, format: action };
    }
    if (action !== 'compare') return undefined;
    if (m.targets.length < 2) { vscode.window.showErrorMessage(`${label(uri)} has ${m.targets.length} target${m.targets.length === 1 ? '' : 's'}; the comparison needs two.`); return undefined; }
    let [ida, idb] = extra.targets || [];
    const items = m.targets.map((t) => ({ label: t.name, description: t.typeLabel, id: t.id }));
    if (!ida) { const a = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: 'Compare build settings: first target (A)', placeHolder: 'Target A' }); if (!a) return undefined; ida = a.id; }
    if (!idb) { const b = await vscode.window.showQuickPick(items.filter((x) => x.id !== ida), { ignoreFocusOut: true, title: 'Compare build settings: second target (B)', placeHolder: 'Target B' }); if (!b) return undefined; idb = b.id; }
    const c = S.compareTargets(m, ida, idb, data.xcconfigs);
    const title = `Build settings: ${c.a} and ${c.b}`;
    const p = openPanel('settings', title);
    p.result = c;
    p.shown = async () => { await pro.produced('settings'); };
    p.actions = async (id, msg) => {
      if (id === 'line' && msg && msg.line) { await provider.revealLine(uri, msg.line); return; }
      if (id !== 'csv' && id !== 'md') return;
      const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(data.place.dir, `${slug(c.a)}-vs-${slug(c.b)}-settings.${id}`), filters: id === 'csv' ? { CSV: ['csv'] } : { Markdown: ['md'] }, title: 'Save the comparison' });
      if (!dest) return;
      await writeText(dest, id === 'csv' ? S.compareToCsv(c) : S.compareToMarkdown(c));
      p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)}.` });
    };
    const ln = (line, text) => (line ? `<a href="#" class="act-line" data-line="${line}">${text}</a>` : text);
    const rows = c.rows.slice(0, MAX_ROWS * 4).map((r) => `<tr class="${r.same ? 'same' : r.kind === 'changed' ? 'flag' : r.kind === 'onlyA' ? 'removed' : 'added'}" data-kind="${r.same ? 'same' : 'diff'}"><td>${esc(r.config)}</td><td><code>${esc(r.key)}</code></td><td><code>${r.a === null ? '<span class="muted">not set</span>' : ln(r.lineA, esc(r.a))}</code> <span class="muted">${esc(r.fromA)}</span></td><td><code>${r.b === null ? '<span class="muted">not set</span>' : ln(r.lineB, esc(r.b))}</code> <span class="muted">${esc(r.fromB)}</span></td></tr>`).join('');
    const html = `<p class="row"><button class="tb act" data-id="csv">Save as CSV...</button> <button class="tb act" data-id="md">Save as Markdown...</button> <span id="saved" class="muted"></span></p>
<div class="stats"><div><b id="nDiffer">${c.differ}</b><span>settings differ</span></div><div><b id="nRows">${c.rows.length}</b><span>settings in all</span></div><div><b id="nConfigs">${c.configs.length}</b><span>configurations</span></div></div>
<div class="filters" id="sameFilter"><label><input type="checkbox" id="onlyDiff" checked> Only differences</label></div>
<table id="cmpTable" class="sort"><thead><tr><th>Configuration</th><th>Setting</th><th>${esc(c.a)} (A)</th><th>${esc(c.b)} (B)</th></tr></thead><tbody>${rows}</tbody></table>`;
    await p.show({ title, html });
    return c;
  }

  return { merge, compare, buildSettings, panels, dataFor, targetFile };
}

module.exports = { createTools };
