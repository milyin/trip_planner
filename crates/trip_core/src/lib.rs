use chrono::{DateTime, Duration, FixedOffset};
use serde::{Deserialize, Serialize};
use std::fmt::{self, Display};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RouteId(Uuid);

impl RouteId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for RouteId {
    fn default() -> Self {
        Self::new()
    }
}

impl Display for RouteId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Route {
    pub id: RouteId,
    pub departure: Stop,
    pub arrival: Stop,
    pub transport: Transport,
    pub company: Option<String>,
    pub cost: Money,
}

impl Route {
    pub fn new(
        departure: Stop,
        arrival: Stop,
        transport: Transport,
        company: Option<String>,
        cost: Money,
    ) -> Result<Self, ValidationError> {
        let route = Self {
            id: RouteId::new(),
            departure,
            arrival,
            transport,
            company: company.and_then(non_empty_string),
            cost,
        };
        route.validate()?;
        Ok(route)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        self.departure.validate("departure")?;
        self.arrival.validate("arrival")?;
        self.transport.validate()?;
        self.cost.validate()?;

        if self.departure.time >= self.arrival.time {
            return Err(ValidationError::NonChronologicalRoute);
        }

        Ok(())
    }

    pub fn interval(&self) -> TimeInterval {
        TimeInterval {
            start: self.departure.time,
            end: self.arrival.time,
        }
    }

