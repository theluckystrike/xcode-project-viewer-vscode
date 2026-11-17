'use strict';
// Extension tests with the vscode stub: listing, activation, the viewer's messages for the sample, real projects,
// merge conflicts and broken files, the disk check, build settings requests, and the three Pro tools with 1 free try
// each (the 2nd use opens the Pro panel, also on another file, from the viewer in front, and after a reload),
// README and support links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { editorHtml, panelHtml } = require('../src/html');
const X = require('../src/core/pbx');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await tick(10); } return f(); };
test.after(() => cleanup());

function fakePanel() {
  let onMsg;
  const posted = [];
  const p = {
    posted, viewColumn: 1, active: true,
    webview: { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage: async (m) => { posted.push(m); return true; }, onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; } },
    onDidChangeViewState: (f) => { p.viewState = f; return { dispose() {} }; }, onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
  return p;
}

const activated = [];
/** Activates with a fresh stub. state: entries to put into globalState first (a "reload" of the window). */
function activate(folder, state) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  activated.push(s);
  s.log.onPost = (panel, m) => { if (m.type === 'show' && m.html) panel.send({ type: 'shown' }); };
  s.opened = [];
  s.commands.set('vscode.openWith', async (uri, viewType) => {
    s.opened.push([uri.fsPath, viewType]);
    if (viewType !== 'xcodeProj.viewer') return undefined;
    const e = await openEditor(s, uri.fsPath);
    return e;
  });
  return s;
}
test.after(() => { for (const s of activated) s.api.provider.dispose(); });

