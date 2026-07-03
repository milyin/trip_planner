use chrono::{DateTime, FixedOffset};
use iced::widget::{button, column, container, row, scrollable, text, text_input};
use iced::{Element, Length, Task};
use trip_app::{AppError, TripPlanner};
use trip_core::{
    AvailabilityStatus, Money, Place, PlanRow, Route, RouteAvailability, RouteId, Stop, Transport,
};
use trip_geo::NominatimGeocoder;
use trip_storage::SqliteRouteRepository;

type Planner = TripPlanner<SqliteRouteRepository, NominatimGeocoder>;

fn main() -> iced::Result {
    iced::application(
        TripPlannerGui::boot,
        TripPlannerGui::update,
        TripPlannerGui::view,
    )
    .title("Trip Planner")
    .run()
}

struct TripPlannerGui {
    planner: Option<Planner>,
    selected_route: Option<RouteId>,
    form: RouteForm,
    status: String,
}

impl TripPlannerGui {
    fn boot() -> (Self, Task<Message>) {
        let mut state = match SqliteRouteRepository::open("trip_planner.sqlite3") {
            Ok(repository) => Self {
                planner: Some(TripPlanner::new(repository, NominatimGeocoder::new())),
                selected_route: None,
                form: RouteForm::default(),
                status: "Ready".to_owned(),
            },
            Err(error) => Self {
                planner: None,
                selected_route: None,
                form: RouteForm::default(),
                status: format!("Could not open storage: {error}"),
            },
        };

        state.seed_examples_if_empty();
        (state, Task::none())
    }

    fn update(&mut self, message: Message) {
        match message {
            Message::DepartureCityChanged(value) => self.form.departure_city = value,
            Message::DepartureAddressChanged(value) => self.form.departure_address = value,
            Message::DepartureTimeChanged(value) => self.form.departure_time = value,
            Message::ArrivalCityChanged(value) => self.form.arrival_city = value,
            Message::ArrivalAddressChanged(value) => self.form.arrival_address = value,
            Message::ArrivalTimeChanged(value) => self.form.arrival_time = value,
            Message::TransportChanged(value) => self.form.transport = value,
            Message::CompanyChanged(value) => self.form.company = value,
            Message::CostChanged(value) => self.form.cost = value,
            Message::CurrencyChanged(value) => self.form.currency = value,
            Message::NewRoute => {
                self.selected_route = None;
                self.form = RouteForm::default();
                self.status = "Creating a new route".to_owned();
            }
            Message::SelectRoute(id) => {
                self.selected_route = Some(id);
                if let Some(planner) = &self.planner {
                    match planner.route(id) {
                        Ok(Some(route)) => {
                            self.form = RouteForm::from_route(&route);
                            self.status = format!("Selected {}", route.summary());
                        }
                        Ok(None) => self.status = "Route no longer exists".to_owned(),
                        Err(error) => self.status = error.to_string(),
                    }
                }
            }
            Message::SaveRoute => self.save_route(),
            Message::DeleteSelected => self.delete_selected(),
            Message::AddSelectedToPlan => self.add_selected_to_plan(),
            Message::RemoveFromPlan(id) => {
                if let Some(planner) = &mut self.planner {
                    planner.remove_from_plan(id);
                    self.status = "Removed route from plan".to_owned();
                }
            }
            Message::ClearPlan => {
                if let Some(planner) = &mut self.planner {
                    planner.clear_plan();
                    self.status = "Plan cleared".to_owned();
                }
            }
            Message::GeocodeSelected => self.geocode_selected(),
            Message::GeocodeAll => self.geocode_all(),
        }
    }

    fn view(&self) -> Element<'_, Message> {
        let header = row![
            text("Trip Planner").size(32),
            button("Add route").on_press(Message::NewRoute),
            button("Geocode all").on_press(Message::GeocodeAll),
            text(&self.status),
        ]
        .spacing(16)
        .align_y(iced::Alignment::Center);

        let body = row![self.routes_panel(), self.plan_panel(), self.map_panel(),]
            .spacing(16)
            .height(Length::FillPortion(3));

        container(
            column![header, body, self.editor_panel()]
                .spacing(16)
                .padding(16),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
    }

    fn routes_panel(&self) -> Element<'_, Message> {
        let mut routes = column![text("Routes").size(24)].spacing(8);

        match self.availability() {
            Ok(availability) if availability.is_empty() => {
                routes = routes.push(text("No routes yet. Use the editor below."));
            }
            Ok(availability) => {
                for item in availability {
                    routes = routes.push(route_list_item(&item));
                }
            }
            Err(error) => {
                routes = routes.push(text(format!("Could not load routes: {error}")));
            }
        }

