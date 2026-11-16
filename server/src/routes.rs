use crate::store::{NewReport, ReportPatch, Store, StoreError};
use axum::extract::{ConnectInfo, FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub admin_password: String,
    pub sessions: Arc<Mutex<HashSet<String>>>,
    pub limiter: Limiter,
}

#[derive(Clone)]
pub struct Limiter {
    hits: Arc<Mutex<HashMap<String, Vec<i64>>>>,
    max: usize,
}

impl Limiter {
    pub fn new(max: usize) -> Self {
        Self {
            hits: Default::default(),
            max,
        }
    }

    // ponytail: one process-wide counter per IP. It resets when the process restarts.
    pub fn allow(&self, key: &str) -> bool {
        let now = chrono::Utc::now().timestamp();
        let mut hits = self.hits.lock().expect("rate limit lock");
        let entry = hits.entry(key.to_string()).or_default();
        entry.retain(|at| now - *at < 3600);
        if entry.len() >= self.max {
            return false;
        }
        entry.push(now);
        true
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/reports", get(list_reports).post(create_report))
        .route("/reports/{id}", get(get_report))
        .route("/admin/session", post(login).delete(logout))
        .route("/admin/reports", get(admin_list))
        .route("/admin/reports/{id}", get(admin_get).patch(admin_patch))
        .with_state(state)
}

struct ClientIp(String);

impl<S> FromRequestParts<S> for ClientIp
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|info| info.0.ip().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        Ok(ClientIp(ip))
    }
}

#[derive(Deserialize)]
struct CreateBody {
    title: String,
    body: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    agency: String,
    #[serde(default)]
    place: String,
    #[serde(default)]
    occurred_on: String,
    #[serde(default)]
    source_links: String,
    #[serde(default)]
    contact: String,
}

#[derive(Deserialize)]
struct LoginBody {
    password: String,
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
struct PatchBody {
    title: Option<String>,
    body: Option<String>,
    category: Option<String>,
    agency: Option<String>,
    place: Option<String>,
    occurred_on: Option<String>,
    source_links: Option<String>,
    status: Option<String>,
    #[serde(default)]
    note: String,
}

async fn list_reports(State(state): State<AppState>) -> Response {
    match state.store.list_public() {
        Ok(reports) => Json(json!({ "reports": reports })).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "The store failed."),
    }
}

async fn get_report(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match state.store.get_public(&id) {
        Ok(Some(report)) => Json(report).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "That report is not public."),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "The store failed."),
    }
}

async fn create_report(
    State(state): State<AppState>,
    client: ClientIp,
    Json(body): Json<CreateBody>,
) -> Response {
    if !state.limiter.allow(&client.0) {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many reports from this address. Try again later.",
        );
    }
    let created = state.store.create(NewReport {
        title: body.title,
        body: body.body,
        category: body.category,
        agency: body.agency,
        place: body.place,
        occurred_on: body.occurred_on,
        source_links: body.source_links,
        contact: body.contact,
        ip: client.0,
    });
    match created {
        Ok(report) => (
            StatusCode::CREATED,
            Json(json!({ "id": report.id, "status": "pending" })),
        )
            .into_response(),
        Err(err) => store_error(err),
    }
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Response {
    if body.password != state.admin_password {
        return error(StatusCode::UNAUTHORIZED, "The password is wrong.");
    }
    let token = Uuid::new_v4().to_string();
    state
        .sessions
        .lock()
        .expect("session lock")
        .insert(token.clone());
    Json(json!({ "token": token })).into_response()
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = bearer(&headers) {
        state.sessions.lock().expect("session lock").remove(token);
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn admin_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> Response {
    if let Err(response) = require_admin(&state, &headers) {
        return response;
    }
    match state.store.list_admin(query.status.as_deref()) {
        Ok(reports) => Json(json!({ "reports": reports })).into_response(),
        Err(err) => store_error(err),
    }
}

async fn admin_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_admin(&state, &headers) {
        return response;
    }
    match state.store.get_admin(&id) {
        Ok(Some(report)) => Json(report).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "That report does not exist."),
        Err(err) => store_error(err),
    }
}

async fn admin_patch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchBody>,
) -> Response {
    if let Err(response) = require_admin(&state, &headers) {
        return response;
    }
    match state.store.update(
        &id,
        ReportPatch {
            title: body.title,
            body: body.body,
            category: body.category,
            agency: body.agency,
            place: body.place,
            occurred_on: body.occurred_on,
            source_links: body.source_links,
            status: body.status,
            note: body.note,
        },
    ) {
        Ok(report) => Json(report).into_response(),
        Err(err) => store_error(err),
    }
}

fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    let Some(token) = bearer(headers) else {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "An admin session is required.",
        ));
    };
    if state.sessions.lock().expect("session lock").contains(token) {
        Ok(())
    } else {
        Err(error(
            StatusCode::UNAUTHORIZED,
            "An admin session is required.",
        ))
    }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

fn store_error(err: StoreError) -> Response {
    match err {
        StoreError::Invalid(message) => error(StatusCode::BAD_REQUEST, message),
        StoreError::Missing => error(StatusCode::NOT_FOUND, "That report does not exist."),
        StoreError::Failed => error(StatusCode::INTERNAL_SERVER_ERROR, "The store failed."),
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}
