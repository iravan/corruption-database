pub mod routes;
pub mod store;

use axum::http::{header, HeaderValue, Method};
use routes::{router, AppState, Limiter};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;

pub struct Config {
    pub database_path: PathBuf,
    pub bind: SocketAddr,
    pub cors_origins: Vec<HeaderValue>,
    pub admin_password: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_path = std::env::var("DATABASE_PATH")
            .unwrap_or_else(|_| "data/reports.sqlite".to_string())
            .into();
        let bind = std::env::var("BIND")
            .unwrap_or_else(|_| "127.0.0.1:8787".to_string())
            .parse()
            .map_err(|_| "BIND is invalid")?;
        let admin_password =
            std::env::var("ADMIN_PASSWORD").map_err(|_| "ADMIN_PASSWORD is required")?;
        if admin_password.is_empty() {
            return Err("ADMIN_PASSWORD is required".to_string());
        }
        let cors_origins = std::env::var("CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3000,http://127.0.0.1:3000".to_string())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(|origin| {
                origin
                    .parse::<HeaderValue>()
                    .map_err(|_| format!("CORS origin is invalid: {origin}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            database_path,
            bind,
            cors_origins,
            admin_password,
        })
    }
}

pub async fn serve(config: Config) -> Result<(), String> {
    let store = store::Store::open(&config.database_path).map_err(|err| err.to_string())?;
    let state = AppState {
        store,
        admin_password: config.admin_password,
        sessions: Default::default(),
        limiter: Limiter::new(30),
    };
    let cors = CorsLayer::new()
        .allow_origin(config.cors_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    let app = router(state).layer(cors);
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|err| err.to_string())?;
    println!("listening on http://{}", config.bind);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|err| err.to_string())
}
