/**
 * TimelineRuler Component
 * Renders tempo-aware ruler above the timeline canvas, REAPER-style
 *
 * Format:
 * - Bar.beat on top (e.g. "0.1", "4.1", "8.3") - 0-indexed bars
 * - Time below in smaller text (e.g. "0:00.000")
 * - Tick line extending down
 *
 * Features:
 * - Long-press on any label seeks playhead to that position
 * - At close zoom (≤3 bars), shows beat labels for precision navigation
 *
 * Uses unified tick generator for consistent alignment with grid lines.
 */

import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useCallback, useRef, memo } from 'react';
import { generateTimelineTicks, formatRulerTime, type TimelineTick } from '../../utils/timelineTicks';
import type { WSTempoMarker } from '../../core/WebSocketTypes';
import { useLongPress } from '../../hooks/useLongPress';
import { useReaper } from '../ReaperProvider';
import { transport } from '../../core/WebSocketCommands';

/** Individual labeled tick (bar or beat) with long-press to seek */
interface LabeledTickProps {
  tick: TimelineTick;
  leftPercent: number;
  visibleDuration: number;
  onSeek: (time: number) => void;
}

const RulerLabeledTick = memo(function RulerLabeledTick({
  tick,
  leftPercent,
  visibleDuration,
  onSeek,
}: LabeledTickProps): ReactElement {
  const { handlers } = useLongPress({
    onLongPress: () => onSeek(tick.time),
    duration: 400,
  });

  // Format: bar.beat (e.g., "8.1" for bar, "8.3" for beat 3)
  const beatNum = tick.type === 'bar' ? 1 : tick.beat ?? 1;
  const isBar = tick.type === 'bar';

  return (
    <div
      key={tick.key}
      className="absolute top-0 bottom-0 flex flex-col select-none touch-none pointer-events-none"
      style={{ left: `${leftPercent}%` }}
      {...handlers}
    >
      {/* Bar.beat label - bars are more prominent than beat labels */}
      <span
        className={`font-mono pl-0.5 leading-tight whitespace-nowrap cursor-pointer ${
          isBar ? 'text-[10px] text-text-secondary' : 'text-[9px] text-text-muted'
        }`}
      >
        {tick.bar}.{beatNum}
      </span>
      {/* Time below - only show for bar ticks to reduce clutter */}
      {isBar && (
        <span className="text-[8px] text-text-muted font-mono pl-0.5 leading-tight whitespace-nowrap">
          {formatRulerTime(tick.time, visibleDuration)}
        </span>
      )}
      {/* Tick line extending down - taller for bars */}
      <div className={`absolute bottom-0 w-px ${isBar ? 'h-[8px] bg-text-muted' : 'h-[6px] bg-text-disabled'}`} />
    </div>
  );
});

interface Props {
  renderTimeToPercent: (time: number) => number;
  visibleRange: { start: number; end: number };
  visibleDuration: number;
  tempoMarkers: WSTempoMarker[];
  barOffset: number;
  bpm: number;
  timesigNum: number;
  timesigDenom: number;
  /** Commit a time selection (drag on the ruler) */
  onSetTimeSelection?: (start: number, end: number) => void;
  /** Live preview of the selection being dragged (null clears it) */
  onSelectionPreview?: (range: { start: number; end: number } | null) => void;
}

// Movement (px) beyond which a ruler press is a selection drag rather than a tap
const RULER_DRAG_THRESHOLD = 6;

export function TimelineRuler({
  renderTimeToPercent,
  visibleRange,
  visibleDuration,
  tempoMarkers,
  barOffset,
  bpm,
  timesigNum,
  timesigDenom,
  onSetTimeSelection,
  onSelectionPreview,
}: Props): ReactElement {
  const { sendCommand } = useReaper();
  const rulerRef = useRef<HTMLDivElement>(null);
  const dragStartTimeRef = useRef<number | null>(null);
  const dragStartXRef = useRef(0);
  const draggedRef = useRef(false);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, visibleRange.start + ratio * visibleDuration);
    },
    [visibleRange.start, visibleDuration]
  );

  // Ruler: tap = seek, drag = free-hand time selection (no snap)
  const handleRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragStartTimeRef.current = timeFromClientX(e.clientX);
      dragStartXRef.current = e.clientX;
      draggedRef.current = false;
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch { /* ignore */ }
    },
    [timeFromClientX]
  );

  const handleRulerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartTimeRef.current === null) return;
      if (!draggedRef.current && Math.abs(e.clientX - dragStartXRef.current) < RULER_DRAG_THRESHOLD) return;
      draggedRef.current = true;
      const t = timeFromClientX(e.clientX);
      onSelectionPreview?.({
        start: Math.min(dragStartTimeRef.current, t),
        end: Math.max(dragStartTimeRef.current, t),
      });
    },
    [timeFromClientX, onSelectionPreview]
  );

  const handleRulerPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStartTimeRef.current;
      dragStartTimeRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      if (start === null) return;
      if (draggedRef.current) {
        const t = timeFromClientX(e.clientX);
        onSelectionPreview?.(null);
        onSetTimeSelection?.(Math.min(start, t), Math.max(start, t));
      } else {
        sendCommand(transport.seek(start));
      }
      draggedRef.current = false;
    },
    [timeFromClientX, onSelectionPreview, onSetTimeSelection, sendCommand]
  );

  const ticks = useMemo(
    () =>
      generateTimelineTicks({
        visibleStart: visibleRange.start,
        visibleEnd: visibleRange.end,
        visibleDuration,
        tempoMarkers,
        barOffset,
        mode: 'ruler',
        bpm,
        timesigNum,
        timesigDenom,
      }),
    [visibleRange.start, visibleRange.end, visibleDuration, tempoMarkers, barOffset, bpm, timesigNum, timesigDenom]
  );

  // Seek to position on long-press
  const handleSeek = useCallback(
    (time: number) => {
      sendCommand(transport.seek(time));
    },
    [sendCommand]
  );

  return (
    <div
      ref={rulerRef}
      data-testid="timeline-ruler"
      className="relative h-[32px] bg-bg-deep rounded-t-lg overflow-hidden cursor-pointer touch-none select-none"
      onPointerDown={handleRulerPointerDown}
      onPointerMove={handleRulerPointerMove}
      onPointerUp={handleRulerPointerUp}
      onPointerCancel={handleRulerPointerUp}
      aria-label="Timeline ruler — tap to seek, drag to select"
    >
      {ticks.map((tick) => {
        const leftPercent = renderTimeToPercent(tick.time);

        // Skip ticks far outside visible bounds (after buffer filtering)
        if (leftPercent < -10 || leftPercent > 110) return null;

        // Ticks with labels get full rendering with long-press navigation
        if (tick.showLabel) {
          return (
            <RulerLabeledTick
              key={tick.key}
              tick={tick}
              leftPercent={leftPercent}
              visibleDuration={visibleDuration}
              onSeek={handleSeek}
            />
          );
        }

        // Beat tick without label (just a short tick line)
        return (
          <div
            key={tick.key}
            className="absolute bottom-0"
            style={{ left: `${leftPercent}%` }}
          >
            <div className="w-px h-[4px] bg-text-disabled" />
          </div>
        );
      })}
    </div>
  );
}
