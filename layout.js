/* Remove empty space without scaling tables or changing their relative order. */
window.TMIS_LAYOUT = (() => {
  const source = window.TMIS_MODEL;

  function compactAxis(axis, size, pointIndex) {
    const intervals = source.tables
      .map(({ box }) => [box[axis], box[axis] + box[size]])
      .sort((a, b) => a[0] - b[0]);
    const occupied = [];
    for (const interval of intervals) {
      const last = occupied[occupied.length - 1];
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else occupied.push([...interval]);
    }

    // Keep a corridor for connectors and at least 12 units between route lanes.
    // No part of an occupied band is scaled, so table and cell sizes stay exact.
    const coordinates = source.relationships.flatMap(edge => edge.points.map(point => point[pointIndex]));
    const gaps = occupied.slice(1).map((interval, index) => {
      const start = occupied[index][1];
      const end = interval[0];
      const lanes = [...new Set(coordinates.filter(value => value > start && value < end))].sort((a, b) => a - b);
      const stops = [start, ...lanes, end];
      const segments = stops.slice(1).map((to, i) => {
        const from = stops[i];
        const length = to - from;
        return { from, to, length: Math.min(length, Math.max(12, length * .18)) };
      });
      const length = end - start;
      const target = Math.min(length, Math.max(axis === 'x' ? 32 : 60, segments.reduce((sum, segment) => sum + segment.length, 0)));
      const extra = target - segments.reduce((sum, segment) => sum + segment.length, 0);
      for (const segment of segments) segment.length += extra * (segment.to - segment.from) / length;
      return { start, end, removed: length - target, segments };
    });

    return value => {
      let removed = 0;
      for (const gap of gaps) {
        if (value >= gap.end) { removed += gap.removed; continue; }
        if (value <= gap.start) break;
        let mapped = gap.start - removed;
        for (const segment of gap.segments) {
          if (value >= segment.to) mapped += segment.length;
          else return mapped + (value - segment.from) * segment.length / (segment.to - segment.from);
        }
      }
      return value - removed;
    };
  }

  const x = compactAxis('x', 'width', 0);
  const y = compactAxis('y', 'height', 1);
  return {
    ...source,
    tables: source.tables.map(table => ({ ...table, box: { ...table.box, x: x(table.box.x), y: y(table.box.y) } })),
    relationships: source.relationships.map(edge => ({ ...edge, points: edge.points.map(point => [x(point[0]), y(point[1])]) })),
  };
})();
