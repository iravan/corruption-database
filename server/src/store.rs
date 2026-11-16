use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const TITLE_MAX: usize = 200;
const BODY_MAX: usize = 4000;
const SHORT_MAX: usize = 200;
const LINKS_MAX: usize = 1000;
const COLUMNS: &str = "r.id, r.created_at, r.updated_at, r.status, r.title, r.body, r.category, r.agency, r.place, r.occurred_on, r.source_links";

#[derive(Clone)]
pub struct Store {
    db: Arc<Mutex<Connection>>,
}

#[derive(Debug)]
pub enum StoreError {
    Invalid(&'static str),
    Missing,
    Failed,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Invalid(message) => write!(f, "{message}"),
            StoreError::Missing => write!(f, "report not found"),
            StoreError::Failed => write!(f, "the store failed"),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct Report {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub status: String,
    pub title: String,
    pub body: String,
    pub category: String,
    pub agency: String,
    pub place: String,
    pub occurred_on: String,
    pub source_links: String,
}

#[derive(Serialize, Clone)]
pub struct AdminAction {
    pub admin_id: String,
    pub action: String,
    pub note: String,
    pub at: String,
}

#[derive(Serialize, Clone)]
pub struct AdminReport {
    #[serde(flatten)]
    pub report: Report,
    pub actions: Vec<AdminAction>,
}

pub struct NewReport {
    pub title: String,
    pub body: String,
    pub category: String,
    pub agency: String,
    pub place: String,
    pub occurred_on: String,
    pub source_links: String,
}

pub struct ReportPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub category: Option<String>,
    pub agency: Option<String>,
    pub place: Option<String>,
    pub occurred_on: Option<String>,
    pub source_links: Option<String>,
    pub status: Option<String>,
    pub note: String,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    eprintln!("database directory: {err}");
                    StoreError::Failed
                })?;
            }
        }
        let conn = Connection::open(path).map_err(failed)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(failed)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected')),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                category TEXT NOT NULL,
                agency TEXT NOT NULL,
                place TEXT NOT NULL,
                occurred_on TEXT NOT NULL,
                source_links TEXT NOT NULL
            );
            DROP TABLE IF EXISTS report_private;
            CREATE TABLE IF NOT EXISTS admin_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id TEXT NOT NULL REFERENCES reports(id),
                admin_id TEXT NOT NULL,
                action TEXT NOT NULL,
                note TEXT NOT NULL,
                at TEXT NOT NULL
            );",
        )
        .map_err(failed)?;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn create(&self, new: NewReport) -> Result<Report, StoreError> {
        let title = required(&new.title, TITLE_MAX, "A title is required.", "The title is too long.")?;
        let body = required(&new.body, BODY_MAX, "A report is required.", "The report is too long.")?;
        let category = optional(&new.category, SHORT_MAX, "The category is too long.")?;
        let agency = optional(&new.agency, SHORT_MAX, "The agency is too long.")?;
        let place = optional(&new.place, SHORT_MAX, "The place is too long.")?;
        let occurred_on = optional(&new.occurred_on, SHORT_MAX, "The date is too long.")?;
        let source_links = optional(&new.source_links, LINKS_MAX, "The source links are too long.")?;
        let id = Uuid::new_v4().to_string();
        let now = now();
        let mut db = self.lock();
        let tx = db.transaction().map_err(failed)?;
        tx.execute(
            "INSERT INTO reports (id, created_at, updated_at, status, title, body, category, agency, place, occurred_on, source_links)
             VALUES (?1, ?2, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, now, title, body, category, agency, place, occurred_on, source_links],
        )
        .map_err(failed)?;
        tx.commit().map_err(failed)?;
        Ok(Report {
            id,
            created_at: now.clone(),
            updated_at: now,
            status: "pending".to_string(),
            title,
            body,
            category,
            agency,
            place,
            occurred_on,
            source_links,
        })
    }

    pub fn list_public(&self) -> Result<Vec<Report>, StoreError> {
        let db = self.lock();
        let mut stmt = db
            .prepare(&format!(
                "SELECT {COLUMNS} FROM reports r WHERE r.status = 'published' ORDER BY r.created_at DESC"
            ))
            .map_err(failed)?;
        let rows = stmt
            .query_map([], map_report)
            .map_err(failed)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(failed)?;
        Ok(rows)
    }

    pub fn get_public(&self, id: &str) -> Result<Option<Report>, StoreError> {
        let db = self.lock();
        Ok(load_report(&db, id)?.filter(|report| report.status == "published"))
    }

    pub fn list_admin(&self, status: Option<&str>) -> Result<Vec<Report>, StoreError> {
        if let Some(status) = status {
            if !is_status(status) {
                return Err(StoreError::Invalid("Status is invalid."));
            }
        }
        let db = self.lock();
        let order = if status == Some("pending") { "ASC" } else { "DESC" };
        let (sql, bind): (String, Option<&str>) = match status {
            Some(status) => (
                format!(
                    "SELECT {COLUMNS} FROM reports r WHERE r.status = ?1 ORDER BY r.created_at {order}"
                ),
                Some(status),
            ),
            None => (
                format!("SELECT {COLUMNS} FROM reports r ORDER BY r.created_at {order}"),
                None,
            ),
        };
        let mut stmt = db.prepare(&sql).map_err(failed)?;
        let rows = match bind {
            Some(status) => stmt.query_map(params![status], map_report).map_err(failed)?,
            None => stmt.query_map([], map_report).map_err(failed)?,
        };
        rows.collect::<Result<Vec<_>, _>>().map_err(failed)
    }

    pub fn get_admin(&self, id: &str) -> Result<Option<AdminReport>, StoreError> {
        let db = self.lock();
        load_admin(&db, id)
    }

    pub fn update(&self, id: &str, patch: ReportPatch) -> Result<AdminReport, StoreError> {
        let mut db = self.lock();
        let tx = db.transaction().map_err(failed)?;
        let Some(current) = load_report(&tx, id)? else {
            return Err(StoreError::Missing);
        };
        let title = match &patch.title {
            Some(value) => required(value, TITLE_MAX, "A title is required.", "The title is too long.")?,
            None => current.title.clone(),
        };
        let body = match &patch.body {
            Some(value) => required(value, BODY_MAX, "A report is required.", "The report is too long.")?,
            None => current.body.clone(),
        };
        let category = match &patch.category {
            Some(value) => optional(value, SHORT_MAX, "The category is too long.")?,
            None => current.category.clone(),
        };
        let agency = match &patch.agency {
            Some(value) => optional(value, SHORT_MAX, "The agency is too long.")?,
            None => current.agency.clone(),
        };
        let place = match &patch.place {
            Some(value) => optional(value, SHORT_MAX, "The place is too long.")?,
            None => current.place.clone(),
        };
        let occurred_on = match &patch.occurred_on {
            Some(value) => optional(value, SHORT_MAX, "The date is too long.")?,
            None => current.occurred_on.clone(),
        };
        let source_links = match &patch.source_links {
            Some(value) => optional(value, LINKS_MAX, "The source links are too long.")?,
            None => current.source_links.clone(),
        };
        let status = match patch.status.as_deref() {
            Some(status) if is_status(status) => status.to_string(),
            Some(_) => return Err(StoreError::Invalid("Status is invalid.")),
            None => current.status.clone(),
        };
        let action = if status != current.status {
            match (current.status.as_str(), status.as_str()) {
                (_, "published") => "publish",
                (_, "rejected") => "reject",
                ("published", "pending") => "unpublish",
                _ => "reopen",
            }
        } else {
            "edit"
        };
        let now = now();
        let note = patch.note.trim();
        tx.execute(
            "UPDATE reports
             SET updated_at = ?1, status = ?2, title = ?3, body = ?4, category = ?5,
                 agency = ?6, place = ?7, occurred_on = ?8, source_links = ?9
             WHERE id = ?10",
            params![now, status, title, body, category, agency, place, occurred_on, source_links, id],
        )
        .map_err(failed)?;
        tx.execute(
            "INSERT INTO admin_actions (report_id, admin_id, action, note, at) VALUES (?1, 'admin', ?2, ?3, ?4)",
            params![id, action, note, now],
        )
        .map_err(failed)?;
        let report = load_admin(&tx, id)?.ok_or(StoreError::Missing)?;
        tx.commit().map_err(failed)?;
        Ok(report)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().expect("database lock")
    }
}

