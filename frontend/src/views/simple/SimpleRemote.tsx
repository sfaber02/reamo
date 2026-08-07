/**
 * SimpleRemote - stripped-down, phone-first REAPER remote.
 *
 * Deliberately minimal: no waveforms, no FX. Just what you need to run a take
 * hands-free from across the room:
 *   - big, easy transport (to-start / play-pause / stop / record / loop)
 *   - a full-width seek bar: TAP to move the play cursor, DRAG to paint a loop
 *     (time selection) — dragging a selection also turns looping on
 *   - marker-based navigation (prev / next + a tap-to-jump list)
 *   - a large time / bars readout
 *
 * Reuses the existing store + WebSocket command layer; it is just a simpler skin.
 */

import { useMemo, useRef, useState, useCallback, type ReactElement, type PointerEvent } from 'react';
import { SkipBack, Play, Pause, Square, Circle, Repeat, ChevronLeft, ChevronRight, X, Plus } from 'lucide-react';
import { useReaper } from '../../components/ReaperProvider';
import { useTransport } from '../../hooks/useTransport';
import { useTransportAnimation, getTransportAnimationState } from '../../hooks';
import { useReaperStore } from '../../store';
import { transport, marker, repeat, timeSelection } from '../../core/WebSocketCommands';
import { formatTime } from '../../utils';

/** Min pointer travel (px) before a press becomes a loop drag instead of a seek tap. */
const DRAG_THRESHOLD_PX = 8;