async function openEditor(s, file) {
  const prov = s.api.provider;
  const handle = await prov.openCustomDocument(s.vscode.Uri.file(file));
  const panel = fakePanel();
  for (const d of prov.docs) for (const p of d.panels) p.active = false;
  await prov.resolveCustomEditor(handle, panel);
  await panel.send({ type: 'ready' });
  const init = panel.posted.find((m) => m.type === 'init');
  if (init && init.kind === 'pbx') await panel.send({ type: 'rendered', targets: init.model.targets.length, files: init.model.fileCount });
  return { prov, handle, panel, doc: handle._doc, init };
}
/** A workspace with the sample project (and its sources), a copy of it as project B, real fixtures and broken files. */
function ws() {
  const dir = tmpDir('xc-ws-');
  fs.cpSync(SAMPLES, path.join(dir, 'demo'), { recursive: true });
  fs.cpSync(SAMPLES, path.join(dir, 'demo-b'), { recursive: true });
  const b = path.join(dir, 'demo-b', 'ZovoDemo.xcodeproj', 'project.pbxproj');
  fs.writeFileSync(b, fs.readFileSync(b, 'utf8').replace(/MARKETING_VERSION = 1\.4\.0;/g, 'MARKETING_VERSION = 1.5.0;'));
  for (const f of ['kingfisher', 'netnewswire']) { fs.mkdirSync(path.join(dir, f, `${f}.xcodeproj`), { recursive: true }); fs.copyFileSync(path.join(FIX, `${f}.pbxproj`), path.join(dir, f, `${f}.xcodeproj`, 'project.pbxproj')); }
  fs.mkdirSync(path.join(dir, 'merge', 'Kingfisher.xcodeproj'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'kf-merge-e542.conflict.pbxproj'), path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj'));
  fs.mkdirSync(path.join(dir, 'merge2', 'Kingfisher.xcodeproj'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'kf-merge-3a46.conflict.pbxproj'), path.join(dir, 'merge2', 'Kingfisher.xcodeproj', 'project.pbxproj'));
  fs.mkdirSync(path.join(dir, 'odd'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'odd', 'notproject.pbxproj'), '{ CFBundleName = Demo; }\n');
  fs.writeFileSync(path.join(dir, 'odd', 'broken.pbxproj'), '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tobjects = {\n\t\tA = {isa = PBXProject\n');
  fs.writeFileSync(path.join(dir, 'odd', 'empty.pbxproj'), '');
  fs.copyFileSync(path.join(FIX, 'kingfisher.pbxproj'), path.join(dir, 'odd', 'LOOSE.PBXPROJ'));
  return dir;
}
const SAMPLE_REL = path.join('demo', 'ZovoDemo.xcodeproj', 'project.pbxproj');
const proPanels = (s, title) => s.log.info.filter((m) => m.text === `${title} is part of Zovo Pro.`);

// ---------- package.json and listing ----------
test('listing: display name with the phrase first, 30 characters or less, description starts with the phrase, 5 keywords, engines', () => {
  assert.equal(pkg.displayName, 'Xcode Project Viewer (pbxproj)');
  assert.ok(pkg.displayName.length <= 30);
  assert.match(pkg.description, /^Xcode project viewer/);
  assert.deepEqual(pkg.keywords, ['xcode', 'pbxproj', 'ios', 'swift', 'xcodeproj']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(pkg.publisher, 'zovo');
  assert.equal(pkg.name, 'zovo-xcode-project-viewer');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/xcode-project-viewer-vscode');
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.ok(fs.existsSync(path.join(ROOT, 'icon.png')));
});
test('editor: *.pbxproj only as an option (the text editor stays the default); no language, grammar or theme; editor title button', () => {
  assert.deepEqual(pkg.contributes.customEditors.map((e) => [e.viewType, e.selector.map((x) => x.filenamePattern), e.priority]), [['xcodeProj.viewer', ['*.pbxproj'], 'option']]);
  assert.ok(!pkg.contributes.themes && !pkg.contributes.grammars && !pkg.contributes.languages && !pkg.contributes.configurationDefaults);
  const btn = pkg.contributes.menus['editor/title'].find((m) => m.command === 'xcodeProj.openWithViewer');
  assert.equal(btn.group, 'navigation@9');
  assert.match(btn.when, /activeEditor == workbench\.editors\.files\.textFileEditor/);
});
test('menus: one backslash before the dots in the final package.json; the right-click regex matches upper case files and .xcodeproj folders; no title on menu items', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(!raw.includes('\\\\\\\\.'));
  const items = Object.values(pkg.contributes.menus).flat();
  assert.ok(items.every((m) => !('title' in m)));
  const ctx = pkg.contributes.menus['explorer/context'].find((m) => m.command === 'xcodeProj.zovoPro.merge');
  const [fileRe, dirRe] = [...ctx.when.matchAll(/resourceFilename =~ \/(.*?)\/i/g)].map((m) => new RegExp(m[1], 'i'));
  for (const f of ['project.pbxproj', 'PROJECT.PBXPROJ', 'LOOSE.PBXPROJ']) assert.ok(fileRe.test(f), f);
  assert.ok(!fileRe.test('project.pbxproj.orig') && !fileRe.test('a.plist'));
  assert.ok(dirRe.test('ZovoDemo.xcodeproj') && dirRe.test('APP.XCODEPROJ'));
  assert.match(ctx.when, /!explorerResourceIsFolder/);
  const wrappers = pkg.contributes.commands.filter((c) => /\.zovoPro\./.test(c.command));
  assert.equal(wrappers.length, 3);
  assert.ok(wrappers.every((c) => c.title.startsWith('Zovo Pro: ')));
  for (const w of wrappers) assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === w.command && m.when === 'false'));
});
test('every contributed command is registered, and every registered xcodeProj command is contributed', () => {
  const s = activate();
  const contributed = pkg.contributes.commands.map((c) => c.command);
  for (const c of contributed) assert.ok(s.commands.has(c), c);
  for (const c of s.commands.keys()) if (c.startsWith('xcodeProj.')) assert.ok(contributed.includes(c), c);
});
test('activation shows nothing: no message, no panel, no editor', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.opened.length, 0);
});

