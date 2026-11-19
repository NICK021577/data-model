/* Offline viewer: build the SVG once, then update selection classes and the camera. */
(() => {
  'use strict';
  const model = window.TMIS_LAYOUT;
  const byId = (id) => document.getElementById(id);
  const diagram = byId('diagram');
  const edgeLayer = byId('edge-layer');
  const tableLayer = byId('table-layer');
  const tableList = byId('table-list');
  const details = byId('selection-details');
  const search = byId('search');
  const viewport = byId('viewport');
  const explorer = byId('explorer');
  const explorerToggle = byId('explorer-toggle');
  const explorerHotspot = byId('explorer-hotspot');
  const tables = new Map(model.tables.map((table) => [table.id, table]));
  const edges = new Map(model.relationships.map((edge) => [edge.id, edge]));
  const adjacent = new Map(model.tables.map((table) => [table.id, []]));
  const tableViews = new Map();
  const edgeViews = new Map();
  const listViews = new Map();
  const routes = new Map();
  let selection = null;
  let activeTables = new Set();
  let activeEdges = new Set();
  let camera = { x: 0, y: 0, scale: 1 };
  let frame = 0;
  let viewportSize = { width: 0, height: 0 };

  function html(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function fieldName(row) { return row.cells[1].value; }
  function edgeDescription(edge) { return `${edge.source}.id → ${edge.target}.${edge.label}`; }
  function edgeCardinality(edge) { return `${edge.parentOptional ? 'Zero or one' : 'One'} → ${edge.childUnique ? 'zero or one' : 'zero or many'}`; }
  function endpoint(table, anchor) {
    const b = table.box;
    return [b.x + b.width * anchor[0], b.y + b.height * anchor[1]];
  }
  function labelPoint(points, position) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) * (position + 1) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const ratio = lengths[i] ? remaining / lengths[i] : 0;
        return points[i].map((value, axis) => value + (points[i + 1][axis] - value) * ratio);
      }
      remaining -= lengths[i];
    }
    return points[0];
  }

  // Use the actual draw.io cells, including their column order and decimal comments.
  function renderTable(table) {
    const { x, y, width, height } = table.box;
    const group = svg('g', {
      class: 'diagram-table', 'data-table': table.id, transform: `translate(${x} ${y})`,
      tabindex: 0, role: 'button', 'aria-pressed': 'false',
      'aria-label': `${table.id}, ${table.rows.length} fields. Highlight connected relationships.`,
      style: `--table-fill:${table.fill};--table-color:${table.stroke}`,
    });
    group.append(svg('title', {}, table.id), svg('rect', { class: 'table-body', width, height, rx: 3 }));
    group.append(svg('text', { class: 'table-title', x: width / 2, y: table.rows[0].box.y / 2 }, table.id));
    const rowViews = new Map();
    let grid = '';
    table.rows.forEach((row) => {
      const rowGroup = svg('g', { class: 'field-row', 'data-field': fieldName(row), transform: `translate(${row.box.x} ${row.box.y})` });
      rowGroup.append(svg('rect', { class: 'field-highlight', width: row.box.width, height: row.box.height }));
      row.cells.forEach((cell, index) => {
        const text = svg('text', { class: 'field-text', x: cell.box.x + 8, y: cell.box.y + cell.box.height / 2 }, cell.value);
        if (index === 1 && row.nullable) text.setAttribute('font-style', 'italic');
        if (index === 2 && cell.value.includes(',')) {
          text.setAttribute('textLength', cell.box.width - 12);
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
        rowGroup.append(text);
        if (cell.box.x) grid += `M${cell.box.x} ${row.box.y}v${row.box.height}`;
      });
      rowGroup.append(svg('title', {}, [...row.cells.map((cell) => cell.value).filter(Boolean), row.nullable ? 'nullable' : 'not null'].join(' · ')));
      grid += `M0 ${row.box.y}H${width}`;
      rowViews.set(fieldName(row), rowGroup);
      group.append(rowGroup);
    });
    group.append(svg('path', { class: 'table-grid', d: grid, 'pointer-events': 'none' }));
    group.append(svg('rect', { class: 'table-outline', x: -5, y: -5, width: width + 10, height: height + 10, rx: 6 }));
    tableViews.set(table.id, { group, rows: rowViews });
    return group;
  }
  function renderEdge(edge) {
    adjacent.get(edge.source).push(edge.id);
    adjacent.get(edge.target).push(edge.id);
    const points = [endpoint(tables.get(edge.source), edge.start), ...edge.points, endpoint(tables.get(edge.target), edge.end)];
    routes.set(edge.id, points);
    const d = points.map((point, i) => `${i ? 'L' : 'M'}${point.join(' ')}`).join(' ');
    const group = svg('g', { class: 'edge', 'data-edge': edge.id, role: 'button', tabindex: 0, 'aria-pressed': 'false', 'aria-label': `${edgeDescription(edge)}. ${edgeCardinality(edge)}.` });
    group.append(svg('title', {}, `${edgeDescription(edge)} · ${edgeCardinality(edge)}`));
    group.append(svg('path', { class: 'edge-hit', d }));
    group.append(svg('path', { class: 'edge-line', d, 'marker-start': edge.parentOptional ? 'url(#optional-one)' : 'url(#one)', 'marker-end': edge.childUnique ? 'url(#optional-one)' : 'url(#many)' }));
    const label = labelPoint(points, edge.labelPosition);
    group.append(svg('text', { class: 'edge-label', x: label[0] + edge.labelOffset[0], y: label[1] + edge.labelOffset[1] }, edge.label));
    edgeViews.set(edge.id, group);
    return group;
  }
  const edgeFragment = document.createDocumentFragment();
  model.relationships.forEach((edge) => edgeFragment.append(renderEdge(edge)));
  edgeLayer.append(edgeFragment);
  const tableFragment = document.createDocumentFragment();
  model.tables.forEach((table) => tableFragment.append(renderTable(table)));
  tableLayer.append(tableFragment);

  const sortedTables = [...model.tables].sort((a, b) => a.id.localeCompare(b.id));
  sortedTables.forEach((table) => {
    const button = html('button', 'table-item');
    button.dataset.table = table.id;
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--table-color', table.stroke);
    button.append(html('span', 'table-dot'), html('span', '', table.id), html('span', 'field-count', String(table.rows.length)));
    button.title = `${table.id} · ${table.rows.length} fields · ${adjacent.get(table.id).length} relationships`;
    listViews.set(table.id, button);
    tableList.append(button);
  });
  const noResults = html('p', 'empty-search', 'No tables or fields match your search.');
  noResults.hidden = true;
  tableList.append(noResults);
  byId('schema-name').textContent = model.schema;
  byId('table-count').textContent = model.tables.length;
  [['tables', model.tables.length], ['relationships', model.relationships.length]].forEach(([label, count]) => {
    const stat = html('span');
    stat.append(html('b', '', count), document.createTextNode(` ${label}`));
    byId('model-counts').append(stat);
  });
  model.notes.forEach((note) => byId('model-notes').append(html('li', '', note)));

  // Edge proximity opens an overlay. Pointer leave closes it after a short grace
  // period, so moving between the edge, handle and panel never causes flicker.
  let explorerTimer;
  let keyboardNavigation = false;
  let lastPointerType = 'mouse';
  function showExplorer() {
    clearTimeout(explorerTimer);
    explorer.inert = false;
    explorer.setAttribute('aria-hidden', 'false');
    explorer.classList.add('is-open');
    document.body.classList.add('explorer-open');
    explorerToggle.setAttribute('aria-expanded', 'true');
  }
  function hideExplorer(restoreFocus = false) {
    clearTimeout(explorerTimer);
    const hadFocus = explorer.contains(document.activeElement);
    if (hadFocus) document.activeElement.blur();
    explorer.inert = true;
    explorer.setAttribute('aria-hidden', 'true');
    explorer.classList.remove('is-open');
    document.body.classList.remove('explorer-open');
    explorerToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && hadFocus) explorerToggle.focus({ preventScroll: true });
  }
  function scheduleExplorerHide() {
    clearTimeout(explorerTimer);
    explorerTimer = setTimeout(() => {
      if (keyboardNavigation && explorer.contains(document.activeElement)) return;
      if ([explorer, explorerToggle, explorerHotspot].some((node) => node.matches(':hover'))) return;
      hideExplorer();
    }, 220);
  }
  [explorer, explorerToggle, explorerHotspot].forEach((node) => {
    node.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch' && !event.buttons) showExplorer();
    });
    node.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') scheduleExplorerHide();
    });
  });
  explorerToggle.addEventListener('click', (event) => {
    showExplorer();
    if (event.detail === 0) { keyboardNavigation = true; search.focus(); }
  });
  byId('explorer-close').addEventListener('click', () => hideExplorer(keyboardNavigation));
  explorer.addEventListener('focusout', scheduleExplorerHide);
  document.addEventListener('pointerdown', (event) => {
    keyboardNavigation = false;
    lastPointerType = event.pointerType;
    if (!explorer.contains(event.target) && !explorerToggle.contains(event.target)) hideExplorer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') keyboardNavigation = true;
  });
  window.addEventListener('blur', () => hideExplorer());

  const fullscreen = byId('fullscreen');
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      byId('selection-status').textContent = 'Full screen is unavailable. The diagram still fills this window.';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreen.setAttribute('aria-pressed', String(active));
    fullscreen.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
    fullscreen.title = active ? 'Exit full screen' : 'Enter full screen';
  });

  function renderDetails() {
    const fragment = document.createDocumentFragment();
    if (!selection) {
      const empty = html('div', 'empty-selection');
      empty.append(html('div', 'selection-icon', '⌁'), html('p', '', 'Select a table to trace its connections, or a relationship to highlight both tables and the matching fields.'));
      fragment.append(empty);
    } else if (selection.kind === 'table') {
      const table = tables.get(selection.id);
      fragment.append(html('p', 'selected-name', table.id));
      fragment.append(html('p', 'selection-meta', `${table.rows.length} fields · ${activeEdges.size} relationships · ${activeTables.size - 1} connected tables`));
      fragment.append(html('h3', 'detail-label', 'Relationships'));
      adjacent.get(table.id).forEach((id) => {
        const edge = edges.get(id);
        const button = html('button', 'relation-item');
        button.dataset.edge = id;
        button.append(html('strong', '', `${edge.source} → ${edge.target}`), html('span', 'relation-field', `${edge.label} · ${edgeCardinality(edge)}`));
        fragment.append(button);
      });
      fragment.append(html('h3', 'detail-label', 'Fields'));
      const fieldTable = html('table', 'field-details');
      fieldTable.setAttribute('aria-label', `${table.id} fields`);
      const body = html('tbody');
      table.rows.forEach((row) => {
        const tr = html('tr');
        tr.append(html('td', '', fieldName(row)), html('td', '', [row.cells[0].value, ...row.cells.slice(3).map((cell) => cell.value), row.nullable ? 'nullable' : 'not null'].filter(Boolean).join(' · ')), html('td', '', row.cells[2].value));
        body.append(tr);
      });
      fieldTable.append(body);
      fragment.append(fieldTable);
      (table.uniqueTogether || []).forEach((fields) => fragment.append(html('p', 'selection-meta', `Unique together: ${fields.join(', ')}`)));
      (table.notes || []).forEach((note) => fragment.append(html('p', 'selection-meta', note)));
    } else {
      const edge = edges.get(selection.id);
      fragment.append(html('p', 'selected-name', edge.label));
      fragment.append(html('p', 'selection-meta', `${edgeCardinality(edge)} · Non-identifying relationship`));
      [[edge.source, 'Parent table · id'], [edge.target, `Child table · ${edge.label}`]].forEach(([id, label]) => {
        const button = html('button', 'endpoint-button');
        button.dataset.table = id;
        button.append(html('span', 'endpoint-label', label), document.createTextNode(id));
        fragment.append(button);
      });
      fragment.append(html('p', 'selection-meta', 'The line, both endpoint tables, and their matching key fields are highlighted.'));
    }
    details.replaceChildren(fragment);
    details.scrollTop = 0;
  }

  function select(kind, id) {
    if (id && selection?.kind === kind && selection.id === id) return;
    selection = id ? { kind, id } : null;
    activeEdges = new Set(id ? (kind === 'table' ? adjacent.get(id) : [id]) : []);
    activeTables = new Set(id && kind === 'table' ? [id] : []);
    const keyFields = new Map();
    const markField = (table, field) => {
      if (!keyFields.has(table)) keyFields.set(table, new Set());
      keyFields.get(table).add(field);
    };
    activeEdges.forEach((edgeId) => {
      const edge = edges.get(edgeId);
      activeTables.add(edge.source);
      activeTables.add(edge.target);
      markField(edge.source, 'id');
      markField(edge.target, edge.label);
    });
    tableViews.forEach((view, tableId) => {
      const selected = Boolean(selection && kind === 'table' && tableId === id);
      const connected = activeTables.has(tableId) && !selected;
      view.group.classList.toggle('is-selected', selected);
      view.group.classList.toggle('is-connected', connected);
      view.group.classList.toggle('is-dimmed', Boolean(selection && !activeTables.has(tableId)));
      view.group.setAttribute('aria-pressed', String(selected));
      view.rows.forEach((row, name) => row.classList.toggle('is-key', keyFields.get(tableId)?.has(name) ?? false));
      const button = listViews.get(tableId);
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-connected', connected);
      button.setAttribute('aria-pressed', String(selected));
    });
    edgeViews.forEach((group, edgeId) => {
      const active = activeEdges.has(edgeId);
      const selected = Boolean(selection && kind === 'edge' && edgeId === id);
      group.classList.toggle('is-active', active);
      group.classList.toggle('is-selected', selected);
      group.classList.toggle('is-dimmed', Boolean(selection && !active));
      group.setAttribute('aria-pressed', String(selected));
      // Raise connected paths over unrelated crossings; tables remain above all paths.
      if (active) edgeLayer.append(group);
    });
    byId('clear-selection').disabled = !selection;
    byId('fit-selection').disabled = !selection;
    byId('selection-status').textContent = !selection ? 'All tables visible' : kind === 'table' ? `${id} · ${activeEdges.size} relationships` : edgeDescription(edges.get(id));
    renderDetails();
  }

  function bounds(tableIds, edgeIds = []) {
    const points = [];
    tableIds.forEach((id) => {
      const b = tables.get(id).box;
      points.push([b.x, b.y], [b.x + b.width, b.y + b.height]);
    });
    edgeIds.forEach((id) => points.push(...routes.get(id)));
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  function size() { return { width: diagram.clientWidth, height: diagram.clientHeight }; }
  function drawCamera() {
    frame = 0;
    const { width, height } = size();
    diagram.setAttribute('viewBox', `${camera.x} ${camera.y} ${width / camera.scale} ${height / camera.scale}`);
    // Anchor the grid to the diagram while keeping its spacing legible at any zoom.
    let spacing = 100 * camera.scale;
    while (spacing < 12) spacing *= 5;
    while (spacing > 60) spacing /= 5;
    viewport.style.setProperty('--grid-minor', `${spacing}px`);
    viewport.style.setProperty('--grid-major', `${spacing * 5}px`);
    viewport.style.setProperty('--grid-x', `${(-camera.x * camera.scale) % (spacing * 5)}px`);
    viewport.style.setProperty('--grid-y', `${(-camera.y * camera.scale) % (spacing * 5)}px`);
    byId('zoom-reset').textContent = `${Math.round(camera.scale * 100)}%`;
  }
  function scheduleCamera() { if (!frame) frame = requestAnimationFrame(drawCamera); }
  function fit(box, maxScale = 1) {
    const { width, height } = size();
    const padding = Math.min(70, width * .1, height * .13);
    camera.scale = Math.max(.035, Math.min(maxScale, (width - padding * 2) / box.width, (height - padding * 2) / box.height));
    camera.x = box.x + box.width / 2 - width / camera.scale / 2;
    camera.y = box.y + box.height / 2 - height / camera.scale / 2;
    scheduleCamera();
  }
  function fitAll() { fit(bounds([...tables.keys()], [...edges.keys()])); }
  function fitSelection() { if (selection) fit(bounds([...activeTables], [...activeEdges])); }
  function zoom(factor, point) {
    const { width, height } = size();
    const [px, py] = point || [width / 2, height / 2];
    const next = Math.max(.035, Math.min(3, camera.scale * factor));
    camera.x += px / camera.scale - px / next;
    camera.y += py / camera.scale - py / next;
    camera.scale = next;
    scheduleCamera();
  }
  function selectElement(target, focus) {
    const item = target.closest('[data-table], [data-edge]');
    if (!item) return false;
    if (item.dataset.table) {
      select('table', item.dataset.table);
      if (focus) fit(tables.get(item.dataset.table).box);
    } else {
      select('edge', item.dataset.edge);
      if (focus) fitSelection();
    }
    return true;
  }
  function selectFromExplorer(event) {
    if (selectElement(event.target, true) && lastPointerType === 'touch') hideExplorer();
  }
  tableList.addEventListener('click', selectFromExplorer);
  details.addEventListener('click', selectFromExplorer);
  byId('clear-selection').addEventListener('click', () => select(null, null));
  byId('fit-all').addEventListener('click', fitAll);
  byId('fit-selection').addEventListener('click', fitSelection);
  byId('zoom-in').addEventListener('click', () => zoom(1.25));
  byId('zoom-out').addEventListener('click', () => zoom(1 / 1.25));
  byId('zoom-reset').addEventListener('click', () => zoom(1 / camera.scale));
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let count = 0;
    sortedTables.forEach((table) => {
      const matches = table.id.toLowerCase().includes(query) || table.rows.some((row) => row.cells.some((cell) => cell.value.toLowerCase().includes(query)));
      listViews.get(table.id).hidden = !matches;
      if (matches) count++;
    });
    byId('table-count').textContent = query ? `${count} / ${tables.size}` : tables.size;
    noResults.hidden = count > 0;
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = [...listViews.values()].find((button) => !button.hidden);
      if (first) selectElement(first, true);
    }
  });

  // Pointer events support mouse dragging, one-finger panning, and two-finger zoom.
  const pointers = new Map();
  let suppressClick = false;
  let gesture = null;
  function pointerPosition(event) {
    const rect = diagram.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  function startGesture() {
    const positions = [...pointers.values()];
    if (!positions.length) { gesture = null; return; }
    const mid = positions.length > 1 ? positions[0].map((value, axis) => (value + positions[1][axis]) / 2) : positions[0];
    gesture = { mid, distance: positions.length > 1 ? Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]) : 0, camera: { ...camera } };
  }
  diagram.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    if (!pointers.size) suppressClick = false;
    pointers.set(event.pointerId, pointerPosition(event));
    if (pointers.size > 1) suppressClick = true;
    startGesture();
  });
  diagram.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, pointerPosition(event));
    const positions = [...pointers.values()];
    const mid = positions.length > 1 ? positions[0].map((value, axis) => (value + positions[1][axis]) / 2) : positions[0];
    if (!suppressClick && Math.hypot(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]) < 4) return;
    suppressClick = true;
    diagram.setPointerCapture(event.pointerId);
    diagram.classList.add('is-panning');
    const distance = positions.length > 1 ? Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]) : 0;
    const nextScale = gesture.distance > 0 ? Math.max(.035, Math.min(3, gesture.camera.scale * distance / gesture.distance)) : gesture.camera.scale;
    camera = {
      x: gesture.camera.x + gesture.mid[0] / gesture.camera.scale - mid[0] / nextScale,
      y: gesture.camera.y + gesture.mid[1] / gesture.camera.scale - mid[1] / nextScale,
      scale: nextScale,
    };
    scheduleCamera();
  });
  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (diagram.hasPointerCapture(event.pointerId)) diagram.releasePointerCapture(event.pointerId);
    if (!pointers.size) diagram.classList.remove('is-panning');
    startGesture();
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  diagram.addEventListener('click', (event) => {
    if (suppressClick) return;
    if (!selectElement(event.target, false)) select(null, null);
  });
  diagram.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? diagram.clientHeight : 1);
    zoom(Math.exp(-Math.max(-250, Math.min(250, delta)) * .002), pointerPosition(event));
  }, { passive: false });
  diagram.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (selectElement(event.target, false)) event.preventDefault();
    }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault();
      const delta = directions[event.key];
      camera.x += delta[0] * 80 / camera.scale;
      camera.y += delta[1] * 80 / camera.scale;
      scheduleCamera();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      select(null, null);
      if (document.activeElement === search) {
        search.value = '';
        search.dispatchEvent(new Event('input'));
      }
      hideExplorer(keyboardNavigation);
    }
    if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
    if (event.key === '/') { event.preventDefault(); keyboardNavigation = true; showExplorer(); search.focus(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); fitAll(); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); }
    if (event.key === '-') { event.preventDefault(); zoom(1 / 1.25); }
    if (event.key === '0') { event.preventDefault(); zoom(1 / camera.scale); }
  });
  new ResizeObserver(() => {
    const next = size();
    if (!viewportSize.width) fitAll();
    else {
      camera.x += (viewportSize.width - next.width) / camera.scale / 2;
      camera.y += (viewportSize.height - next.height) / camera.scale / 2;
      scheduleCamera();
    }
    viewportSize = next;
  }).observe(diagram);
  select(null, null);
})();
