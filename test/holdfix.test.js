'use strict';
// HOLDFIX (0.1.1): VER22 BLOCK (walkthrough button to zovo.zovo-plist-editor, not on the Marketplace) and VER20 BLOCK 16 Nov
// 07:15 (Targets tab build-phase path cells 11 px wide in VS Code's default layout, 746 px webview).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'media', 'viewer.css'), 'utf8');

test('narrow layout: facts pane under the main view below 900 px; build-phase paths keep a minimum width and break at /', () => {
  assert.match(css, /table\.files td\.fpath \{ min-width: 150px; \}/);
  assert.match(css, /table\.files td\.fpath code \{ overflow-wrap: break-word; word-break: normal; \}/);
  assert.match(css, /#settingsTable td\.pv \{ min-width: 120px; \}/); // Build Settings values (a 38 px cell at 746 px in the first 0.1.1 gate)
  const m = /@media \(max-width: 900px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, 'media rule');
  assert.match(m[1], /#app \{ display: grid;/);
  assert.match(m[1], /#info \{ grid-column: 2; grid-row: 2; width: auto;/);
  const js = fs.readFileSync(path.join(ROOT, 'media', 'viewer.js'), 'utf8');
  assert.match(js, /<td class="fpath">\$\{f\.path \? `<code>\$\{esc\(f\.path\)\.replace\(\/\\\/\/g, '\/<wbr>'\)\}<\/code>` : ''\}<\/td>/);
});

test('related links: no unpublished plist editor in the walkthrough or RELATED', () => {
  const support = require('../src/support');
  assert.ok(!support.RELATED.includes('zovo.zovo-plist-editor'));
  const all = JSON.stringify(pkg.contributes.walkthroughs) + fs.readFileSync(path.join(ROOT, 'walkthrough', 'related.md'), 'utf8');
  assert.doesNotMatch(all, /plist-editor|Plist Viewer|apk-analyzer|APK Analyzer/);
  assert.ok(!support.RELATED.includes('zovo.zovo-apk-analyzer'));
});

test('0.1.1 CHANGELOG first', () => {
  assert.strictEqual(pkg.version, '0.1.1');
  assert.match(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), /^# Changelog\n\n## 0\.1\.1\n\n- The Targets tab stays readable/);
});
