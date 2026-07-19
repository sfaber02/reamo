/**
 * useTimelinePointerEvents — Gesture routing for the timeline canvas
 *
 * Navigate mode (the track region):
 *   - 1-finger drag = pan/scroll
 *   - pinch = zoom
 *   - tap = select item under finger
 *   - long-press = open that track's FX view
 * Time selection is handled by the ruler, NOT the track region.
 *
 * Regions mode keeps its own editing/selection handlers (unchanged).
 */

import { useState, useRef, useCallback, useMemo, useEffect, type RefObject } from 'react';
import type { UsePanGestureResult } from './usePanGesture';
import type { UsePinchGestureResult } from './usePinchGesture';
import type { TimelineMode } from '../../../store/slices/regionEditSlice.types';

// Vertical distance to cancel gesture (drag off timeline)
const VERTICAL_CANCEL_THRESHOLD = 50;

// Tap detection threshold (pixels) - movement less than this is considered a tap
const TAP_THRESHOLD = 10;

// Long-press: hold duration (ms) and movement tolerance (px) before it cancels
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_CANCEL = 12;

export interface UseTimelinePointerEventsParams {
  containerRef: RefObject<HTMLDivElement | null>;
  timelineMode: TimelineMode;
  selectionModeActive: boolean;
  panGesture: UsePanGestureResult;
  pinchGesture: UsePinchGestureResult;
  isDraggingPlayhead: boolean;
  /** Region pointer handlers (optional — if absent, regions mode uses pan/tap like navigate) */
  handleRegionPointerDown?: (e: React.PointerEvent) => void;
  handleRegionPointerMove?: (e: React.PointerEvent) => void;
  handleRegionPointerUp?: (e: React.PointerEvent) => void;
  /** Called on tap in regions mode to select/deselect a region. Return true if a region was hit. */
  onRegionTap?: (clientX: number, clientY: number) => boolean;
  handleItemTap: (clientX: number, clientY: number) => boolean;
  positionToTime: (clientX: number) => number;
  followPlayhead: boolean;
  pauseFollow: () => void;
  setTimeSelection: (start: number, end: number) => void;
  navigateTo: (time: number) => void;
  findNearestBoundary: (time: number) => number;
  /** Called on a long-press in navigate mode (e.g. to open the track's FX view) */
  onTrackLongPress?: (clientX: number, clientY: number) => void;
}

export interface UseTimelinePointerEventsReturn {
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  selectionPreview: { start: number; end: number } | null;
}

