use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use server::routes::{router, AppState, Limiter};
use server::store::Store;
use serde_json::{json, Value};
use tower::ServiceExt;
use rusqlite::OptionalExtension;
use uuid::Uuid;

fn app(limit: usize) -> (axum::Router, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("corruption-http-{}.sqlite", Uuid::new_v4()));
    let store = Store::open(&path).unwrap();
    let app = router(AppState {
        store,
        admin_password: "test-admin".to_string(),
        sessions: Default::default(),
        limiter: Limiter::new(limit),
    });
    (app, path)
}

async fn call(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, value)
}

fn post(uri: &str, token: Option<&str>, body: Value) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

fn authed(method: &str, uri: &str, token: &str, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"));
    if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        builder.body(Body::from(body.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}

fn report(title: &str) -> Value {
    json!({
        "title": title,
        "body": "The winning bid was fixed before the deadline.",
        "category": "procurement",
        "agency": "Works department",
        "place": "Harbour",
        "occurred_on": "2019-01-01",
        "source_links": "",
        "contact": "letterbox@example.com",
        "latitude": 22.3194,
        "longitude": 114.1698
    })
}

#[tokio::test]
async fn a_submission_stays_hidden_until_an_admin_publishes_it() {
    let (app, path) = app(30);
    let (status, created) = call(&app, post("/reports", None, report("Harbour tender"))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["status"], "pending");
    let id = created["id"].as_str().unwrap();

    let (status, list) = call(&app, Request::builder().uri("/reports").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["reports"].as_array().unwrap().len(), 0);
    let (status, areas) = call(&app, bounds()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(areas["areas"].as_array().unwrap().is_empty());
    let raw = list.to_string();
    assert!(!raw.contains("letterbox@example.com"));
    assert!(!raw.contains("contact"));
    assert!(private_table_is_gone(&path));

    let (status, _) = call(
        &app,
        Request::builder()
            .uri(format!("/reports/{id}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = call(
        &app,
        Request::builder()
            .uri("/admin/reports?status=pending")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _) = call(
        &app,
        post("/admin/session", None, json!({ "password": "nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, session) = call(
        &app,
        post("/admin/session", None, json!({ "password": "test-admin" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = session["token"].as_str().unwrap();

    let (status, queue) = call(
        &app,
        authed("GET", "/admin/reports?status=pending", token, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(queue["reports"][0]["id"], id);
    assert!(!queue.to_string().contains("letterbox@example.com"));
    assert!(queue["reports"][0].get("contact").is_none());
    assert_eq!(queue["reports"][0]["area"], "22319:114169");

    let (status, published) = call(
        &app,
        authed(
            "PATCH",
            &format!("/admin/reports/{id}"),
            token,
            Some(json!({
                "body": "The winning bid was fixed before the deadline. Names removed.",
                "status": "published",
                "note": "redacted"
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(published["status"], "published");
    assert_eq!(published["actions"][0]["action"], "publish");
    assert!(!published.to_string().contains("submitter_ip_hash"));

    let (status, public) = call(
        &app,
        Request::builder()
            .uri(format!("/reports/{id}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(public["title"], "Harbour tender");
    let raw = public.to_string();
    assert!(!raw.contains("letterbox@example.com"));
    assert!(!raw.contains("contact"));
    assert!(!raw.contains("redacted"));
    let (status, areas) = call(&app, bounds()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(areas["areas"][0]["area"], "22319:114169");
    assert_eq!(areas["areas"][0]["count"], 1);
    let (status, cell) = call(
        &app,
        Request::builder()
            .uri("/areas/22319:114169/reports")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cell["reports"][0]["title"], "Harbour tender");

    let (status, _) = call(
        &app,
        authed(
            "PATCH",
            &format!("/admin/reports/{id}"),
            token,
            Some(json!({ "status": "pending", "note": "hold" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        Request::builder()
            .uri(format!("/reports/{id}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = call(
        &app,
        authed(
            "PATCH",
            &format!("/admin/reports/{id}"),
            token,
            Some(json!({ "status": "rejected" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, list) = call(&app, Request::builder().uri("/reports").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["reports"].as_array().unwrap().is_empty());
    let (status, areas) = call(&app, bounds()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(areas["areas"].as_array().unwrap().is_empty());
    let _ = std::fs::remove_file(path);
}

fn bounds() -> Request<Body> {
    Request::builder()
        .uri("/areas?south=22.3&west=114.1&north=22.4&east=114.2")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn empty_text_and_private_data_are_not_stored() {
    let (app, path) = app(30);
    let (status, _) = call(
        &app,
        post("/reports", None, json!({ "title": " ", "body": "Something happened." })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) = call(
        &app,
        post(
            "/reports",
            None,
            json!({
                "title": "A phone number",
                "body": "Call +852 9123 4567 about the contract."
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("phone numbers"));

    let (status, body) = call(
        &app,
        post(
            "/reports",
            None,
            json!({
                "title": "A tender",
                "body": "The winning bid was fixed before the deadline."
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("location"));

    let (status, session) = call(
        &app,
        post("/admin/session", None, json!({ "password": "test-admin" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = session["token"].as_str().unwrap();
    let (status, queue) = call(
        &app,
        authed("GET", "/admin/reports?status=pending", token, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(queue["reports"].as_array().unwrap().is_empty());
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn the_rate_limit_stops_another_post() {
    let (app, path) = app(1);
    let (status, _) = call(&app, post("/reports", None, report("First"))).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = call(&app, post("/reports", None, report("Second"))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let _ = std::fs::remove_file(path);
}

fn private_table_is_gone(path: &std::path::Path) -> bool {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.query_row(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'report_private'",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .unwrap()
    .is_none()
}
