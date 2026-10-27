import { Scene } from './scene/Scene';
import { Panel } from './ui/Panel';
import { Plates } from './ui/Plates';
import { DistrictStrip } from './ui/DistrictStrip';
import { RowHeaders } from './ui/RowHeaders';
import { LayerBar } from './ui/LayerBar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { CommandDrawer } from './ui/CommandDrawer';
import { TerminalDrawer, TerminalLauncherPill } from './ui/TerminalDrawer';
import { HelpOverlay, SearchHint, StatusBar, Toasts, Tooltip, TopBar, useWindowChrome } from './ui/Overlays';
import { useKeyboard } from './ui/useKeyboard';
import { Palette } from './ui/Palette';
import { SkillsSettings } from './ui/SkillsSettings';
import { LibDragGhost, LibDropChooser } from './ui/library/LibraryManager';
import { LibraryTag } from './ui/LibraryTag';
import { useAutoSendContext } from './ui/library/autoSend';
import { useWorld } from './store';
import { UNREACHABLE_AFTER_FAILURES } from './store/reducer';
import { useFollowCmux } from './ui/followCmux';
import { EventTicker } from './ui/EventTicker';
import { useCatchUp } from './ui/catchUp';
import { loadConfig } from './api/config';
import { CLI_NAME } from './lib/brand';
import { useEffect } from 'react';
import { useApplySkin } from './skins/store';
import { useDevShots } from './ui/devShots';

export function App() {
  const search = useKeyboard();
  useWindowChrome();
  useFollowCmux();
  useCatchUp();
  useApplySkin();
  useAutoSendContext();
  useDevShots();
  const conn = useWorld((s) => s.conn);
  useEffect(() => {
    if (conn === 'open') void loadConfig(false);
  }, [conn]);
  const hasData = useWorld((s) => !!s.snapshot);
  const unreachable = useWorld((s) => s.wsFailures >= UNREACHABLE_AFTER_FAILURES);
  return (
    <div className="app">
      <Scene />
      {/* Tab order: top bar, layer bar, panel, then the scene's tags (every layer has its own z-index) */}
      <TopBar />
      <LayerBar />
      <Panel />
      <Plates />
      <DistrictStrip />
      <LibraryTag />
      <RowHeaders />
      {!hasData && (
        <div className={`loading glass${unreachable ? ' is-error' : ''}`} role="status">
          {unreachable ? (
            <>
              <b>Can't reach the Shufler daemon</b>
              <span>
                Start it with <code>bin/{CLI_NAME} start</code>, or open <code>?mock=1</code> to explore with demo data.
              </span>
            </>
          ) : (
            <>
              <span className="loading-dot" />
              Connecting to the daemon…
            </>
          )}
        </div>
      )}
      <CommandDrawer />
      <TerminalDrawer />
      <TerminalLauncherPill />
      <EventTicker />
      <StatusBar />
      <Toasts />
      <Tooltip />
      <SearchHint text={search} />
      <SkillsSettings />
      <LibDragGhost />
      <LibDropChooser />
      <Palette />
      <ConfirmDialog />
      <HelpOverlay />
    </div>
  );
}
