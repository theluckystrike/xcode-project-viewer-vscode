'use strict';
// Core tests: the copied OpenStep parser, the line scanner, the project model on real projects (Kingfisher,
// NetNewsWire, our sample), broken reference checks, build settings with inherited values, the merge planner on real
// Kingfisher merge conflicts, and the semantic comparison. No VS Code needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../src/core/pbx');
const C = require('../src/core/check');
const S = require('../src/core/settings');
const G = require('../src/core/merge');
const D = require('../src/core/diff');
const { scan } = require('../src/core/scan');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const SAMPLE = fs.readFileSync(path.join(ROOT, 'samples', 'ZovoDemo.xcodeproj', 'project.pbxproj'), 'utf8');
const REAL = process.env.XC_REAL_DIR || path.join(process.env.HOME || '', 'plugin-market-intel-work', 'newb14-work', 'xcode', 'dl');

test('the OpenStep parser is the Plist Viewer & Editor copy, byte for byte', () => {
  const other = path.join(ROOT, '..', 'plist-editor-vscode', 'src', 'core', 'openstep.js');
  if (!fs.existsSync(other)) return;
  assert.equal(fs.readFileSync(path.join(ROOT, 'src', 'core', 'openstep.js'), 'utf8'), fs.readFileSync(other, 'utf8'));
});

test('scanner: lines of objects, keys and list items; keys written twice are found', () => {
  const t = 'objects = {\n\tA /* a */ = {\n\t\tisa = PBXGroup;\n\t\tchildren = (\n\t\t\tB /* b */,\n\t\t\tC,\n\t\t);\n\t};\n\tB = {isa = PBXFileReference; path = "x y.swift"; };\n\tB = {isa = PBXFileReference; };\n};\n';
  const s = scan(`{\n${t}}\n`);
  assert.equal(s.lineOf('objects', 'A'), 3);
  assert.deepEqual(s.rangeOf('objects', 'A'), { line: 3, endLine: 9 });
  assert.deepEqual(s.itemsOf('objects', 'A', 'children').map((x) => [x.v, x.line]), [['B', 6], ['C', 7]]);
  assert.equal(s.lineOf('objects', 'B', 'path'), 10);
  assert.deepEqual(s.dups, [{ path: ['objects'], key: 'B', lines: [10, 11] }]);
  assert.doesNotThrow(() => scan('{ a = ( ; } "unclosed'));
});

