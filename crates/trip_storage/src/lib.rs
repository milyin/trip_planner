use chrono::{DateTime, FixedOffset};
use rusqlite::{Connection, OptionalExtension, Row, params};
use std::path::Path;
use std::sync::Mutex;
use trip_core::{Coordinates, Money, Place, Route, RouteId, Stop, Transport, ValidationError};
use uuid::Uuid;

pub trait RouteRepository {
    fn add(&self, route: &Route) -> Result<(), StorageError>;
    fn update(&self, route: &Route) -> Result<(), StorageError>;
    fn remove(&self, id: RouteId) -> Result<(), StorageError>;
    fn get(&self, id: RouteId) -> Result<Option<Route>, StorageError>;
    fn list(&self) -> Result<Vec<Route>, StorageError>;
}

pub struct SqliteRouteRepository {
    connection: Mutex<Connection>,
}

impl SqliteRouteRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        let repository = Self {
            connection: Mutex::new(connection),
        };
        repository.migrate()?;
        Ok(repository)
    }

    pub fn in_memory() -> Result<Self, StorageError> {
        let connection = Connection::open_in_memory()?;
        let repository = Self {
            connection: Mutex::new(connection),
        };
        repository.migrate()?;
        Ok(repository)
    }

    fn migrate(&self) -> Result<(), StorageError> {
        self.with_connection(|connection| {
            connection.execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS routes (
                    id TEXT PRIMARY KEY NOT NULL,
                    departure_city TEXT NOT NULL,
                    departure_address TEXT NOT NULL,
                    departure_time TEXT NOT NULL,
                    departure_latitude REAL,
                    departure_longitude REAL,
                    arrival_city TEXT NOT NULL,
                    arrival_address TEXT NOT NULL,
                    arrival_time TEXT NOT NULL,
                    arrival_latitude REAL,
                    arrival_longitude REAL,
                    transport_kind TEXT NOT NULL,
                    transport_other TEXT,
                    company TEXT,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS route_screenshots (
                    id TEXT PRIMARY KEY NOT NULL,
                    route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
                    path TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                "#,
            )?;
            Ok(())
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::PoisonedConnection)?;
        operation(&connection)
    }
}

impl RouteRepository for SqliteRouteRepository {
    fn add(&self, route: &Route) -> Result<(), StorageError> {
        route.validate()?;
        self.with_connection(|connection| {
            insert_or_update_route(
                connection,
                r#"
                INSERT INTO routes (
                    id,
                    departure_city, departure_address, departure_time,
                    departure_latitude, departure_longitude,
                    arrival_city, arrival_address, arrival_time,
                    arrival_latitude, arrival_longitude,
                    transport_kind, transport_other, company,
                    amount_minor, currency
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
                )
                "#,
                route,
            )?;
            Ok(())
        })
    }

    fn update(&self, route: &Route) -> Result<(), StorageError> {
        route.validate()?;
        self.with_connection(|connection| {
            let changed = insert_or_update_route(
                connection,
                r#"
                UPDATE routes SET
                    departure_city = ?2,
                    departure_address = ?3,
                    departure_time = ?4,
                    departure_latitude = ?5,
                    departure_longitude = ?6,
                    arrival_city = ?7,
                    arrival_address = ?8,
                    arrival_time = ?9,
                    arrival_latitude = ?10,
                    arrival_longitude = ?11,
                    transport_kind = ?12,
                    transport_other = ?13,
                    company = ?14,
                    amount_minor = ?15,
                    currency = ?16
                WHERE id = ?1
                "#,
                route,
            )?;

            if changed == 0 {
                return Err(StorageError::NotFound(route.id));
            }

            Ok(())
        })
    }

    fn remove(&self, id: RouteId) -> Result<(), StorageError> {
        self.with_connection(|connection| {
            let changed =
                connection.execute("DELETE FROM routes WHERE id = ?1", [id.to_string()])?;
            if changed == 0 {
                return Err(StorageError::NotFound(id));
            }
            Ok(())
        })
    }

    fn get(&self, id: RouteId) -> Result<Option<Route>, StorageError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT * FROM routes WHERE id = ?1",
                    [id.to_string()],
                    route_from_row,
                )
                .optional()
                .map_err(StorageError::from)
        })
    }

    fn list(&self) -> Result<Vec<Route>, StorageError> {
        self.with_connection(|connection| {
            let mut statement =
                connection.prepare("SELECT * FROM routes ORDER BY departure_time, arrival_time")?;
            let rows = statement.query_map([], route_from_row)?;
            let mut routes = Vec::new();

            for row in rows {
                routes.push(row?);
            }

            Ok(routes)
        })
    }
}

