import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = { window: {} };
vm.runInNewContext(await readFile(path.join(root, 'model-data.js'), 'utf8'), context);
const model = JSON.parse(JSON.stringify(context.window.TMIS_MODEL));
const revisionBytes = await readFile(path.join(root, 'source', 'TMIS-schema-v3.json'));
assert.equal(createHash('sha256').update(revisionBytes).digest('hex'), model.revisionSha256);
const revision = JSON.parse(revisionBytes);
assert.equal(model.schema, 'tmis_v3');
assert.equal(model.tables.length, 46);
assert.equal(model.tables.reduce((sum, table) => sum + table.rows.length, 0), 355);
assert.equal(model.relationships.length, 109);
assert.equal(new Set(model.relationships.map((edge) => edge.id)).size, 109);
assert.deepEqual(model.tables.map(t => t.id), revision.tables.map(t => t.id));

// Compare every field and relationship with the current downloadable Mermaid.
const mermaid = await readFile(path.join(root, 'source', 'TMIS-schema.mmd'), 'utf8');
const schemaTables = [...mermaid.matchAll(/^    (\w+) \{\n([\s\S]*?)^    \}/gm)];
assert.equal(schemaTables.length, model.tables.length);
for (const [, name, body] of schemaTables) {
  const table = model.tables.find((item) => item.id === name);
  assert.ok(table, `Missing table ${name}`);
  const fields = body.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\S+) (\w+)(?: ((?:PK|FK|UK)(?:,(?:PK|FK|UK))*))?(?: "([^"]+)")?$/);
    assert.ok(match, `Unparsed field: ${line}`);
    return [match[1], match[2], match[3] || '', match[4] || ''];
  });
  assert.deepEqual(table.rows.map((row) => [row.cells[0].value, row.cells[1].value, row.cells[2].value, [...row.cells.slice(3).map(cell => cell.value).filter(Boolean), row.nullable ? 'nullable' : 'not null'].join('; ')]), fields, name);
  const definition = revision.tables.find(t => t.id === name);
  assert.deepEqual(table.uniqueTogether, definition.uniqueTogether || [], `${name} composite uniqueness`);
  assert.deepEqual(table.rows.map(r => [r.cells[0].value, r.cells[1].value, r.cells[2].value, r.nullable]), definition.fields.map(f => [f.type, f.name, f.key || '', !!f.nullable]), `${name} transcription`);
  assert.equal(new Set(definition.fields.map(f => f.name)).size, definition.fields.length, `${name} duplicate fields`);
  assert.equal(definition.fields.filter(f => (f.key || '').includes('PK')).length, 1, `${name} primary key`);
  for (const unique of table.uniqueTogether) for (const field of unique) assert.ok(definition.fields.some(f => f.name === field), `${name}.${field} unique field exists`);
  for (const row of table.rows) {
    const field = row.cells[1].value;
    const spec = definition.fields.find(f => f.name === field);
    const edge = model.relationships.find(e => e.target === name && e.label === field);
    assert.equal(!!edge, !!spec.references, `${name}.${field} foreign key`);
    if (edge) {
      assert.equal(edge.source, spec.references);
      assert.ok(model.tables.some(t => t.id === edge.source), 'Foreign key target exists');
      assert.equal(edge.parentOptional, !!spec.nullable);
      assert.equal(edge.childUnique, (spec.key || '').includes('UK') || spec.key === 'PK,FK');
      assert.equal(edge.omittedInReference, !!spec.omitted);
    }
  }
}
const sourceEdges = [...mermaid.matchAll(/^    (\w+) (\|[|o])\.\.(o[|{]) (\w+) : (\w+)$/gm)].map(([, from, parent, child, to, field]) => `${from}|${to}|${field}|${parent}|${child}`).sort();
assert.deepEqual(model.relationships.map((edge) => `${edge.source}|${edge.target}|${edge.label}|${edge.parentOptional ? '|o' : '||'}|${edge.childUnique ? 'o|' : 'o{'}`).sort(), sourceEdges);
assert.equal(model.relationships.filter(edge => edge.omittedInReference).length, 55);
assert.equal(model.relationships.filter(edge => !edge.omittedInReference).length, 54);
assert.deepEqual(model.relationships.filter(edge => edge.childUnique).map(edge => `${edge.target}.${edge.label}`).sort(), ['activity.calendar_entry_id', 'certificate_rule.activity_id', 'participant_profile.user_id']);
assert.ok(!model.tables.some(t => ['program_flow', 'output', 'output_photo'].includes(t.id)), 'Superseded v2 tables should be replaced');
console.log('PASS: v3 source hash, 46 tables, 355 fields, constraints, and 109 relationships (54 drawn + 55 omitted links).');

vm.runInNewContext(await readFile(path.join(root, 'layout.js'), 'utf8'), context);
const layout = JSON.parse(JSON.stringify(context.window.TMIS_LAYOUT));
assert.deepEqual(JSON.parse(JSON.stringify(context.window.TMIS_MODEL)), model, 'Layout must not mutate the source model');
for (let i = 0; i < model.tables.length; i++) {
  const before = model.tables[i], after = layout.tables[i];
  assert.equal(after.box.width, before.box.width, `${before.id}: width must stay exact`);
  assert.equal(after.box.height, before.box.height, `${before.id}: height must stay exact`);
  assert.deepEqual(after.rows, before.rows, `${before.id}: cells and text must stay exact`);
  for (let j = i + 1; j < model.tables.length; j++) {
    const originalOther = model.tables[j].box, other = layout.tables[j].box;
    for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
      if (before.box[axis] + before.box[size] <= originalOther[axis]) {
        assert.ok(after.box[axis] + after.box[size] <= other[axis] + .001, 'Compaction must preserve separation and ordering');
      }
    }
  }
}
const extent = tables => {
  const width = Math.max(...tables.map(t => t.box.x + t.box.width)) - Math.min(...tables.map(t => t.box.x));
  const height = Math.max(...tables.map(t => t.box.y + t.box.height)) - Math.min(...tables.map(t => t.box.y));
  return width * height;
};
assert.ok(extent(layout.tables) < extent(model.tables) * .80, 'Layout should remove at least 20% of the overall area');
console.log('PASS: compact layout, unchanged table/cell sizes and contents, preserved ordering, and unmodified source geometry.');

