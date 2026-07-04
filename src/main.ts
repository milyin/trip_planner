import 'leaflet/dist/leaflet.css';
import './styles/index.css';

import { backfillCoordinates } from './domain/geocode';
import { initMap } from './map/mapView';
import { settings } from './state/settings';
import { emitChange, state, subscribe } from './state/store';
import { wireGlobal } from './ui/global';
import { wireModal } from './ui/modal';
import { setupDrop } from './ui/panels';
import { wireParserSettings } from './ui/parserSettings';
import { renderAll } from './ui/render';
import { setTab, syncMode, wireTabbar } from './ui/tabbar';
import { applyTheme } from './ui/theme';
import { wireTopbar } from './ui/topbar';

initMap();
wireTopbar();
wireModal();
wireParserSettings();
wireTabbar();
wireGlobal();
setupDrop('segmentsList', 'segments');
setupDrop('planList', 'plan');
applyTheme(settings.theme);

subscribe(renderAll);
renderAll();
setTab('plan');
syncMode();

// Resolve coordinates that older data or offline saves are missing, so every
// record eventually shows on the map.
backfillCoordinates(state.items, emitChange);