fn load_report(db: &Connection, id: &str) -> Result<Option<Report>, StoreError> {
    db.query_row(
        &format!("SELECT {COLUMNS} FROM reports r WHERE r.id = ?1"),
        params![id],
        map_report,
    )
    .optional()
    .map_err(failed)
}

fn load_admin(db: &Connection, id: &str) -> Result<Option<AdminReport>, StoreError> {
    let Some(report) = load_report(db, id)? else {
        return Ok(None);
    };
    let mut stmt = db
        .prepare(
            "SELECT admin_id, action, note, at FROM admin_actions WHERE report_id = ?1 ORDER BY id ASC",
        )
        .map_err(failed)?;
    let actions = stmt
        .query_map(params![id], |row| {
            Ok(AdminAction {
                admin_id: row.get(0)?,
                action: row.get(1)?,
                note: row.get(2)?,
                at: row.get(3)?,
            })
        })
        .map_err(failed)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(failed)?;
    Ok(Some(AdminReport { report, actions }))
}

fn map_report(row: &rusqlite::Row<'_>) -> rusqlite::Result<Report> {
    Ok(Report {
        id: row.get(0)?,
        created_at: row.get(1)?,
        updated_at: row.get(2)?,
        status: row.get(3)?,
        title: row.get(4)?,
        body: row.get(5)?,
        category: row.get(6)?,
        agency: row.get(7)?,
        place: row.get(8)?,
        occurred_on: row.get(9)?,
        source_links: row.get(10)?,
    })
}

