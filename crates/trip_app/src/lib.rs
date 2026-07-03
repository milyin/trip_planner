use trip_core::{
    AvailabilityStatus, Coordinates, PlanError, PlanRow, Segment, SegmentAvailability, SegmentId,
    build_plan_rows, segment_availability, segments_overlap, selected_segments_are_non_overlapping,
};
use trip_geo::{GeoError, Geocoder};
use trip_storage::{SegmentRepository, StorageError};

pub struct TripPlanner<R, G> {
    repository: R,
    geocoder: G,
    selected_plan: Vec<SegmentId>,
}

impl<R, G> TripPlanner<R, G>
where
    R: SegmentRepository,
    G: Geocoder,
{
    pub fn new(repository: R, geocoder: G) -> Self {
        Self {
            repository,
            geocoder,
            selected_plan: Vec::new(),
        }
    }

    pub fn add_segment(&mut self, segment: Segment) -> Result<(), AppError> {
        self.repository.add(&segment)?;
        Ok(())
    }

    pub fn update_segment(&mut self, segment: Segment) -> Result<(), AppError> {
        let mut segments = self.segments()?;
        if let Some(existing) = segments.iter_mut().find(|candidate| candidate.id == segment.id) {
            *existing = segment.clone();
        }

        if self.selected_plan.contains(&segment.id) {
            selected_segments_are_non_overlapping(&segments, &self.selected_plan)?;
        }

        self.repository.update(&segment)?;
        self.selected_plan
            .retain(|id| matches!(self.repository.get(*id), Ok(Some(_))));
        Ok(())
    }

    pub fn remove_segment(&mut self, id: SegmentId) -> Result<(), AppError> {
        self.repository.remove(id)?;
        self.selected_plan.retain(|selected| *selected != id);
        Ok(())
    }

    pub fn segments(&self) -> Result<Vec<Segment>, AppError> {
        Ok(self.repository.list()?)
    }

    pub fn segment(&self, id: SegmentId) -> Result<Option<Segment>, AppError> {
        Ok(self.repository.get(id)?)
    }

    pub fn availability(&self) -> Result<Vec<SegmentAvailability>, AppError> {
        Ok(segment_availability(&self.segments()?, &self.selected_plan))
    }

    pub fn add_to_plan(&mut self, id: SegmentId) -> Result<(), AppError> {
        if self.selected_plan.contains(&id) {
            return Ok(());
        }

        let segments = self.segments()?;
        let segment = segments
            .iter()
            .find(|candidate| candidate.id == id)
            .ok_or(AppError::SegmentNotFound(id))?;

        if segments
            .iter()
            .filter(|candidate| self.selected_plan.contains(&candidate.id))
            .any(|selected| segments_overlap(segment, selected))
        {
            return Err(AppError::Plan(PlanError::SegmentUnavailable(id)));
        }

        self.selected_plan.push(id);
        Ok(())
    }

    pub fn remove_from_plan(&mut self, id: SegmentId) {
        self.selected_plan.retain(|selected| *selected != id);
    }

    pub fn clear_plan(&mut self) {
        self.selected_plan.clear();
    }

    pub fn plan_rows(&self) -> Result<Vec<PlanRow>, AppError> {
        Ok(build_plan_rows(&self.segments()?, &self.selected_plan))
    }

    pub fn selected_plan(&self) -> &[SegmentId] {
        &self.selected_plan
    }

    pub fn geocode_segment(&mut self, id: SegmentId) -> Result<Segment, AppError> {
        let Some(mut segment) = self.repository.get(id)? else {
            return Err(AppError::SegmentNotFound(id));
        };

        if segment.departure.place.coordinates.is_none() {
            segment.departure.place.coordinates = self.geocoder.geocode(&segment.departure.place)?;
        }

        if segment.arrival.place.coordinates.is_none() {
            segment.arrival.place.coordinates = self.geocoder.geocode(&segment.arrival.place)?;
        }

        self.repository.update(&segment)?;
        Ok(segment)
    }

    pub fn geocode_all(&mut self) -> Result<(), AppError> {
        let ids: Vec<_> = self.segments()?.into_iter().map(|segment| segment.id).collect();
        for id in ids {
            self.geocode_segment(id)?;
        }
        Ok(())
    }

    pub fn map_snapshot(&self) -> Result<MapSnapshot, AppError> {
        let lines = self
            .availability()?
            .into_iter()
            .map(|availability| MapLine {
                segment_id: availability.segment.id,
                label: availability.segment.summary(),
                from_label: availability.segment.departure.place.short_label(),
                to_label: availability.segment.arrival.place.short_label(),
                from: availability.segment.departure.place.coordinates,
                to: availability.segment.arrival.place.coordinates,
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
    pub segment_id: SegmentId,
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
    #[error("segment not found: {0}")]
    SegmentNotFound(SegmentId),
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use trip_core::{Money, Place, Stop, Transport};
    use trip_geo::GeoError;
    use trip_storage::SqliteSegmentRepository;

    struct FakeGeocoder;

    impl Geocoder for FakeGeocoder {
        fn geocode(&self, _place: &Place) -> Result<Option<Coordinates>, GeoError> {
            Ok(Some(Coordinates::new(1.0, 2.0).unwrap()))
        }
    }

    fn segment(departure: &str, arrival: &str) -> Segment {
        Segment::new(
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
    fn prevents_adding_overlapping_segments_to_plan() {
        let repository = SqliteSegmentRepository::in_memory().unwrap();
        let mut planner = TripPlanner::new(repository, FakeGeocoder);
        let first = segment("2026-05-01T12:00:00+02:00", "2026-05-01T14:00:00+02:00");
        let conflict = segment("2026-05-01T13:00:00+02:00", "2026-05-01T15:00:00+02:00");

        planner.add_segment(first.clone()).unwrap();
        planner.add_segment(conflict.clone()).unwrap();
        planner.add_to_plan(first.id).unwrap();

        assert!(matches!(
            planner.add_to_plan(conflict.id),
            Err(AppError::Plan(PlanError::SegmentUnavailable(_)))
        ));
    }

    #[test]
    fn geocodes_missing_segment_coordinates() {
        let repository = SqliteSegmentRepository::in_memory().unwrap();
        let mut planner = TripPlanner::new(repository, FakeGeocoder);
        let segment = segment("2026-05-01T12:00:00+02:00", "2026-05-01T14:00:00+02:00");

        planner.add_segment(segment.clone()).unwrap();
        let geocoded = planner.geocode_segment(segment.id).unwrap();

        assert!(geocoded.departure.place.coordinates.is_some());
        assert!(geocoded.arrival.place.coordinates.is_some());
    }
}
