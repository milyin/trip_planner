use trip_core::{
    AvailabilityStatus, Coordinates, PlanError, PlanRow, Route, RouteAvailability, RouteId,
    build_plan_rows, route_availability, routes_overlap, selected_routes_are_non_overlapping,
};
use trip_geo::{GeoError, Geocoder};
use trip_storage::{RouteRepository, StorageError};

pub struct TripPlanner<R, G> {
    repository: R,
    geocoder: G,
    selected_plan: Vec<RouteId>,
}

impl<R, G> TripPlanner<R, G>
where
    R: RouteRepository,
    G: Geocoder,
{
    pub fn new(repository: R, geocoder: G) -> Self {
        Self {
            repository,
            geocoder,
            selected_plan: Vec::new(),
        }
    }

    pub fn add_route(&mut self, route: Route) -> Result<(), AppError> {
        self.repository.add(&route)?;
        Ok(())
    }

    pub fn update_route(&mut self, route: Route) -> Result<(), AppError> {
        let mut routes = self.routes()?;
        if let Some(existing) = routes.iter_mut().find(|candidate| candidate.id == route.id) {
            *existing = route.clone();
        }

        if self.selected_plan.contains(&route.id) {
            selected_routes_are_non_overlapping(&routes, &self.selected_plan)?;
        }

        self.repository.update(&route)?;
        self.selected_plan
            .retain(|id| matches!(self.repository.get(*id), Ok(Some(_))));
        Ok(())
    }

    pub fn remove_route(&mut self, id: RouteId) -> Result<(), AppError> {
        self.repository.remove(id)?;
        self.selected_plan.retain(|selected| *selected != id);
        Ok(())
    }

    pub fn routes(&self) -> Result<Vec<Route>, AppError> {
        Ok(self.repository.list()?)
    }

    pub fn route(&self, id: RouteId) -> Result<Option<Route>, AppError> {
        Ok(self.repository.get(id)?)
    }

    pub fn availability(&self) -> Result<Vec<RouteAvailability>, AppError> {
        Ok(route_availability(&self.routes()?, &self.selected_plan))
    }

    pub fn add_to_plan(&mut self, id: RouteId) -> Result<(), AppError> {
        if self.selected_plan.contains(&id) {
            return Ok(());
        }

        let routes = self.routes()?;
        let route = routes
            .iter()
            .find(|candidate| candidate.id == id)
            .ok_or(AppError::RouteNotFound(id))?;

        if routes
            .iter()
            .filter(|candidate| self.selected_plan.contains(&candidate.id))
            .any(|selected| routes_overlap(route, selected))
        {
            return Err(AppError::Plan(PlanError::RouteUnavailable(id)));
        }

        self.selected_plan.push(id);
        Ok(())
    }

    pub fn remove_from_plan(&mut self, id: RouteId) {
        self.selected_plan.retain(|selected| *selected != id);
    }

    pub fn clear_plan(&mut self) {
        self.selected_plan.clear();
    }

    pub fn plan_rows(&self) -> Result<Vec<PlanRow>, AppError> {
        Ok(build_plan_rows(&self.routes()?, &self.selected_plan))
    }

    pub fn selected_plan(&self) -> &[RouteId] {
        &self.selected_plan
    }

    pub fn geocode_route(&mut self, id: RouteId) -> Result<Route, AppError> {
        let Some(mut route) = self.repository.get(id)? else {
            return Err(AppError::RouteNotFound(id));
        };

        if route.departure.place.coordinates.is_none() {
            route.departure.place.coordinates = self.geocoder.geocode(&route.departure.place)?;
        }

        if route.arrival.place.coordinates.is_none() {
            route.arrival.place.coordinates = self.geocoder.geocode(&route.arrival.place)?;
        }

        self.repository.update(&route)?;
        Ok(route)
    }

    pub fn geocode_all(&mut self) -> Result<(), AppError> {
        let ids: Vec<_> = self.routes()?.into_iter().map(|route| route.id).collect();
        for id in ids {
            self.geocode_route(id)?;
        }
        Ok(())
    }

    pub fn map_snapshot(&self) -> Result<MapSnapshot, AppError> {
        let lines = self
            .availability()?
            .into_iter()
            .map(|availability| MapLine {
                route_id: availability.route.id,
                label: availability.route.summary(),
                from_label: availability.route.departure.place.short_label(),
                to_label: availability.route.arrival.place.short_label(),
                from: availability.route.departure.place.coordinates,
                to: availability.route.arrival.place.coordinates,
                selected: matches!(availability.status, AvailabilityStatus::Selected),
                disabled: matches!(availability.status, AvailabilityStatus::Disabled { .. }),
            })
            .collect();

        Ok(MapSnapshot { lines })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapSnapshot {
    pub lines: Vec<MapLine>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapLine {
    pub route_id: RouteId,
    pub label: String,
    pub from_label: String,
    pub to_label: String,
    pub from: Option<Coordinates>,
    pub to: Option<Coordinates>,
    pub selected: bool,
    pub disabled: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("geocoding error: {0}")]
    Geo(#[from] GeoError),
    #[error("plan error: {0}")]
    Plan(#[from] PlanError),
    #[error("route not found: {0}")]
    RouteNotFound(RouteId),
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use trip_core::{Money, Place, Stop, Transport};
    use trip_geo::GeoError;
    use trip_storage::SqliteRouteRepository;

    struct FakeGeocoder;

    impl Geocoder for FakeGeocoder {
        fn geocode(&self, _place: &Place) -> Result<Option<Coordinates>, GeoError> {
            Ok(Some(Coordinates::new(1.0, 2.0).unwrap()))
        }
    }

    fn route(departure: &str, arrival: &str) -> Route {
        Route::new(
            Stop {
                place: Place::new("Marseille", "airport"),
                time: DateTime::parse_from_rfc3339(departure).unwrap(),
            },
            Stop {
                place: Place::new("Paris", "CDG"),
                time: DateTime::parse_from_rfc3339(arrival).unwrap(),
            },
            Transport::Plane,
            Some("AirFrance".to_owned()),
            Money::new(10_000, "EUR").unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn prevents_adding_overlapping_routes_to_plan() {
        let repository = SqliteRouteRepository::in_memory().unwrap();
        let mut planner = TripPlanner::new(repository, FakeGeocoder);
        let first = route("2026-05-01T12:00:00+02:00", "2026-05-01T14:00:00+02:00");
        let conflict = route("2026-05-01T13:00:00+02:00", "2026-05-01T15:00:00+02:00");

        planner.add_route(first.clone()).unwrap();
        planner.add_route(conflict.clone()).unwrap();
        planner.add_to_plan(first.id).unwrap();

        assert!(matches!(
            planner.add_to_plan(conflict.id),
            Err(AppError::Plan(PlanError::RouteUnavailable(_)))
        ));
    }

    #[test]
    fn geocodes_missing_route_coordinates() {
        let repository = SqliteRouteRepository::in_memory().unwrap();
        let mut planner = TripPlanner::new(repository, FakeGeocoder);
        let route = route("2026-05-01T12:00:00+02:00", "2026-05-01T14:00:00+02:00");

        planner.add_route(route.clone()).unwrap();
        let geocoded = planner.geocode_route(route.id).unwrap();

        assert!(geocoded.departure.place.coordinates.is_some());
        assert!(geocoded.arrival.place.coordinates.is_some());
    }
}