// ---------- the viewer ----------
test('viewer: the sample sends targets, files, packages and facts; the disk check finds the one missing file; rating success once', async () => {
  const dir = ws();
  const s = activate(dir);
  const { init, doc, panel } = await openEditor(s, path.join(dir, SAMPLE_REL));
  assert.equal(init.kind, 'pbx');
  const m = init.model;
  assert.equal(m.projectName, 'ZovoDemo');
  assert.deepEqual(m.targets.map((t) => t.name), ['ZovoDemo', 'ZovoDemoWidget', 'ZovoDemoTests']);
  assert.equal(m.packages[0].name, 'swift-collections');
  assert.deepEqual(m.xcconfigs.map((p) => path.basename(p)), ['Base.xcconfig', 'Release.xcconfig']);
  assert.ok(m.facts.some((f) => f.k === 'Object version' && f.v === '60'));
  const disk = await until(() => panel.posted.find((x) => x.type === 'disk'));
  assert.equal(disk.skipped, false);
  assert.ok(disk.checked >= 15);
  assert.deepEqual(disk.missing.map((x) => x.path), ['ZovoDemo/OldHelper.swift']);
  assert.ok(disk.missing[0].line > 0);
  assert.ok(doc.rendered);
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
});
test('viewer: build settings for a target and configuration, with the xcconfig level and lines', async () => {
  const dir = ws();
  const s = activate(dir);
  const { init, panel } = await openEditor(s, path.join(dir, SAMPLE_REL));
  const app = init.model.targets[0];
  await panel.send({ type: 'settings', req: 7, target: app.id, config: 'Release' });
  const r = panel.posted.find((x) => x.type === 'settings' && x.req === 7);
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row('SWIFT_OPTIMIZATION_LEVEL').value, '-O');
  assert.equal(row('SWIFT_OPTIMIZATION_LEVEL').fromLabel, 'Project .xcconfig');
  assert.equal(row('OTHER_SWIFT_FLAGS').value, '-warn-concurrency -enforce-exclusivity=checked');
  assert.equal(row('PRODUCT_BUNDLE_IDENTIFIER').from, 'target');
  assert.ok(row('PRODUCT_BUNDLE_IDENTIFIER').line > 0);
  await panel.send({ type: 'settings', req: 8, target: '', config: 'Debug' });
  assert.ok(panel.posted.find((x) => x.req === 8).rows.every((x) => /^project/.test(x.from)));
});
test('viewer: a click on a row opens its line in the text beside the viewer; Open as Text uses the default editor', async () => {
  const dir = ws();
  const s = activate(dir);
  const { panel } = await openEditor(s, path.join(dir, SAMPLE_REL));
  await panel.send({ type: 'reveal', line: 42 });
  const shown = s.log.shown || s.log.opened;
  assert.ok(shown.length >= 1);
  await panel.send({ type: 'openText' });
  assert.deepEqual(s.opened.slice(-1)[0], [path.join(dir, SAMPLE_REL), 'default']);
});
test('viewer: a merge conflict, a plist that is not a project, a syntax error and an empty file give plain notes, no error message', async () => {
  const dir = ws();
  const s = activate(dir);
  const c = (await openEditor(s, path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj'))).init;
  assert.equal(c.kind, 'conflict');
  assert.deepEqual(c.conflicts.map((b) => [b.start, b.end]), [[12, 16], [156, 160], [448, 452]]);
  assert.equal(c.conflicts[0].ours, 'ours.tmp');
  const n = (await openEditor(s, path.join(dir, 'odd', 'notproject.pbxproj'))).init;
  assert.equal(n.kind, 'notproj');
  const b = (await openEditor(s, path.join(dir, 'odd', 'broken.pbxproj'))).init;
  assert.equal(b.kind, 'error');
  assert.match(b.error, /Line \d+/);
  assert.ok(b.errorLine > 0);
  const e = (await openEditor(s, path.join(dir, 'odd', 'empty.pbxproj'))).init;
  assert.equal(e.kind, 'empty');
  assert.equal(s.log.error.length + s.log.warn.length + s.log.info.length, 0);
  assert.equal(s.opened.length, 0);
});
test('viewer: a pbxproj outside a .xcodeproj folder opens, and the disk check is skipped (no false warnings)', async () => {
  const dir = ws();
  const s = activate(dir);
  const { init, panel } = await openEditor(s, path.join(dir, 'odd', 'LOOSE.PBXPROJ'));
  assert.equal(init.kind, 'pbx');
  assert.equal(init.model.inBundle, false);
  const disk = await until(() => panel.posted.find((x) => x.type === 'disk'));
  assert.equal(disk.skipped, true);
  assert.equal(disk.missing.length, 0);
});
test('Open Xcode Project Viewer: from the text editor, a .xcodeproj folder, or the one project in the workspace', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.vscode.commands.executeCommand('xcodeProj.openWithViewer', s.vscode.Uri.file(path.join(dir, 'demo', 'ZovoDemo.xcodeproj')));
  assert.deepEqual(s.opened.slice(-1)[0], [path.join(dir, SAMPLE_REL), 'xcodeProj.viewer']);
  const sample = await s.vscode.commands.executeCommand('xcodeProj.openSample');
  assert.equal(sample.init.kind, 'pbx');
  assert.match(s.opened.slice(-1)[0][0], /samples\/ZovoDemo\.xcodeproj\/project\.pbxproj$/);
});

test('webview HTML: strict CSP, nonce scripts, no remote URLs, no blob, worker or connect sources, no style attributes', () => {
  const e = editorHtml({ cspSource: 'vscode-resource:', scriptUri: 'media/viewer.js', styleUri: 'media/viewer.css', title: 'x<y', showSupportLinks: true, nonce: 'abc' });
  const p = panelHtml({ cspSource: 'vscode-resource:', scriptUri: 'media/panel.js', styleUri: 'media/viewer.css', title: 't', nonce: 'abc' });
  for (const h of [e, p]) {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
    assert.match(csp, /^default-src 'none'/);
    assert.match(csp, /script-src 'nonce-abc'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|connect-src|worker-src|blob:|https?:/);
    assert.ok([...h.matchAll(/<script\b[^>]*>/g)].every((m) => /nonce="abc"/.test(m[0])));
    assert.doesNotMatch(h.replace(/https:\/\/(marketplace\.visualstudio\.com|github\.com|www\.paypal\.com|open-vsx\.org)[^"]*/g, ''), /https?:\/\//);
  }
  assert.match(e, /<title>x&lt;y<\/title>/);
  for (const f of ['viewer.js', 'panel.js']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'media', f), 'utf8'), /style="/, f);
  for (const f of ['src/tools.js', 'src/html.js', 'src/editor.js']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /style="/, f);
});
test('media scripts load nothing remote and open no connection', () => {
  for (const f of ['viewer.js', 'panel.js']) {
    const t = fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');
    assert.doesNotMatch(t, /fetch\(|XMLHttpRequest|WebSocket|new Worker|importScripts|https?:\/\/|eval\(/, f);
  }
});
test('no source file opens a network connection', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js') && !x.includes(`${path.sep}license${path.sep}`))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /require\(['"](https?|net|tls|dgram|child_process)['"]\)|fetch\(/, f);
  }
});

// ---------- Pro: merge conflict helper ----------
test('Pro Merge: the real Kingfisher conflict shows as a diff, then one modal question; Apply and Save writes it, comments kept; try counted after', async () => {
  const dir = ws();
  const s = activate(dir);
  const file = path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj');
  const before = fs.readFileSync(file, 'utf8');
  s.ui.warn.push('Apply and Save');
  const r = await s.api.tools.merge(s.vscode.Uri.file(file));
  assert.equal(r.applied, true);
  const diff = s.log.commands.find((c) => c[0] === 'vscode.diff');
  assert.ok(diff && diff[1].fsPath === file && /current file and the fix$/.test(diff[3]));
  const q = s.log.warn.find((w) => /^Apply the fix to Kingfisher\.xcodeproj and save it\?$/.test(w.text));
  assert.ok(q && q.opts.modal && /3 conflict blocks resolved/.test(q.opts.detail) && q.buttons[0] === 'Apply and Save');
  const we = s.log.edits.slice(-1)[0];
  const edits = [...we.map.values()][0];
  assert.equal(edits.length, 3);
  // no needsConfirmation: that would open the Refactor Preview with every change unticked
  assert.ok(edits.every((e) => !e.meta));
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(s.log.saved.includes(file));
  assert.doesNotMatch(after, /^<{7}/m);
  assert.match(after, /388F37372B4D9CDB0089705C \/\* DisplayLink\.swift \*\/,/);
  assert.match(after, /3ADE9AF82A73CD69009A86CA \/\* String\+SHA256\.swift \*\/,/);
  assert.equal(after.split('\n').length, before.split('\n').length - 9);
  assert.doesNotThrow(() => X.load(after));
  assert.equal(s.api.pro.left('merge'), 0);
  assert.ok(s.log.status.some((t) => /free try 1 of 1 of "Merge conflict helper" used/.test(t)));
  assert.match(s.log.status.slice(-1)[0], /free try 1 of 1/);
});
test('Pro Merge: settings set on both sides ask which side wins; Escape there, Cancel at the question and "nothing to fix" use no try', async () => {
  const dir = ws();
  const s = activate(dir);
  const file = path.join(dir, 'merge2', 'Kingfisher.xcodeproj', 'project.pbxproj');
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.merge(s.vscode.Uri.file(file)), undefined);
  assert.match(s.log.lastPick.opts.placeHolder, /3 settings are set on both sides/);
  s.ui.quick.push((items) => items.find((i) => i.id === 'theirs'));
  const r = await s.api.tools.merge(s.vscode.Uri.file(file)); // the modal question closed: no answer
  assert.equal(r.applied, false);
  assert.equal(s.log.edits.length, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /^<{7}/m);
  const clean = await s.api.tools.merge(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)));
  assert.equal(clean.applied, false);
  assert.match(s.log.info.slice(-1)[0].text, /nothing to fix/);
  assert.equal(s.api.pro.left('merge'), 1);
  s.ui.quick.push((items) => items.find((i) => i.id === 'theirs'));
  s.ui.warn.push('Apply and Save');
  const ok = await s.api.tools.merge(s.vscode.Uri.file(file));
  assert.equal(ok.applied, true);
  assert.match(fs.readFileSync(file, 'utf8'), /CURRENT_PROJECT_VERSION = 2664;/);
  assert.equal(s.api.pro.left('merge'), 0);
});
test('Pro Merge A then B: after the fix of file A, the helper on file B opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.warn.push('Apply and Save');
  await s.api.tools.merge(s.vscode.Uri.file(path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj')));
  await until(() => s.api.pro.left('merge') === 0);
  const file = path.join(dir, 'merge2', 'Kingfisher.xcodeproj', 'project.pbxproj');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(await s.api.tools.merge(s.vscode.Uri.file(file)), undefined);
  assert.equal(proPanels(s, 'Merge conflict helper').length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// ---------- Pro: compare ----------
test('Pro Compare: sample A with the changed copy B lists the version change; Markdown saved; try counted after the report showed', async () => {
  const dir = ws();
  const s = activate(dir);
  const r = await s.api.tools.compare(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { other: s.vscode.Uri.file(path.join(dir, 'demo-b', 'ZovoDemo.xcodeproj', 'project.pbxproj')) });
  assert.equal(r.settings.length, 4);
  assert.ok(r.settings.every((x) => x.key === 'MARKETING_VERSION' && x.a === '1.4.0' && x.b === '1.5.0'));
  const show = s.log.posted.find((m) => m.type === 'show');
  assert.match(show.html, /<b id="nSettings">4<\/b>/);
  await until(() => s.api.pro.left('compare') === 0);
  const dest = path.join(dir, 'changes.md');
  s.ui.save.push(s.vscode.Uri.file(dest));
  await s.api.tools.panels.compare.actions('md');
  assert.match(fs.readFileSync(dest, 'utf8'), /\| ZovoDemo \| Debug \| `MARKETING_VERSION` \| `1\.4\.0` \| `1\.5\.0` \|/);
});
test('Pro Compare A then B: after one comparison, comparing another pair opens the Pro panel; Escape in the pick used no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.compare(s.vscode.Uri.file(path.join(dir, SAMPLE_REL))), undefined);
  assert.ok(s.log.lastPick.items.some((i) => i.label === 'ZovoDemo.xcodeproj' && /demo-b/.test(i.description || '')));
  assert.equal(s.api.pro.left('compare'), 1);
  await s.api.tools.compare(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { other: s.vscode.Uri.file(path.join(dir, 'demo-b', 'ZovoDemo.xcodeproj', 'project.pbxproj')) });
  await until(() => s.api.pro.left('compare') === 0);
  assert.equal(await s.api.tools.compare(s.vscode.Uri.file(path.join(dir, 'kingfisher', 'kingfisher.xcodeproj', 'project.pbxproj')), { other: s.vscode.Uri.file(path.join(dir, 'netnewswire', 'netnewswire.xcodeproj', 'project.pbxproj')) }), undefined);
  assert.equal(proPanels(s, 'Compare two project versions').length, 1);
});

// ---------- Pro: build settings ----------
test('Pro Build settings: CSV of every target and configuration written and opened; try counted after the file was written', async () => {
  const dir = ws();
  const s = activate(dir);
  const dest = path.join(dir, 'settings.csv');
  s.ui.quick.push((items) => items.find((i) => i.id === 'csv'));
  s.ui.save.push(s.vscode.Uri.file(dest));
  const r = await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)));
  assert.equal(r.format, 'csv');
  const csv = fs.readFileSync(dest, 'utf8');
  assert.match(csv, /^Target,Configuration,Setting,Value/);
  assert.match(csv, /ZovoDemo,Release,SWIFT_OPTIMIZATION_LEVEL,-O,Project \.xcconfig/);
  assert.equal(s.api.pro.left('settings'), 0);
});
test('Pro Build settings: compare two targets side by side (panel table); Cancel in the save dialog uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.id === 'md'));
  s.ui.save.push(undefined);
  assert.equal(await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL))), undefined);
  assert.equal(s.api.pro.left('settings'), 1);
  s.ui.quick.push((items) => items.find((i) => i.id === 'compare'), (items) => items.find((i) => i.label === 'ZovoDemo'), (items) => items.find((i) => i.label === 'ZovoDemoWidget'));
  const c = await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)));
  assert.equal(c.a, 'ZovoDemo');
  assert.equal(c.b, 'ZovoDemoWidget');
  const show = s.log.posted.filter((m) => m.type === 'show').pop();
  assert.match(show.html, /id="cmpTable"/);
  assert.match(show.html, /com\.example\.zovodemo\.widget/);
  await until(() => s.api.pro.left('settings') === 0);
});
test('Pro Build settings A then B: after the export of project A, the tool on project B opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { action: 'md', dest: s.vscode.Uri.file(path.join(dir, 'a.md')) });
  assert.equal(s.api.pro.left('settings'), 0);
  assert.equal(await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, 'kingfisher', 'kingfisher.xcodeproj', 'project.pbxproj')), { action: 'md', dest: s.vscode.Uri.file(path.join(dir, 'b.md')) }), undefined);
  assert.equal(proPanels(s, 'Build settings export and compare').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'b.md')));
});