export function useTimelinePointerEvents({
  containerRef,
  timelineMode,
  selectionModeActive,
  panGesture,
  pinchGesture,
  isDraggingPlayhead,
  handleRegionPointerDown,
  handleRegionPointerMove,
  handleRegionPointerUp,
  onRegionTap,
  handleItemTap,
  positionToTime,
  followPlayhead,
  pauseFollow,
  setTimeSelection,
  navigateTo,
  findNearestBoundary,
  onTrackLongPress,
}: UseTimelinePointerEventsParams): UseTimelinePointerEventsReturn {
  // Selection drag state (regions mode only)
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [isCancelled, setIsCancelled] = useState(false);

  // Track pan gesture start position for tap detection
  const panStartPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Long-press tracking (navigate mode)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Clear any pending long-press timer on unmount
  useEffect(() => cancelLongPress, [cancelLongPress]);

  // Handle touch/mouse start
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Always track pinch pointers (works in all modes)
      const pinchStarted = pinchGesture.handlePointerDown(e);
      if (pinchStarted) {
        cancelLongPress();
        if (!followPlayhead) pauseFollow();
        return; // Pinch takes priority
      }

      // Don't start a gesture while the playhead is being dragged
      if (isDraggingPlayhead) return;

      // Region editing mode - delegate to hook if handlers provided
      if (timelineMode === 'regions' && handleRegionPointerDown) {
        handleRegionPointerDown(e);
        return;
      }

      // Navigate mode: pan/scroll the track region (+ tap = item, long-press = FX)
      if (timelineMode === 'navigate') {
        panStartPositionRef.current = { x: e.clientX, y: e.clientY };
        panGesture.handlePointerDown(e);

        longPressFiredRef.current = false;
        longPressPosRef.current = { x: e.clientX, y: e.clientY };
        cancelLongPress();
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          longPressTimerRef.current = null;
          onTrackLongPress?.(longPressPosRef.current.x, longPressPosRef.current.y);
        }, LONG_PRESS_MS);
        return;
      }

      // Regions mode without drag handlers - original pan/tap or selection behavior
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          panStartPositionRef.current = { x: e.clientX, y: e.clientY };
          panGesture.handlePointerDown(e);
          return;
        }
        const time = positionToTime(e.clientX);
        setDragStart(time);
        setDragEnd(time);
        setIsCancelled(false);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [positionToTime, isDraggingPlayhead, timelineMode, handleRegionPointerDown, selectionModeActive, panGesture, pinchGesture, pauseFollow, followPlayhead, onTrackLongPress, cancelLongPress]
  );

  // Handle touch/mouse move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Always update pinch pointers (even if not pinching yet, to track second finger)
      pinchGesture.handlePointerMove(e);
      if (pinchGesture.isPinchingRef.current) {
        cancelLongPress();
        return;
      }

      // Region editing mode - delegate to hook if handlers provided
      if (timelineMode === 'regions' && handleRegionPointerMove) {
        handleRegionPointerMove(e);
        return;
      }

      // Navigate mode: pan/scroll
      if (timelineMode === 'navigate') {
        // Any real movement cancels the pending long-press (it's a drag = pan)
        if (longPressTimerRef.current) {
          const ldx = Math.abs(e.clientX - longPressPosRef.current.x);
          const ldy = Math.abs(e.clientY - longPressPosRef.current.y);
          if (ldx > LONG_PRESS_MOVE_CANCEL || ldy > LONG_PRESS_MOVE_CANCEL) cancelLongPress();
        }
        panGesture.handlePointerMove(e);
        return;
      }

      // Regions mode without drag handlers
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          panGesture.handlePointerMove(e);
          return;
        }
        if (dragStart === null || !containerRef.current) return;
        const time = positionToTime(e.clientX);
        setDragEnd(time);
        const rect = containerRef.current.getBoundingClientRect();
        const isOutsideVertically =
          e.clientY < rect.top - VERTICAL_CANCEL_THRESHOLD ||
          e.clientY > rect.bottom + VERTICAL_CANCEL_THRESHOLD;
        setIsCancelled(isOutsideVertically);
      }
    },
    [dragStart, positionToTime, timelineMode, handleRegionPointerMove, selectionModeActive, panGesture, pinchGesture, containerRef, cancelLongPress]
  );

  // Handle touch/mouse end
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasPinching = pinchGesture.isPinchingRef.current;
      pinchGesture.handlePointerUp(e);
      if (wasPinching) return;

      // Region editing mode - delegate to hook if handlers provided
      if (timelineMode === 'regions' && handleRegionPointerUp) {
        handleRegionPointerUp(e);
        return;
      }

      // Navigate mode: finish pan; tap = item; long-press already opened FX
      if (timelineMode === 'navigate') {
        cancelLongPress();
        panGesture.handlePointerUp(e);

        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          panStartPositionRef.current = null;
          return;
        }

        if (panStartPositionRef.current) {
          const dx = Math.abs(e.clientX - panStartPositionRef.current.x);
          const dy = Math.abs(e.clientY - panStartPositionRef.current.y);
          if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
            handleItemTap(e.clientX, e.clientY);
          }
        }
        panStartPositionRef.current = null;
        return;
      }

      // Regions mode without drag handlers - original pan/tap or selection behavior
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          panGesture.handlePointerUp(e);
          if (panStartPositionRef.current) {
            const dx = Math.abs(e.clientX - panStartPositionRef.current.x);
            const dy = Math.abs(e.clientY - panStartPositionRef.current.y);
            if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
              if (onRegionTap) {
                onRegionTap(e.clientX, e.clientY);
              } else {
                handleItemTap(e.clientX, e.clientY);
              }
            }
          }
          panStartPositionRef.current = null;
          return;
        }

        // Selection mode - time selection gesture (boundary-snapped)
        if (dragStart === null) return;
        const endTime = positionToTime(e.clientX);
        const wasDraggingHorizontally = Math.abs(endTime - dragStart) > 0.1;
        const rect = containerRef.current?.getBoundingClientRect();
        const isOutsideVertically = rect && (
          e.clientY < rect.top - VERTICAL_CANCEL_THRESHOLD ||
          e.clientY > rect.bottom + VERTICAL_CANCEL_THRESHOLD
        );

        if (isCancelled || isOutsideVertically) {
          // Cancelled - do nothing
        } else if (wasDraggingHorizontally) {
          const selStart = findNearestBoundary(Math.min(dragStart, endTime));
          const selEnd = findNearestBoundary(Math.max(dragStart, endTime));
          setTimeSelection(selStart, selEnd);
        } else {
          navigateTo(findNearestBoundary(dragStart));
        }

        setDragStart(null);
        setDragEnd(null);
        setIsCancelled(false);
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // Pointer capture already released
        }
      }
    },
    [
      dragStart,
      isCancelled,
      positionToTime,
      findNearestBoundary,
      setTimeSelection,
      navigateTo,
      timelineMode,
      handleRegionPointerUp,
      selectionModeActive,
      panGesture,
      pinchGesture,
      handleItemTap,
      onRegionTap,
      containerRef,
      cancelLongPress,
    ]
  );

  // Selection preview (regions mode only — navigate has no canvas selection)
  const selectionPreview = useMemo(() => {
    if (dragStart === null || dragEnd === null) return null;
    if (isCancelled) return null;
    if (Math.abs(dragEnd - dragStart) <= 0.1) return null;
    return { start: Math.min(dragStart, dragEnd), end: Math.max(dragStart, dragEnd) };
  }, [dragStart, dragEnd, isCancelled]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    selectionPreview,
  };
}