        panel(scrollable(routes), 2)
    }

    fn plan_panel(&self) -> Element<'_, Message> {
        let mut plan = column![
            row![
                text("Plan").size(24),
                button("Add selected").on_press(Message::AddSelectedToPlan),
                button("Clear").on_press(Message::ClearPlan),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center)
        ]
        .spacing(8);

        match self.plan_rows() {
            Ok(rows) if rows.is_empty() => {
                plan = plan.push(text("Select a route and add it to the plan."));
            }
            Ok(rows) => {
                for row in rows {
                    plan = plan.push(plan_row(row));
                }
            }
            Err(error) => {
                plan = plan.push(text(format!("Could not build plan: {error}")));
            }
        }

        panel(scrollable(plan), 2)
    }

    fn map_panel(&self) -> Element<'_, Message> {
        let mut map = column![
            text("Map").size(24),
            text("Geocoded route markers and lines")
        ]
        .spacing(8);

        if let Some(planner) = &self.planner {
            match planner.map_snapshot() {
                Ok(snapshot) if snapshot.lines.is_empty() => {
                    map = map.push(text("No route coordinates available yet."));
                }
                Ok(snapshot) => {
                    for line in snapshot.lines {
                        let from = line
                            .from
                            .map(format_coordinates)
                            .unwrap_or_else(|| "not geocoded".to_owned());
                        let to = line
                            .to
                            .map(format_coordinates)
                            .unwrap_or_else(|| "not geocoded".to_owned());
                        let prefix = if line.selected { "✓ " } else { "" };
                        map = map.push(text(format!(
                            "{prefix}{}\n  {} -> {}\n  {} -> {}",
                            line.label, line.from_label, line.to_label, from, to
                        )));
                    }
                }
                Err(error) => {
                    map = map.push(text(format!("Could not load map data: {error}")));
                }
            }
        }

        panel(scrollable(map), 2)
    }

    fn editor_panel(&self) -> Element<'_, Message> {
        let editor = column![
            text("Route details").size(24),
            row![
                text_input("Departure city", &self.form.departure_city)
                    .on_input(Message::DepartureCityChanged),
                text_input("Departure address", &self.form.departure_address)
                    .on_input(Message::DepartureAddressChanged),
                text_input("Departure time RFC3339", &self.form.departure_time)
                    .on_input(Message::DepartureTimeChanged),
            ]
            .spacing(8),
            row![
                text_input("Arrival city", &self.form.arrival_city)
                    .on_input(Message::ArrivalCityChanged),
                text_input("Arrival address", &self.form.arrival_address)
                    .on_input(Message::ArrivalAddressChanged),
                text_input("Arrival time RFC3339", &self.form.arrival_time)
                    .on_input(Message::ArrivalTimeChanged),
            ]
            .spacing(8),
            row![
                text_input(
                    "Transport: Plane, Train, Bus, Taxi, Car, or custom",
                    &self.form.transport
                )
                .on_input(Message::TransportChanged),
                text_input("Company", &self.form.company).on_input(Message::CompanyChanged),
                text_input("Cost, e.g. 100.00", &self.form.cost).on_input(Message::CostChanged),
                text_input("Currency", &self.form.currency).on_input(Message::CurrencyChanged),
            ]
            .spacing(8),
            row![
                button("Save").on_press(Message::SaveRoute),
                button("Delete selected").on_press(Message::DeleteSelected),
                button("Geocode selected").on_press(Message::GeocodeSelected),
            ]
            .spacing(8),
            text("Screenshots: planned as route attachments for the next drag-and-drop step."),
        ]
        .spacing(8);

        panel(editor, 1)
    }

    fn save_route(&mut self) {
        let Some(planner) = &mut self.planner else {
            self.status = "Storage is not available".to_owned();
            return;
        };

        match self.form.to_route(self.selected_route) {
            Ok(mut route) => {
                if let Some(existing_id) = self.selected_route {
                    if let Ok(Some(existing)) = planner.route(existing_id) {
                        preserve_coordinates(&existing, &mut route);
                    }
                }

                let result = if self.selected_route.is_some() {
                    planner.update_route(route.clone())
                } else {
                    planner.add_route(route.clone())
                };

                match result {
                    Ok(()) => {
                        self.selected_route = Some(route.id);
                        self.form = RouteForm::from_route(&route);
                        self.status = "Route saved".to_owned();
                    }
                    Err(error) => self.status = error.to_string(),
                }
            }
            Err(error) => self.status = error,
        }
    }

    fn delete_selected(&mut self) {
        let Some(id) = self.selected_route else {
            self.status = "No route selected".to_owned();
            return;
        };

        let Some(planner) = &mut self.planner else {
            self.status = "Storage is not available".to_owned();
            return;
        };

        match planner.remove_route(id) {
            Ok(()) => {
                self.selected_route = None;
                self.form = RouteForm::default();
                self.status = "Route deleted".to_owned();
            }
            Err(error) => self.status = error.to_string(),
        }
    }

    fn add_selected_to_plan(&mut self) {
        let Some(id) = self.selected_route else {
            self.status = "No route selected".to_owned();
            return;
        };

        let Some(planner) = &mut self.planner else {
            self.status = "Storage is not available".to_owned();
            return;
        };

        match planner.add_to_plan(id) {
            Ok(()) => self.status = "Route added to plan".to_owned(),
            Err(error) => self.status = error.to_string(),
        }
    }

    fn geocode_selected(&mut self) {
        let Some(id) = self.selected_route else {
            self.status = "No route selected".to_owned();
            return;
        };

        let Some(planner) = &mut self.planner else {
            self.status = "Storage is not available".to_owned();
            return;
        };

        match planner.geocode_route(id) {
            Ok(route) => {
                self.form = RouteForm::from_route(&route);
                self.status = "Selected route geocoded".to_owned();
            }
            Err(error) => self.status = error.to_string(),
        }
    }

    fn geocode_all(&mut self) {
        let Some(planner) = &mut self.planner else {
            self.status = "Storage is not available".to_owned();
            return;
        };

        match planner.geocode_all() {
            Ok(()) => self.status = "All routes geocoded".to_owned(),
            Err(error) => self.status = error.to_string(),
        }
    }

    fn seed_examples_if_empty(&mut self) {
        let Some(planner) = &mut self.planner else {
            return;
        };

        if !matches!(planner.routes(), Ok(routes) if routes.is_empty()) {
            return;
        }

        for route in example_routes() {
            if let Err(error) = planner.add_route(route) {
                self.status = format!("Could not seed examples: {error}");
                break;
            }
        }
    }

    fn availability(&self) -> Result<Vec<RouteAvailability>, AppError> {
        self.planner
            .as_ref()
            .ok_or_else(storage_unavailable)?
            .availability()
    }

    fn plan_rows(&self) -> Result<Vec<PlanRow>, AppError> {
        self.planner
            .as_ref()
            .ok_or_else(storage_unavailable)?
            .plan_rows()
    }
}