test('model: the sample project has 3 targets, its phases, a Swift package, groups with paths and configurations', () => {
  const m = X.load(SAMPLE, { projectName: 'ZovoDemo' });
  assert.deepEqual(m.targets.map((t) => [t.name, t.typeLabel]), [['ZovoDemo', 'App'], ['ZovoDemoWidget', 'App extension'], ['ZovoDemoTests', 'Unit tests']]);
  const app = m.targets[0];
  assert.deepEqual(app.phases.map((p) => [p.name, p.files.length]), [['Write build number', 0], ['Sources', 4], ['Frameworks', 1], ['Resources', 1], ['Embed Foundation Extensions', 1]]);
  assert.match(app.phases[0].script, /PlistBuddy/);
  assert.deepEqual(app.phases[1].files.map((f) => f.path), ['ZovoDemo/ZovoDemoApp.swift', 'ZovoDemo/ContentView.swift', 'ZovoDemo/TripStore.swift', 'ZovoDemo/OldHelper.swift']);
  assert.equal(app.phases[2].files[0].kind, 'package');
  assert.equal(app.phases[4].files[0].attrs, 'RemoveHeadersOnCopy');
  assert.deepEqual(app.deps.map((d) => d.name), ['ZovoDemoWidget']);
  assert.deepEqual(app.packages.map((p) => [p.product, p.package]), [['OrderedCollections', 'swift-collections']]);
  assert.deepEqual(m.packages.map((p) => [p.name, p.url, p.requirement]), [['swift-collections', 'https://github.com/apple/swift-collections', 'from 1.1.0 (up to next major)']]);
  assert.deepEqual(m.configNames, ['Debug', 'Release']);
  assert.equal(m.projectConfigs.configs[0].basePath, 'Config/Base.xcconfig');
  const store = m.tree.children[0].children.find((c) => c.name === 'TripStore.swift');
  assert.deepEqual(store.targets.sort(), ['ZovoDemo', 'ZovoDemoWidget']);
  assert.equal(m.tree.children.find((c) => c.name === 'Frameworks').children[0].full, '$(SDKROOT)/System/Library/Frameworks/WidgetKit.framework');
  assert.equal(m.facts.find((f) => f.k === 'Project').v, 'ZovoDemo');
  // every target, phase and file row has a line in the text
  const lines = SAMPLE.split('\n');
  assert.match(lines[app.line - 1], /ZovoDemo \*\/ = \{/);
  assert.match(lines[app.phases[1].files[3].line - 1], /OldHelper\.swift in Sources/);
});

test('model: real Kingfisher and NetNewsWire projects (synchronized folders, packages pinned by revision, local paths)', () => {
  const k = X.load(read('kingfisher.pbxproj'));
  assert.deepEqual(k.targets.map((t) => t.name), ['Kingfisher', 'KingfisherTests']);
  assert.ok(k.targets[0].phases.find((p) => p.kind === 'Sources').files.length > 60);
  assert.ok(k.fileCount > 150);
  const n = X.load(read('netnewswire.pbxproj'));
  assert.ok(n.targets.length >= 6);
  assert.ok(n.targets.some((t) => t.sync.length > 0));
  assert.ok(n.packages.some((p) => /^revision /.test(p.requirement)));
  assert.ok(n.packages.some((p) => p.url === 'https://github.com/sparkle-project/Sparkle.git'));
  for (const m of [k, n]) assert.deepEqual(C.check(m).filter((w) => w.level === 'error'), []);
});

test('model: merge markers, a property list that is no project, and a syntax error give clear errors', () => {
  assert.throws(() => X.load(read('kf-merge-e542.conflict.pbxproj')), (e) => e instanceof X.ConflictError && e.blocks.length === 3 && e.blocks[0].start === 12 && /3 git merge conflicts/.test(e.message));
  assert.throws(() => X.load('{ CFBundleName = Demo; }'), (e) => e instanceof X.NotProjectError);
  assert.throws(() => X.load('{ objects = { A = { isa = PBXProject; }; }; rootObject = B; }'), (e) => e instanceof X.NotProjectError);
  assert.throws(() => X.load(SAMPLE.replace('isa = PBXGroup;', 'isa = PBXGroup')), /Line \d+/);
});

test('checks: dangling ids, objects defined twice, repeated list items, duplicate build files and unused entries', () => {
  let t = SAMPLE;
  // a group child that points nowhere, a build file whose file was deleted, a child listed twice
  t = t.replace('A0D0E0000000000000000002 /* ContentView.swift */,\n', 'A0D0E0000000000000000002 /* ContentView.swift */,\n\t\t\t\tFFFFFFFFFFFFFFFFFFFFFFFF /* Gone.swift */,\n\t\t\t\tA0D0E0000000000000000003 /* TripStore.swift */,\n');
  t = t.replace(/\t\tA0D0E0000000000000000006 \/\* ZovoDemo\.entitlements \*\/ = \{[^\n]*\n/, '');
  const dupLine = (/\t\tA0D0E0000000000000000009 \/\* Info\.plist \*\/ = \{[^\n]*\n/.exec(t) || [''])[0];
  t = t.replace(dupLine, dupLine + dupLine);
  const m = X.load(t);
  const w = C.check(m);
  const kinds = w.map((x) => x.kind);
  assert.ok(kinds.includes('dangling'));
  assert.ok(w.some((x) => x.kind === 'dangling' && x.ref === 'FFFFFFFFFFFFFFFFFFFFFFFF' && x.field === 'children'));
  assert.ok(w.some((x) => x.kind === 'dangling' && x.ref === 'A0D0E0000000000000000006'));
  assert.ok(w.some((x) => x.kind === 'dupObject' && x.id === 'A0D0E0000000000000000009'));
  assert.ok(w.some((x) => x.kind === 'dupItem' && x.ref === 'A0D0E0000000000000000003'));
  for (const x of w) assert.ok(x.line > 0, x.message);
  assert.equal(w[0].level, 'error');
});

test('disk entries: paths from the project folder for files and folders, none for SDK or product files', () => {
  const m = X.load(SAMPLE);
  const e = C.diskEntries(m);
  assert.ok(e.some((x) => x.rel === 'ZovoDemo/OldHelper.swift'));
  assert.ok(e.some((x) => x.rel === 'Config/Release.xcconfig'));
  assert.ok(!e.some((x) => /WidgetKit|\.app$|\.appex$|\.xctest$/.test(x.rel)));
  // every file of the shipped sample is there except OldHelper.swift (missing on purpose)
  const missing = e.filter((x) => !fs.existsSync(path.join(ROOT, 'samples', x.rel)));
  assert.deepEqual(missing.map((x) => x.rel), ['ZovoDemo/OldHelper.swift']);
});

test('build settings: target over project, $(inherited) resolved, xcconfig levels, project-only view', () => {
  const m = X.load(SAMPLE);
  const app = m.targets[0];
  const xc = new Map([[m.projectConfigs.configs[0].id, { settings: S.parseXcconfig(fs.readFileSync(path.join(ROOT, 'samples', 'Config', 'Base.xcconfig'), 'utf8')).settings }]]);
  const r = S.resolveSettings(m, app.id, 'Debug', xc);
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row('SWIFT_ACTIVE_COMPILATION_CONDITIONS').value, 'DEBUG DEMO_DATA');
  assert.equal(row('SWIFT_ACTIVE_COMPILATION_CONDITIONS').from, 'target');
  assert.equal(row('IPHONEOS_DEPLOYMENT_TARGET').from, 'project');
  assert.equal(row('IPHONEOS_DEPLOYMENT_TARGET').inherited, true);
  assert.equal(row('ENABLE_USER_SCRIPT_SANDBOXING').fromLabel, 'Project .xcconfig');
  assert.equal(row('LD_RUNPATH_SEARCH_PATHS').value, '@executable_path/Frameworks');
  assert.ok(row('MARKETING_VERSION').line > 0);
  assert.match(SAMPLE.split('\n')[row('MARKETING_VERSION').line - 1], /MARKETING_VERSION = 1\.4\.0;/);
  const p = S.resolveSettings(m, null, 'Release', null);
  assert.ok(p.rows.every((x) => x.from === 'project'));
  assert.ok(p.rows.some((x) => x.key === 'SWIFT_COMPILATION_MODE'));
  const inc = S.parseXcconfig('#include "Base.xcconfig"\n// note\nA = 1 // x\nB[sdk=iphoneos*] = "a // b"\n');
  assert.deepEqual(inc, { settings: { A: '1', 'B[sdk=iphoneos*]': '"a // b"' }, includes: ['Base.xcconfig'], lines: { A: 3, 'B[sdk=iphoneos*]': 4 } });
});

test('build settings export: CSV (formula-safe) and Markdown; compare two targets side by side', () => {
  const m = X.load(SAMPLE);
  const rows = S.allRows(m);
  const csv = S.toCsv(rows);
  assert.match(csv.split('\r\n')[0], /^Target,Configuration,Setting,Value,Set at/);
  assert.match(csv, /ZovoDemoWidget,Release,SKIP_INSTALL,YES,Target/);
  assert.match(csv, /,SWIFT_OPTIMIZATION_LEVEL,-Onone,/);
  assert.match(S.toCsv([{ target: 't', config: 'c', key: 'K', value: '=HYPERLINK("x")', fromLabel: 'Target', raw: {} }]), /"'=HYPERLINK\(""x""\)"/);
  const md = S.toMarkdown(rows, 'ZovoDemo.xcodeproj');
  assert.match(md, /^# Build settings: ZovoDemo\.xcodeproj/);
  assert.match(md, /## ZovoDemoTests, Debug/);
  const c = S.compareTargets(m, m.targets[0].id, m.targets[1].id);
  const bid = c.rows.find((r) => r.config === 'Debug' && r.key === 'PRODUCT_BUNDLE_IDENTIFIER');
  assert.deepEqual([bid.a, bid.b, bid.same], ['com.example.zovodemo', 'com.example.zovodemo.widget', false]);
  assert.equal(c.rows.find((r) => r.config === 'Release' && r.key === 'SKIP_INSTALL').kind, 'onlyB');
  assert.ok(c.differ > 4);
  assert.match(S.compareToMarkdown(c), /\| `SKIP_INSTALL` \| _not set_ \| `YES` \|/);
  assert.match(S.compareToCsv(c), /^Configuration,Setting,ZovoDemo,ZovoDemoWidget,Same/);
});

test('merge: real Kingfisher conflict (both sides added a file) keeps both files, as the authors did, and keeps every id comment', () => {
  const text = read('kf-merge-e542.conflict.pbxproj');
  const p = G.plan(text);
  assert.equal(p.ok, true);
  assert.equal(p.blocks.length, 3);
  assert.ok(p.blocks.every((b) => b.decision === 'both' && b.added === 1 && b.clashes.length === 0));
  assert.equal(p.edits.length, 3);
  assert.ok(p.edits.every((e) => e.group === 'Merge conflicts'));
  const out = G.applyEdits(text, p.edits);
  assert.equal(out, p.finalText);
  assert.doesNotMatch(out, /^(<{7}|={7}|>{7})/m);
  const m = X.load(out);
  const author = X.load(read('kf-merge-e542.author.pbxproj'));
  assert.deepEqual(Object.keys(m.objects).sort(), Object.keys(author.objects).sort());
  assert.match(out, /3ADE9AF92A73CD69009A86CA \/\* String\+SHA256\.swift in Sources \*\/ = \{isa = PBXBuildFile;/);
  assert.match(out, /388F37382B4D9CDB0089705C \/\* DisplayLink\.swift in Sources \*\/ = \{isa = PBXBuildFile;/);
  // nothing outside the blocks changed
  const before = text.split('\n'), after = out.split('\n');
  assert.equal(after.length, before.length - 3 * 3);
  assert.equal(after.slice(0, 11).join('\n'), before.slice(0, 11).join('\n'));
  assert.equal(after.slice(-200).join('\n'), before.slice(-200).join('\n'));
});

test('merge: settings set on both sides follow the pick; with a diff3 base the side that changed wins and a deletion stays deleted', () => {
  const text = read('kf-merge-3a46.conflict.pbxproj');
  const ours = G.plan(text, { prefer: 'ours' });
  const theirs = G.plan(text, { prefer: 'theirs' });
  const val = (t, k) => [...t.matchAll(new RegExp(`${k} = ([^;]+);`, 'g'))].map((x) => x[1]);
  assert.ok(ours.blocks[0].clashes.length === 1 && ours.blocks[0].clashes[0].key === 'CURRENT_PROJECT_VERSION');
  assert.ok(val(ours.finalText, 'CURRENT_PROJECT_VERSION').includes('2624'));
  assert.ok(!val(theirs.finalText, 'CURRENT_PROJECT_VERSION').includes('2624'));
  assert.ok(val(theirs.finalText, 'CURRENT_PROJECT_VERSION').includes('2664'));
  // the entries only one side added are kept with either pick
  for (const p of [ours, theirs]) { assert.match(p.finalText, /DEFINES_MODULE = YES;/); assert.match(p.finalText, /SWIFT_INSTALL_OBJC_HEADER = YES;/); assert.doesNotThrow(() => X.load(p.finalText)); }
  // the version the Kingfisher authors committed took the incoming value where both changed it
  assert.deepEqual(val(theirs.finalText, 'CURRENT_PROJECT_VERSION'), val(read('kf-merge-3a46.author.pbxproj'), 'CURRENT_PROJECT_VERSION'));
  // diff3: SWIFT_OPTIMIZATION_LEVEL was "-Owholemodule" in the base; only the current side changed it, so "-O" stays
  const d3 = G.plan(read('kf-merge-3a46.conflict-diff3.pbxproj'), { prefer: 'theirs' });
  const b = d3.blocks[2];
  assert.equal(b.diff3, true);
  assert.equal(b.clashes[0].key, 'SWIFT_OPTIMIZATION_LEVEL');
  assert.equal(b.clashes[0].kept, 'ours');
  assert.equal(b.clashes[0].auto, true);
  const e = G.plan(read('kf-merge-e542.conflict-diff3.pbxproj'));
  assert.equal(e.ok, true);
  assert.deepEqual(Object.keys(X.load(e.finalText).objects).sort(), Object.keys(X.load(read('kf-merge-e542.author.pbxproj')).objects).sort());
});

test('merge: removes copies of objects, dangling list items, dead build files and repeated items, but never text it cannot isolate', () => {
  let t = SAMPLE;
  t = t.replace('A0D0E0000000000000000002 /* ContentView.swift */,\n', 'A0D0E0000000000000000002 /* ContentView.swift */,\n\t\t\t\tFFFFFFFFFFFFFFFFFFFFFFFF /* Gone.swift */,\n\t\t\t\tA0D0E0000000000000000003 /* TripStore.swift */,\n');
  const dupLine = (/\t\tA0D0E0000000000000000009 \/\* Info\.plist \*\/ = \{[^\n]*\n/.exec(t) || [''])[0];
  t = t.replace(dupLine, dupLine + dupLine);
  t = t.replace(/\t\tA0D0E0000000000000000007 \/\* OldHelper\.swift \*\/ = \{[^\n]*\n/, ''); // file reference deleted, its build file and group entry stay
  const p = G.plan(t);
  assert.equal(p.ok, true);
  const kinds = p.removed.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['dangling', 'dangling', 'dangling', 'deadBuildFile', 'dupItem', 'dupObject']);
  const out = G.applyEdits(t, p.edits);
  assert.equal(out, p.finalText);
  const m = X.load(out);
  assert.deepEqual(C.check(m).filter((w) => w.level !== 'note'), []);
  assert.doesNotMatch(out, /FFFFFFFFFFFFFFFFFFFFFFFF|OldHelper/);
  assert.equal((out.match(/A0D0E0000000000000000009 \/\* Info\.plist \*\/ = \{/g) || []).length, 1);
  assert.ok(p.edits.every((e) => e.text === '' && e.start === e.end));
  assert.deepEqual([...new Set(p.edits.map((e) => e.group))].sort(), ['Broken references', 'Duplicate entries']);
  // the clean sample needs no edit
  assert.equal(G.plan(SAMPLE).edits.length, 0);
  // an unclosed block or a block that breaks the file is refused, nothing planned
  assert.equal(G.plan('{\n<<<<<<< HEAD\na = 1;\n=======\n').ok, false);
  const bad = G.plan('{\n\tobjects = {\n<<<<<<< HEAD\n\t\tA = {\n=======\n\t\tB = {\n>>>>>>> x\n\t\t\tisa = PBXGroup;\n\t\t};\n\t};\n}\n');
  assert.equal(bad.ok, true);
  assert.equal(bad.blocks[0].decision, 'side');
});

test('merge: CRLF files keep CRLF, and a file without a final newline keeps it that way', () => {
  const text = read('kf-merge-e542.conflict.pbxproj').replace(/\n/g, '\r\n');
  const p = G.plan(text);
  const out = G.applyEdits(text, p.edits);
  assert.equal(out, p.finalText);
  assert.doesNotMatch(out.replace(/\r\n/g, ''), /\n/);
  const t2 = SAMPLE.replace(/\n$/, '').replace('A0D0E0000000000000000002 /* ContentView.swift */,\n', 'A0D0E0000000000000000002 /* ContentView.swift */,\n\t\t\t\tFFFFFFFFFFFFFFFFFFFFFFFF,\n');
  const p2 = G.plan(t2);
  assert.equal(G.applyEdits(t2, p2.edits), p2.finalText);
  assert.ok(!p2.finalText.endsWith('\n'));
});

test('compare: real Kingfisher base and current versions, by object, with a Markdown report', () => {
  const a = X.load(read('kf-merge-e542.base.pbxproj'));
  const b = X.load(read('kf-merge-e542.ours.pbxproj'));
  const r = D.diff(a, b);
  assert.deepEqual(r.filesAdded.map((f) => f.path), ['Sources/Utility/String+SHA256.swift']);
  assert.deepEqual(r.filesRemoved.map((f) => f.path), ['Sources/Utility/String+MD5.swift']);
  assert.deepEqual(r.membership.map((x) => [x.target, x.phase, x.change, x.path]), [['Kingfisher', 'Sources', 'added', 'Sources/Utility/String+SHA256.swift'], ['Kingfisher', 'Sources', 'removed', 'Sources/Utility/String+MD5.swift']]);
  assert.ok(r.settings.some((s) => s.target === '(project)' && s.key === 'IPHONEOS_DEPLOYMENT_TARGET' && s.a === '12.0' && s.b === '13.0'));
  const md = D.toMarkdown(r, 'base', 'current');
  assert.match(md, /^# Xcode project changes: base to current/);
  assert.match(md, /## Files added \(1\)\n\n- `Sources\/Utility\/String\+SHA256\.swift` in group Sources\/Utility/);
  assert.match(md, /\| \(project\) \| Debug \| `IPHONEOS_DEPLOYMENT_TARGET` \| `12\.0` \| `13\.0` \|/);
  assert.equal(D.diff(b, b).total, 0);
});

test('compare: targets added and renamed, a file moved to another group, a package version changed', () => {
  const a = X.load(SAMPLE);
  let t = SAMPLE.replace(/name = ZovoDemoTests;/, 'name = ZovoDemoUnitTests;');
  t = t.replace('exactly', 'exactly').replace('minimumVersion = 1.1.0;', 'minimumVersion = 1.2.0;');
  // move TripStore.swift from the ZovoDemo group to ZovoDemoWidget
  t = t.replace('\t\t\t\tA0D0E0000000000000000003 /* TripStore.swift */,\n', '').replace('A0D0E0000000000000000008 /* TripWidget.swift */,\n', 'A0D0E0000000000000000008 /* TripWidget.swift */,\n\t\t\t\tA0D0E0000000000000000003 /* TripStore.swift */,\n');
  const b = X.load(t);
  const r = D.diff(a, b);
  assert.deepEqual(r.targetsRenamed.map((x) => [x.from, x.to]), [['ZovoDemoTests', 'ZovoDemoUnitTests']]);
  assert.deepEqual(r.filesMoved.map((x) => [x.name, x.from, x.to]), [['TripStore.swift', 'ZovoDemo', 'ZovoDemoWidget']]);
  assert.deepEqual(r.packagesChanged.map((x) => [x.name, x.from, x.to]), [['swift-collections', 'from 1.1.0 (up to next major)', 'from 1.2.0 (up to next major)']]);
});

test('real files from the download folder (skipped when it is not there): Wikipedia and Alamofire load fast with no errors', { skip: !fs.existsSync(path.join(REAL, 'wikipedia', 'project.pbxproj')) }, () => {
  for (const f of ['wikipedia', 'alamofire']) {
    const t0 = Date.now();
    const m = X.load(fs.readFileSync(path.join(REAL, f, 'project.pbxproj'), 'utf8'));
    const w = C.check(m);
    assert.ok(Date.now() - t0 < 3000, f);
    assert.deepEqual(w.filter((x) => x.level === 'error'), [], f);
    assert.ok(S.allRows(m).length > 100, f);
  }
});