const candidates = [process.env.TMIS_BROWSER, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
let browserPath;
for (const candidate of candidates) {
  try { await access(candidate); browserPath = candidate; break; } catch { /* Try the next installed browser. */ }
}
assert.ok(browserPath, 'Install Chrome/Edge or set TMIS_BROWSER to its executable.');
const profile = await mkdtemp(path.join(tmpdir(), 'tmis-browser-'));
const qaDir = path.resolve(process.env.TMIS_QA_DIR || path.join(tmpdir(), 'tmis-datamodel-qa'));
await mkdir(qaDir, { recursive: true });
let browser;
let socket;
let sessionId;
let sequence = 0;
const pending = new Map();
const errors = [];
const remoteRequests = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function send(method, params = {}, browserScope = false) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(!browserScope && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function settled() { await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); }
async function click(selector) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing click target'); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await settled();
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(qaDir, name), Buffer.from(result.data, 'base64'));
}
async function openExplorer() {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 240 });
  await delay(260);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 130, y: 240 });
  assert.equal(await evaluate('document.querySelector("#explorer-toggle").getAttribute("aria-expanded")'), 'true', 'Left edge must reveal the explorer');
}
async function leaveExplorer() {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 120 });
  await delay(480);
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), true, 'Explorer must hide when the pointer leaves');
}

