import 'leaflet/dist/leaflet.css';
import './styles/index.css';

import { backfillCoordinates } from './domain/geocode';
import { initMap, resetInitialFit, setShowPool } from './map/mapView';
import { settings } from './state/settings';
import { importSharedFromHash } from './state/share';
import { emitChange, reloadActiveWorkspace, state, subscribe } from './state/store';
import { wireGlobal } from './ui/global';
import { applyIcons } from './ui/icons';
import { wireModal } from './ui/modal';
import { setupDrop, syncEyeButton, wirePanelActions } from './ui/panels';
import { wireParserSettings } from './ui/parserSettings';
import { renderAll } from './ui/render';
import { setTab, syncMode, wireTabbar } from './ui/tabbar';
import { applyTheme } from './ui/theme';
import { wireTopbar } from './ui/topbar';
import { refreshWorkspaceUi, wireWorkspaces } from './ui/workspaces';

applyIcons();
initMap();
wireTopbar();
wireModal();
wireParserSettings();
wireTabbar();
wireGlobal();
setupDrop('segmentsList', 'segments');
setupDrop('planList', 'plan');
wirePanelActions();
wireWorkspaces();
applyTheme(settings.theme);

subscribe(renderAll);
renderAll();
setTab('plan');
syncMode();

// A share link in the URL becomes a new workspace (async: gzip decoding).
function handleShareHash(): Promise<boolean> {
  return importSharedFromHash().then((imported) => {
    if (imported) {
      reloadActiveWorkspace();
      refreshWorkspaceUi();
      // Present a shared plan cleanly: hide the pool (plan-only map), re-fit to
      // the imported itinerary, and land on the Plan tab (also matters when a
      // link is pasted into an already-open app on another tab).
      setShowPool(false);
      syncEyeButton();
      resetInitialFit();
      setTab('plan');
      emitChange();
    }
    return imported;
  });
}

void handleShareHash().then(() => {
  // Resolve coordinates that older data or offline saves are missing, so
  // every record eventually shows on the map.
  backfillCoordinates(state.items, emitChange);
});
// Pasting a share link into an already-open app only changes the hash
// (same-document navigation) — import on hashchange too.
window.addEventListener('hashchange', () => void handleShareHash());
