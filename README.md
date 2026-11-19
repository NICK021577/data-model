# TMIS data model

Open **index.html** in Chrome, Edge, or Firefox. The interactive viewer works offline without installation or a server.

## Explore

- Move near the left edge or the **TMIS** handle to reveal the table explorer. On touchscreens, tap the handle and tap outside to dismiss it.
- Click a table or field to trace its relationships. Click a relationship or its label to highlight the matching primary and foreign keys.
- Search by table, field, or type. Select a result to zoom to the table. The Selection panel shows constraints, notes, and relationships.
- Drag to pan, scroll or pinch to zoom. **Fit all** shows the complete diagram; **Focus selection** fits the selected connections.
- Use the theme button to switch between light and dark mode, or **⛶** to enter full screen.
- Keyboard: **/** opens search, **F** fits all, **+ / −** zooms, **0** restores actual size, and **Escape** clears selection. Tab to a table or relationship and press Enter/Space to select it. Arrow keys pan the focused diagram.

## Model contents

The viewer uses **schema v3: 46 tables, 355 fields, and 109 foreign keys**, transcribed from the supplied TMIS Logical Data Model image. The reference draws **54 relationships** and omits tenant and most user connectors for readability. All foreign keys remain available in the viewer and Mermaid export.

The diagram follows the reference's five-column table groups: tenancy and people, platform administration, planning, activities, delivery, finance, outputs, and messaging. Empty space is compacted without resizing table cells or text.

Changes from v2 include agency applications and documents, audit logs, platform settings and defaults, participant profiles and categories, agency roles and subscriptions, category questions and membership answers, notifications, separate activity objectives and outcomes, materials, feedback questions and answers, and output submissions. Session scheduling replaces `program_flow`; `output_submission` replaces the old `output` / `output_photo` structure. Existing tables include the updated v3 fields, types, keys, and nullability.

`PK` indicates a primary key, `FK` a foreign key, and `UK` a unique field. Nullable names are italic; constraints and table notes also appear in the inspector. `client_id` supports offline synchronization and does not reference another table. This project presents a logical schema; it does not migrate a database.

## Files and maintenance

- `index.html`, `styles.css`, `theme.js`, and `app.js` provide the offline SVG viewer.
- `source/TMIS-schema-v3.json` is the editable v3 transcription, including fields, references, constraints, notes, groups, and table placement.
- `scripts/generate-model.mjs` generates `model-data.js` and the downloadable `source/TMIS-schema.mmd` from that JSON.
- `layout.js` compacts empty space while preserving table sizes and ordering.
- `scripts/verify.mjs` checks all fields and relationships and exercises the viewer in installed Chrome/Edge.
- `source/TMIS_data_model.drawio.html` and `source/TMIS-schema-v2.json` remain archived references.

After editing the v3 JSON, regenerate and validate with Node.js 22+:

```powershell
node scripts/generate-model.mjs
node scripts/generate-model.mjs --check
node scripts/verify.mjs
```

The existing `./scripts/extract-model.ps1` command delegates to the v3 generator; `-Check` verifies generated files without changing them.

Browser verification uses a temporary profile and closes its own browser afterward. Set `TMIS_BROWSER` to the browser executable if automatic discovery cannot find Chrome or Edge. Screenshots are saved in the temporary `tmis-datamodel-qa` directory, or the directory specified by `TMIS_QA_DIR`.
# data-model