// ---------- the viewer in front ----------
test('Pro tools act on the viewer tab in front, with several viewer tabs open', async () => {
  const dir = ws();
  const s = activate(dir);
  const a = await openEditor(s, path.join(dir, SAMPLE_REL));
  const b = await openEditor(s, path.join(dir, 'kingfisher', 'kingfisher.xcodeproj', 'project.pbxproj'));
  // b is in front now
  assert.equal(s.api.provider.front().uri.fsPath, path.join(dir, 'kingfisher', 'kingfisher.xcodeproj', 'project.pbxproj'));
  const r = await s.api.tools.buildSettings(undefined, { action: 'csv', dest: s.vscode.Uri.file(path.join(dir, 'front.csv')) });
  assert.match(fs.readFileSync(path.join(dir, 'front.csv'), 'utf8'), /^Target,Configuration[\s\S]*KingfisherTests,/m);
  assert.equal(r.format, 'csv');
  // switch the front tab back to A
  b.panel.active = false; a.panel.active = true; a.panel.viewState();
  assert.equal(s.api.provider.front().uri.fsPath, path.join(dir, SAMPLE_REL));
  s.ui.quick.push(undefined);
  await s.api.tools.compare(undefined);
  assert.match(s.log.lastPick.opts.title, /^Compare ZovoDemo\.xcodeproj with/);
  // the viewer's own button runs the merge helper on its file
  const c = await openEditor(s, path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj'));
  s.ui.warn.push('Apply and Save');
  await c.panel.send({ type: 'tool', tool: 'merge' });
  await until(() => s.api.pro.left('merge') === 0);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'merge', 'Kingfisher.xcodeproj', 'project.pbxproj'), 'utf8'), /^<{7}/m);
});

