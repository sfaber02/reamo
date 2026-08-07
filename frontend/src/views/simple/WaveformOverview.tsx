/**
 * WaveformOverview - a rough, whole-project waveform silhouette for the seek bar.
 *
 * Purely additive and self-contained: it subscribes to a COARSE peaks overview
 * (low resolution, all tracks, entire project) and paints a centered amplitude
 * silhouette on a canvas that sits *behind* the seek-bar overlays. If no peaks
 * arrive (or the project has none), it simply draws nothing — the seek bar keeps
 * working exactly as before.
 *
 * It intentionally does NOT use the item list or the heavy tile-blitting path;
 * it just walks whatever tiles are in the cache and maps each tile's peaks onto
 * the full-project timeline. Good enough for a glanceable overview on a phone.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useReaperStore } from '../../store';
import { usePeaksSubscription } from '../../hooks/usePeaksSubscription';

/** Fixed, coarse overview resolution (drives backend LOD) — keeps tile count low. */
const OVERVIEW_WIDTH_PX = 400;

export function WaveformOverview({ duration }: { duration: number }): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const totalTracks = useReaperStore((s) => s.totalTracks);
  const tileCache = useReaperStore((s) => s.tileCache);

  // Coarse overview: all user tracks, whole project, low resolution.
  usePeaksSubscription(
    totalTracks > 0 && duration > 0
      ? {
          range: { start: 1, end: totalTracks },
          sampleCount: 30,
          viewport: { start: 0, end: duration, widthPx: OVERVIEW_WIDTH_PX },
        }
      : null
  );

  // Measure the container so the canvas matches the seek bar's pixel size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the silhouette whenever tiles, size, or duration change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = size;
    if (w === 0 || h === 0 || duration <= 0) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    const mid = h / 2;
    const maxBar = h - 2;

    for (const tile of tileCache.values()) {
      const n = tile.peaks.length;
      if (n === 0) continue;
      const tileStart = tile.itemPosition + tile.startTime;
      const tileDur = tile.endTime - tile.startTime;
      if (tileDur <= 0) continue;

      for (let i = 0; i < n; i++) {
        const t = tileStart + (i / n) * tileDur;
        const x = Math.round((t / duration) * w);
        if (x < 0 || x >= w) continue;

        const p = tile.peaks[i];
        const amp = Array.isArray(p)
          ? Math.max(Math.abs(p[0]), Math.abs(p[1]))
          : Math.max(Math.abs(p.l[0]), Math.abs(p.l[1]), Math.abs(p.r[0]), Math.abs(p.r[1]));

        const barH = Math.max(1, amp * maxBar);
        ctx.fillRect(x, mid - barH / 2, 1, barH);
      }
    }
  }, [tileCache, size, duration]);

  return (
    <div ref={wrapRef} className="absolute inset-0 pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
