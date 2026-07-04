import { drawMap } from '../map/mapView';
import { renderPlan, renderSegments } from './panels';

/** Re-render every panel and the map from current state. */
export function renderAll(): void {
  renderSegments();
  renderPlan();
  drawMap();
}