    pub fn summary(&self) -> String {
        let company = self
            .company
            .as_deref()
            .map(|value| format!(", {value}"))
            .unwrap_or_default();
        format!(
            "{} -> {} ({transport}{company}, {cost})",
            self.departure.place.short_label(),
            self.arrival.place.short_label(),
            transport = self.transport,
            cost = self.cost
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stop {
    pub place: Place,
    pub time: DateTime<FixedOffset>,
}

impl Stop {
    pub fn validate(&self, label: &'static str) -> Result<(), ValidationError> {
        self.place.validate(label)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub city: String,
    pub address: String,
    pub coordinates: Option<Coordinates>,
}

impl Place {
    pub fn new(city: impl Into<String>, address: impl Into<String>) -> Self {
        Self {
            city: city.into().trim().to_owned(),
            address: address.into().trim().to_owned(),
            coordinates: None,
        }
    }

    pub fn validate(&self, label: &'static str) -> Result<(), ValidationError> {
        if self.city.trim().is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("{label}.city"),
            });
        }

        if self.address.trim().is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("{label}.address"),
            });
        }

        Ok(())
    }

    pub fn full_address(&self) -> String {
        format!("{}, {}", self.address, self.city)
    }

    pub fn short_label(&self) -> String {
        format!("{}, {}", self.city, self.address)
    }

    pub fn with_coordinates(mut self, coordinates: Coordinates) -> Self {
        self.coordinates = Some(coordinates);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Coordinates {
    pub latitude: f64,
    pub longitude: f64,
}

impl Coordinates {
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, ValidationError> {
        if !(-90.0..=90.0).contains(&latitude) {
            return Err(ValidationError::InvalidCoordinates {
                reason: "latitude must be between -90 and 90".to_owned(),
            });
        }

        if !(-180.0..=180.0).contains(&longitude) {
            return Err(ValidationError::InvalidCoordinates {
                reason: "longitude must be between -180 and 180".to_owned(),
            });
        }

        Ok(Self {
            latitude,
            longitude,
        })
    }

    pub fn distance_to_km(self, other: Self) -> f64 {
        let radius_km = 6_371.0_f64;
        let lat1 = self.latitude.to_radians();
        let lat2 = other.latitude.to_radians();
        let delta_lat = (other.latitude - self.latitude).to_radians();
        let delta_lon = (other.longitude - self.longitude).to_radians();

        let a = (delta_lat / 2.0).sin().powi(2)
            + lat1.cos() * lat2.cos() * (delta_lon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
        radius_km * c
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Transport {
    Plane,
    Train,
    Bus,
    Taxi,
    Car,
    Other(String),
}

impl Transport {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if let Self::Other(value) = self {
            if value.trim().is_empty() {
                return Err(ValidationError::MissingField {
                    field: "transport.other".to_owned(),
                });
            }
        }
        Ok(())
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Plane => "Plane",
            Self::Train => "Train",
            Self::Bus => "Bus",
            Self::Taxi => "Taxi",
            Self::Car => "Car",
            Self::Other(_) => "Other",
        }
    }

    pub fn from_kind(kind: &str, other: Option<String>) -> Result<Self, ValidationError> {
        match kind {
            "Plane" => Ok(Self::Plane),
            "Train" => Ok(Self::Train),
            "Bus" => Ok(Self::Bus),
            "Taxi" => Ok(Self::Taxi),
            "Car" => Ok(Self::Car),
            "Other" => Ok(Self::Other(other.and_then(non_empty_string).ok_or_else(
                || ValidationError::MissingField {
                    field: "transport.other".to_owned(),
                },
            )?)),
            value => Err(ValidationError::UnknownTransport(value.to_owned())),
        }
    }

    pub fn all_builtin() -> [Self; 5] {
        [Self::Plane, Self::Train, Self::Bus, Self::Taxi, Self::Car]
    }
}

impl Display for Transport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Other(value) => write!(f, "{value}"),
            _ => write!(f, "{}", self.kind()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Money {
    pub amount_minor: i64,
    pub currency: String,
}

impl Money {
    pub fn new(amount_minor: i64, currency: impl Into<String>) -> Result<Self, ValidationError> {
        let money = Self {
            amount_minor,
            currency: currency.into().trim().to_uppercase(),
        };
        money.validate()?;
        Ok(money)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.amount_minor < 0 {
            return Err(ValidationError::InvalidMoney(
                "amount cannot be negative".to_owned(),
            ));
        }

        if self.currency.len() != 3 || !self.currency.chars().all(|c| c.is_ascii_uppercase()) {
            return Err(ValidationError::InvalidMoney(
                "currency must be a 3-letter ISO-like code".to_owned(),
            ));
        }

        Ok(())
    }
}

impl Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let major = self.amount_minor / 100;
        let minor = self.amount_minor.abs() % 100;
        write!(f, "{} {major}.{minor:02}", self.currency)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeInterval {
    pub start: DateTime<FixedOffset>,
    pub end: DateTime<FixedOffset>,
}

impl TimeInterval {
    pub fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlanRow {
    Route(Route),
    Gap(GapInfo),
}

#[derive(Debug, Clone, PartialEq)]
pub struct GapInfo {
    pub from_route: RouteId,
    pub to_route: RouteId,
    pub duration: Duration,
    pub distance_km: Option<f64>,
}

impl GapInfo {
    pub fn label(&self) -> String {
        let duration = format_duration(self.duration);
        match self.distance_km {
            Some(distance) => format!("{duration}, {:.0}km", distance),
            None => format!("{duration}, distance unknown"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RouteAvailability {
    pub route: Route,
    pub status: AvailabilityStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AvailabilityStatus {
    Selected,
    Selectable,
    Disabled { reason: String },
}

pub fn routes_overlap(left: &Route, right: &Route) -> bool {
    left.interval().overlaps(right.interval())
}

pub fn route_availability(routes: &[Route], selected_ids: &[RouteId]) -> Vec<RouteAvailability> {
    let selected_routes: Vec<_> = routes
        .iter()
        .filter(|route| selected_ids.contains(&route.id))
        .collect();

    routes
        .iter()
        .cloned()
        .map(|route| {
            let status = if selected_ids.contains(&route.id) {
                AvailabilityStatus::Selected
            } else if let Some(conflict) = selected_routes
                .iter()
                .find(|selected| routes_overlap(&route, selected))
            {
                AvailabilityStatus::Disabled {
                    reason: format!("overlaps {}", conflict.summary()),
                }
            } else {
                AvailabilityStatus::Selectable
            };

            RouteAvailability { route, status }
        })
        .collect()
}

pub fn build_plan_rows(routes: &[Route], selected_ids: &[RouteId]) -> Vec<PlanRow> {
    let mut selected: Vec<Route> = routes
        .iter()
        .filter(|route| selected_ids.contains(&route.id))
        .cloned()
        .collect();

    selected.sort_by_key(|route| route.departure.time);

    let mut rows = Vec::new();
    for (index, route) in selected.iter().enumerate() {
        if index > 0 {
            let previous = &selected[index - 1];
            rows.push(PlanRow::Gap(gap_between(previous, route)));
        }
        rows.push(PlanRow::Route(route.clone()));
    }

    rows
}

pub fn gap_between(previous: &Route, next: &Route) -> GapInfo {
    let duration = next.departure.time - previous.arrival.time;
    let distance_km = previous
        .arrival
        .place
        .coordinates
        .zip(next.departure.place.coordinates)
        .map(|(from, to)| from.distance_to_km(to));

    GapInfo {
        from_route: previous.id,
        to_route: next.id,
        duration,
        distance_km,
    }
}

pub fn selected_routes_are_non_overlapping(
    routes: &[Route],
    selected_ids: &[RouteId],
) -> Result<(), PlanError> {
    let selected: Vec<_> = routes
        .iter()
        .filter(|route| selected_ids.contains(&route.id))
        .collect();

    for (left_index, left) in selected.iter().enumerate() {
        for right in selected.iter().skip(left_index + 1) {
            if routes_overlap(left, right) {
                return Err(PlanError::OverlappingRoutes {
                    left: left.id,
                    right: right.id,
                });
            }
        }
    }

    Ok(())
}

pub fn format_duration(duration: Duration) -> String {
    let total_minutes = duration.num_minutes();
    let sign = if total_minutes < 0 { "-" } else { "" };
    let minutes = total_minutes.abs();
    let hours = minutes / 60;
    let remaining_minutes = minutes % 60;

    if remaining_minutes == 0 {
        format!("{sign}{hours}h")
    } else {
        format!("{sign}{hours}h {remaining_minutes}m")
    }
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("missing required field `{field}`")]
    MissingField { field: String },
    #[error("route departure must be before arrival")]
    NonChronologicalRoute,
    #[error("invalid coordinates: {reason}")]
    InvalidCoordinates { reason: String },
    #[error("invalid money: {0}")]
    InvalidMoney(String),
    #[error("unknown transport `{0}`")]
    UnknownTransport(String),
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("selected routes overlap: {left} and {right}")]
    OverlappingRoutes { left: RouteId, right: RouteId },
    #[error("route is not available for selection: {0}")]
    RouteUnavailable(RouteId),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(value: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(value).unwrap()
    }

    fn route(departure: &str, arrival: &str, dep_city: &str, arr_city: &str) -> Route {
        Route::new(
            Stop {
                place: Place::new(dep_city, "airport"),
                time: time(departure),
            },
            Stop {
                place: Place::new(arr_city, "airport"),
                time: time(arrival),
            },
            Transport::Plane,
            Some("Airline".to_owned()),
            Money::new(10_000, "EUR").unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn rejects_non_chronological_routes() {
        let result = Route::new(
            Stop {
                place: Place::new("Paris", "CDG"),
                time: time("2026-05-01T12:00:00+02:00"),
            },
            Stop {
                place: Place::new("Madrid", "airport"),
                time: time("2026-05-01T11:00:00+02:00"),
            },
            Transport::Plane,
            None,
            Money::new(1, "EUR").unwrap(),
        );

        assert_eq!(result.unwrap_err(), ValidationError::NonChronologicalRoute);
    }

    #[test]
    fn detects_overlap() {
        let left = route(
            "2026-05-01T12:00:00+02:00",
            "2026-05-01T14:00:00+02:00",
            "Marseille",
            "Paris",
        );
        let right = route(
            "2026-05-01T13:30:00+02:00",
            "2026-05-01T16:00:00+02:00",
            "Paris",
            "Madrid",
        );

        assert!(routes_overlap(&left, &right));
    }

    #[test]
    fn builds_plan_with_gap_rows() {
        let first = route(
            "2026-05-01T12:00:00+02:00",
            "2026-05-01T14:00:00+02:00",
            "Marseille",
            "Paris",
        );
        let second = route(
            "2026-05-01T16:00:00+02:00",
            "2026-05-01T18:00:00+02:00",
            "Paris",
            "Madrid",
        );
        let rows = build_plan_rows(&[second.clone(), first.clone()], &[first.id, second.id]);

        assert!(matches!(rows[0], PlanRow::Route(_)));
        assert!(matches!(rows[1], PlanRow::Gap(_)));
        assert!(matches!(rows[2], PlanRow::Route(_)));
        assert_eq!(
            rows[1],
            PlanRow::Gap(GapInfo {
                from_route: first.id,
                to_route: second.id,
                duration: Duration::hours(2),
                distance_km: None,
            })
        );
    }

    #[test]
    fn disables_routes_overlapping_selected_route() {
        let selected = route(
            "2026-05-01T12:00:00+02:00",
            "2026-05-01T14:00:00+02:00",
            "Marseille",
            "Paris",
        );
        let conflict = route(
            "2026-05-01T13:00:00+02:00",
            "2026-05-01T15:00:00+02:00",
            "Lyon",
            "Paris",
        );
        let later = route(
            "2026-05-01T16:00:00+02:00",
            "2026-05-01T18:00:00+02:00",
            "Paris",
            "Madrid",
        );

        let availability =
            route_availability(&[selected.clone(), conflict.clone(), later], &[selected.id]);

        assert_eq!(availability[0].status, AvailabilityStatus::Selected);
        assert!(matches!(
            availability[1].status,
            AvailabilityStatus::Disabled { .. }
        ));
        assert_eq!(availability[2].status, AvailabilityStatus::Selectable);
    }
}