fn required(value: &str, max: usize, empty: &'static str, long: &'static str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(StoreError::Invalid(empty));
    }
    if value.chars().count() > max {
        return Err(StoreError::Invalid(long));
    }
    screen(value)?;
    Ok(value.to_string())
}

fn optional(value: &str, max: usize, long: &'static str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(StoreError::Invalid(long));
    }
    screen(value)?;
    Ok(value.to_string())
}

fn screen(value: &str) -> Result<(), StoreError> {
    if rejects_private_data(value) {
        Err(StoreError::Invalid(
            "Remove names, phone numbers, identity numbers, and home addresses. A report is anonymous.",
        ))
    } else {
        Ok(())
    }
}

fn is_status(status: &str) -> bool {
    matches!(status, "pending" | "published" | "rejected")
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn rejects_private_data(text: &str) -> bool {
    consecutive_digits(text) >= 17
        || looks_like_hkid(text)
        || looks_like_ssn(text)
        || looks_like_phone(text)
        || looks_like_street_address(text)
}

fn consecutive_digits(text: &str) -> usize {
    let mut best = 0;
    let mut run = 0;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            run += 1;
            best = best.max(run);
        } else {
            run = 0;
        }
    }
    best
}

fn looks_like_hkid(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_alphabetic() {
            i += 1;
            continue;
        }
        let mut letters = 0;
        while i < chars.len() && chars[i].is_ascii_alphabetic() {
            letters += 1;
            i += 1;
        }
        let mut digits = 0;
        while i < chars.len() && chars[i].is_ascii_digit() {
            digits += 1;
            i += 1;
        }
        if (letters == 1 || letters == 2) && digits == 6 && i < chars.len() {
            let mut j = i;
            if chars[j] == ' ' {
                j += 1;
            }
            if j < chars.len() && chars[j] == '(' {
                j += 1;
            }
            if j < chars.len() && (chars[j].is_ascii_digit() || chars[j].eq_ignore_ascii_case(&'a')) {
                return true;
            }
        }
    }
    false
}

