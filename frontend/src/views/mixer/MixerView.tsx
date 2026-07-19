/**
 * MixerView - Dedicated mixer
 *
 * - All tracks shown in a single, horizontally-scrollable row (no bank paging)
 * - Optional pinned master track (Settings → Mixer → Pin MASTER)
 * - Track filtering via header bank selector / quick filters / folders
 */

import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import { ViewHeader, ViewLayout } from '../../components';
import {
  MixerStrip,
  MixerStripCompact,
  BankSelector,
  BankEditorModal,
  CreateTrackModal,
  FolderNavSheet,
  QuickFilterDropdown,
  isBuiltinBank,
  type CustomBank,
  type BuiltinBankId,
} from '../../components/Mixer';
import { Plus } from 'lucide-react';
import {
  useTrackSkeleton,
  useCustomBanks,
  useFolderHierarchy,
  useAvailableContentHeight,
} from '../../hooks';
import { useReaper } from '../../components/ReaperProvider';
import { track } from '../../core/WebSocketCommands';
import { useReaperStore } from '../../store';
import { EMPTY_TRACKS } from '../../store/stableRefs';
import {
  STRIP_OVERHEAD_FULL,
  STRIP_OVERHEAD_COMPACT,
  MIN_FADER_PORTRAIT,
  MIN_FADER_LANDSCAPE,
  MAX_FADER_PERCENT,
  MIXER_CONTENT_PADDING,
} from '../../constants/layout';