fn route_list_item(item: &RouteAvailability) -> Element<'static, Message> {
    let status = match &item.status {
        AvailabilityStatus::Selected => "selected".to_owned(),
        AvailabilityStatus::Selectable => "selectable".to_owned(),
        AvailabilityStatus::Disabled { reason } => format!("disabled: {reason}"),
    };

    let label = format!("{}\n{}", item.route.summary(), status);
    match item.status {
        AvailabilityStatus::Disabled { .. } => container(text(label)).padding(8).into(),
        _ => button(text(label))
            .on_press(Message::SelectRoute(item.route.id))
            .width(Length::Fill)
            .into(),
    }
}

fn plan_row(row: PlanRow) -> Element<'static, Message> {
    match row {
        PlanRow::Route(route) => row![
            text(route.summary()).width(Length::Fill),
            button("Remove").on_press(Message::RemoveFromPlan(route.id)),
        ]
        .spacing(8)
        .into(),
        PlanRow::Gap(gap) => container(text(format!("↳ gap: {}", gap.label())))
            .padding(8)
            .into(),
    }
}

fn panel<'a>(content: impl Into<Element<'a, Message>>, portion: u16) -> Element<'a, Message> {
    container(content)
        .padding(12)
        .width(Length::FillPortion(portion))
        .height(Length::Fill)
        .into()
}

fn format_coordinates(coordinates: trip_core::Coordinates) -> String {
    format!("{:.4}, {:.4}", coordinates.latitude, coordinates.longitude)
}

fn preserve_coordinates(existing: &Route, updated: &mut Route) {
    if same_place(&existing.departure.place, &updated.departure.place) {
        updated.departure.place.coordinates = existing.departure.place.coordinates;
    }

    if same_place(&existing.arrival.place, &updated.arrival.place) {
        updated.arrival.place.coordinates = existing.arrival.place.coordinates;
    }
}

fn same_place(left: &Place, right: &Place) -> bool {
    left.city == right.city && left.address == right.address
}

fn storage_unavailable() -> AppError {
    AppError::Storage(trip_storage::StorageError::PoisonedConnection)
}

#[derive(Debug, Clone)]
enum Message {
    NewRoute,
    SelectRoute(RouteId),
    SaveRoute,
    DeleteSelected,
    AddSelectedToPlan,
    RemoveFromPlan(RouteId),
    ClearPlan,
    GeocodeSelected,
    GeocodeAll,
    DepartureCityChanged(String),
    DepartureAddressChanged(String),
    DepartureTimeChanged(String),
    ArrivalCityChanged(String),
    ArrivalAddressChanged(String),
    ArrivalTimeChanged(String),
    TransportChanged(String),
    CompanyChanged(String),
    CostChanged(String),
    CurrencyChanged(String),
}

