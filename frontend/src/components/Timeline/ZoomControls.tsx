/**
 * Zoom Controls Component
 * Always-visible inline zoom: [−] duration [＋] [fit]
 */

import type { ReactElement } from 'react';
import { ZoomOut, ZoomIn, Maximize2 } from 'lucide-react';
import { formatZoomDuration } from '../../utils/timelineTicks';

export interface ZoomControlsProps {
  /** Current visible duration in seconds */
  visibleDuration: number;
  /** Zoom in callback */
  onZoomIn: () => void;
  /** Zoom out callback */
  onZoomOut: () => void;
  /** Fit to content callback */
  onFitToContent?: () => void;
  /** Optional className for container */
  className?: string;
}

export function ZoomControls({
  visibleDuration,
  onZoomIn,
  onZoomOut,
  onFitToContent,
  className = '',
}: ZoomControlsProps): ReactElement {
  const btn =
    'p-2 rounded-lg transition-colors touch-none text-text-tertiary hover:bg-bg-hover hover:text-text-secondary active:bg-bg-surface';

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <button onClick={onZoomOut} className={btn} title="Zoom out" aria-label="Zoom out">
        <ZoomOut size={18} />
      </button>

      <span
        className="min-w-[3ch] text-center text-[10px] font-medium tabular-nums text-text-tertiary select-none"
        aria-live="polite"
        title="Visible duration"
      >
        {formatZoomDuration(visibleDuration)}
      </span>

      <button onClick={onZoomIn} className={btn} title="Zoom in" aria-label="Zoom in">
        <ZoomIn size={18} />
      </button>

      {onFitToContent && (
        <button
          onClick={onFitToContent}
          className={btn}
          title="Fit to content"
          aria-label="Fit to content"
        >
          <Maximize2 size={18} />
        </button>
      )}
    </div>
  );
}