export function MixerView(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendCommand } = useReaper();
  const { totalTracks, skeleton } = useTrackSkeleton();
  const tracks = useReaperStore((state) => state?.tracks ?? EMPTY_TRACKS);
  const pinMasterTrack = useReaperStore((state) => state.pinMasterTrack);
  const showAddTrackButton = useReaperStore((state) => state.showAddTrackButton);

  // Responsive height measurement drives fader sizing
  const { availableHeight, isLandscape } = useAvailableContentHeight({
    containerRef,
    viewId: 'mixer',
  });

  // Dynamic fader height based on measured container height and orientation
  const faderHeight = useMemo(() => {
    const minFader = isLandscape ? MIN_FADER_LANDSCAPE : MIN_FADER_PORTRAIT;
    const overhead = isLandscape ? STRIP_OVERHEAD_COMPACT : STRIP_OVERHEAD_FULL;
    if (availableHeight === 0) return minFader;
    const stripBudget = availableHeight - MIXER_CONTENT_PADDING;
    const calculated = stripBudget - overhead;
    return Math.min(Math.max(minFader, calculated), stripBudget * MAX_FADER_PERCENT);
  }, [availableHeight, isLandscape]);

  // Custom banks from ProjExtState
  const { banks: customBanks, saveBank, deleteBank } = useCustomBanks();

  // Filter state from store (persisted across view switches)
  const viewFilters = useReaperStore((s) => s.viewFilters.mixer);
  const setSelectedBankId = useReaperStore((s) => s.setSelectedBankId);
  const setFolderPath = useReaperStore((s) => s.setFolderPath);
  const { selectedBankId, filterQuery, folderPath } = viewFilters;

  // Folder navigation state (sheet visibility is ephemeral, path is persisted)
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const { getChildren: getFolderChildren, validatePath } = useFolderHierarchy();

  const handleSetSelectedBankId = useCallback((bankId: string | null) => {
    setSelectedBankId('mixer', bankId);
    if (bankId === 'builtin:folders') {
      setFolderSheetOpen(true);
    } else {
      setFolderPath('mixer', []);
      setFolderSheetOpen(false);
    }
  }, [setSelectedBankId, setFolderPath]);
  const handleSetFolderPath = useCallback((path: string[]) => {
    setFolderPath('mixer', path);
  }, [setFolderPath]);

  // Modal state
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<CustomBank | null>(null);
  const [createTrackModalOpen, setCreateTrackModalOpen] = useState(false);

  // Get skeleton for custom bank filtering
  const hasTextFilter = filterQuery.trim().length > 0;
  const hasBuiltinBank = isBuiltinBank(selectedBankId);
  const hasCustomBank = selectedBankId !== null && !hasBuiltinBank;
  const isFiltered = hasTextFilter || hasBuiltinBank || hasCustomBank;

  const selectedBank = useMemo(
    () => (hasCustomBank ? customBanks.find((b) => b.id === selectedBankId) : null),
    [hasCustomBank, selectedBankId, customBanks]
  );

  // Filter tracks by bank (built-in, smart, custom), then optional text query
  const allFilteredTracks = useMemo(() => {
    if (!isFiltered) return [];
    let baseTracks = skeleton.slice(1).map((t, i) => ({ ...t, index: i + 1 }));

    if (hasBuiltinBank) {
      const builtinId = selectedBankId as BuiltinBankId;
      if (builtinId === 'builtin:folders' && folderPath.length > 0) {
        const currentFolderGuid = folderPath[folderPath.length - 1];
        const childIndices = new Set(getFolderChildren(currentFolderGuid));
        baseTracks = baseTracks.filter((t) => childIndices.has(t.index));
      } else {
        baseTracks = baseTracks.filter((t) => {
          switch (builtinId) {
            case 'builtin:muted': return t.m === true;
            case 'builtin:soloed': return t.sl !== null && t.sl !== 0;
            case 'builtin:armed': return t.r === true;
            case 'builtin:selected': return t.sel === true;
            case 'builtin:folders': return t.fd === 1;
            case 'builtin:with-sends': return t.sc > 0;
            case 'builtin:clipped': return t.cl === true;
            case 'builtin:with-items': return t.ic > 0;
            default: return true;
          }
        });
      }
    } else if (selectedBank) {
      if (selectedBank.type === 'smart' && selectedBank.pattern) {
        const pattern = selectedBank.pattern.toLowerCase();
        baseTracks = baseTracks.filter((t) => t.n.toLowerCase().includes(pattern));
      } else {
        const bankGuids = new Set(selectedBank.trackGuids);
        baseTracks = baseTracks.filter((t) => bankGuids.has(t.g));
      }
    }

    if (hasTextFilter) {
      const lower = filterQuery.toLowerCase();
      baseTracks = baseTracks.filter((t) => t.n.toLowerCase().includes(lower));
    }
    return baseTracks;
  }, [isFiltered, skeleton, hasBuiltinBank, selectedBankId, selectedBank, hasTextFilter, filterQuery, folderPath, getFolderChildren]);

  const allFilteredIndices = useMemo(() => allFilteredTracks.map((t) => t.index), [allFilteredTracks]);

  // Validate folder path when skeleton changes (folder may have been deleted)
  useEffect(() => {
    if (folderPath.length === 0) return;
    const validPath = validatePath(folderPath);
    if (validPath.length !== folderPath.length) {
      handleSetFolderPath(validPath);
    }
  }, [folderPath, validatePath, handleSetFolderPath]);

  // Track indices to render: all tracks (scrollable), or the filtered set
  const displayTrackIndices = useMemo(() => {
    if (isFiltered) return allFilteredIndices;
    const indices: number[] = [];
    for (let i = pinMasterTrack ? 1 : 0; i <= totalTracks; i++) indices.push(i);
    return indices;
  }, [isFiltered, allFilteredIndices, pinMasterTrack, totalTracks]);

  // Bank management handlers
  const handleAddBank = useCallback(() => {
    setEditingBank(null);
    setBankModalOpen(true);
  }, []);
  const handleEditBank = useCallback((bankId: string) => {
    const bank = customBanks.find((b) => b.id === bankId);
    if (bank) { setEditingBank(bank); setBankModalOpen(true); }
  }, [customBanks]);
  const handleCloseModal = useCallback(() => {
    setBankModalOpen(false);
    setEditingBank(null);
  }, []);
  const handleBankChange = handleSetSelectedBankId;

  const handleSaveBank = useCallback(async (bank: CustomBank) => { await saveBank(bank); }, [saveBank]);
  const handleDeleteBank = useCallback(async (bankId: string) => {
    await deleteBank(bankId);
    if (selectedBankId === bankId) handleSetSelectedBankId(null);
  }, [deleteBank, selectedBankId, handleSetSelectedBankId]);

  // Folder sheet: tapping a track selects it in REAPER and closes the sheet
  const handleFolderSheetSelectTrack = useCallback((trackIndex: number) => {
    sendCommand(track.setSelected(trackIndex, 1));
    setFolderSheetOpen(false);
  }, [sendCommand]);

  // Subscribe to all shown tracks (small track counts → subscribe everything)
  const filteredGuids = useMemo(() => allFilteredTracks.map((t) => t.g), [allFilteredTracks]);
  useEffect(() => {
    if (totalTracks === 0) return;
    if (isFiltered) {
      sendCommand(
        filteredGuids.length > 0
          ? track.subscribe({ guids: filteredGuids, includeMaster: true })
          : track.subscribe({ range: { start: 0, end: 0 }, includeMaster: true })
      );
    } else {
      sendCommand(track.subscribe({ range: { start: 0, end: totalTracks }, includeMaster: true }));
    }
  }, [sendCommand, isFiltered, filteredGuids, totalTracks]);

  const hasTrackData = (trackIndex: number): boolean => !!tracks[trackIndex];

  const placeholderStyle = {
    width: isLandscape ? 82 : 80,
    height: faderHeight + (isLandscape ? STRIP_OVERHEAD_COMPACT : STRIP_OVERHEAD_FULL),
  };

  const renderStrip = (trackIndex: number) =>
    isLandscape ? (
      <MixerStripCompact trackIndex={trackIndex} faderHeight={faderHeight} />
    ) : (
      <MixerStrip trackIndex={trackIndex} mode="volume" faderHeight={faderHeight} showDbLabel={true} />
    );

  return (
    <ViewLayout
      viewId="mixer"
      header={
        <ViewHeader currentView="mixer">
          <BankSelector
            selectedBankId={selectedBankId}
            banks={customBanks}
            onBankChange={handleBankChange}
            onAddBank={handleAddBank}
            onEditBank={handleEditBank}
            onFolderNavClick={() => setFolderSheetOpen(true)}
          />
          <QuickFilterDropdown
            selectedFilterId={hasBuiltinBank && selectedBankId !== 'builtin:folders' ? selectedBankId as BuiltinBankId : null}
            skeleton={skeleton}
            onFilterChange={(filterId) => handleSetSelectedBankId(filterId)}
            className="ml-1"
          />
        </ViewHeader>
      }
      scrollable={false}
      className="bg-bg-app text-text-primary p-view"
    >
      {/* Main mixer area - single scrollable row of all tracks */}
      <div
        ref={containerRef}
        className="h-full flex items-center justify-start gap-2 relative overflow-x-auto overflow-y-hidden pb-3"
      >
        {/* Master track - sticky on the left when pinned */}
        {pinMasterTrack && (
          <div className="sticky left-0 z-10 bg-bg-app border-r pr-2 border-border-subtle">
            {hasTrackData(0) ? renderStrip(0) : <div className="bg-bg-surface/50 rounded-lg animate-pulse" style={placeholderStyle} />}
          </div>
        )}

        {/* Channel strips */}
        <div className="flex gap-3">
          {displayTrackIndices.map((trackIndex) => (
            <div key={trackIndex}>
              {hasTrackData(trackIndex) ? renderStrip(trackIndex) : (
                <div className="bg-bg-surface/50 rounded-lg animate-pulse" style={placeholderStyle} />
              )}
            </div>
          ))}
        </div>

        {/* Empty filter state */}
        {isFiltered && displayTrackIndices.length === 0 && (
          <div className="text-text-muted text-sm">No tracks matching filter</div>
        )}

        {/* Create track button */}
        {showAddTrackButton && (
          <button
            onClick={() => setCreateTrackModalOpen(true)}
            className="self-center p-2 text-text-muted hover:text-text-primary transition-colors"
            title="Create track"
          >
            <Plus size={24} />
          </button>
        )}
      </div>

      {/* Bank editor modal */}
      <BankEditorModal
        isOpen={bankModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveBank}
        onDelete={handleDeleteBank}
        editBank={editingBank}
      />

      {/* Create track modal */}
      <CreateTrackModal
        isOpen={createTrackModalOpen}
        onClose={() => setCreateTrackModalOpen(false)}
      />

      {/* Folder navigation sheet */}
      <FolderNavSheet
        isOpen={folderSheetOpen && selectedBankId === 'builtin:folders'}
        onClose={() => setFolderSheetOpen(false)}
        folderPath={folderPath}
        onNavigate={handleSetFolderPath}
        onSelectTrack={handleFolderSheetSelectTrack}
      />
    </ViewLayout>
  );
}