fn looks_like_ssn(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() < 11 {
        return false;
    }
    for start in 0..=bytes.len() - 11 {
        let window = &bytes[start..start + 11];
        if window[3] == b'-'
            && window[6] == b'-'
            && window[..3].iter().all(u8::is_ascii_digit)
            && window[4..6].iter().all(u8::is_ascii_digit)
            && window[7..].iter().all(u8::is_ascii_digit)
        {
            return true;
        }
    }
    false
}

fn looks_like_phone(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if !is_phone_char(chars[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && is_phone_char(chars[i]) {
            i += 1;
        }
        let cluster = trim_phone_edges(&chars[start..i]);
        let digits = cluster.iter().filter(|ch| ch.is_ascii_digit()).count();
        let plus = cluster.first() == Some(&'+');
        let separated = cluster.iter().any(|ch| matches!(ch, '-' | ' ' | '(' | ')'));
        if digits >= 8 && digits <= 15 && (plus || separated) && !is_calendar_date(cluster) {
            return true;
        }
    }
    false
}

fn is_phone_char(ch: char) -> bool {
    ch.is_ascii_digit() || matches!(ch, '+' | '-' | ' ' | '(' | ')')
}

fn trim_phone_edges(cluster: &[char]) -> &[char] {
    let mut start = 0;
    let mut end = cluster.len();
    while start < end && !cluster[start].is_ascii_digit() && cluster[start] != '+' {
        start += 1;
    }
    while end > start && !cluster[end - 1].is_ascii_digit() {
        end -= 1;
    }
    &cluster[start..end]
}

fn is_calendar_date(cluster: &[char]) -> bool {
    let text: String = cluster.iter().collect();
    let text = text.trim();
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..].iter().all(u8::is_ascii_digit)
}

fn looks_like_street_address(text: &str) -> bool {
    const SUFFIXES: &[&str] = &[
        " street", " st.", " road", " rd.", " avenue", " ave.", " lane", " drive", " boulevard",
    ];
    for line in text.lines() {
        let line = line.trim();
        let lower = line.to_lowercase();
        let starts_with_digit = lower.starts_with(|ch: char| ch.is_ascii_digit());
        if starts_with_digit && SUFFIXES.iter().any(|suffix| lower.contains(suffix)) {
            return true;
        }
        if line.chars().any(|ch| ch.is_ascii_digit()) && line.contains('號') {
            return true;
        }
    }
    false
}

fn failed(err: rusqlite::Error) -> StoreError {
    eprintln!("sqlite error: {err}");
    StoreError::Failed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_data_is_refused_and_ordinary_text_is_kept() {
        assert!(rejects_private_data("+852 9123 4567"));
        assert!(rejects_private_data("A123456(7)"));
        assert!(rejects_private_data("123-45-6789"));
        assert!(rejects_private_data("110101199001011234"));
        assert!(rejects_private_data("12 Queen's Road"));
        assert!(rejects_private_data("中環皇后大道中12號"));
        assert!(!rejects_private_data("A tender in 2019 for the harbour project."));
        assert!(!rejects_private_data("2019-01-01"));
        assert!(!rejects_private_data("The contract was worth 10000000."));
    }

    #[test]
    fn a_report_is_still_there_after_reopen_and_stays_unpublished() {
        let path = std::env::temp_dir().join(format!("corruption-{}.sqlite", Uuid::new_v4()));
        let id = {
            let store = Store::open(&path).unwrap();
            store
                .create(NewReport {
                    title: "Harbour tender".into(),
                    body: "The winning bid was fixed before the deadline.".into(),
                    category: "procurement".into(),
                    agency: "Works department".into(),
                    place: "Harbour".into(),
                    occurred_on: "2019-01-01".into(),
                    source_links: "".into(),
                })
                .unwrap()
                .id
        };
        let store = Store::open(&path).unwrap();
        let report = store.get_admin(&id).unwrap().unwrap();
        assert_eq!(report.report.status, "pending");
        let conn = Connection::open(&path).unwrap();
        let private: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'report_private'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(private.is_none());
        assert!(store.get_public(&id).unwrap().is_none());
        assert!(store.list_public().unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }
}
