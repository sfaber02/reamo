/**
 * useTimelinePointerEvents — Gesture routing for the timeline canvas
 *
 * Manages handlePointerDown, handlePointerMove, handlePointerUp and their
 * shared state (dragStart, dragEnd, isCancelled, panStartPositionRef).
 * Routes pointer events to the correct handler based on timeline mode:
 * pinch (always), region editing, pan/tap (navigate), or selection drag.
 * Also computes the selectionPreview bounds during active selection drags.
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
  // Gesture state (navigate mode)
  // Simplified: tap = seek, horizontal drag = select, vertical drag off = cancel
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [isCancelled, setIsCancelled] = useState(false);

  // Track pan gesture start position for tap detection
  const panStartPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Long-press tracking (navigate mode)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Clear any pending long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  // Handle touch/mouse start
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Always track pinch pointers (works in all modes)
      const pinchStarted = pinchGesture.handlePointerDown(e);
      if (pinchStarted) {
        // isPinchingRef is already set to true inside the hook
        // Don't pause follow when following playhead - zoom is already centered on it
        if (!followPlayhead) {
          pauseFollow();
        }
        return; // Pinch takes priority
      }

      // Don't start timeline selection if dragging playhead
      if (isDraggingPlayhead) return;

      // Region editing mode - delegate to hook if handlers provided, otherwise fall through to pan/tap
      if (timelineMode === 'regions' && handleRegionPointerDown) {
        handleRegionPointerDown(e);
        return;
      }

      // Navigate mode: free-hand time-selection drag (drag = loop, tap = item).
      // Pan-by-drag is intentionally disabled here so a finger drag on the track
      // region sets the loop directly.
      if (timelineMode === 'navigate') {
        panStartPositionRef.current = { x: e.clientX, y: e.clientY };
        const time = positionToTime(e.clientX);
        setDragStart(time);
        setDragEnd(time);
        setIsCancelled(false);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        // Start long-press timer: holding still (no drag) opens the track's FX view
        longPressFiredRef.current = false;
        longPressPosRef.current = { x: e.clientX, y: e.clientY };
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          longPressTimerRef.current = null;
          // Abandon the nascent selection drag so no loop is created
          setDragStart(null);
          setDragEnd(null);
          setIsCancelled(false);
          onTrackLongPress?.(longPressPosRef.current.x, longPressPosRef.current.y);
        }, LONG_PRESS_MS);
        return;
      }

      // Regions mode without drag handlers - original pan/tap or selection behavior
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          // Pan mode (default) - track start position for tap detection, then delegate
          panStartPositionRef.current = { x: e.clientX, y: e.clientY };
          panGesture.handlePointerDown(e);
          return;
        }
        // Selection mode - time selection gesture
        const time = positionToTime(e.clientX);
        setDragStart(time);
        setDragEnd(time);
        setIsCancelled(false);
        // Capture pointer for drag events
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [positionToTime, isDraggingPlayhead, timelineMode, handleRegionPointerDown, selectionModeActive, panGesture, pinchGesture, pauseFollow, followPlayhead, onTrackLongPress]
  );

  // Handle touch/mouse move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Always update pinch pointers (even if not pinching yet, to track second finger)
      pinchGesture.handlePointerMove(e);

      // If pinching, skip other gesture handling
      if (pinchGesture.isPinchingRef.current) return;

      // Region editing mode - delegate to hook if handlers provided
      if (timelineMode === 'regions' && handleRegionPointerMove) {
        handleRegionPointerMove(e);
        return;
      }

      // Navigate mode: update the free-hand selection drag
      if (timelineMode === 'navigate') {
        // Any real movement cancels a pending long-press (it's a drag = loop)
        if (longPressTimerRef.current) {
          const ldx = Math.abs(e.clientX - longPressPosRef.current.x);
          const ldy = Math.abs(e.clientY - longPressPosRef.current.y);
          if (ldx > LONG_PRESS_MOVE_CANCEL || ldy > LONG_PRESS_MOVE_CANCEL) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }
        if (dragStart === null || !containerRef.current) return;
        const time = positionToTime(e.clientX);
        setDragEnd(time);
        const rect = containerRef.current.getBoundingClientRect();
        const isOutsideVertically =
          e.clientY < rect.top - VERTICAL_CANCEL_THRESHOLD ||
          e.clientY > rect.bottom + VERTICAL_CANCEL_THRESHOLD;
        setIsCancelled(isOutsideVertically);
        return;
      }

      // Regions mode without drag handlers
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          // Pan mode - delegate to pan gesture
          panGesture.handlePointerMove(e);
          return;
        }
        // Selection mode - time selection gesture
        if (dragStart === null || !containerRef.current) return;

        const time = positionToTime(e.clientX);
        setDragEnd(time);

        // Check if dragged off timeline (vertical cancel)
        const rect = containerRef.current.getBoundingClientRect();
        const isOutsideVertically =
          e.clientY < rect.top - VERTICAL_CANCEL_THRESHOLD ||
          e.clientY > rect.bottom + VERTICAL_CANCEL_THRESHOLD;

        if (isOutsideVertically) {
          setIsCancelled(true);
        } else {
          setIsCancelled(false);
        }
      }
    },
    [dragStart, positionToTime, timelineMode, handleRegionPointerMove, selectionModeActive, panGesture, pinchGesture, containerRef]
  );

  // Handle touch/mouse end
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Check if we were pinching BEFORE processing the pointer up
      const wasPinching = pinchGesture.isPinchingRef.current;

      // Always track pinch pointer removal
      pinchGesture.handlePointerUp(e);

      // If we were pinching, don't process as tap/other gesture
      // This handles both "still pinching" (2+ fingers) and "pinch just ended" (1 finger lifted)
      if (wasPinching) {
        return;
      }

      // Region editing mode - delegate to hook if handlers provided
      if (timelineMode === 'regions' && handleRegionPointerUp) {
        handleRegionPointerUp(e);
        return;
      }

      // Navigate mode: commit free-hand time selection (no snap), or tap = item
      if (timelineMode === 'navigate') {
        // Long-press already handled (opened FX) — swallow this pointerup
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          setDragStart(null);
          setDragEnd(null);
          setIsCancelled(false);
          panStartPositionRef.current = null;
          try {
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            // Pointer capture already released
          }
          return;
        }

        if (dragStart === null) return;

        const endTime = positionToTime(e.clientX);
        const wasDraggingHorizontally = Math.abs(endTime - dragStart) > 0.1;

        const rect = containerRef.current?.getBoundingClientRect();
        const isOutsideVertically = rect && (
          e.clientY < rect.top - VERTICAL_CANCEL_THRESHOLD ||
          e.clientY > rect.bottom + VERTICAL_CANCEL_THRESHOLD
        );
        const startPos = panStartPositionRef.current;

        if (isCancelled || isOutsideVertically) {
          // Cancelled - do nothing
        } else if (wasDraggingHorizontally) {
          // Free-hand time selection - no snapping to grid/boundaries
          const selStart = Math.min(dragStart, endTime);
          const selEnd = Math.max(dragStart, endTime);
          setTimeSelection(selStart, selEnd);
        } else if (startPos) {
          // Tap (no horizontal movement) = select item under finger
          const dx = Math.abs(e.clientX - startPos.x);
          const dy = Math.abs(e.clientY - startPos.y);
          if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
            handleItemTap(e.clientX, e.clientY);
          }
        }

        // Reset state
        setDragStart(null);
        setDragEnd(null);
        setIsCancelled(false);
        panStartPositionRef.current = null;

        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // Pointer capture already released
        }
        return;
      }

      // Regions mode without drag handlers - original pan/tap or selection behavior
      if (timelineMode === 'regions') {
        if (!selectionModeActive) {
          // Pan mode - delegate to pan gesture
          panGesture.handlePointerUp(e);

          // Check if it was a tap (minimal movement) - if so, check for item/region hit
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
    ]
  );

  // Calculate selection preview bounds (free-hand, no snapping)
  const selectionPreview = useMemo(() => {
    if (dragStart === null || dragEnd === null) return null;
    // Don't show if cancelled or no horizontal movement
    if (isCancelled) return null;
    if (Math.abs(dragEnd - dragStart) <= 0.1) return null;

    const start = Math.min(dragStart, dragEnd);
    const end = Math.max(dragStart, dragEnd);

    return { start, end };
  }, [dragStart, dragEnd, isCancelled]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    selectionPreview,
  };
}
