// Panel of a Zovo Pro tool (project comparison, build settings of two targets): the report HTML comes from the
// extension host. Sortable tables (click a column head), an "only differences" filter and links to lines. No network request.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  function sortable(table) {
    const head = table.tHead;
    if (!head) return;
    [...head.rows[0].cells].forEach((th, col) => {
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        const body = table.tBodies[0];
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        [...head.rows[0].cells].forEach((h) => delete h.dataset.dir);
        th.dataset.dir = dir;
        const key = (tr) => { const c = tr.cells[col]; const t = c ? (c.dataset.sort || c.textContent) : ''; return t; };
        const num = (s) => (/^0x[0-9a-f]+$/i.test(s) ? BigInt(s) : /^-?\d+$/.test(s) ? BigInt(s) : null);
        const rows = [...body.rows].sort((a, b) => {
          const x = key(a), y = key(b); const nx = num(x), ny = num(y);
          let r;
          if (nx !== null && ny !== null) r = nx < ny ? -1 : nx > ny ? 1 : 0;
          else if (nx !== null) r = -1; else if (ny !== null) r = 1;
          else r = x.localeCompare(y);
          return dir === 'asc' ? r : -r;
        });
        for (const r of rows) body.appendChild(r);
      });
    });
  }
  function filters() {
    const only = $('onlyDiff');
    if (!only) return;
    const apply = () => { for (const tr of document.querySelectorAll('#cmpTable tbody tr')) tr.hidden = only.checked && tr.dataset.kind === 'same'; };
    only.addEventListener('change', apply);
    apply();
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'show') {
      $('title').textContent = m.title || '';
      document.title = m.title || document.title;
      $('report').innerHTML = m.html;
      document.querySelectorAll('table.sort').forEach(sortable);
      filters();
      document.body.dataset.state = 'shown';
      vscode.postMessage({ type: 'shown' });
    } else if (m.type === 'patch') {
      const t = $(m.target);
      if (t) t.innerHTML = m.html;
    }
  });
  document.addEventListener('click', (e) => {
    const l = e.target.closest('a.act-line');
    if (l) { e.preventDefault(); vscode.postMessage({ type: 'action', id: 'line', line: Number(l.dataset.line) }); return; }
    const b = e.target.closest('button.act');
    if (b) vscode.postMessage({ type: 'action', id: b.dataset.id });
  });
  vscode.postMessage({ type: 'ready' });
}());