// ---------- tries across tools, reloads and the panel ----------
test('a window reload keeps the counts: after a reload every used tool opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { action: 'csv', dest: s.vscode.Uri.file(path.join(dir, 'x.csv')) });
  await s.api.tools.compare(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { other: s.vscode.Uri.file(path.join(dir, 'demo-b', 'ZovoDemo.xcodeproj', 'project.pbxproj')) });
  await until(() => s.api.pro.left('settings') === 0 && s.api.pro.left('compare') === 0);
  const s2 = activate(dir, s.state);
  assert.deepEqual(s2.api.pro.tries(), { merge: 1, compare: 0, settings: 0 });
  assert.equal(await s2.api.tools.buildSettings(s2.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { action: 'csv', dest: s2.vscode.Uri.file(path.join(dir, 'y.csv')) }), undefined);
  assert.equal(proPanels(s2, 'Build settings export and compare').length, 1);
  assert.equal(await s2.api.tools.compare(s2.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { other: s2.vscode.Uri.file(path.join(dir, 'demo-b', 'ZovoDemo.xcodeproj', 'project.pbxproj')) }), undefined);
  assert.equal(proPanels(s2, 'Compare two project versions').length, 1);
});
test('the Pro panel names the other tools with their tries and no URL is opened when it is cancelled', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { action: 'csv', dest: s.vscode.Uri.file(path.join(dir, 'x.csv')) });
  await s.api.tools.buildSettings(s.vscode.Uri.file(path.join(dir, SAMPLE_REL)), { action: 'csv', dest: s.vscode.Uri.file(path.join(dir, 'x2.csv')) });
  const p = proPanels(s, 'Build settings export and compare')[0];
  assert.ok(p && p.opts.modal);
  assert.match(p.opts.detail, /You used the free try of Build settings export and compare on this computer\./);
  assert.match(p.opts.detail, /Merge conflict helper: 0 of 1 free try used/);
  assert.match(p.opts.detail, /Compare two project versions: 0 of 1 free try used/);
  assert.equal(s.log.external.length, 0);
});
test('the Explorer entry runs the tool on the clicked file, and on the project file of a clicked .xcodeproj folder', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.id === 'csv'));
  s.ui.save.push(s.vscode.Uri.file(path.join(dir, 'ctx.csv')));
  const r = await s.vscode.commands.executeCommand('xcodeProj.zovoPro.settings', s.vscode.Uri.file(path.join(dir, 'odd', 'LOOSE.PBXPROJ')));
  assert.equal(r.format, 'csv');
  assert.match(fs.readFileSync(path.join(dir, 'ctx.csv'), 'utf8'), /Kingfisher,/);
  s.ui.warn.push('Apply and Save');
  const m = await s.vscode.commands.executeCommand('xcodeProj.zovoPro.merge', s.vscode.Uri.file(path.join(dir, 'merge', 'Kingfisher.xcodeproj')));
  assert.equal(m.applied, true);
});
test('the toolbar row lists the 3 Pro tools with 1 free try each; one constant; the proinfo tries key matches', () => {
  const s = activate();
  const reachCfg = require('../src/reach-config');
  assert.deepEqual(reachCfg.tools.map((t) => t.id), ['merge', 'compare', 'settings']);
  const pro = require('../src/pro');
  assert.equal(pro.TRIAL_USES, 1);
  const cfg = require('../src/license/config');
  assert.equal(cfg.listing, 'xcode');
  assert.equal(cfg.pro_info.triesKey, pro.TRIAL_KEY);
  assert.equal(reachCfg.triesKey, pro.TRIAL_KEY);
  assert.equal(cfg.pro_info.triesMax, undefined);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.id), ['merge', 'compare', 'settings']);
  assert.deepEqual(Object.keys(s.api.pro.tries()), ['merge', 'compare', 'settings']);
  const row = s.api.provider.hooks.reach().rowHtml();
  assert.equal((row.match(/<small>1 free try<\/small>/g) || []).length, 3);
  assert.match(row, /Get Zovo Pro/);
  for (const f of ['src/tools.js', 'src/editor.js', 'src/extension.js']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /TRIAL_USES\s*=|triesMax/, f);
});