export function SimpleRemote(): ReactElement {
  const { sendCommand } = useReaper();
  const { isPlaying, isRecording, positionSeconds } = useTransport();

  const positionBeats = useReaperStore((s) => s.positionBeats);
  const bpm = useReaperStore((s) => s.bpm);
  const numerator = useReaperStore((s) => s.timeSignatureNumerator);
  const denominator = useReaperStore((s) => s.timeSignatureDenominator);
  const isRepeat = useReaperStore((s) => s.isRepeat);
  const projectName = useReaperStore((s) => s.projectName);
  const projectLength = useReaperStore((s) => s.projectLength);
  const markers = useReaperStore((s) => s.markers);
  const loopSel = useReaperStore((s) => s.timeSelection);

  // Project duration = furthest of (reported length, last marker, playhead, loop end).
  const duration = useMemo(() => {
    let end = projectLength;
    for (const m of markers) if (m.position > end) end = m.position;
    if (loopSel && loopSel.endSeconds > end) end = loopSel.endSeconds;
    if (positionSeconds > end) end = positionSeconds;
    return Math.max(end, 1);
  }, [projectLength, markers, positionSeconds, loopSel]);

  const progress = Math.min(1, Math.max(0, positionSeconds / duration));

  // Markers sorted by time (for the list + nearest lookup).
  const sortedMarkers = useMemo(
    () => [...markers].sort((a, b) => a.position - b.position),
    [markers]
  );

  // "Current" marker = last one at or before the playhead.
  const currentMarker = useMemo(() => {
    let found: (typeof sortedMarkers)[number] | null = null;
    for (const m of sortedMarkers) {
      if (m.position <= positionSeconds + 0.05) found = m;
      else break;
    }
    return found;
  }, [sortedMarkers, positionSeconds]);

  // --- Live 60fps position (time / beats / playhead) ---
  // The store's positionSeconds does NOT update during playback (only tick events
  // do, and those feed the animation engine, not the store). So drive the live
  // elements directly from the engine via refs, no React re-render per frame.
  const beatsRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const markerNameRef = useRef<HTMLDivElement>(null);
  // Latest values the rAF callback needs, without re-subscribing every render.
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const sortedMarkersRef = useRef(sortedMarkers);
  sortedMarkersRef.current = sortedMarkers;

  useTransportAnimation((s) => {
    const dur = durationRef.current;
    const pct = dur > 0 ? Math.min(1, Math.max(0, s.position / dur)) : 0;
    if (beatsRef.current) beatsRef.current.textContent = s.positionBeats;
    if (timeRef.current) timeRef.current.textContent = formatTime(s.position, { precision: 0, showSign: false });
    if (playheadRef.current) playheadRef.current.style.left = `${pct * 100}%`;
    if (fillRef.current) fillRef.current.style.width = `${pct * 100}%`;
    if (markerNameRef.current) {
      let name = '—';
      for (const m of sortedMarkersRef.current) {
        if (m.position <= s.position + 0.05) name = m.name || `Marker ${m.id}`;
        else break;
      }
      markerNameRef.current.textContent = name;
    }
  }, []);

  // --- Seek bar: tap = seek, drag = paint loop selection ---
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startRatio: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ a: number; b: number } | null>(null);

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handleDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startRatio: ratioFromClientX(e.clientX), moved: false };
    },
    [ratioFromClientX]
  );

  const handleMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const ratio = ratioFromClientX(e.clientX);
      const width = trackRef.current?.getBoundingClientRect().width ?? 0;
      if (!drag.moved && Math.abs(ratio - drag.startRatio) * width > DRAG_THRESHOLD_PX) {
        drag.moved = true;
      }
      if (drag.moved) setPreview({ a: drag.startRatio, b: ratio });
    },
    [ratioFromClientX]
  );

  const handleUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (!drag) return;

      const ratio = ratioFromClientX(e.clientX);
      if (!drag.moved) {
        // Tap → seek
        sendCommand(transport.seek(drag.startRatio * duration));
        return;
      }
      // Drag → set loop (time selection) and enable looping
      const lo = Math.min(drag.startRatio, ratio) * duration;
      const hi = Math.max(drag.startRatio, ratio) * duration;
      if (hi - lo < 0.05) return; // too small
      sendCommand(timeSelection.set(lo, hi));
      if (!isRepeat) sendCommand(repeat.set(1));
    },
    [ratioFromClientX, duration, isRepeat, sendCommand]
  );

  const clearLoop = useCallback(() => sendCommand(timeSelection.clear()), [sendCommand]);

  // One-tap marker at the current cursor, named with a short date/time (e.g. "8/6 20:52").
  // Use the animation engine's live position — the store's position lags during playback.
  const handleAddMarker = useCallback(() => {
    const now = new Date();
    const name = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    sendCommand(marker.add(getTransportAnimationState().position, name));
  }, [sendCommand]);

  // Loop band (committed selection) shown on the bar.
  const loopBand = loopSel && loopSel.endSeconds > loopSel.startSeconds
    ? { left: (loopSel.startSeconds / duration) * 100, width: ((loopSel.endSeconds - loopSel.startSeconds) / duration) * 100 }
    : null;
  const previewBand = preview
    ? { left: Math.min(preview.a, preview.b) * 100, width: Math.abs(preview.b - preview.a) * 100 }
    : null;

  return (
    <div className="flex flex-col h-full bg-bg-app text-text-primary select-none safe-area-top safe-area-x">
      {/* Project name */}
      <div className="px-4 pt-3 text-center text-xs text-text-muted truncate">
        {projectName || 'REAPER'}
      </div>

      {/* Big time readout */}
      <div className="px-4 pt-1 pb-3 text-center">
        <div ref={beatsRef} className="text-5xl font-bold tabular-nums tracking-tight text-text-primary">
          {positionBeats}
        </div>
        <div className="mt-1 text-sm text-text-secondary tabular-nums">
          <span ref={timeRef}>{formatTime(positionSeconds, { precision: 0, showSign: false })}</span>
          <span className="text-text-muted"> / {formatTime(duration, { precision: 0, showSign: false })}</span>
          <span className="mx-2 text-text-muted">·</span>
          {Math.round(bpm ?? 120)} BPM
          <span className="mx-2 text-text-muted">·</span>
          {numerator}/{denominator}
        </div>
      </div>

      {/* Seek bar */}
      <div className="px-4">
        <div
          ref={trackRef}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          className="relative h-16 rounded-xl bg-bg-elevated border border-border-muted touch-none overflow-hidden"
          role="slider"
          aria-label="Seek — tap to move cursor, drag to set loop"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(positionSeconds)}
        >
          {/* Elapsed fill */}
          <div ref={fillRef} className="absolute inset-y-0 left-0 bg-primary/20" style={{ width: `${progress * 100}%` }} />
          {/* Committed loop band */}
          {loopBand && (
            <div
              className="absolute inset-y-0 bg-amber-400/25 border-x-2 border-amber-400/70"
              style={{ left: `${loopBand.left}%`, width: `${loopBand.width}%` }}
            />
          )}
          {/* Live drag preview */}
          {previewBand && (
            <div
              className="absolute inset-y-0 bg-amber-300/30 border-x-2 border-amber-300"
              style={{ left: `${previewBand.left}%`, width: `${previewBand.width}%` }}
            />
          )}
          {/* Marker ticks */}
          {sortedMarkers.map((m) => (
            <div
              key={m.id}
              className="absolute top-0 bottom-0 w-px bg-success/70"
              style={{ left: `${Math.min(100, Math.max(0, (m.position / duration) * 100))}%` }}
            />
          ))}
          {/* Playhead */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-1 -ml-0.5 bg-text-primary rounded"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        {/* Hint / loop status */}
        <div className="flex items-center justify-between px-1 pt-1.5 h-6 text-xs">
          {loopBand ? (
            <>
              <span className="text-amber-400 tabular-nums">
                Loop {formatTime(loopSel!.startSeconds, { precision: 0, showSign: false })}–{formatTime(loopSel!.endSeconds, { precision: 0, showSign: false })}
              </span>
              <button onClick={clearLoop} className="flex items-center gap-1 text-text-muted active:text-text-primary">
                <X size={14} /> clear
              </button>
            </>
          ) : (
            <span className="text-text-muted">tap to seek · drag to loop</span>
          )}
        </div>
      </div>

      {/* Marker navigation */}
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => sendCommand(marker.prev())}
          className="flex items-center justify-center h-14 w-14 shrink-0 rounded-xl bg-bg-elevated active:bg-bg-hover"
          aria-label="Previous marker"
        >
          <ChevronLeft size={28} />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-xs text-text-muted">marker</div>
          <div ref={markerNameRef} className="text-lg font-medium truncate">
            {currentMarker ? currentMarker.name || `Marker ${currentMarker.id}` : '—'}
          </div>
        </div>
        <button
          onClick={() => sendCommand(marker.next())}
          className="flex items-center justify-center h-14 w-14 shrink-0 rounded-xl bg-bg-elevated active:bg-bg-hover"
          aria-label="Next marker"
        >
          <ChevronRight size={28} />
        </button>
      </div>

      {/* Marker list header + one-tap add */}
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Markers</span>
        <button
          onClick={handleAddMarker}
          className="flex items-center gap-1.5 rounded-full bg-primary/20 border border-primary/40 px-3 h-9 text-sm font-medium text-primary active:bg-primary/30"
          aria-label="Add marker at current position"
        >
          <Plus size={16} /> Add marker
        </button>
      </div>

      {/* Marker list (tap to jump) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {sortedMarkers.length === 0 ? (
          <div className="py-6 text-center text-sm text-text-muted">No markers</div>
        ) : (
          <ul className="flex flex-col gap-1.5 pb-2">
            {sortedMarkers.map((m) => {
              const active = currentMarker?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => sendCommand(marker.goto(m.id))}
                    className={`w-full flex items-center justify-between gap-3 rounded-xl px-4 h-14 text-left transition-colors ${
                      active ? 'bg-primary/20 border border-primary/40' : 'bg-bg-elevated active:bg-bg-hover'
                    }`}
                  >
                    <span className="truncate text-base font-medium">
                      {m.name || `Marker ${m.id}`}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-text-secondary">
                      {formatTime(m.position, { precision: 0, showSign: false })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Big transport */}
      <div className="border-t border-border-muted bg-bg-deep px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center gap-3">
          <TransportButton onClick={() => sendCommand(transport.goStart())} label="To start">
            <SkipBack size={26} fill="currentColor" />
          </TransportButton>

          <TransportButton
            onClick={() => sendCommand(transport.playPause())}
            label={isPlaying ? 'Pause' : 'Play'}
            variant={isPlaying ? 'active-green' : 'default'}
            big
          >
            {isPlaying ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" />}
          </TransportButton>

          <TransportButton onClick={() => sendCommand(transport.stop())} label="Stop">
            <Square size={24} fill="currentColor" />
          </TransportButton>

          <TransportButton
            onClick={() => sendCommand(transport.record())}
            label="Record"
            variant={isRecording ? 'active-red' : 'record'}
          >
            <Circle size={26} fill="currentColor" />
          </TransportButton>
        </div>

        {/* Loop toggle */}
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => sendCommand(repeat.toggle())}
            aria-pressed={isRepeat}
            className={`flex items-center gap-2 rounded-full px-5 h-11 text-sm font-medium transition-colors ${
              isRepeat ? 'bg-success text-text-on-primary' : 'bg-bg-elevated text-text-secondary active:bg-bg-hover'
            }`}
          >
            <Repeat size={18} />
            {isRepeat ? 'Loop on' : 'Loop off'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TransportVariant = 'default' | 'record' | 'active-green' | 'active-red';

function TransportButton({
  onClick,
  label,
  children,
  variant = 'default',
  big = false,
}: {
  onClick: () => void;
  label: string;
  children: ReactElement;
  variant?: TransportVariant;
  big?: boolean;
}): ReactElement {
  const size = big ? 'h-20 w-20' : 'h-16 w-16';
  const variantClass: Record<TransportVariant, string> = {
    default: 'bg-bg-elevated text-text-primary active:bg-bg-hover',
    record: 'bg-bg-elevated text-error ring-2 ring-error/40 active:bg-bg-hover',
    'active-green': 'bg-success text-text-on-primary',
    'active-red': 'bg-error text-text-on-primary animate-pulse',
  };
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${size} shrink-0 rounded-full flex items-center justify-center transition-colors touch-none ${variantClass[variant]}`}
    >
      {children}
    </button>
  );
}
