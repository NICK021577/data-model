# TMIS data model

Open **index.html** in Chrome, Edge, or Firefox. No installation, build, server, or internet connection is required for the interactive viewer.

## Explore

- The dark diagram fills the window. Move near the left edge or the **TMIS** handle to reveal the tables and relationships panel; move away to hide it. On touchscreens, tap the handle and tap outside to dismiss. The panel overlays the canvas without resizing it.
- Click any table (including a field) to subtly highlight its direct relationships and connected tables. Tables remain fully opaque; unrelated relationship lines stay at 40%. Hovering an unrelated line restores its full visibility.
- Click a relationship line or its label to highlight that exact relationship, both tables, and the matching PK/FK rows. Parallel relationships remain distinct.
- Use the table list to select and zoom to a table. Search by table name, field, or type; Enter opens the first match.
- Use the Selection panel to inspect and select relationships. **Focus selection** fits all highlighted tables and paths into view.
- Drag to pan, scroll or pinch to zoom, and use **Fit all** to return to the complete diagram.
- Use **⛶** in the top-right controls for browser full screen. The viewer always fills its window even outside full-screen mode.
- Click the canvas background, **Clear**, or press **Escape** to clear highlighting.
- Keyboard: **/** opens the panel and focuses search, **F** fits all, **+ / −** zooms, **0** restores actual size. Tab to a table or relationship and press Enter/Space to select it. Arrow keys pan while the diagram is focused. The panel stays open during keyboard navigation; **Escape** closes it and clears selection.

## Model contents

The viewer contains **schema v2: 31 tables, 213 fields, and 78 foreign-key relationships**, updated from the supplied TMIS Logical Data Model image. The reference draws 60 relationships and marks 18 additional tenant foreign keys with omitted lines; all 78 remain explorable. Empty bands between table groups are compacted, with connector routes moved alongside them. Table sizes, cell dimensions, font sizes, relative ordering, colors, and interaction controls are preserved. Original geometry remains in the generated model.

Content changes from v1:

- Logical types: `char(36)` → `uuid`, `tinyint(1)` → `bool`, `int(11)` → `int`. Decimal precision is unchanged.
- `activity.objectives` → `activity.objective`.
- 11 single-field UNIQUE constraints, including unique foreign keys on `activity.calendar_entry_id` and `certificate_rule.activity_id`. These relationships now show a maximum of one child.
- Nullable fields from the reference use italic names and explicit inspector text. Nullable foreign keys have optional-parent markers.
- Composite uniqueness for `session(activity_id, session_date, period)` and `activity_partner(activity_id, partner_agency_id)`, agency category values, `AM | PM` session periods and `program_flow.end_time > start_time` appear in the notes/inspector and Mermaid export.

No tables, fields or foreign-key connections were added or removed. Child minimum counts remain zero where the image does not establish mandatory child existence. This updates the logical model presentation, not a database.

`source/TMIS_data_model.drawio.html` remains a byte-for-byte archived v1 reference and uses the original external diagrams.net viewer. `source/TMIS-schema-v2.json` records the image transcription as content overrides. `source/TMIS-schema.mmd` is the current v2 Mermaid export.

## Files and maintenance

- `index.html` — app shell and relationship markers.
- `styles.css` — responsive layout and selection styles.
- `app.js` — SVG rendering, graph selection, search, and camera controls.
- `layout.js` — compacts empty space and connector lanes without resizing tables or text.
- `model-data.js` — compact, generated model. Loaded as a regular local script so opening the folder works without a web server.
- `source/` — archived draw.io, v2 content overrides and current Mermaid export.
- `scripts/extract-model.ps1` — regenerates the model and Mermaid from archived draw.io geometry plus v2 content overrides (PowerShell 7+).
- `scripts/verify.mjs` — checks model contents and uses an installed Chrome/Edge for browser interaction tests.

The implementation uses native JavaScript and SVG. It renders the diagram once, indexes relationships by table, delegates click handlers, and batches camera updates with `requestAnimationFrame`. It has no runtime dependencies or remote font/script requests.

After editing `source/TMIS-schema-v2.json`, regenerate from this folder with PowerShell 7+:

```powershell
./scripts/extract-model.ps1
```

Verify preservation and browser behavior (Node.js 22+ and installed Chrome/Edge):

```powershell
./scripts/extract-model.ps1 -Check
node scripts/verify.mjs
```

The browser check uses a temporary profile and closes its own browser afterwards. Set `TMIS_BROWSER` to a browser executable path if automatic discovery does not find one.

# data-model
# data-model