fn insert_or_update_route(
    connection: &Connection,
    sql: &str,
    route: &Route,
) -> Result<usize, StorageError> {
    let id = route.id.to_string();
    let departure_time = route.departure.time.to_rfc3339();
    let arrival_time = route.arrival.time.to_rfc3339();
    let departure_latitude = route
        .departure
        .place
        .coordinates
        .map(|coordinates| coordinates.latitude);
    let departure_longitude = route
        .departure
        .place
        .coordinates
        .map(|coordinates| coordinates.longitude);
    let arrival_latitude = route
        .arrival
        .place
        .coordinates
        .map(|coordinates| coordinates.latitude);
    let arrival_longitude = route
        .arrival
        .place
        .coordinates
        .map(|coordinates| coordinates.longitude);
    let transport_kind = route.transport.kind();
    let transport_other = match &route.transport {
        Transport::Other(value) => Some(value.as_str()),
        _ => None,
    };

    Ok(connection.execute(
        sql,
        params![
            id,
            &route.departure.place.city,
            &route.departure.place.address,
            departure_time,
            departure_latitude,
            departure_longitude,
            &route.arrival.place.city,
            &route.arrival.place.address,
            arrival_time,
            arrival_latitude,
            arrival_longitude,
            transport_kind,
            transport_other,
            route.company.as_deref(),
            route.cost.amount_minor,
            &route.cost.currency,
        ],
    )?)
}

fn route_from_row(row: &Row<'_>) -> Result<Route, rusqlite::Error> {
    let id: String = row.get("id")?;
    let transport_kind: String = row.get("transport_kind")?;
    let transport_other: Option<String> = row.get("transport_other")?;

    let route = Route {
        id: RouteId::from_uuid(parse_uuid(&id)?),
        departure: Stop {
            place: Place {
                city: row.get("departure_city")?,
                address: row.get("departure_address")?,
                coordinates: coordinates_from_columns(
                    row.get("departure_latitude")?,
                    row.get("departure_longitude")?,
                )?,
            },
            time: parse_time(row.get("departure_time")?)?,
        },
        arrival: Stop {
            place: Place {
                city: row.get("arrival_city")?,
                address: row.get("arrival_address")?,
                coordinates: coordinates_from_columns(
                    row.get("arrival_latitude")?,
                    row.get("arrival_longitude")?,
                )?,
            },
            time: parse_time(row.get("arrival_time")?)?,
        },
        transport: Transport::from_kind(&transport_kind, transport_other)
            .map_err(to_sql_conversion_error)?,
        company: row.get("company")?,
        cost: Money::new(row.get("amount_minor")?, row.get::<_, String>("currency")?)
            .map_err(to_sql_conversion_error)?,
    };

    route.validate().map_err(to_sql_conversion_error)?;
    Ok(route)
}

fn parse_uuid(value: &str) -> Result<Uuid, rusqlite::Error> {
    Uuid::parse_str(value).map_err(to_sql_conversion_error)
}

fn parse_time(value: String) -> Result<DateTime<FixedOffset>, rusqlite::Error> {
    DateTime::parse_from_rfc3339(&value).map_err(to_sql_conversion_error)
}

fn coordinates_from_columns(
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<Option<Coordinates>, rusqlite::Error> {
    match (latitude, longitude) {
        (Some(latitude), Some(longitude)) => Coordinates::new(latitude, longitude)
            .map(Some)
            .map_err(to_sql_conversion_error),
        (None, None) => Ok(None),
        _ => Err(to_sql_conversion_error(SimpleConversionError(
            "latitude and longitude must be stored together",
        ))),
    }
}

fn to_sql_conversion_error(
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

#[derive(Debug)]
struct SimpleConversionError(&'static str);

impl std::fmt::Display for SimpleConversionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for SimpleConversionError {}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("route validation failed: {0}")]
    Validation(#[from] ValidationError),
    #[error("route not found: {0}")]
    NotFound(RouteId),
    #[error("sqlite connection lock is poisoned")]
    PoisonedConnection,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    fn time(value: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(value).unwrap()
    }

    fn sample_route() -> Route {
        Route::new(
            Stop {
                place: Place::new("Marseille", "airport")
                    .with_coordinates(Coordinates::new(43.4393, 5.2214).unwrap()),
                time: time("2026-05-01T12:00:00+02:00"),
            },
            Stop {
                place: Place::new("Paris", "CDG")
                    .with_coordinates(Coordinates::new(49.0097, 2.5479).unwrap()),
                time: time("2026-05-01T14:00:00+02:00"),
            },
            Transport::Plane,
            Some("AirFrance".to_owned()),
            Money::new(10_000, "EUR").unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn stores_and_loads_route() {
        let repository = SqliteRouteRepository::in_memory().unwrap();
        let route = sample_route();

        repository.add(&route).unwrap();
        let stored = repository.get(route.id).unwrap().unwrap();

        assert_eq!(stored, route);
    }

    #[test]
    fn removes_route() {
        let repository = SqliteRouteRepository::in_memory().unwrap();
        let route = sample_route();

        repository.add(&route).unwrap();
        repository.remove(route.id).unwrap();

        assert!(repository.get(route.id).unwrap().is_none());
    }
}
