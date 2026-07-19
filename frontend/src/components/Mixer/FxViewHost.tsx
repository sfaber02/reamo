/**
 * FxViewHost - Renders the FX chain view for whatever track is set in the
 * global fxView slice. Mounted once at the app root so any surface (mixer,
 * timeline double-tap, etc.) can open FX via openFxView().
 *
 * Hosts the FX modal trio: chain list (FxModal) + plugin browser
 * (FxBrowserModal) + per-plugin params (FxParamModal).
 */

import { useState, useCallback, useEffect, type ReactElement } from 'react';
import { useReaperStore } from '../../store';
import { FxModal } from './FxModal';
import { FxBrowserModal } from './FxBrowserModal';
import { FxParamModal } from './FxParamModal';

export function FxViewHost(): ReactElement | null {
  const target = useReaperStore((s) => s.fxViewTarget);
  const closeFxView = useReaperStore((s) => s.closeFxView);

  // Nested modal state (browser / param editor), scoped to the current target
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [selectedFx, setSelectedFx] = useState<{ fxGuid: string; fxName: string } | null>(null);

  // Reset nested modals whenever the target track changes or clears
  const targetGuid = target?.trackGuid;
  useEffect(() => {
    setIsBrowserOpen(false);
    setSelectedFx(null);
  }, [targetGuid]);

  const handleClose = useCallback(() => {
    setIsBrowserOpen(false);
    setSelectedFx(null);
    closeFxView();
  }, [closeFxView]);

  const handleAddFx = useCallback(() => setIsBrowserOpen(true), []);
  const handleOpenFxParams = useCallback(
    (fxGuid: string, fxName: string) => setSelectedFx({ fxGuid, fxName }),
    []
  );
  const handleFxBrowserClose = useCallback(() => setIsBrowserOpen(false), []);
  const handleFxParamClose = useCallback(() => setSelectedFx(null), []);

  if (!target) return null;

  return (
    <>
      <FxModal
        isOpen={true}
        onClose={handleClose}
        trackIndex={target.trackIndex}
        overrideGuid={target.trackGuid}
        overrideName={target.trackName}
        onAddFx={handleAddFx}
        onOpenFxParams={handleOpenFxParams}
      />

      <FxBrowserModal
        isOpen={isBrowserOpen}
        onClose={handleFxBrowserClose}
        trackGuid={target.trackGuid}
        trackName={target.trackName}
      />

      {selectedFx && (
        <FxParamModal
          isOpen={true}
          onClose={handleFxParamClose}
          trackGuid={target.trackGuid}
          fxGuid={selectedFx.fxGuid}
          fxName={selectedFx.fxName}
        />
      )}
    </>
  );
}
