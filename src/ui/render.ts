import { drawMap } from '../map/mapView';
import { renderPlan, renderSegmentsPool } from './panels';

/** Re-render every panel and the map from current state. */
export function renderAll(): void {
  renderSegmentsPool();
  renderPlan();
  drawMap();
}
