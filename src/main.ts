import 'leaflet/dist/leaflet.css';
import './styles/index.css';

import { wireImport } from './import/importFlow';
import { initMap } from './map/mapView';
import { settings } from './state/settings';
import { subscribe } from './state/store';
import { wireGlobal } from './ui/global';
import { wireModal } from './ui/modal';
import { setupDrop } from './ui/panels';
import { renderAll } from './ui/render';
import { setTab, syncMode, wireTabbar } from './ui/tabbar';
import { applyTheme } from './ui/theme';
import { wireTopbar } from './ui/topbar';

initMap();
wireTopbar();
wireModal();
wireImport();
wireTabbar();
wireGlobal();
setupDrop('segmentsList', 'segments');
setupDrop('planList', 'plan');
applyTheme(settings.theme);

subscribe(renderAll);
renderAll();
setTab('plan');
syncMode();