struct RouteForm {
    departure_city: String,
    departure_address: String,
    departure_time: String,
    arrival_city: String,
    arrival_address: String,
    arrival_time: String,
    transport: String,
    company: String,
    cost: String,
    currency: String,
}

impl Default for RouteForm {
    fn default() -> Self {
        Self {
            departure_city: String::new(),
            departure_address: String::new(),
            departure_time: "2026-05-01T12:00:00+02:00".to_owned(),
            arrival_city: String::new(),
            arrival_address: String::new(),
            arrival_time: "2026-05-01T14:00:00+02:00".to_owned(),
            transport: "Plane".to_owned(),
            company: String::new(),
            cost: "0.00".to_owned(),
            currency: "EUR".to_owned(),
        }
    }
}

impl RouteForm {
    fn from_route(route: &Route) -> Self {
        Self {
            departure_city: route.departure.place.city.clone(),
            departure_address: route.departure.place.address.clone(),
            departure_time: route.departure.time.to_rfc3339(),
            arrival_city: route.arrival.place.city.clone(),
            arrival_address: route.arrival.place.address.clone(),
            arrival_time: route.arrival.time.to_rfc3339(),
            transport: route.transport.to_string(),
            company: route.company.clone().unwrap_or_default(),
            cost: format_amount(route.cost.amount_minor),
            currency: route.cost.currency.clone(),
        }
    }

    fn to_route(&self, existing_id: Option<RouteId>) -> Result<Route, String> {
        let departure_time = parse_time(&self.departure_time)?;
        let arrival_time = parse_time(&self.arrival_time)?;
        let transport = parse_transport(&self.transport)?;
        let cost = Money::new(parse_amount_minor(&self.cost)?, self.currency.clone())
            .map_err(|error| error.to_string())?;

        let mut route = Route::new(
            Stop {
                place: Place::new(&self.departure_city, &self.departure_address),
                time: departure_time,
            },
            Stop {
                place: Place::new(&self.arrival_city, &self.arrival_address),
                time: arrival_time,
            },
            transport,
            Some(self.company.clone()),
            cost,
        )
        .map_err(|error| error.to_string())?;

        if let Some(id) = existing_id {
            route.id = id;
        }

        Ok(route)
    }
}

fn parse_time(value: &str) -> Result<DateTime<FixedOffset>, String> {
    DateTime::parse_from_rfc3339(value.trim())
        .map_err(|error| format!("Invalid RFC3339 time `{value}`: {error}"))
}

fn parse_transport(value: &str) -> Result<Transport, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "plane" => Ok(Transport::Plane),
        "train" => Ok(Transport::Train),
        "bus" => Ok(Transport::Bus),
        "taxi" => Ok(Transport::Taxi),
        "car" => Ok(Transport::Car),
        "" => Err("Transport is required".to_owned()),
        _ => Ok(Transport::Other(value.trim().to_owned())),
    }
}

fn parse_amount_minor(value: &str) -> Result<i64, String> {
    let trimmed = value.trim();
    let (major, minor) = trimmed
        .split_once('.')
        .map_or((trimmed, "0"), |(major, minor)| (major, minor));

    if minor.len() > 2 {
        return Err("Cost must have at most two decimal places".to_owned());
    }

    let major: i64 = major
        .parse()
        .map_err(|_| "Cost major amount must be a number".to_owned())?;
    let mut minor = minor.to_owned();
    while minor.len() < 2 {
        minor.push('0');
    }
    let minor: i64 = minor
        .parse()
        .map_err(|_| "Cost cents must be a number".to_owned())?;

    Ok(major * 100 + minor)
}

fn format_amount(amount_minor: i64) -> String {
    format!("{}.{:02}", amount_minor / 100, amount_minor.abs() % 100)
}

fn example_routes() -> Vec<Route> {
    vec![
        Route::new(
            Stop {
                place: Place::new("Marseille", "airport"),
                time: parse_time("2026-05-01T12:00:00+02:00").unwrap(),
            },
            Stop {
                place: Place::new("Paris", "CDG"),
                time: parse_time("2026-05-01T14:00:00+02:00").unwrap(),
            },
            Transport::Plane,
            Some("AirFrance".to_owned()),
            Money::new(10_000, "EUR").unwrap(),
        )
        .unwrap(),
        Route::new(
            Stop {
                place: Place::new("Paris", "Orly"),
                time: parse_time("2026-05-01T16:00:00+02:00").unwrap(),
            },
            Stop {
                place: Place::new("Madrid", "airport"),
                time: parse_time("2026-05-01T18:00:00+02:00").unwrap(),
            },
            Transport::Plane,
            Some("Iberia".to_owned()),
            Money::new(15_000, "EUR").unwrap(),
        )
        .unwrap(),
    ]
}
