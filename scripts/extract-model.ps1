param([switch]$Check)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$source = Join-Path $project 'source\TMIS_data_model.drawio.html'
$html = [IO.File]::ReadAllText($source)
$match = [regex]::Match($html, 'data-mxgraph="([^"]+)"')
if (!$match.Success) { throw 'The source does not contain a draw.io model.' }
$config = [Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
[xml]$xml = $config.xml
function Get-Style($cell) {
    $result = @{}
    foreach ($part in $cell.GetAttribute('style').Split(';')) {
        $pair = $part.Split('=', 2)
        if ($pair.Length -eq 2) { $result[$pair[0]] = $pair[1] }
    }
    return $result
}
function Get-Number($node, $name) {
    $value = $node.GetAttribute($name)
    if (!$value) { return 0 }
    return [double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture)
}
function Get-Box($node) {
    return [ordered]@{ x = (Get-Number $node 'x'); y = (Get-Number $node 'y'); width = (Get-Number $node 'width'); height = (Get-Number $node 'height') }
}
$children = @{}
foreach ($cell in $xml.SelectNodes('//mxCell[@parent]')) {
    $parentId = $cell.GetAttribute('parent')
    if (!$children.ContainsKey($parentId)) { $children[$parentId] = [Collections.Generic.List[object]]::new() }
    $children[$parentId].Add($cell)
}
$names = @{}
$tables = @($xml.SelectNodes('//UserObject[starts-with(@mermaidId,"n:")]') | ForEach-Object {
    $table = $_
    $names[$table.id] = $table.label
    $style = Get-Style $table.mxCell
    $rows = @($children[$table.id] | ForEach-Object {
        $row = $_
        $columns = @($children[$row.id] | ForEach-Object {
            [ordered]@{ value = $_.GetAttribute('value'); box = (Get-Box $_.mxGeometry) }
        })
        [ordered]@{ box = (Get-Box $row.mxGeometry); cells = $columns }
    })
    [ordered]@{ id = $table.label; box = (Get-Box $table.mxCell.mxGeometry); fill = $style.fillColor; stroke = $style.strokeColor; rows = $rows }
})
$relationships = @($xml.SelectNodes('//UserObject[mxCell/@edge="1"]') | ForEach-Object {
    $edge = $_.mxCell
    $style = Get-Style $edge
    $geometry = $edge.mxGeometry
    $points = @($geometry.SelectNodes('Array[@as="points"]/mxPoint') | ForEach-Object { ,@((Get-Number $_ 'x'), (Get-Number $_ 'y')) })
    $offset = $geometry.SelectSingleNode('mxPoint[@as="offset"]')
    [ordered]@{
        id = $_.mermaidId; source = $names[$edge.source]; target = $names[$edge.target]; label = $_.label
        start = @([double]::Parse($style.exitX, [Globalization.CultureInfo]::InvariantCulture), [double]::Parse($style.exitY, [Globalization.CultureInfo]::InvariantCulture))
        end = @([double]::Parse($style.entryX, [Globalization.CultureInfo]::InvariantCulture), [double]::Parse($style.entryY, [Globalization.CultureInfo]::InvariantCulture))
        startArrow = $style.startArrow; endArrow = $style.endArrow; dashed = ($style.dashed -eq '1'); points = $points
        labelPosition = (Get-Number $geometry 'x'); labelOffset = $(if ($offset) { @((Get-Number $offset 'x'), (Get-Number $offset 'y')) } else { @(0, 0) })
    }
})
$mermaid = ($xml.SelectSingleNode('//UserObject[@mermaidData]').mermaidData | ConvertFrom-Json).data
$model = [ordered]@{
    schema = 'tmis_semifinal'
    sourceSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    tables = $tables; relationships = $relationships
    notes = @($mermaid.Split("`n") | Where-Object { $_.Trim().StartsWith('%%') } | ForEach-Object { $_.Trim().Substring(2).Trim() })
}
# Preserve all original geometry and apply only the v2 schema content.
$revisionPath = Join-Path $project 'source\TMIS-schema-v2.json'
$revision = Get-Content -LiteralPath $revisionPath -Raw | ConvertFrom-Json -AsHashtable
$model.schema = $revision.schema
$model.revisionSha256 = (Get-FileHash -LiteralPath $revisionPath -Algorithm SHA256).Hash.ToLowerInvariant()
$model.notes = $revision.notes
$model.drawnRelationshipCount = $revision.drawnRelationshipCount
foreach ($table in $tables) {
    $table.uniqueTogether = @()
    $table.notes = @()
    if ($revision.uniqueTogether.ContainsKey($table.id)) { $table.uniqueTogether = $revision.uniqueTogether[$table.id] }
    if ($revision.tableNotes.ContainsKey($table.id)) { $table.notes = $revision.tableNotes[$table.id] }
    foreach ($row in $table.rows) {
        $type = $row.cells[0].value
        if ($revision.typeReplacements.ContainsKey($type)) { $row.cells[0].value = $revision.typeReplacements[$type] }
        $field = $row.cells[1].value
        $renames = $revision.renames[$table.id]
        if ($renames -and $renames.ContainsKey($field)) { $row.cells[1].value = $renames[$field] }
        $field = $row.cells[1].value
        $row.nullable = $field -in $revision.nullableFields[$table.id]
        if ($field -in $revision.uniqueFields[$table.id]) {
            $row.cells[2].value = (@($row.cells[2].value, 'UK') | Where-Object { $_ }) -join ','
        }
    }
}
foreach ($edge in $relationships) {
    $table = $tables | Where-Object id -EQ $edge.target
    $row = $table.rows | Where-Object { $_.cells[1].value -eq $edge.label }
    $edge.parentOptional = $row.nullable
    $edge.childUnique = $row.cells[2].value.Split(',') -contains 'UK'
    $edge.omittedInReference = $edge.source -eq 'agency' -and $edge.label -eq 'agency_id' -and $edge.target -in $revision.omittedTenantLinks
    $edge.startArrow = if ($edge.parentOptional) { 'ERzeroToOne' } else { 'ERmandOne' }
    $edge.endArrow = if ($edge.childUnique) { 'ERzeroToOne' } else { 'ERzeroToMany' }
}
if (@($relationships | Where-Object { !$_.omittedInReference }).Count -ne $revision.drawnRelationshipCount) { throw 'Reference relationship count differs.' }

$lines = [Collections.Generic.List[string]]::new()
$lines.Add('erDiagram')
foreach ($note in $model.notes) { $lines.Add("    %% $note") }
foreach ($table in $tables) {
    $lines.Add('')
    foreach ($fields in $table.uniqueTogether) { $lines.Add("    %% UNIQUE $($table.id)($($fields -join ', '))") }
    foreach ($note in $table.notes) { $lines.Add("    %% $($table.id): $note") }
    $lines.Add("    $($table.id) {")
    foreach ($row in $table.rows) {
        $line = "        $($row.cells[0].value) $($row.cells[1].value)"
        if ($row.cells[2].value) { $line += " $($row.cells[2].value)" }
        $comments = @($row.cells | Select-Object -Skip 3 | ForEach-Object { $_.value } | Where-Object { $_ })
        $comments += $(if ($row.nullable) { 'nullable' } else { 'not null' })
        $line += ' "' + ($comments -join '; ') + '"'
        $lines.Add($line)
    }
    $lines.Add('    }')
}
$lines.Add('')
foreach ($edge in $relationships) {
    $parent = if ($edge.parentOptional) { '|o' } else { '||' }
    $child = if ($edge.childUnique) { 'o|' } else { 'o{' }
    $lines.Add("    $($edge.source) $parent..$child $($edge.target) : $($edge.label)")
}
$mermaid = ($lines -join "`n") + "`n"
$data = '/* Generated from archived draw.io geometry + source/TMIS-schema-v2.json. Run scripts/extract-model.ps1 to refresh. */' + "`n" + 'window.TMIS_MODEL = ' + ($model | ConvertTo-Json -Depth 20 -Compress) + ";`n"
$target = Join-Path $project 'model-data.js'
if ($Check) {
    if ([IO.File]::ReadAllText($target) -cne $data) { throw 'Generated model differs from the archived layout plus v2 schema. Run the extractor.' }
    if ([IO.File]::ReadAllText((Join-Path $project 'source\TMIS-schema.mmd')) -cne $mermaid) { throw 'Mermaid source differs.' }
    Write-Output "Verified $($tables.Count) tables, $(($tables | ForEach-Object { $_.rows.Count } | Measure-Object -Sum).Sum) fields, and $($relationships.Count) relationships against the source."
} else {
    [IO.File]::WriteAllText($target, $data, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $project 'source\TMIS-schema.mmd'), $mermaid, [Text.UTF8Encoding]::new($false))
    Write-Output "Extracted $($tables.Count) tables and $($relationships.Count) relationships."
}
