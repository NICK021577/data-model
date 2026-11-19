// Generate the offline viewer and Mermaid export from the v3 image transcription.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = await readFile(path.join(root, 'source/TMIS-schema-v3.json'));
const schema = JSON.parse(bytes);
const tables = schema.tables.map(table => {
  const width = 530, rowHeight = 32, header = 40;
  const columns = [0, 132, 400];
  return {
    id: table.id,
    box: { x: table.column * 850, y: table.band * 1150, width, height: header + table.fields.length * rowHeight },
    fill: schema.groups[table.group].fill, stroke: schema.groups[table.group].color,
    uniqueTogether: table.uniqueTogether || [], notes: table.notes || [],
    rows: table.fields.map((field, index) => ({
      box: { x: 0, y: header + index * rowHeight, width, height: rowHeight },
      cells: [field.type, field.name, field.key || ''].map((value, i) => ({ value, box: { x: columns[i], y: 0, width: (columns[i + 1] || width) - columns[i], height: rowHeight } })),
      nullable: !!field.nullable,
    })),
  };
});
const tableMap = new Map(tables.map(t => [t.id, t]));
const bandBottom = new Map(schema.tables.map(t => [t.id, Math.max(...schema.tables.filter(other => other.band === t.band).map(other => { const box = tableMap.get(other.id).box; return box.y + box.height; }))]));
const relationships = [];
for (const table of schema.tables) for (const field of table.fields.filter(f => f.references)) {
  const source = tableMap.get(field.references), target = tableMap.get(table.id);
  if (!source) throw Error(`Unknown reference ${field.references}`);
  const sx = source.box.x + source.box.width, sy = source.box.y + source.box.height / 2;
  const tx = target.box.x, ty = target.box.y + 56 + table.fields.indexOf(field) * 32;
  const lane = (relationships.length % 10) * 15;
  let points;
  if (tx > sx) {
    const mid = sx + (tx - sx) / 2 + lane / 4;
    points = [[mid, sy], [mid, ty]];
  } else {
    const right = Math.max(sx, target.box.x + target.box.width) + 40 + lane;
    const left = tx - 40 - lane;
    const corridor = Math.max(bandBottom.get(source.id), bandBottom.get(target.id)) + 60 + lane;
    points = [[right, sy], [right, corridor], [left, corridor], [left, ty]];
  }
  relationships.push({
    id: `e:${source.id}->${target.id}:${field.name}`, source: source.id, target: target.id, label: field.name,
    start: [1, .5], end: [0, (ty - target.box.y) / target.box.height], points,
    parentOptional: !!field.nullable, childUnique: (field.key || '').split(',').includes('UK') || field.key === 'PK,FK',
    omittedInReference: !!field.omitted, dashed: true, labelPosition: 0, labelOffset: [0, -6],
  });
}
const drawn = relationships.filter(e => !e.omittedInReference).length;
if (drawn !== schema.drawnRelationshipCount) throw Error(`Expected ${schema.drawnRelationshipCount} drawn relationships; found ${drawn}`);
const model = { schema: schema.schema, revisionSha256: createHash('sha256').update(bytes).digest('hex'), tables, relationships, notes: schema.notes, drawnRelationshipCount: drawn };
let mermaid = 'erDiagram\n' + schema.notes.map(note => `    %% ${note}\n`).join('');
for (const table of tables) {
  mermaid += '\n';
  for (const fields of table.uniqueTogether) mermaid += `    %% UNIQUE ${table.id}(${fields.join(', ')})\n`;
  for (const note of table.notes) mermaid += `    %% ${table.id}: ${note}\n`;
  mermaid += `    ${table.id} {\n`;
  for (const row of table.rows) mermaid += `        ${row.cells[0].value} ${row.cells[1].value}${row.cells[2].value ? ' ' + row.cells[2].value : ''} "${row.nullable ? 'nullable' : 'not null'}"\n`;
  mermaid += '    }\n';
}
mermaid += '\n' + relationships.map(e => `    ${e.source} ${e.parentOptional ? '|o' : '||'}..${e.childUnique ? 'o|' : 'o{'} ${e.target} : ${e.label}\n`).join('');
const outputs = { 'model-data.js': `/* Generated from source/TMIS-schema-v3.json. Run node scripts/generate-model.mjs to refresh. */\nwindow.TMIS_MODEL = ${JSON.stringify(model)};\n`, 'source/TMIS-schema.mmd': mermaid };
for (const [name, content] of Object.entries(outputs)) {
  const file = path.join(root, name);
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw Error(`${name} is stale. Run node scripts/generate-model.mjs`);
  } else await writeFile(file, content);
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${tables.length} tables, ${tables.reduce((n, t) => n + t.rows.length, 0)} fields, ${relationships.length} foreign keys (${drawn} drawn in reference).`);
