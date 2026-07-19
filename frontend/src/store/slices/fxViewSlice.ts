/**
 * FX View slice
 * Global "open the FX chain for this track" state, so any view (mixer,
 * timeline double-tap, etc.) can surface the FX view. Rendered once by
 * <FxViewHost /> at the app root.
 */

import type { StateCreator } from 'zustand';

export interface FxViewTarget {
  /** Global track index (0 = master, 1+ = user tracks) */
  trackIndex: number;
  /** Track GUID for stable FX targeting */
  trackGuid: string;
  /** Display name for headers */
  trackName: string;
}

export interface FxViewSlice {
  fxViewTarget: FxViewTarget | null;
  openFxView: (target: FxViewTarget) => void;
  closeFxView: () => void;
}

export const createFxViewSlice: StateCreator<FxViewSlice> = (set) => ({
  fxViewTarget: null,
  openFxView: (target) => set({ fxViewTarget: target }),
  closeFxView: () => set({ fxViewTarget: null }),
});
