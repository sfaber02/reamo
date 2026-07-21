/**
 * REAmo - REAPER Web Control (simple phone remote)
 *
 * This branch (simple-phone-ui) strips the app down to a single, phone-first
 * screen: big transport, seekable timeline, and marker navigation. All the
 * heavier views (mixer, FX, waveforms, actions, etc.) are intentionally gone.
 */

import { useState, useEffect, type ReactNode } from 'react';
import { Radio, SlidersHorizontal } from 'lucide-react';
import './index.css';
import { ReaperProvider, useReaper, ConnectionBanner, ErrorBoundary, ModalRoot, ToastRoot } from './components';
import { FxViewHost } from './components/Mixer/FxViewHost';
import { useReaperStore } from './store';
import { SimpleRemote } from './views/simple/SimpleRemote';
import { MixerView } from './views/mixer';

type SimpleView = 'remote' | 'mixer';

function AppContent() {
  const [view, setView] = useState<SimpleView>('remote');

  return (
    <div className="flex flex-col h-dvh bg-bg-app overflow-hidden select-none isolate safe-area-top">
      <ConnectionBanner className="shrink-0" />

      <main className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary>
          {view === 'remote' ? <SimpleRemote /> : <MixerView />}
        </ErrorBoundary>
      </main>

      {/* Minimal two-tab switch */}
      <nav className="shrink-0 flex border-t border-border-muted bg-bg-deep safe-area-bottom safe-area-x z-fixed">
        <ViewTab active={view === 'remote'} onClick={() => setView('remote')} icon={<Radio size={20} />} label="Remote" />
        <ViewTab active={view === 'mixer'} onClick={() => setView('mixer')} icon={<SlidersHorizontal size={20} />} label="Mixer" />
      </nav>

      <ModalRoot />
      <ToastRoot />
      <FxViewHost />
    </div>
  );
}

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
        active ? 'text-primary' : 'text-text-muted active:text-text-secondary'
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

/**
 * Loading screen - shown while connecting to REAPER
 */
function LoadingScreen() {
  const { gaveUp } = useReaper();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const troubleState = elapsed >= 10 || gaveUp;

  return (
    <div className="flex flex-col items-center justify-center h-dvh gap-6 bg-bg-app px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-wide text-text-primary">REAmo</h1>

      <svg className="w-32 h-32" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 80">
        <rect x="0" y="0" width="48" height="80" rx="14" fill="#3a3a3a" />
        <g>
          {!troubleState && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 24 41"
              to="360 24 41"
              dur="4s"
              repeatCount="indefinite"
            />
          )}
          <circle cx="24" cy="32" r="12" fill="#5ba3d4" opacity="0.9" />
          <circle cx="16" cy="46" r="12" fill="#7ec96b" opacity="0.9" />
          <circle cx="32" cy="46" r="12" fill="#d4956b" opacity="0.9" />
        </g>
      </svg>

      {troubleState ? (
        <div className="flex flex-col items-center gap-4 max-w-xs">
          <p className="text-text-secondary text-sm">Having trouble connecting to REAPER.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-text-on-primary text-sm font-medium rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      ) : elapsed >= 1 ? (
        <p className="text-text-secondary text-sm">Connecting...</p>
      ) : null}
    </div>
  );
}

// Minimum time to show loading screen (prevents jarring flash on fast connections)
const MIN_LOADING_MS = 750;

function AppWithLoading() {
  const { connected } = useReaper();
  const [minTimePassed, setMinTimePassed] = useState(false);
  const loadUIPrefsFromStorage = useReaperStore((s) => s.loadUIPrefsFromStorage);

  useEffect(() => {
    loadUIPrefsFromStorage();
  }, [loadUIPrefsFromStorage]);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimePassed(true), MIN_LOADING_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!connected || !minTimePassed) {
    return <LoadingScreen />;
  }

  return <AppContent />;
}

function App() {
  return (
    <ReaperProvider autoStart={true}>
      <AppWithLoading />
    </ReaperProvider>
  );
}

export default App;
