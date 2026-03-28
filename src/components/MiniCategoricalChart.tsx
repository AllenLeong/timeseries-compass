import { useMemo } from 'react';
import { parseListValue } from '@/lib/csv-parser';
import { buildCategoryColorMap } from '@/lib/curve-utils';

interface Props {
  data: string[];
  width?: number;
  height?: number;
  colorMap?: Record<string, string>;
}

export function MiniCategoricalChart({ data, width = 120, height = 28, colorMap: externalColorMap }: Props) {
  const segments = useMemo(() => {
    if (data.length === 0) return [];
    const colorMap = externalColorMap ?? buildCategoryColorMap(data);
    const segs: { start: number; end: number; category: string; color: string }[] = [];
    let current = data[0];
    let startIdx = 0;

    for (let i = 1; i <= data.length; i++) {
      if (i === data.length || data[i] !== current) {
        segs.push({
          start: startIdx,
          end: i,
          category: current,
          color: colorMap[current] || '#888',
        });
        if (i < data.length) {
          current = data[i];
          startIdx = i;
        }
      }
    }
    return segs;
  }, [data]);

  if (data.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const padding = 1;
  const w = width - padding * 2;

  return (
    <svg width={width} height={height} className="block rounded-sm">
      {segments.map((seg, i) => {
        const x = padding + (seg.start / data.length) * w;
        const segWidth = ((seg.end - seg.start) / data.length) * w;
        return (
          <rect
            key={i}
            x={x}
            y={0}
            width={Math.max(segWidth, 1)}
            height={height}
            fill={seg.color}
            fillOpacity={0.35}
            rx={1}
          />
        );
      })}
    </svg>
  );
}