// ---------- README and text ----------
const RIVALS = /mariomatheu|syntax-project-pbxproj|EdwinKofler|assorted-languages|Squarelogic|open-xcode-project|SweetPad|XcodeGen|Tuist|Kintsukuroi|mergepbx|xUnique|\bsynx\b|xcodeproj gem|CocoaPods/i;
test('README: first screen has the main use, a screenshot of this product, the free list and the price; by Zovo; no rival names', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const first = md.split('\n').slice(0, 30).join('\n');
  assert.match(first, /^# Xcode Project Viewer \(pbxproj\)/);
  assert.match(first, /\(images\/screenshot\.png\)/);
  assert.match(first, /Zovo Pro: USD 19 once/);
  assert.match(md, /by Zovo/i);
  const files = ['README.md', 'CHANGELOG.md', 'package.json', 'walkthrough/settings.md', 'walkthrough/related.md', 'THIRD-PARTY-NOTICES.md', 'src/editor.js', 'src/tools.js', 'src/extension.js', 'src/pro.js', 'media/viewer.js', 'media/panel.js', ...fs.readdirSync(path.join(ROOT, 'src', 'core')).map((f) => `src/core/${f}`)];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), RIVALS, f);
  assert.ok(fs.existsSync(path.join(ROOT, 'images', 'screenshot.png')));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8'), /^images\/?(\*\*|\*\.png|screenshot)?\s*$/m);
});
test('support links name this listing and related Zovo tools; walkthrough links exist in the factory', () => {
  const support = require('../src/support');
  assert.equal(support.SELF_ID, 'zovo.zovo-xcode-project-viewer');
  assert.ok(support.RELATED.length >= 3 && !support.RELATED.includes(support.SELF_ID));
  assert.equal(support.RELATED[0], 'zovo.zovo-git-commit-graph');
  assert.equal(support.PRO.getPro, 'xcodeProj.getPro');
  const steps = pkg.contributes.walkthroughs[0].steps;
  const links = steps.flatMap((st) => [...st.description.matchAll(/command:extension\.open\?%5B%22([^%]+)%22%5D/g)].map((m) => m[1]));
  assert.deepEqual(links, ['zovo.zovo-git-commit-graph', 'zovo.zovo-svg-viewer', 'zovo.zovo-json-tree-viewer']);
  for (const id of links) assert.ok(fs.existsSync(path.join(ROOT, '..', id.replace('zovo.zovo-', '') + '-vscode')), id);
});
