use geocoding::{Forward, Openstreetmap};
use trip_core::{Coordinates, Place, Route};

pub trait Geocoder {
    fn geocode(&self, place: &Place) -> Result<Option<Coordinates>, GeoError>;
}

pub struct NominatimGeocoder {
    provider: Openstreetmap,
}

impl NominatimGeocoder {
    pub fn new() -> Self {
        Self {
            provider: Openstreetmap::new(),
        }
    }
}

impl Default for NominatimGeocoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Geocoder for NominatimGeocoder {
    fn geocode(&self, place: &Place) -> Result<Option<Coordinates>, GeoError> {
        let points = self.provider.forward(&place.full_address())?;
        points
            .into_iter()
            .next()
            .map(|point| Coordinates::new(point.y(), point.x()).map_err(GeoError::from))
            .transpose()
    }
}

pub trait DistanceEstimator {
    fn route_distance_km(&self, route: &Route) -> Option<f64>;
}

pub struct StraightLineDistanceEstimator;

impl DistanceEstimator for StraightLineDistanceEstimator {
    fn route_distance_km(&self, route: &Route) -> Option<f64> {
        route
            .departure
            .place
            .coordinates
            .zip(route.arrival.place.coordinates)
            .map(|(departure, arrival)| departure.distance_to_km(arrival))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GeoError {
    #[error("geocoding provider error: {0}")]
    Provider(#[from] geocoding::GeocodingError),
    #[error("invalid coordinates returned by provider: {0}")]
    InvalidCoordinates(#[from] trip_core::ValidationError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use trip_core::{Money, Stop, Transport};

    #[test]
    fn estimates_straight_line_route_distance() {
        let route = Route::new(
            Stop {
                place: Place::new("Marseille", "airport")
                    .with_coordinates(Coordinates::new(43.4393, 5.2214).unwrap()),
                time: DateTime::parse_from_rfc3339("2026-05-01T12:00:00+02:00").unwrap(),
            },
            Stop {
                place: Place::new("Paris", "CDG")
                    .with_coordinates(Coordinates::new(49.0097, 2.5479).unwrap()),
                time: DateTime::parse_from_rfc3339("2026-05-01T14:00:00+02:00").unwrap(),
            },
            Transport::Plane,
            None,
            Money::new(10_000, "EUR").unwrap(),
        )
        .unwrap();

        let distance = StraightLineDistanceEstimator
            .route_distance_km(&route)
            .unwrap();

        assert!(distance > 600.0);
        assert!(distance < 700.0);
    }
}
