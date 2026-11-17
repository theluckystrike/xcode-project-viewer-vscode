// Xcode Project Viewer webview: targets with their build phases, the file and group tree, build settings with
// inherited values, Swift packages and warnings. Data comes from the extension host; this page makes no network
// request (CSP default-src 'none'). Indentation and colors come from classes, never from style attributes.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  let data = null;
  let tab = 'targets';
  let selTarget = '';
  let query = '';
  let disk = null;
  const closed = new Set();
  const openPhases = new Set();
  const settingsState = { target: '', config: '', onlyHere: false, rows: null, req: 0, meta: null };

  function footer() {
    const f = $('zovo-footer');
    if (f && !$('footer').childElementCount) $('footer').innerHTML = f.innerHTML;
  }
  function status(t) { $('statusText').textContent = t; }
  function showMessage(html) { const m = $('msg'); m.innerHTML = html; m.hidden = !html; }
  const lineLink = (line, label) => (line ? `<a href="#" class="ln" data-line="${line}" title="Go to line ${line} in the text">${esc(label || `line ${line}`)}</a>` : '');

  // ---------- init ----------
  function init(m) {
    document.body.dataset.kind = m.kind;
    footer();
    disk = null;
    if (m.kind !== 'pbx') {
      data = null;
      document.body.dataset.state = m.kind;
      $('fmt').textContent = m.sizeText || '';
      $('view').innerHTML = '';
      $('facts').innerHTML = '';
      $('targetList').innerHTML = '';
      $('tabs').hidden = true;
      $('search').disabled = true;
      $('side').hidden = true; $('info').hidden = true;
      let html = `<p>${esc(m.error)}</p>`;
      if (m.kind === 'conflict') {
        html = `<p><strong>Merge conflict.</strong> ${esc(m.error)}</p><table id="conflictTable"><thead><tr><th>Lines</th><th>Current side</th><th>Incoming side</th></tr></thead><tbody>${m.conflicts.map((b) => `<tr><td>${lineLink(b.start, b.end ? `${b.start} to ${b.end}` : `${b.start} (not closed)`)}</td><td><code>${esc(b.ours)}</code></td><td><code>${esc(b.theirs)}</code></td></tr>`).join('')}</tbody></table>
<p>The Merge conflict helper (Zovo Pro) keeps both sides' new entries, lets you pick the side for settings changed on both, and shows every change in a preview before it writes.</p>
<p><button class="tb" id="mMerge">Merge Conflict Helper (Pro)</button> <button class="tb" id="mText">Open as Text</button></p>`;
      } else {
        html += `<p>${m.errorLine ? `<button class="tb" id="mLine">Go to Line ${m.errorLine}</button> ` : ''}<button class="tb" id="mText">Open as Text</button></p>`;
      }
      showMessage(html);
      if ($('mText')) $('mText').onclick = () => vscode.postMessage({ type: 'openRaw' });
      if ($('mLine')) $('mLine').onclick = () => vscode.postMessage({ type: 'reveal', line: m.errorLine });
      if ($('mMerge')) $('mMerge').onclick = () => vscode.postMessage({ type: 'tool', tool: 'merge' });
      status(m.kind === 'conflict' ? `${m.conflicts.length} merge conflict${m.conflicts.length === 1 ? '' : 's'}` : m.error);
      return;
    }
    data = m.model;
    $('tabs').hidden = false; $('search').disabled = false; $('info').hidden = false;
    showMessage('');
    $('fmt').textContent = `objectVersion ${data.objectVersion}, ${n(data.objectCount)} objects, ${m.sizeText}`;
    if (!data.targets.some((t) => t.id === selTarget)) selTarget = data.targets.length ? data.targets[0].id : '';
    if (!settingsState.config || !data.configNames.includes(settingsState.config)) settingsState.config = data.defaultConfig && data.configNames.includes(data.defaultConfig) ? data.defaultConfig : data.configNames[0] || '';
    if (settingsState.target && !data.targets.some((t) => t.id === settingsState.target)) settingsState.target = '';
    if (!settingsState.target && data.targets.length) settingsState.target = data.targets[0].id;
    settingsState.rows = null;
    facts();
    warnBadge();
    setTab(tab);
    document.body.dataset.state = 'ready';
    status(`${data.targets.length} target${data.targets.length === 1 ? '' : 's'}, ${n(data.fileCount)} file references, ${n(data.groupCount)} groups, ${data.packages.length} Swift package${data.packages.length === 1 ? '' : 's'}, ${data.configNames.length} configurations`);
    vscode.postMessage({ type: 'rendered', targets: data.targets.length, files: data.fileCount });
  }

  function facts() {
    const pc = data.projectConfigs.map((c) => `<li>${lineLink(c.line, c.name)}${c.basePath ? ` <span class="muted">based on ${esc(c.basePath)}</span>` : ''} <span class="muted">(${c.count})</span></li>`).join('');
    $('facts').innerHTML = `<h3>Project</h3><dl>${data.facts.map((f) => `<dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd>`).join('')}</dl>
<h3>Project configurations</h3><ul id="projectConfigs">${pc || '<li class="muted">None</li>'}</ul>
${data.xcconfigs.length ? `<h3>.xcconfig files read</h3><ul>${data.xcconfigs.map((p) => `<li><code>${esc(p.split('/').pop())}</code></li>`).join('')}</ul>` : ''}
<h3>Disk check</h3><p id="diskNote" class="muted">${data.inBundle ? 'Looking for the project files on disk...' : 'Skipped: this file is not inside a .xcodeproj folder, so file paths cannot be checked.'}</p>`;
  }

  function allWarnings() {
    const w = data.warnings.slice();
    if (disk && disk.missing) for (const x of disk.missing) w.push({ level: 'warning', kind: 'missingOnDisk', line: x.line, id: x.id, message: `${x.group ? 'Folder' : 'File'} not found on disk: ${x.path}` });
    const order = { error: 0, warning: 1, note: 2 };
    return w.sort((a, b) => order[a.level] - order[b.level] || (a.line || 0) - (b.line || 0));
  }
  function warnBadge() {
    const w = allWarnings();
    const serious = w.filter((x) => x.level !== 'note').length;
    $('warnCount').textContent = w.length ? `(${serious}${w.length > serious ? `+${w.length - serious}` : ''})` : '';
    $('tabWarnings').classList.toggle('bad', serious > 0);
  }
  const missingSet = () => new Set(disk && disk.missing ? disk.missing.map((x) => x.id) : []);

  // ---------- tabs ----------
  function setTab(t) {
    tab = t;
    for (const b of document.querySelectorAll('#tabs .tab')) b.classList.toggle('sel', b.dataset.tab === t);
    $('side').hidden = t !== 'targets';
    document.body.dataset.tab = t;
    draw();
  }
  function draw() {
    if (!data) return;
    const q = query.trim().toLowerCase();
    if (tab === 'targets') { drawTargetList(q); drawTarget(q); }
    else if (tab === 'files') drawFiles(q);
    else if (tab === 'settings') drawSettings(q);
    else if (tab === 'packages') drawPackages(q);
    else drawWarnings(q);
  }

  // ---------- targets ----------
  function drawTargetList(q) {
    $('targetList').innerHTML = data.targets.map((t) => {
      const hits = q ? t.phases.reduce((s, p) => s + p.files.filter((f) => (f.name + ' ' + f.path).toLowerCase().includes(q)).length, 0) : 0;
      return `<div class="trow${t.id === selTarget ? ' sel' : ''}" role="option" data-target="${esc(t.id)}"><span class="ic ic-${esc(kindIcon(t))}"></span><span class="nm">${esc(t.name)}</span><span class="muted ty">${esc(t.typeLabel)}</span>${q && hits ? `<span class="badge">${hits}</span>` : ''}</div>`;
    }).join('') || '<p class="muted pad">No targets.</p>';
  }
  const kindIcon = (t) => (/App$|app/.test(t.typeLabel) ? 'app' : /tests/i.test(t.typeLabel) ? 'test' : /extension/i.test(t.typeLabel) ? 'ext' : /ramework|library/i.test(t.typeLabel) ? 'lib' : 'target');
  function drawTarget(q) {
    const t = data.targets.find((x) => x.id === selTarget);
    if (!t) { $('view').innerHTML = '<p class="muted">This project has no targets.</p>'; return; }
    const miss = missingSet();
    let shown = 0;
    const phases = t.phases.map((p) => {
      const files = q ? p.files.filter((f) => (f.name + ' ' + f.path).toLowerCase().includes(q)) : p.files;
      shown += files.length;
      const isOpen = openPhases.has(`${t.id}:${p.id}`) || (q && files.length) || p.files.length <= 12;
      const rows = files.map((f) => `<tr class="${f.missingObject ? 'bad' : miss.has(f.ref) ? 'warn' : ''}"><td><span class="ic ic-${esc(f.kind)}"></span>${lineLink(f.line, f.name)}</td><td class="fpath">${f.path ? `<code>${esc(f.path).replace(/\//g, '/<wbr>')}</code>` : ''}</td><td>${esc(f.attrs)}${f.flags ? ` <code>${esc(f.flags)}</code>` : ''}${f.missingObject ? ' <span class="tag bad">missing object</span>' : miss.has(f.ref) ? ' <span class="tag warn">not on disk</span>' : ''}</td></tr>`).join('');
      let extra = '';
      if (p.isa === 'PBXShellScriptBuildPhase') extra = `<div class="script"><div class="muted">${esc(p.shell)}${p.onlyInstall ? ', only when installing' : ''}${p.inputs.length ? `, inputs: ${p.inputs.map(esc).join(', ')}` : ''}${p.outputs.length ? `, outputs: ${p.outputs.map(esc).join(', ')}` : ''}</div><pre>${esc(p.script)}</pre></div>`;
      if (p.isa === 'PBXCopyFilesBuildPhase') extra = `<div class="muted">Destination ${esc(copyDest(p.dstSubfolderSpec))}${p.dstPath ? ` / ${esc(p.dstPath)}` : ''}</div>`;
      return `<details class="phase" data-key="${esc(`${t.id}:${p.id}`)}"${isOpen ? ' open' : ''}><summary><strong>${esc(p.name)}</strong> <span class="muted">${p.kind !== p.name ? `${esc(p.kind)}, ` : ''}${p.files.length} file${p.files.length === 1 ? '' : 's'}</span> ${lineLink(p.line)}</summary>${extra}${files.length ? `<table class="files"><tbody>${rows}</tbody></table>` : (p.files.length && q ? '<p class="muted">No file matches the search.</p>' : '')}</details>`;
    }).join('');
    const deps = t.deps.length ? `<ul>${t.deps.map((d) => `<li>${lineLink(d.line, d.name)}${d.external ? ' <span class="muted">(in another project)</span>' : ''}${d.missing ? ' <span class="tag bad">missing object</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">None.</p>';
    const pk = t.packages.length ? `<ul>${t.packages.map((p) => `<li>${lineLink(p.line, p.product)}${p.package ? ` <span class="muted">from ${esc(p.package)}</span>` : ''}</li>`).join('')}</ul>` : '';
    const sync = t.sync.length ? `<h3>Synchronized folders</h3><ul>${t.sync.map((g) => `<li>${lineLink(g.line, g.name)} <code>${esc(g.path)}</code>${miss.has(g.id) ? ' <span class="tag warn">not on disk</span>' : ''}</li>`).join('')}</ul>` : '';
    const cfg = t.configs.map((c) => `<li>${lineLink(c.line, c.name)}${c.name === t.defaultConfig ? ' <span class="muted">(default)</span>' : ''}${c.basePath ? ` <span class="muted">based on ${esc(c.basePath)}</span>` : ''} <span class="muted">${c.count} setting${c.count === 1 ? '' : 's'}</span> <a href="#" class="cfg" data-config="${esc(c.name)}">Build settings</a></li>`).join('');
    $('view').innerHTML = `<h2 id="targetName">${esc(t.name)} ${lineLink(t.line)}</h2>
<p class="muted">${esc(t.typeLabel)}${t.product ? `, product ${esc(t.product)}` : ''}${t.productType ? ` <code>${esc(t.productType)}</code>` : ''}${t.buildTool ? `, build tool <code>${esc(t.buildTool)}</code>` : ''}</p>
<h3>Build phases</h3>${phases || '<p class="muted">None.</p>'}
${sync}
<h3>Dependencies</h3>${deps}
${pk ? `<h3>Swift package products</h3>${pk}` : ''}
<h3>Build configurations</h3><ul>${cfg || '<li class="muted">None</li>'}</ul>`;
    $('count').textContent = q ? `${shown} matching file${shown === 1 ? '' : 's'} in ${esc(t.name)}` : '';
  }
  const copyDest = (s) => ({ 0: 'Absolute path', 1: 'Wrapper', 6: 'Executables', 7: 'Resources', 10: 'Frameworks', 11: 'Shared frameworks', 12: 'Shared support', 13: 'Plug-ins', 15: 'Java resources', 16: 'Products directory' })[s] || `folder ${s}`;

  // ---------- files ----------
  function drawFiles(q) {
    if (!data.tree) { $('view').innerHTML = '<p class="muted">This project has no main group.</p>'; return; }
    const miss = missingSet();
    let hits = 0;
    const match = (nd) => (nd.name + ' ' + nd.full).toLowerCase().includes(q);
    function keep(nd) { // with a query: the node matches or holds a match
      if (!q) return true;
      if (match(nd)) return true;
      return (nd.children || []).some(keep);
    }
    function li(nd) {
      if (!keep(nd)) return '';
      const isGroup = nd.children && nd.children.length > 0 || ['group', 'variant', 'version', 'sync'].includes(nd.kind);
      if (q && match(nd)) hits++;
      const isClosed = !q && closed.has(nd.id);
      const cls = [nd.missingObject ? 'bad' : miss.has(nd.id) ? 'warn' : '', q && match(nd) ? 'hit' : ''].join(' ').trim();
      const kids = isGroup && nd.children && nd.children.length && !isClosed ? `<ul>${nd.children.map(li).join('')}</ul>` : '';
      return `<li class="${isGroup ? 'grp' : 'file'}${isClosed ? ' closed' : ''}"><div class="frow ${cls}" data-id="${esc(nd.id)}"><span class="tw">${isGroup && nd.children && nd.children.length ? (isClosed ? '▸' : '▾') : ''}</span><span class="ic ic-${esc(nd.kind)}"></span>${lineLink(nd.line, nd.name)}<span class="fp muted">${esc(nd.full)}</span>${nd.targets.length ? `<span class="tg">${nd.targets.map(esc).join(', ')}</span>` : ''}${nd.missingObject ? '<span class="tag bad">missing object</span>' : miss.has(nd.id) ? '<span class="tag warn">not on disk</span>' : ''}</div>${kids}</li>`;
    }
    const html = li(data.tree);
    $('view').innerHTML = `<p class="muted">Groups and files as in the project navigator, with each file's path from the project folder and the targets that build it.${data.inBundle ? '' : ' The disk check is off: this file is not inside a .xcodeproj folder.'}</p><ul id="fileTree" class="ftree">${html || '<li class="muted">No file matches the search.</li>'}</ul>`;
    $('count').textContent = q ? `${hits} match${hits === 1 ? '' : 'es'}` : '';
  }

  // ---------- build settings ----------
  function requestSettings() {
    settingsState.req++;
    settingsState.rows = null;
    vscode.postMessage({ type: 'settings', req: settingsState.req, target: settingsState.target === '__project' ? '' : settingsState.target, config: settingsState.config });
  }
  function drawSettings(q) {
    const opts = [`<option value="__project"${settingsState.target === '__project' ? ' selected' : ''}>Project</option>`].concat(data.targets.map((t) => `<option value="${esc(t.id)}"${t.id === settingsState.target ? ' selected' : ''}>${esc(t.name)}</option>`)).join('');
    const cfgs = data.configNames.map((c) => `<option${c === settingsState.config ? ' selected' : ''}>${esc(c)}</option>`).join('');
    if (!settingsState.rows) {
      $('view').innerHTML = `<div class="filters"><label>Target <select id="setTarget">${opts}</select></label><label>Configuration <select id="setConfig">${cfgs}</select></label></div><p class="muted">Reading the settings...</p>`;
      requestSettings();
      return;
    }
    const meta = settingsState.meta;
    let rows = settingsState.rows;
    if (settingsState.onlyHere) rows = rows.filter((r) => r.from === 'target' || (settingsState.target === '__project' && r.from === 'project'));
    if (q) rows = rows.filter((r) => (r.key + ' ' + r.value).toLowerCase().includes(q));
    const isTarget = settingsState.target !== '__project';
    const body = rows.map((r) => `<tr class="${r.from === 'target' ? 'own' : ''}" data-key="${esc(r.key)}"><td class="pn">${r.line ? lineLink(r.line, r.key) : esc(r.key)}</td><td class="pv"><code>${esc(r.value)}</code></td><td class="lv">${esc(r.fromLabel)}${r.usesInherited ? ' <span class="muted">+ inherited</span>' : ''}</td>${isTarget ? `<td class="pv muted"><code>${esc(r.raw.project !== undefined ? r.raw.project : r.raw.projectXcconfig !== undefined ? r.raw.projectXcconfig : '')}</code></td>` : ''}</tr>`).join('');
    $('view').innerHTML = `<div class="filters"><label>Target <select id="setTarget">${opts}</select></label><label>Configuration <select id="setConfig">${cfgs}</select></label><label><input type="checkbox" id="onlyHere"${settingsState.onlyHere ? ' checked' : ''}> Only settings set ${isTarget ? 'on the target' : 'here'}</label> <span class="muted">${rows.length} of ${settingsState.rows.length}</span></div>
${meta && !meta.hasTargetConfig && isTarget ? `<p class="muted">The target has no "${esc(settingsState.config)}" configuration.</p>` : ''}
${meta && (meta.xcconfig.project || meta.xcconfig.target) ? `<p class="muted">Based on ${[meta.xcconfig.project ? `project: ${esc(meta.xcconfig.project)}` : '', meta.xcconfig.target ? `target: ${esc(meta.xcconfig.target)}` : ''].filter(Boolean).join(', ')}.</p>` : ''}
<p class="muted">Resolved values: the target level wins over the project level, and $(inherited) takes the value from the level below. Xcode's own SDK defaults are not in the project file and are not listed.</p>
<table id="settingsTable" class="sort"><thead><tr><th>Setting</th><th>Value</th><th>Set at</th>${isTarget ? '<th>Project value</th>' : ''}</tr></thead><tbody>${body || `<tr><td colspan="4" class="muted">${q ? 'No setting matches the search.' : 'No settings.'}</td></tr>`}</tbody></table>`;
    $('count').textContent = q ? `${rows.length} matching setting${rows.length === 1 ? '' : 's'}` : '';
  }

  // ---------- packages ----------
  function drawPackages(q) {
    const list = data.packages.filter((p) => !q || (p.name + ' ' + p.url + ' ' + p.path + ' ' + p.products.map((x) => x.name).join(' ')).toLowerCase().includes(q));
    const rows = list.map((p) => `<tr><td>${lineLink(p.line, p.name)}${p.missing ? ' <span class="tag bad">missing object</span>' : ''}</td><td><code>${esc(p.url || p.path)}</code>${p.local ? ' <span class="muted">(local)</span>' : ''}</td><td>${esc(p.requirement)}</td><td>${p.products.map((x) => `${esc(x.name)}${x.targets.length ? ` <span class="muted">in ${x.targets.map(esc).join(', ')}</span>` : ''}`).join('<br>')}</td></tr>`).join('');
    $('view').innerHTML = data.packages.length ? `<table id="packageTable"><thead><tr><th>Package</th><th>Location</th><th>Version rule</th><th>Products and targets</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No package matches the search.</td></tr>'}</tbody></table>` : '<p class="muted">This project has no Swift package references.</p>';
    $('count').textContent = q ? `${list.length} match${list.length === 1 ? '' : 'es'}` : '';
  }

  // ---------- warnings ----------
  function drawWarnings(q) {
    const w = allWarnings().filter((x) => !q || x.message.toLowerCase().includes(q));
    const label = { error: 'Error', warning: 'Warning', note: 'Note' };
    const diskLine = !data.inBundle ? 'The disk check is off: this file is not inside a .xcodeproj folder.' : disk ? `${n(disk.checked)} paths looked up on disk, ${disk.missing.length} not found.` : 'Looking for the project files on disk...';
    $('view').innerHTML = `<p class="muted">${diskLine} The view is read-only: nothing here changes the file.</p>${w.length ? `<table id="warnTable"><thead><tr><th>Level</th><th>Line</th><th>Message</th></tr></thead><tbody>${w.map((x) => `<tr class="lvl-${x.level}" data-kind="${esc(x.kind)}"><td>${label[x.level]}</td><td>${lineLink(x.line, String(x.line || ''))}</td><td>${esc(x.message)}</td></tr>`).join('')}</tbody></table>` : `<p id="noWarnings">${q ? 'No warning matches the search.' : 'No broken references found.'}</p>`}
${data.warnings.some((x) => x.kind === 'dangling' || x.kind === 'dupObject' || x.kind === 'dupItem') ? '<p><button class="tb" id="wMerge">Fix with the Merge Conflict Helper (Pro)</button></p>' : ''}`;
    if ($('wMerge')) $('wMerge').onclick = () => vscode.postMessage({ type: 'tool', tool: 'merge' });
    $('count').textContent = q ? `${w.length} match${w.length === 1 ? '' : 'es'}` : '';
  }

  // ---------- events ----------
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init') init(m);
    else if (m.type === 'disk') {
      disk = m;
      if (!data) return;
      const note = $('diskNote');
      if (note) note.textContent = m.skipped ? 'Skipped: this file is not inside a .xcodeproj folder, so file paths cannot be checked.' : `${n(m.checked)} paths looked up, ${m.missing.length} not found${m.missing.length ? ' (see Warnings)' : ''}.`;
      warnBadge();
      if (tab !== 'settings') draw();
    } else if (m.type === 'settings') {
      if (m.req !== settingsState.req) return;
      settingsState.rows = m.rows;
      settingsState.meta = m;
      if (tab === 'settings') draw();
    } else if (m.type === 'focus') {
      if (m.tab) setTab(m.tab);
    }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.ln');
    if (a) { e.preventDefault(); vscode.postMessage({ type: 'reveal', line: Number(a.dataset.line) }); return; }
    const c = e.target.closest('a.cfg');
    if (c) { e.preventDefault(); settingsState.target = selTarget; settingsState.config = c.dataset.config; settingsState.rows = null; setTab('settings'); return; }
    const tb = e.target.closest('#tabs .tab');
    if (tb) { setTab(tb.dataset.tab); return; }
    const tr = e.target.closest('.trow');
    if (tr) { selTarget = tr.dataset.target; draw(); return; }
    const fr = e.target.closest('.frow');
    if (fr && e.target.closest('.tw')) { const id = fr.dataset.id; if (closed.has(id)) closed.delete(id); else closed.add(id); draw(); return; }
    if (e.target.closest('#openText')) vscode.postMessage({ type: 'openText' });
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d && d.classList && d.classList.contains('phase')) { if (d.open) openPhases.add(d.dataset.key); else openPhases.delete(d.dataset.key); }
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.id === 'setTarget') { settingsState.target = e.target.value; settingsState.rows = null; draw(); }
    else if (e.target.id === 'setConfig') { settingsState.config = e.target.value; settingsState.rows = null; draw(); }
    else if (e.target.id === 'onlyHere') { settingsState.onlyHere = e.target.checked; draw(); }
  });
  let timer = null;
  $('search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = $('search').value; draw(); }, 150); });
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('search').value = ''; query = ''; draw(); } });
  vscode.postMessage({ type: 'ready' });
}());