try {
  const websocketUrl = await new Promise((resolve, reject) => {
    browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('Browser did not start within 20 seconds.')), 20000);
    let output = '';
    browser.stderr.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.once('error', (error) => { clearTimeout(timer); reject(error); });
    browser.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Browser exited (${code}) before starting.`)); });
  });
  socket = new WebSocket(websocketUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) remoteRequests.push(message.params.request.url);
  });
  const target = await send('Target.createTarget', { url: 'about:blank' }, true);
  sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, true)).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'index.html')).href });
  let loaded = false;
  for (let i = 0; i < 100; i++) {
    if (await evaluate('document.querySelectorAll(".diagram-table").length === 46')) { loaded = true; break; }
    await delay(50);
  }
  assert.ok(loaded, 'The local viewer did not load.');
  await settled();
  await screenshot('overview.png');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".table-title")).fontSize'), '14px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".field-text")).fontSize'), '14px');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".table-body")].map(el => [Number(el.getAttribute("width")), Number(el.getAttribute("height"))])'), model.tables.map(t => [t.box.width, t.box.height]));
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'dark');
  const canvasSize = await evaluate('({width:document.querySelector("#diagram").clientWidth,height:document.querySelector("#diagram").clientHeight})');
  assert.deepEqual(canvasSize, { width: 1440, height: 960 }, 'Diagram must fill the entire viewport');
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), true, 'Drawer starts collapsed');
  const initialCamera = await evaluate('document.querySelector("#diagram").getAttribute("viewBox")');
  await openExplorer();
  assert.equal(await evaluate('document.querySelector("#diagram").getAttribute("viewBox")'), initialCamera, 'Opening explorer must not resize or move diagram');
  await leaveExplorer();
  console.log('PASS: dark full-window canvas and left-edge reveal/hide without camera changes.');
  assert.deepEqual(await evaluate('({tables:document.querySelectorAll(".diagram-table").length,edges:document.querySelectorAll(".edge").length,fields:document.querySelectorAll(".field-row").length})'), { tables: 46, edges: 109, fields: 355 });
  const interactionResults = await evaluate(`(() => {
    const m = window.TMIS_MODEL;
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    const query = (selector) => [...document.querySelectorAll(selector)];
    const fire = (el) => el.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    for (const table of m.tables) {
      const node = query('.diagram-table').find(el => el.dataset.table === table.id);
      assert(node.querySelector('.table-title').textContent === table.id, 'Table name changed');
      assert(JSON.stringify(query('[data-table="'+table.id+'"] .field-text').map(el => el.textContent)) === JSON.stringify(table.rows.flatMap(row => row.cells.map(cell => cell.value))), 'Rendered fields changed: '+table.id);
      fire(node.querySelector('.field-text'));
      const expected = m.relationships.filter(e => e.source === table.id || e.target === table.id);
      const actual = query('.edge.is-active').map(el => el.dataset.edge).sort();
      assert(JSON.stringify(actual) === JSON.stringify(expected.map(e => e.id).sort()), 'Wrong adjacency: '+table.id);
      assert(query('.diagram-table.is-selected').length === 1, 'Table selection failed');
      assert(query('.diagram-table.is-connected').length === new Set(expected.flatMap(e => [e.source,e.target]).filter(id => id !== table.id)).size, 'Neighbor selection failed');
    }
    for (const edge of m.relationships) {
      const node = query('.edge').find(el => el.dataset.edge === edge.id);
      assert(node.querySelector('.edge-line').getAttribute('marker-start') === (edge.parentOptional ? 'url(#optional-one)' : 'url(#one)'), 'Wrong parent cardinality: '+edge.id);
      assert(node.querySelector('.edge-line').getAttribute('marker-end') === (edge.childUnique ? 'url(#optional-one)' : 'url(#many)'), 'Wrong child cardinality: '+edge.id);
      fire(node.querySelector('.edge-hit'));
      assert(query('.edge.is-active').length === 1 && node.classList.contains('is-selected'), 'Exact edge failed: '+edge.id);
      assert(JSON.stringify(query('.diagram-table.is-connected').map(el => el.dataset.table).sort()) === JSON.stringify([edge.source,edge.target].sort()), 'Endpoint selection failed');
      assert(JSON.stringify(query('.field-row.is-key').map(el => el.dataset.field).sort()) === JSON.stringify(['id',edge.label].sort()), 'Key highlighting failed: '+edge.id);
    }
    document.querySelector('#clear-selection').click();
    assert(query('.is-dimmed').length === 0 && query('.is-key').length === 0, 'Clear did not reset diagram');
    return {tables:m.tables.length,relationships:m.relationships.length};
  })()`);
  console.log(`PASS: all ${interactionResults.tables} table selections, ${interactionResults.relationships} exact relationship selections, PK/FK highlights, and clear.`);

  await openExplorer();
  await click('.table-item[data-table="activity_type"]');
  assert.equal(await evaluate('document.querySelector(".diagram-table.is-selected").dataset.table'), 'activity_type');
  await delay(180);
  assert.equal(await evaluate('[...document.querySelectorAll(".diagram-table.is-dimmed")].every(el => Number(getComputedStyle(el).opacity) >= .6)'), true, 'Unrelated tables must remain readable');
  assert.equal(await evaluate('[...document.querySelectorAll(".edge.is-dimmed")].every(el => Number(getComputedStyle(el).opacity) >= .35)'), true, 'Unrelated lines must remain visible');
  assert.ok(await evaluate('Number.parseFloat(getComputedStyle(document.querySelector(".edge.is-active .edge-line")).strokeWidth)') < 2, 'Highlight lines should be restrained');
  await screenshot('table-selection.png');
  await click('.relation-item');
  await screenshot('relationship-selection.png');
  const selectedEdge = await evaluate('document.querySelector(".edge.is-selected").dataset.edge');
  await click('#clear-selection');
  await click(`.edge[data-edge="${selectedEdge}"] .edge-label`);
  assert.equal(await evaluate('document.querySelector(".edge.is-selected")?.dataset.edge'), selectedEdge, 'Real click on relationship label failed');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await click('.diagram-table[data-table="activity_type"] .table-title');
  assert.equal(await evaluate('document.querySelector(".diagram-table.is-selected")?.dataset.table'), 'activity_type', 'Real click on table failed');
  await evaluate('document.querySelector(".diagram-table[data-table=activity_type]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate('document.querySelectorAll(".is-dimmed").length'), 0);

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash' });
  assert.equal(await evaluate('document.activeElement.id'), 'search', 'Search shortcut opens and focuses explorer');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 120 });
  await delay(450);
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), false, 'Keyboard users keep the panel open');

  assert.deepEqual(await evaluate(`(() => {
    const search = document.querySelector('#search');
    search.value = 'client_id'; search.dispatchEvent(new Event('input'));
    return [...document.querySelectorAll('.table-item')].filter(el => getComputedStyle(el).display !== 'none').map(el => el.dataset.table);
  })()`), ['attendance', 'feedback', 'output_submission', 'reentry_plan']);
  await evaluate(`document.querySelector('#search').value = 'not_a_real_table'; document.querySelector('#search').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".empty-search")).display !== "none"'), true);
  await evaluate(`document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input'))`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'explorer-toggle', 'Escape restores keyboard focus');

  const beforeZoom = await evaluate('document.querySelector("#diagram").viewBox.baseVal.width');
  await click('#zoom-in');
  assert.ok(await evaluate('document.querySelector("#diagram").viewBox.baseVal.width') < beforeZoom);
  const canvas = await evaluate('(() => {const r=document.querySelector("#diagram").getBoundingClientRect();return {x:r.x+400,y:r.y+100};})()');
  const beforePan = await evaluate('document.querySelector("#diagram").viewBox.baseVal.x');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...canvas });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: canvas.x + 80, y: canvas.y + 45 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: canvas.x + 80, y: canvas.y + 45 });
  await settled();
  assert.notEqual(await evaluate('document.querySelector("#diagram").viewBox.baseVal.x'), beforePan);
  await click('#fit-all');
  assert.equal(await evaluate(`(() => {const b=document.querySelector('#diagram').viewBox.baseVal;return window.TMIS_LAYOUT.tables.every(t => t.box.x >= b.x && t.box.y >= b.y && t.box.x+t.box.width <= b.x+b.width && t.box.y+t.box.height <= b.y+b.height)})()`), true);
  console.log('PASS: real mouse clicks, keyboard selection/reset, search, zoom, pan, and fit.');

  await click('#fullscreen');
  await delay(200);
  assert.equal(await evaluate('Boolean(document.fullscreenElement)'), true, 'Full-screen button should enter full screen');
  await click('#fullscreen');
  await delay(200);
  assert.equal(await evaluate('Boolean(document.fullscreenElement)'), false, 'Full-screen button should exit full screen');
  console.log('PASS: subdued highlighting, keyboard drawer access, and full-screen toggle.');

  await evaluate('document.querySelector("#clear-selection").click()');
  await click('.diagram-table[data-table="activity_type"] .table-title');
  const cameraBeforeTheme = await evaluate('document.querySelector("#diagram").getAttribute("viewBox")');
  await click('#theme-toggle');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#viewport")).backgroundColor'), 'rgb(245, 247, 250)');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".field-row:not(.is-key) .field-text")).fill'), 'rgb(52, 68, 90)');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#many circle")).fill'), 'rgb(245, 247, 250)');
  assert.equal(await evaluate('document.querySelector("#diagram").getAttribute("viewBox")'), cameraBeforeTheme, 'Theme switching preserves the camera');
  assert.equal(await evaluate('document.querySelector(".diagram-table.is-selected").dataset.table'), 'activity_type', 'Theme switching preserves selection');
  assert.equal(await evaluate('document.querySelector("#theme-toggle").getAttribute("aria-label")'), 'Switch to dark mode');
  await openExplorer();
  await screenshot('light-selection.png');
  await leaveExplorer();
  await evaluate('window.beforeThemeReload = true');
  await send('Page.reload');
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!window.beforeThemeReload && document.readyState === "complete" && document.querySelectorAll(".diagram-table").length === 31')) break;
    await delay(50);
  }
  await settled();
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light', 'Saved theme survives reload');
  await evaluate('document.querySelector("#theme-toggle").focus()');
  assert.equal(await evaluate('document.activeElement.id'), 'theme-toggle');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'dark', 'Keyboard activates the theme toggle');
  assert.equal(await evaluate('localStorage.getItem("tmis-theme")'), 'dark');
  console.log('PASS: light/dark colors, SVG markers, preserved selection/camera, reload persistence, and keyboard toggle.');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settled();
  await click('#fit-all');
  await screenshot('mobile.png');
  await click('#theme-toggle');
  await screenshot('mobile-light.png');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light');
  assert.equal(await evaluate('document.querySelector("#explorer-toggle").getBoundingClientRect().right < document.querySelector(".canvas-toolbar").getBoundingClientRect().left'), true, 'Mobile toolbar controls must not overlap');
  await click('#theme-toggle');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Mobile layout overflows horizontally');
  assert.equal(await evaluate('document.querySelector("#diagram").clientHeight === window.innerHeight'), true, 'Mobile diagram must fill screen');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  async function tap(x, y) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(260);
  }
  await tap(45, 25);
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), false, 'Touch handle opens drawer');
  await screenshot('mobile-explorer.png');
  await tap(370, 400);
  assert.equal(await evaluate('document.querySelector("#explorer").inert'), true, 'Touch outside closes drawer');
  const mobileBox = await evaluate('(() => {const r=document.querySelector("#diagram").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  const beforePinch = await evaluate('document.querySelector("#diagram").viewBox.baseVal.width');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: mobileBox.x - 30, y: mobileBox.y }, { id: 2, x: mobileBox.x + 30, y: mobileBox.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: mobileBox.x - 65, y: mobileBox.y }, { id: 2, x: mobileBox.x + 65, y: mobileBox.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled();
  assert.ok(await evaluate('document.querySelector("#diagram").viewBox.baseVal.width') < beforePinch, 'Pinch zoom failed');
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  assert.deepEqual(remoteRequests, [], 'The viewer should make no network requests');
  console.log('PASS: mobile layout, touch pinch, no runtime errors, and fully offline loading.');
  console.log(`Screenshots: ${qaDir}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close', {}, true); } catch { /* Process cleanup below. */ }
    socket.close();
  }
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(1500)]);
    if (browser.exitCode === null) browser.kill();
  }
  for (const item of pending.values()) clearTimeout(item.timer);
  // Delete only the dedicated, absolute temporary profile created by this test.
  const resolvedProfile = path.resolve(profile);
  if (path.dirname(resolvedProfile) === path.resolve(tmpdir()) && path.basename(resolvedProfile).startsWith('tmis-browser-')) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
}
