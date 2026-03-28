import { useMemo } from 'react';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  predictionData?: number[];
  upperBound?: number[];
  lowerBound?: number[];
  noFill?: boolean;
  /** When true, data/predictionData/upperBound/lowerBound are all the same length
   *  representing a merged timeline. NaN entries mean "no value at this position". */
  aligned?: boolean;
}

function catmullRomToPath(points: [number, number][], tension = 0.3): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`;

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;

    d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2[0]},${p2[1]}`;
  }
  return d;
}

function indexToXY(
  data: number[],
  indices: number[],
  totalLen: number,
  min: number,
  range: number,
  padding: number,
  w: number,
  h: number,
): [number, number][] {
  return data.map((v, i) => [
    padding + (indices[i] / (totalLen - 1)) * w,
    padding + h - ((v - min) / range) * h,
  ]);
}

function pointsToXY(
  data: number[],
  startIdx: number,
  totalLen: number,
  min: number,
  range: number,
  padding: number,
  w: number,
  h: number,
  _height: number
): [number, number][] {
  return data.map((v, i) => [
    padding + ((startIdx + i) / (totalLen - 1)) * w,
    padding + h - ((v - min) / range) * (h),
  ]);
}

export function MiniSparkline({ data, width = 120, height = 28, color, predictionData, upperBound, lowerBound, noFill, aligned }: Props) {
  const paths = useMemo(() => {
    if (aligned) {
      return buildAlignedPaths(data, predictionData, upperBound, lowerBound, width, height, noFill);
    }
    return buildLegacyPaths(data, predictionData, upperBound, lowerBound, width, height, noFill);
  }, [data, predictionData, upperBound, lowerBound, width, height, noFill, aligned]);

  if (!paths) return <span className="text-xs text-muted-foreground">—</span>;

  const strokeColor = color || 'hsl(var(--primary))';
  const gradId = `spark-grad-${strokeColor.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg width={width} height={height} className="block">
      {!noFill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {paths.areaPath && <path d={paths.areaPath} fill={`url(#${gradId})`} />}
      <path d={paths.linePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {paths.bandPath && (
        <path d={paths.bandPath} fill="hsl(var(--destructive))" fillOpacity="0.12" stroke="none" />
      )}
      {paths.predLinePath && (
        <path d={paths.predLinePath} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Aligned mode: all arrays same length, NaN = no value */
function buildAlignedPaths(
  data: number[],
  predictionData: number[] | undefined,
  upperBound: number[] | undefined,
  lowerBound: number[] | undefined,
  width: number,
  height: number,
  noFill?: boolean,
) {
  const totalLen = data.length;
  if (totalLen < 2) return null;

  // Collect valid actual and pred indices/values
  const actualIdxs: number[] = [], actualVals: number[] = [];
  const predIdxs: number[] = [], predVals: number[] = [];
  const upperIdxs: number[] = [], upperVals: number[] = [];
  const lowerIdxs: number[] = [], lowerVals: number[] = [];

  for (let i = 0; i < totalLen; i++) {
    if (!isNaN(data[i]) && isFinite(data[i])) {
      actualIdxs.push(i);
      actualVals.push(data[i]);
    }
    if (predictionData && i < predictionData.length && !isNaN(predictionData[i]) && isFinite(predictionData[i])) {
      predIdxs.push(i);
      predVals.push(predictionData[i]);
    }
    if (upperBound && i < upperBound.length && !isNaN(upperBound[i]) && isFinite(upperBound[i])) {
      upperIdxs.push(i);
      upperVals.push(upperBound[i]);
    }
    if (lowerBound && i < lowerBound.length && !isNaN(lowerBound[i]) && isFinite(lowerBound[i])) {
      lowerIdxs.push(i);
      lowerVals.push(lowerBound[i]);
    }
  }

  if (actualVals.length < 2) return null;

  // Y scale based on actual + pred (not bounds)
  const scaleValues = [...actualVals, ...predVals];
  const rawMin = Math.min(...scaleValues);
  const rawMax = Math.max(...scaleValues);
  const rawRange = rawMax - rawMin || 1;
  const min = rawMin - rawRange * 0.05;
  const max = rawMax + rawRange * 0.05;
  const range = max - min;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const actualPoints = indexToXY(actualVals, actualIdxs, totalLen, min, range, padding, w, h);
  const linePath = catmullRomToPath(actualPoints);

  let areaPath = '';
  if (!noFill) {
    const lastX = actualPoints[actualPoints.length - 1][0];
    const firstX = actualPoints[0][0];
    areaPath = `${linePath}L${lastX},${height}L${firstX},${height}Z`;
  }

  let predLinePath = '';
  if (predVals.length > 0) {
    const predPoints = indexToXY(predVals, predIdxs, totalLen, min, range, padding, w, h);
    const firstPredIdx = predIdxs[0];
    // Only connect from actual if there's NO overlap (actual doesn't have a value at first pred index)
    const hasOverlap = actualIdxs.includes(firstPredIdx);
    const connectPoints: [number, number][] = [];
    if (!hasOverlap) {
      // Find the last actual index before the first pred index
      const connectActual = actualIdxs.filter(i => i < firstPredIdx);
      if (connectActual.length > 0) {
        const lastActualBeforePred = connectActual[connectActual.length - 1];
        const ai = actualIdxs.indexOf(lastActualBeforePred);
        connectPoints.push(actualPoints[ai]);
      }
    }
    connectPoints.push(...predPoints);
    predLinePath = catmullRomToPath(connectPoints);
  }

  let bandPath = '';
  if (upperVals.length > 0 && lowerVals.length > 0) {
    const upperPoints = indexToXY(upperVals, upperIdxs, totalLen, min, range, padding, w, h);
    const lowerPoints = indexToXY(lowerVals, lowerIdxs, totalLen, min, range, padding, w, h);
    const upperPath = catmullRomToPath(upperPoints);
    const lowerReversed = [...lowerPoints].reverse();
    const lowerPath = lowerReversed.map((p, i) => `${i === 0 ? 'L' : ''}${p[0]},${p[1]}`).join('L');
    bandPath = `${upperPath}L${lowerReversed[0][0]},${lowerReversed[0][1]}${lowerPath}Z`;
  }

  return { linePath, areaPath, predLinePath, bandPath };
}

/** Legacy mode: predictionData appended after data */
function buildLegacyPaths(
  data: number[],
  predictionData: number[] | undefined,
  upperBound: number[] | undefined,
  lowerBound: number[] | undefined,
  width: number,
  height: number,
  noFill?: boolean,
) {
  const validData = data.filter(d => !isNaN(d) && isFinite(d));
  if (validData.length < 2) return null;

  const validPred = predictionData?.filter(d => !isNaN(d) && isFinite(d)) ?? [];
  const validUpper = upperBound?.filter(d => !isNaN(d) && isFinite(d)) ?? [];
  const validLower = lowerBound?.filter(d => !isNaN(d) && isFinite(d)) ?? [];

  const scaleValues = [...validData, ...validPred];
  const rawMin = Math.min(...scaleValues);
  const rawMax = Math.max(...scaleValues);
  const rawRange = rawMax - rawMin || 1;
  const min = rawMin - rawRange * 0.05;
  const max = rawMax + rawRange * 0.05;
  const range = max - min;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const totalLen = validData.length + validPred.length;

  const actualPoints = pointsToXY(validData, 0, totalLen, min, range, padding, w, h, height);
  const linePath = catmullRomToPath(actualPoints);

  let areaPath = '';
  if (!noFill) {
    const lastX = actualPoints[actualPoints.length - 1][0];
    const firstX = actualPoints[0][0];
    areaPath = `${linePath}L${lastX},${height}L${firstX},${height}Z`;
  }

  let predLinePath = '';
  if (validPred.length > 0) {
    const predPoints: [number, number][] = [actualPoints[actualPoints.length - 1]];
    predPoints.push(...pointsToXY(validPred, validData.length, totalLen, min, range, padding, w, h, height));
    predLinePath = catmullRomToPath(predPoints);
  }

  let bandPath = '';
  if (validUpper.length > 0 && validLower.length > 0) {
    const upperPoints = pointsToXY(validUpper, validData.length, totalLen, min, range, padding, w, h, height);
    const lowerPoints = pointsToXY(validLower, validData.length, totalLen, min, range, padding, w, h, height);
    const upperPath = catmullRomToPath(upperPoints);
    const lowerReversed = [...lowerPoints].reverse();
    const lowerPath = lowerReversed.map((p, i) => `${i === 0 ? 'L' : ''}${p[0]},${p[1]}`).join('L');
    bandPath = `${upperPath}L${lowerReversed[0][0]},${lowerReversed[0][1]}${lowerPath}Z`;
  }

  return { linePath, areaPath, predLinePath, bandPath };
}