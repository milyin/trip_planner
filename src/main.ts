import 'leaflet/dist/leaflet.css';
import './styles/index.css';

import { initMap } from './map/mapView';
import { subscribe } from './state/store';
import { wireGlobal } from './ui/global';
import { wireModal } from './ui/modal';
import { setupDrop } from './ui/panels';
import { renderAll } from './ui/render';
import { setTab, syncMode, wireTabbar } from './ui/tabbar';
import { wireTopbar } from './ui/topbar';

initMap();
wireTopbar();
wireModal();
wireTabbar();
wireGlobal();
setupDrop('segmentsList', 'segments');
setupDrop('planList', 'plan');

subscribe(renderAll);
renderAll();
setTab('plan');
syncMode();
