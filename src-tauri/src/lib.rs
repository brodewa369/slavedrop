// SlaveDrop — Tauri v2 port of the Electron main process (main.js).
#![recursion_limit = "512"]
// SQLite backend via rusqlite, same schema, same IPC surface (window.api.*).

use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

struct Db(pub Mutex<Option<Connection>>);

// ---------- constants (mirror main.js) ----------

const DEFAULT_CATEGORIES: &[&str] = &[
    "Testnet", "Mainnet", "Retrodrop", "Node", "DeFi", "Social", "Waitlist", "AI",
    "Telegram Bot", "Daily Checkin", "Memecoin", "NFT",
];
const DEFAULT_NETWORKS: &[&str] = &[
    "Ethereum", "Solana", "Arbitrum", "Optimism", "Base", "BSC", "Polygon", "Avalanche",
    "Sui", "Aptos", "Bitcoin", "Cosmos",
];
const DEFAULT_RANKS: &[&str] = &["S", "A", "B", "C", "D"];
const DEFAULT_STATUSES: &[&str] = &["Ongoing", "TGE", "Completed", "Eligible", "Ineligible"];
const DEFAULT_PLATFORMS: &[&str] = &["X", "Desktop", "App", "Extension"];
const DEFAULT_WALLET_APPS: &[&str] = &["MetaMask", "OKX Wallet", "Phantom", "Rabby", "Keplr", "Binance"];

const VALID_THEMES: &[&str] = &["dark", "light"];
const VALID_SKINS: &[&str] = &["base", "paper", "aurora", "crt"];
const VALID_LOCALES: &[&str] = &["en", "id"];
const VALID_BG: &[&str] = &["none", "aurora", "nebula", "ember", "forest", "custom"];
const BG_DEFAULT: &str = "aurora";

const RANK_ORDER: &[&str] = &["S", "A", "B", "C", "D"];

// which editable option list writes into which projects column
fn option_to_column(key: &str) -> Option<&'static str> {
    match key {
        "categories" => Some("category"),
        "networks" => Some("network"),
        "statuses" => Some("status"),
        "platforms" => Some("platform"),
        "walletApps" => Some("wallet_app"),
        "walletLabels" => None,
        "ranks" => Some("rank"),
        _ => None,
    }
}

fn protected_options(key: &str) -> Vec<String> {
    match key {
        "ranks" => RANK_ORDER.iter().map(|s| s.to_string()).collect(),
        "platforms" => DEFAULT_PLATFORMS.iter().map(|s| s.to_string()).collect(),
        _ => vec![],
    }
}

// ---------- X username parsing (mirror parseXUsername) ----------

/// public wrapper for tests
pub fn parse_x_username_public(v: &Value) -> String {
    parse_x_username(v)
}

fn parse_x_username(v: &Value) -> String {
    let raw = match v {
        Value::Null => return String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return String::new();
    }
    // strip query/hash
    if let Some(pos) = s.find(['?', '#']) {
        s.truncate(pos);
    }
    while s.ends_with('/') {
        s.pop();
    }
    s = s.trim_start_matches(['@', ':', ' ', '\t']).to_string();

    // find all x.com/twitter.com/<handle> occurrences, take the LAST
    let lower = s.to_lowercase();
    let mut hits: Vec<(usize, String)> = vec![];
    let mut search_from = 0usize;
    loop {
        let idx = match lower[search_from..].find("x.com/") {
            Some(i) => search_from + i,
            None => match lower[search_from..].find("twitter.com/") {
                Some(i) => search_from + i,
                None => break,
            },
        };
        let domain_len = if lower[idx..].starts_with("x.com/") { 6 } else { 12 };
        let start = idx + domain_len;
        let handle: String = s[start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if !handle.is_empty() && handle.len() <= 15 {
            hits.push((idx, handle));
        }
        search_from = start;
        if search_from >= s.len() {
            break;
        }
    }
    if !hits.is_empty() {
        return hits.last().unwrap().1.clone();
    }

    // bare handle: take the last path segment
    if let Some(pos) = s.rfind('/') {
        s = s[pos + 1..].to_string();
    }
    s = s.trim_start_matches(['@', ':']).to_string();
    s = s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    s.chars().take(15).collect()
}

// ---------- parseCats (JSON array or plain string) ----------

fn parse_cats(raw: Option<String>) -> Vec<String> {
    let raw = match raw {
        None => return vec![],
        Some(r) => r,
    };
    if raw.is_empty() {
        return vec![];
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Array(arr)) => arr
            .into_iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        Ok(_) => vec![raw],
        Err(_) => vec![raw],
    }
}

fn parse_cats_value(v: &Value) -> Vec<String> {
    match v {
        Value::Null => vec![],
        Value::Array(arr) => arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect(),
        Value::String(s) => {
            if s.is_empty() {
                vec![]
            } else {
                match serde_json::from_str::<Value>(s) {
                    Ok(Value::Array(arr)) => arr
                        .into_iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect(),
                    _ => vec![s.clone()],
                }
            }
        }
        other => vec![other.to_string()],
    }
}

// ---------- DB helpers ----------

fn db_file(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    dir.join("airdrop.db")
}

fn open_db(path: &PathBuf) -> Connection {
    let conn = Connection::open(path).expect("open sqlite");
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    conn
}

fn with_conn<T>(db: &State<Db>, f: impl FnOnce(&Connection) -> T) -> T {
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialized");
    f(conn)
}

fn has_column(conn: &Connection, table: &str, col: &str) -> bool {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("pragma table_info");
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("pragma rows");
    for r in rows {
        if r.unwrap_or_default() == col {
            return true;
        }
    }
    false
}

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // ISO 8601 UTC — matches JS new Date().toISOString()
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();
    let (y, mo, d, h, mi, s) = epoch_to_utc(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

fn epoch_to_utc(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    // days since epoch -> civil date (Howard Hinnant's algorithm)
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let h = (rem / 3600) as u32;
    let mi = ((rem % 3600) / 60) as u32;
    let s = (rem % 60) as u32;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

// ---------- migration ----------

fn migrate(conn: &Connection) {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          website TEXT DEFAULT '',
          x_account TEXT DEFAULT '',
          category TEXT DEFAULT '',
          network TEXT DEFAULT '',
          note TEXT DEFAULT '',
          icon TEXT DEFAULT '',
          done INTEGER DEFAULT 0,
          archived INTEGER DEFAULT 0,
          rank TEXT DEFAULT '',
          cost TEXT DEFAULT '',
          chains TEXT DEFAULT '[]',
          status TEXT DEFAULT '',
          platform TEXT DEFAULT '',
          wallet_app TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          label TEXT DEFAULT '',
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          address TEXT NOT NULL,
          label TEXT DEFAULT '',
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS x_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          username TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS emails (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          text TEXT NOT NULL,
          deadline TEXT DEFAULT '',
          done INTEGER DEFAULT 0,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        ",
    )
    .expect("create tables");

    // additive migrations
    if !has_column(conn, "projects", "icon") {
        conn.execute("ALTER TABLE projects ADD COLUMN icon TEXT DEFAULT ''", [])
            .ok();
    }
    if !has_column(conn, "tasks", "deadline") {
        conn.execute("ALTER TABLE tasks ADD COLUMN deadline TEXT DEFAULT ''", [])
            .ok();
    }
    if !has_column(conn, "tasks", "url") {
        conn.execute("ALTER TABLE tasks ADD COLUMN url TEXT DEFAULT ''", [])
            .ok();
    }
    for col in ["rank", "cost", "chains", "status", "platform", "wallet_app"] {
        if !has_column(conn, "projects", col) {
            conn.execute(
                &format!("ALTER TABLE projects ADD COLUMN {col} TEXT DEFAULT ''"),
                [],
            )
            .ok();
        }
    }
    // category single string -> JSON array
    let _ = conn.execute(
        "UPDATE projects SET category = '[]' WHERE category IS NULL OR category = ''",
        [],
    );
    let _ = conn.execute(
        "UPDATE projects SET category = '[' || category || ']' WHERE category <> '[]' AND json_valid(category) = 0",
        [],
    );
    // seed lists
    let seed = |conn: &Connection, key: &str, defaults: &[&str]| {
        let exists: bool = conn
            .query_row("SELECT 1 FROM config WHERE key = ?1", [key], |_| Ok(true))
            .unwrap_or(false);
        if !exists {
            let val = serde_json::to_string(defaults).unwrap();
            conn.execute("INSERT INTO config(key, value) VALUES(?1, ?2)", params![key, val])
                .ok();
        }
    };
    seed(conn, "categories", DEFAULT_CATEGORIES);
    seed(conn, "networks", DEFAULT_NETWORKS);
    seed(conn, "walletLabels", &["MetaMask", "Phantom", "Rabby", "Keplr", "OKX", "Binance"]);
    seed(conn, "ranks", DEFAULT_RANKS);
    seed(conn, "statuses", DEFAULT_STATUSES);
    seed(conn, "platforms", DEFAULT_PLATFORMS);
    seed(conn, "walletApps", DEFAULT_WALLET_APPS);

    // v2 list refresh: drop removed defaults, ensure new defaults exist
    let merge_list = |conn: &Connection, key: &str, defaults: &[&str], drop: &[&str]| {
        let row: Option<String> = conn
            .query_row("SELECT value FROM config WHERE key = ?1", [key], |r| r.get(0))
            .ok();
        let Some(row) = row else { return };
        let Ok(Value::Array(mut arr)) = serde_json::from_str::<Value>(&row) else {
            return;
        };
        let mut changed = false;
        for d in drop {
            if let Some(i) = arr.iter().position(|v| v.as_str() == Some(*d)) {
                arr.remove(i);
                changed = true;
            }
        }
        for d in defaults {
            if !arr.iter().any(|v| v.as_str() == Some(*d)) {
                arr.push(json!(d));
                changed = true;
            }
        }
        if changed {
            let val = serde_json::to_string(&arr).unwrap();
            let _ = conn.execute(
                "UPDATE config SET value = ?1 WHERE key = ?2",
                params![val, key],
            );
        }
    };
    merge_list(conn, "categories", DEFAULT_CATEGORIES, &["Other", "Airdrop", "Quest"]);
    merge_list(conn, "statuses", DEFAULT_STATUSES, &[]);
    merge_list(conn, "platforms", DEFAULT_PLATFORMS, &[]);
    merge_list(conn, "walletApps", DEFAULT_WALLET_APPS, &[]);
}

// ---------- row -> JSON ----------

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let id: i64 = row.get("id")?;
    let name: String = row.get("name")?;
    let website: String = row.get::<_, Option<String>>("website")?.unwrap_or_default();
    let x_account: String = row.get::<_, Option<String>>("x_account")?.unwrap_or_default();
    let category: String = row.get::<_, Option<String>>("category")?.unwrap_or_default();
    let network: String = row.get::<_, Option<String>>("network")?.unwrap_or_default();
    let note: String = row.get::<_, Option<String>>("note")?.unwrap_or_default();
    let icon: Option<String> = row.get("icon")?;
    let done: i64 = row.get("done")?;
    let archived: i64 = row.get("archived")?;
    let rank: String = row.get::<_, Option<String>>("rank")?.unwrap_or_default();
    let cost: String = row.get::<_, Option<String>>("cost")?.unwrap_or_default();
    let chains: String = row.get::<_, Option<String>>("chains")?.unwrap_or_default();
    let status: String = row.get::<_, Option<String>>("status")?.unwrap_or_default();
    let platform: String = row.get::<_, Option<String>>("platform")?.unwrap_or_default();
    let wallet_app: String = row.get::<_, Option<String>>("wallet_app")?.unwrap_or_default();
    let created_at: String = row.get::<_, Option<String>>("created_at")?.unwrap_or_default();
    let updated_at: String = row.get::<_, Option<String>>("updated_at")?.unwrap_or_default();
    Ok(json!({
        "id": id, "name": name, "website": website, "x_account": x_account,
        "category": parse_cats(Some(category)), "network": parse_cats(Some(network)),
        "note": note, "icon": icon, "done": done != 0, "archived": archived != 0,
        "rank": rank, "cost": cost, "chains": parse_cats(Some(chains)),
        "status": status, "platform": parse_cats(Some(platform)), "wallet_app": wallet_app,
        "created_at": created_at, "updated_at": updated_at,
    }))
}

fn get_project_full(conn: &Connection, id: i64) -> Option<Value> {
    let mut p = conn
        .query_row("SELECT * FROM projects WHERE id = ?1", [id], row_to_project)
        .ok()?;
    let obj = p.as_object_mut()?;
    obj.insert("links".into(), child_rows(conn, id, "links", &["id", "url", "label"]));
    obj.insert("wallets".into(), child_rows(conn, id, "wallets", &["id", "address", "label"]));
    obj.insert("x_accounts".into(), child_rows(conn, id, "x_accounts", &["id", "username"]));
    obj.insert("emails".into(), child_rows(conn, id, "emails", &["id", "email"]));
    obj.insert(
        "tasks".into(),
        child_rows(conn, id, "tasks", &["id", "text", "deadline", "done", "url"]),
    );
    Some(p)
}

fn child_rows(conn: &Connection, pid: i64, table: &str, cols: &[&str]) -> Value {
    let sql = format!(
        "SELECT {} FROM {} WHERE project_id = ?1 ORDER BY id",
        cols.join(", "),
        table
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return json!([]),
    };
    let col_count = cols.len();
    let mut out: Vec<Value> = vec![];
    let mut rows = match stmt.query([pid]) {
        Ok(r) => r,
        Err(_) => return json!([]),
    };
    while let Ok(Some(row)) = rows.next() {
        let mut obj = Map::new();
        for (i, c) in cols.iter().enumerate() {
            let v: Value = match *c {
                "done" => row.get::<_, i64>(i).map(|v| json!(v != 0)).unwrap_or(json!(false)),
                "id" | "project_id" => row.get::<_, i64>(i).map(Value::from).unwrap_or(Value::Null),
                _ => row
                    .get::<_, Option<String>>(i)
                    .map(|v| v.map(Value::from).unwrap_or(Value::String(String::new())))
                    .unwrap_or(Value::String(String::new())),
            };
            obj.insert((*c).to_string(), v);
        }
        let _ = col_count;
        out.push(Value::Object(obj));
    }
    json!(out)
}

fn get_all_projects(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT * FROM projects WHERE archived = 0 ORDER BY id ASC")
        .expect("prepare projects");
    let rows = stmt
        .query_map([], row_to_project)
        .expect("query projects");
    let mut out: Vec<Value> = vec![];
    for r in rows {
        if let Ok(mut p) = r {
            let id = p["id"].as_i64().unwrap_or(0);
            let tasks = child_rows(conn, id, "tasks", &["id", "text", "deadline", "done", "url"]);
            let task_total = tasks.as_array().map(|a| a.len()).unwrap_or(0);
            let task_done = tasks
                .as_array()
                .map(|a| a.iter().filter(|t| t["done"].as_bool().unwrap_or(false)).count())
                .unwrap_or(0);
            let obj = p.as_object_mut().unwrap();
            obj.insert("tasks".into(), tasks);
            obj.insert(
                "wallets".into(),
                child_rows(conn, id, "wallets", &["address", "label"]),
            );
            obj.insert(
                "x_accounts".into(),
                child_rows(conn, id, "x_accounts", &["username"]),
            );
            obj.insert("emails".into(), child_rows(conn, id, "emails", &["email"]));
            obj.insert("links".into(), child_rows(conn, id, "links", &["url", "label"]));
            obj.insert("task_total".into(), json!(task_total));
            obj.insert("task_done".into(), json!(task_done));
            out.push(p);
        }
    }
    json!(out)
}

fn load_options(conn: &Connection) -> Value {
    let mut out = Map::new();
    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM config") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for row in rows.flatten() {
                let (k, v) = row;
                if let Some(v) = v {
                    if let Ok(parsed) = serde_json::from_str::<Value>(&v) {
                        out.insert(k, parsed);
                    }
                }
            }
        }
    }
    Value::Object(out)
}

// ---------- STRINGS (en/id) ----------

fn strings() -> Value {
    json!({
        "en": {
            "appSubtitle": "I promise to diligently farm airdrops again.",
            "search": "Search projects, wallets, tasks",
            "showPending": "Show pending only",
            "todayLabel": "{v}",
            "newProject": "New project", "editProject": "Edit project",
            "allNetworks": "All networks", "allCategories": "All categories", "allRanks": "All ranks",
            "network": "Network", "category": "Category", "rank": "Rank",
            "projects": "Projects", "done": "Done", "dailyProgress": "Daily progress",
            "noProjects": "No projects yet",
            "noProjectsHint": "Add the first airdrop you are farming. Everything is stored locally in this app, nothing leaves your machine.",
            "noMatches": "No matches",
            "noMatchesHint": "Nothing matches the current search or filter. Clear them to see all projects.",
            "clearFilters": "Clear filters", "addProject": "Add project",
            "tasks": "tasks", "markedDone": "Marked done",
            "website": "Website", "links": "Links", "identities": "Identities", "note": "Note", "status": "Status",
            "taskProgress": "Task progress", "taskDoneOf": "{a} of {b} tasks done",
            "noTasks": "No tasks recorded.",
            "edit": "Edit", "delete": "Delete project", "cancel": "Cancel", "create": "Create", "saveChanges": "Save changes",
            "deleteConfirm": "Delete {n} and all its data? This cannot be undone.",
            "nameRequired": "Project name is required",
            "created": "Created", "lastEdited": "Last edited",
            "add": "Add",
            "cost": "Cost", "platform": "Platform", "walletApp": "Wallet app",
            "additionalLinks": "Additional links", "wallets": "Wallets", "xAccounts": "X accounts", "emails": "Emails",
            "tasksSection": "Tasks",
            "backup": "Backup", "restore": "Restore",
            "confirmDeleteOption": "\"{v}\" is used by {n} projects. Delete it anyway? The value will be removed from those projects."
        },
        "id": {
            "appSubtitle": "Saya berjanji akan rajin garap erdrop lagi.",
            "search": "Cari project, wallet, task",
            "showPending": "Tampilkan yang belum selesai",
            "todayLabel": "{v}",
            "newProject": "Project baru", "editProject": "Edit project",
            "allNetworks": "Semua network", "allCategories": "Semua kategori", "allRanks": "Semua rank",
            "network": "Network", "category": "Kategori", "rank": "Rank",
            "projects": "Project", "done": "Selesai", "dailyProgress": "Progress harian",
            "noProjects": "Belum ada project",
            "noProjectsHint": "Tambahkan airdrop pertama yang sedang kamu kerjakan. Semua disimpan lokal di app ini, tidak ada yang keluar dari perangkatmu.",
            "noMatches": "Tidak ada hasil",
            "noMatchesHint": "Tidak ada yang cocok dengan pencarian atau filter saat ini. Hapus filter untuk melihat semua project.",
            "clearFilters": "Hapus filter", "addProject": "Tambah project",
            "tasks": "task", "markedDone": "Ditandai selesai",
            "website": "Website", "links": "Link", "identities": "Identitas", "note": "Catatan", "status": "Status",
            "taskProgress": "Progress task", "taskDoneOf": "{a} dari {b} task selesai",
            "noTasks": "Belum ada task.",
            "edit": "Edit", "delete": "Hapus project", "cancel": "Batal", "create": "Buat", "saveChanges": "Simpan perubahan",
            "deleteConfirm": "Hapus {n} dan semua datanya? Ini tidak bisa dibatalkan.",
            "nameRequired": "Nama project wajib diisi",
            "created": "Dibuat", "lastEdited": "Terakhir diubah",
            "add": "Tambah",
            "cost": "Cost", "platform": "Platform", "walletApp": "Wallet app",
            "additionalLinks": "Link tambahan", "wallets": "Wallet", "xAccounts": "Akun X", "emails": "Email",
            "tasksSection": "Task",
            "backup": "Backup", "restore": "Restore",
            "confirmDeleteOption": "\"{v}\" dipakai di {n} project. Tetap hapus? Nilainya akan dihapus dari project-project tersebut."
        }
    })
}

// ---------- settings ----------

fn load_settings(conn: &Connection) -> Value {
    let get = |k: &str, fallback: &str| -> String {
        conn.query_row("SELECT value FROM config WHERE key = ?1", [k], |r| {
            r.get::<_, String>(0)
        })
        .unwrap_or_else(|_| fallback.to_string())
    };
    let theme = {
        let v = get("theme", "dark");
        if VALID_THEMES.contains(&v.as_str()) { v } else { "dark".into() }
    };
    let locale = {
        let v = get("locale", "en");
        if VALID_LOCALES.contains(&v.as_str()) { v } else { "en".into() }
    };
    let skin = {
        let v = get("skin", "base");
        if VALID_SKINS.contains(&v.as_str()) { v } else { "base".into() }
    };
    let bg_preset = {
        let v = get("bgPreset", BG_DEFAULT);
        if VALID_BG.contains(&v.as_str()) { v } else { BG_DEFAULT.into() }
    };
    let bg_custom = get("bgCustom", "");
    json!({ "theme": theme, "locale": locale, "skin": skin, "bgPreset": bg_preset, "bgCustom": bg_custom })
}

// ---------- commands ----------

#[tauri::command]
fn db_options(db: State<Db>) -> Value {
    with_conn(&db, load_options)
}

#[tauri::command]
fn db_option_usage(db: State<Db>, key: String, value: String) -> i64 {
    let Some(col) = option_to_column(&key) else { return 0 };
    with_conn(&db, |conn| {
        let sql = format!("SELECT {col} AS v FROM projects WHERE archived = 0");
        let Ok(mut stmt) = conn.prepare(&sql) else { return 0 };
        let Ok(rows) = stmt.query_map([], |r| r.get::<_, Option<String>>(0)) else { return 0 };
        let mut used = 0i64;
        for r in rows.flatten() {
            if let Some(v) = r {
                for item in parse_cats(Some(v)) {
                    if item == value {
                        used += 1;
                    }
                }
            }
        }
        used
    })
}

#[tauri::command]
fn db_option_delete(db: State<Db>, key: String, value: String) -> Value {
    with_conn(&db, |conn| {
        let row: Option<String> = conn
            .query_row("SELECT value FROM config WHERE key = ?1", [&key], |r| r.get(0))
            .ok();
        let arr = row
            .and_then(|v| serde_json::from_str::<Value>(&v).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        if !arr.iter().any(|v| v.as_str() == Some(value.as_str())) {
            return json!({ "ok": false, "error": "not in list" });
        }
        if protected_options(&key).contains(&value) {
            return json!({
                "ok": false, "error": "protected",
                "message": format!("\"{value}\" is a built-in default and cannot be deleted")
            });
        }
        let col = option_to_column(&key);
        let _ = conn.execute("BEGIN", []);
        let filtered: Vec<Value> = arr.into_iter().filter(|v| v.as_str() != Some(value.as_str())).collect();
        let _ = conn.execute(
            "UPDATE config SET value = ?1 WHERE key = ?2",
            params![serde_json::to_string(&filtered).unwrap(), key],
        );
        if let Some(col) = col {
            let sql = format!("SELECT id, {col} AS v FROM projects");
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(rows) = stmt.query_map([], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
                }) {
                    let now = now_iso();
                    let mut updates: Vec<(String, i64)> = vec![];
                    for r in rows.flatten() {
                        let (id, v) = r;
                        let items = parse_cats(v);
                        let filtered: Vec<String> = items.into_iter().filter(|x| x != &value).collect();
                        let next = if col == "status" || col == "rank" || col == "cost" || col == "wallet_app" {
                            filtered.first().cloned().unwrap_or_default()
                        } else {
                            serde_json::to_string(&filtered).unwrap()
                        };
                        updates.push((next, id));
                    }
                    let mut upd = conn
                        .prepare(&format!(
                            "UPDATE projects SET {col} = ?1, updated_at = ?2 WHERE id = ?3"
                        ))
                        .unwrap();
                    for (next, id) in updates {
                        let _ = upd.execute(params![next, now, id]);
                    }
                }
            }
        }
        let _ = conn.execute("COMMIT", []);
        json!({ "ok": true, "options": load_options(conn) })
    })
}

#[tauri::command]
fn db_option_add(db: State<Db>, key: String, value: String) -> Value {
    with_conn(&db, |conn| {
        let row: Option<String> = conn
            .query_row("SELECT value FROM config WHERE key = ?1", [&key], |r| r.get(0))
            .ok();
        let mut arr: Vec<Value> = row
            .and_then(|v| serde_json::from_str::<Value>(&v).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default();
        if !arr.iter().any(|v| v.as_str() == Some(value.as_str())) {
            arr.push(json!(value));
        }
        let _ = conn.execute(
            "INSERT INTO config(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(&arr).unwrap()],
        );
        load_options(conn)
    })
}

#[tauri::command]
fn db_option_set(db: State<Db>, key: String, arr: Value) -> Value {
    with_conn(&db, |conn| {
        if let Some(list) = arr.as_array() {
            let _ = conn.execute(
                "INSERT INTO config(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, serde_json::to_string(list).unwrap()],
            );
        }
        load_options(conn)
    })
}

#[tauri::command]
fn db_projects(db: State<Db>) -> Value {
    with_conn(&db, get_all_projects)
}

#[tauri::command]
fn db_project_get(db: State<Db>, id: i64) -> Option<Value> {
    with_conn(&db, |conn| get_project_full(conn, id))
}

#[tauri::command]
fn db_deadlines(db: State<Db>) -> Value {
    with_conn(&db, |conn| {
        let sql = "SELECT t.id, t.text, t.deadline, t.done, p.id AS pid, p.name AS pname, p.icon AS picon
                   FROM tasks t JOIN projects p ON p.id = t.project_id
                   WHERE t.deadline <> '' AND p.archived = 0
                   ORDER BY t.deadline ASC, t.id ASC";
        let Ok(mut stmt) = conn.prepare(sql) else { return json!([]) };
        let Ok(rows) = stmt.query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "text": r.get::<_, String>(1)?,
                "deadline": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "done": r.get::<_, i64>(3)? != 0,
                "pid": r.get::<_, i64>(4)?,
                "pname": r.get::<_, String>(5)?,
                "picon": r.get::<_, Option<String>>(6)?,
            }))
        }) else { return json!([]) };
        let mut out = vec![];
        for r in rows.flatten() {
            out.push(r);
        }
        json!(out)
    })
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct TaskInput {
    text: String,
    #[serde(deserialize_with = "de_opt_str")]
    deadline: Option<String>,
    done: Option<bool>,
    #[serde(deserialize_with = "de_opt_str")]
    url: Option<String>,
}

fn de_opt_str<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = Value::deserialize(d)?;
    Ok(match v {
        Value::Null => None,
        Value::String(s) => Some(s),
        other => Some(other.to_string()),
    })
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ProjectInput {
    id: Option<i64>,
    name: String,
    website: Option<String>,
    x_account: Option<String>,
    category: Option<Value>,
    network: Option<Value>,
    note: Option<String>,
    icon: Option<String>,
    done: Option<bool>,
    rank: Option<String>,
    cost: Option<String>,
    status: Option<String>,
    platform: Option<Value>,
    wallet_app: Option<String>,
    links: Option<Vec<LinkInput>>,
    wallets: Option<Vec<WalletInput>>,
    x_accounts: Option<Vec<Value>>,
    emails: Option<Vec<String>>,
    tasks: Option<Vec<TaskInput>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct LinkInput {
    url: Option<String>,
    label: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct WalletInput {
    address: Option<String>,
    label: Option<String>,
}

fn clean(v: &Option<String>) -> String {
    v.as_deref().unwrap_or("").trim().to_string()
}

#[tauri::command]
fn db_project_save(db: State<Db>, data: ProjectInput) -> Option<Value> {
    let now = now_iso();
    with_conn(&db, |conn| {
        let mut id = data.id.unwrap_or(0);
        let name = data.name.trim().to_string();
        let cats: Vec<String> = data
            .category
            .as_ref()
            .map(parse_cats_value)
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        let nets: Vec<String> = data
            .network
            .as_ref()
            .map(parse_cats_value)
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        let plats: Vec<String> = data
            .platform
            .as_ref()
            .map(parse_cats_value)
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect();
        let x_main = parse_x_username(&Value::String(data.x_account.clone().unwrap_or_default()));
        let icon = data.icon.as_deref().map(str::trim).filter(|s| !s.is_empty());

        let _ = conn.execute("BEGIN", []);

        if id > 0 {
            conn.execute(
                "UPDATE projects SET name=?1, website=?2, x_account=?3, category=?4, network=?5, note=?6, icon=?7, done=?8, rank=?9, cost=?10, chains=?11, status=?12, platform=?13, wallet_app=?14, updated_at=?15 WHERE id=?16",
                params![
                    name,
                    clean(&data.website),
                    x_main,
                    serde_json::to_string(&cats).unwrap(),
                    serde_json::to_string(&nets).unwrap(),
                    clean(&data.note),
                    icon,
                    if data.done.unwrap_or(false) { 1 } else { 0 },
                    clean(&data.rank),
                    clean(&data.cost),
                    "[]",
                    clean(&data.status),
                    serde_json::to_string(&plats).unwrap(),
                    clean(&data.wallet_app),
                    now,
                    id
                ],
            )
            .ok();
        } else {
            conn.execute(
                "INSERT INTO projects (name, website, x_account, category, network, note, icon, done, rank, cost, chains, status, platform, wallet_app, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    name,
                    clean(&data.website),
                    x_main,
                    serde_json::to_string(&cats).unwrap(),
                    serde_json::to_string(&nets).unwrap(),
                    clean(&data.note),
                    icon,
                    if data.done.unwrap_or(false) { 1 } else { 0 },
                    clean(&data.rank),
                    clean(&data.cost),
                    "[]",
                    clean(&data.status),
                    serde_json::to_string(&plats).unwrap(),
                    clean(&data.wallet_app),
                    now
                ],
            )
            .ok();
            id = conn.last_insert_rowid();
        }

        for t in ["links", "wallets", "x_accounts", "emails", "tasks"] {
            let _ = conn.execute(&format!("DELETE FROM {t} WHERE project_id = ?1"), [id]);
        }
        for l in data.links.unwrap_or_default() {
            let url = l.url.as_deref().unwrap_or("").trim().to_string();
            if url.is_empty() { continue; }
            let _ = conn.execute(
                "INSERT INTO links (project_id, url, label) VALUES (?1,?2,?3)",
                params![id, url, l.label.as_deref().unwrap_or("").trim()],
            );
        }
        for w in data.wallets.unwrap_or_default() {
            let addr = w.address.as_deref().unwrap_or("").trim().to_string();
            if addr.is_empty() { continue; }
            let _ = conn.execute(
                "INSERT INTO wallets (project_id, address, label) VALUES (?1,?2,?3)",
                params![id, addr, w.label.as_deref().unwrap_or("").trim()],
            );
        }
        for x in data.x_accounts.unwrap_or_default() {
            let u = parse_x_username(&x);
            if u.is_empty() { continue; }
            let _ = conn.execute(
                "INSERT INTO x_accounts (project_id, username) VALUES (?1,?2)",
                params![id, u],
            );
        }
        for m in data.emails.unwrap_or_default() {
            let em = m.trim().to_string();
            if em.is_empty() { continue; }
            let _ = conn.execute(
                "INSERT INTO emails (project_id, email) VALUES (?1,?2)",
                params![id, em],
            );
        }
        for t in data.tasks.unwrap_or_default() {
            let txt = t.text.trim().to_string();
            if txt.is_empty() { continue; }
            let mut dl = t.deadline.clone().unwrap_or_default().trim().to_string();
            if !dl.is_empty() {
                let ok_chars = dl.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'T' || c == ':');
                let ok_shape = if dl.len() == 10 {
                    true
                } else if dl.len() == 16 {
                    dl.as_bytes()[10] == b'T' && dl.as_bytes()[13] == b':'
                } else {
                    false
                };
                if !ok_chars || !ok_shape {
                    dl = String::new();
                }
            }
            let _ = conn.execute(
                "INSERT INTO tasks (project_id, text, deadline, done, url) VALUES (?1,?2,?3,?4,?5)",
                params![
                    id,
                    txt,
                    dl,
                    if t.done.unwrap_or(false) { 1 } else { 0 },
                    t.url.as_deref().unwrap_or("").trim()
                ],
            );
        }
        let _ = conn.execute("DELETE FROM tasks WHERE text = ''", []);
        let _ = conn.execute("DELETE FROM wallets WHERE address = ''", []);
        let _ = conn.execute("DELETE FROM x_accounts WHERE username = ''", []);
        let _ = conn.execute("DELETE FROM emails WHERE email = ''", []);
        let _ = conn.execute("DELETE FROM links WHERE url = ''", []);
        let _ = conn.execute("UPDATE projects SET updated_at = ?1 WHERE id = ?2", params![now, id]);
        let _ = conn.execute("COMMIT", []);

        get_project_full(conn, id)
    })
}

#[tauri::command]
fn db_project_delete(db: State<Db>, id: i64) -> bool {
    with_conn(&db, |conn| {
        conn.execute("DELETE FROM projects WHERE id = ?1", [id]).is_ok()
    })
}

#[tauri::command]
fn db_project_toggle(db: State<Db>, id: i64, done: bool) -> Option<Value> {
    with_conn(&db, |conn| {
        conn.execute(
            "UPDATE projects SET done = ?1, updated_at = ?2 WHERE id = ?3",
            params![if done { 1 } else { 0 }, now_iso(), id],
        )
        .ok();
        get_project_full(conn, id)
    })
}

#[tauri::command]
fn db_task_toggle(db: State<Db>, project_id: i64, task_id: i64, done: bool) -> Option<Value> {
    with_conn(&db, |conn| {
        conn.execute(
            "UPDATE tasks SET done = ?1 WHERE id = ?2 AND project_id = ?3",
            params![if done { 1 } else { 0 }, task_id, project_id],
        )
        .ok();
        conn.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now_iso(), project_id],
        )
        .ok();
        get_project_full(conn, project_id)
    })
}

#[tauri::command]
fn db_stats(db: State<Db>) -> Value {
    with_conn(&db, |conn| {
        let mut stmt = match conn.prepare("SELECT category, network, rank, done FROM projects WHERE archived = 0") {
            Ok(s) => s,
            Err(_) => return json!({ "total": 0, "done": 0, "networks": [], "categories": [], "ranks": [] }),
        };
        let rows = match stmt.query_map([], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_string(),
                r.get::<_, i64>(3)?,
            ))
        }) {
            Ok(r) => r,
            Err(_) => return json!({ "total": 0, "done": 0, "networks": [], "categories": [], "ranks": [] }),
        };
        let mut total = 0i64;
        let mut done = 0i64;
        let mut cat_count: std::collections::HashMap<String, i64> = Default::default();
        let mut net_count: std::collections::HashMap<String, i64> = Default::default();
        let mut rank_count: std::collections::HashMap<String, i64> = Default::default();
        for r in rows.flatten() {
            let (cat, net, rank, d) = r;
            total += 1;
            if d != 0 { done += 1; }
            for c in parse_cats(Some(cat.clone())) {
                *cat_count.entry(c).or_insert(0) += 1;
            }
            for c in parse_cats(Some(net.clone())) {
                *net_count.entry(c).or_insert(0) += 1;
            }
            if !rank.is_empty() {
                *rank_count.entry(rank).or_insert(0) += 1;
            }
        }
        let mut categories: Vec<Value> = cat_count
            .into_iter()
            .map(|(k, c)| json!({ "k": k, "c": c }))
            .collect();
        categories.sort_by_key(|v| -v["c"].as_i64().unwrap_or(0));
        let mut networks: Vec<Value> = net_count
            .into_iter()
            .map(|(k, c)| json!({ "k": k, "c": c }))
            .collect();
        networks.sort_by_key(|v| -v["c"].as_i64().unwrap_or(0));
        let ranks: Vec<Value> = RANK_ORDER
            .iter()
            .filter(|r| rank_count.contains_key(&r.to_string()))
            .map(|r| json!({ "k": r, "c": rank_count[*r] }))
            .collect();
        json!({ "total": total, "done": done, "networks": networks, "categories": categories, "ranks": ranks })
    })
}

// ---------- settings commands ----------

#[tauri::command]
fn db_settings_get(db: State<Db>) -> Value {
    with_conn(&db, load_settings)
}

#[tauri::command]
fn db_settings_set(db: State<Db>, patch: Value) -> Value {
    with_conn(&db, |conn| {
        let cur = load_settings(conn);
        let mut next = cur.clone();
        let obj = patch.as_object().cloned().unwrap_or_default();
        if let Some(t) = obj.get("theme").and_then(|v| v.as_str()) {
            if VALID_THEMES.contains(&t) { next["theme"] = json!(t); }
        }
        if let Some(l) = obj.get("locale").and_then(|v| v.as_str()) {
            if VALID_LOCALES.contains(&l) { next["locale"] = json!(l); }
        }
        if let Some(s) = obj.get("skin").and_then(|v| v.as_str()) {
            if VALID_SKINS.contains(&s) { next["skin"] = json!(s); }
        }
        if let Some(b) = obj.get("bgPreset").and_then(|v| v.as_str()) {
            if VALID_BG.contains(&b) { next["bgPreset"] = json!(b); }
        }
        if let Some(c) = obj.get("bgCustom").and_then(|v| v.as_str()) {
            next["bgCustom"] = json!(c);
        }
        for (k, v) in [
            ("theme", next["theme"].clone()),
            ("locale", next["locale"].clone()),
            ("skin", next["skin"].clone()),
            ("bgPreset", next["bgPreset"].clone()),
            ("bgCustom", next["bgCustom"].clone()),
        ] {
            let _ = conn.execute(
                "INSERT INTO config(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![k, v.as_str().unwrap_or("")],
            );
        }
        next
    })
}

#[tauri::command]
fn db_t() -> Value {
    strings()
}


// ---------- file dialogs via tauri-plugin-dialog (parented to window) ----------

fn pick_file(app: &AppHandle, title: &str) -> impl std::future::Future<Output = Option<String>> {
    let app = app.clone();
    let title = title.to_string();
    async move {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .pick_file(tx_send(tx));
    rx.await.unwrap_or(None)
    }
}

fn pick_db_file(app: &AppHandle, title: &str) -> impl std::future::Future<Output = Option<String>> {
    let app = app.clone();
    let title = title.to_string();
    async move {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Database", &["db"])
        .pick_file(tx_send(tx));
    rx.await.unwrap_or(None)
    }
}

fn save_file(app: &AppHandle, title: &str, default_name: &str) -> impl std::future::Future<Output = Option<String>> {
    let app = app.clone();
    let title = title.to_string();
    let default_name = default_name.to_string();
    async move {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter("Database", &["db"])
        .save_file(tx_send(tx));
    rx.await.unwrap_or(None)
    }
}

fn tx_send(tx: tokio::sync::oneshot::Sender<Option<String>>) -> impl FnOnce(Option<tauri_plugin_dialog::FilePath>) {
    move |fp: Option<tauri_plugin_dialog::FilePath>| {
        let _ = tx.send(fp.map(|p| p.to_string()));
    }
}

// ---------- dialogs ----------

fn copy_into_icons(app: &AppHandle, src: &str, prefix: &str) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("icons");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src_path = PathBuf::from(src);
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_else(|| ".png".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dst = dir.join(format!("{prefix}-{stamp}.{ext}"));
    fs::copy(&src_path, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
async fn dialog_pick_icon(app: AppHandle) -> Option<Value> {
    let picked = pick_file(&app, "Choose a project icon").await?;
    match copy_into_icons(&app, &picked, "icon") {
        Ok(dst) => Some(json!(dst)),
        Err(e) => Some(json!({ "error": e })),
    }
}

#[tauri::command]
async fn dialog_pick_bg(app: AppHandle) -> Option<Value> {
    let picked = pick_file(&app, "Choose a background image").await?;
    match copy_into_icons(&app, &picked, "bg") {
        Ok(dst) => Some(json!(dst)),
        Err(e) => Some(json!({ "error": e })),
    }
}

#[tauri::command]
fn db_project_icon(db: State<Db>, id: i64, icon_path: Option<String>) -> Option<Value> {
    with_conn(&db, |conn| {
        conn.execute(
            "UPDATE projects SET icon = ?1, updated_at = ?2 WHERE id = ?3",
            params![icon_path, now_iso(), id],
        )
        .ok();
        get_project_full(conn, id)
    })
}

#[tauri::command]
async fn db_backup(app: AppHandle, db: State<'_, Db>) -> Result<Value, String> {
    let Some(dst) = save_file(
        &app,
        "Backup database",
        &format!("airdrop-backup-{}.db", today_compact()),
    )
    .await else { return Ok(json!({ "ok": false, "canceled": true })) };
    let src = db_file(&app);
    // checkpoint WAL so the copied file is complete
    {
        let guard = db.0.lock().unwrap();
        if let Some(conn) = guard.as_ref() {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
    }
    Ok(match fs::copy(&src, &dst) {
        Ok(_) => json!({ "ok": true, "path": dst }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    })
}

#[tauri::command]
async fn db_restore(app: AppHandle, db: State<'_, Db>) -> Result<Value, String> {
    let Some(src) = pick_db_file(&app, "Restore database").await else {
        return Ok(json!({ "ok": false, "canceled": true }));
    };
    let dst = db_file(&app);
    // validate the incoming file opens as sqlite before swapping
    if let Err(e) = Connection::open(&src) {
        return Ok(json!({ "ok": false, "error": e.to_string() }));
    }
    // close current db, swap files, reopen + migrate
    {
        let mut guard = db.0.lock().unwrap();
        *guard = None; // drop connection
    }
    let tmp = dst.with_extension("db.incoming");
    if let Err(e) = fs::copy(&src, &tmp) {
        return Ok(json!({ "ok": false, "error": e.to_string() }));
    }
    if dst.exists() {
        let _ = fs::remove_file(&dst);
    }
    if let Err(e) = fs::rename(&tmp, &dst) {
        return Ok(json!({ "ok": false, "error": e.to_string() }));
    }
    // also remove stale wal/shm
    let _ = fs::remove_file(dst.with_extension("db-wal"));
    let _ = fs::remove_file(dst.with_extension("db-shm"));
    let _ = fs::remove_file(dst.with_extension("db.incoming-wal"));
    let _ = fs::remove_file(dst.with_extension("db.incoming-shm"));
    {
        let mut guard = db.0.lock().unwrap();
        let conn = open_db(&dst);
        migrate(&conn);
        *guard = Some(conn);
    }
    Ok(json!({ "ok": true, "path": src }))
}

fn today_compact() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let (y, m, d, _, _, _) = epoch_to_utc(now);
    format!("{y:04}-{m:02}-{d:02}")
}


// ---------- native confirm dialog ----------

#[tauri::command]
async fn confirm_dialog(app: AppHandle, message: String) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    app.dialog()
        .message(message)
        .title("SlaveDrop")
        .buttons(MessageDialogButtons::OkCancelCustom("Delete".to_string(), "Cancel".to_string()))
        .show(move |yes| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(yes);
            }
        });
    rx.await.unwrap_or(false)
}

// ---------- shell / clipboard ----------

#[tauri::command]
fn clipboard_write(text: String) -> bool {
    let mut clip = arboard::Clipboard::new().unwrap();
    clip.set_text(text).is_ok()
}

#[tauri::command]
fn shell_open(url: String) -> bool {
    let u = url.trim().to_string();
    if u.is_empty() {
        return false;
    }
    let target = if u.starts_with("http://") || u.starts_with("https://") {
        u
    } else {
        format!("https://{u}")
    };
    let _ = open::that(&target);
    true
}

#[tauri::command]
fn shell_x(username: String) -> bool {
    let name = parse_x_username(&Value::String(username));
    if name.is_empty() {
        return false;
    }
    let _ = open::that(format!("https://x.com/{name}"));
    true
}

#[tauri::command]
fn parse_x(v: Value) -> String {
    parse_x_username(&v)
}

// ---------- Electron DB auto-migration ----------

fn migrate_from_electron(conn: &Connection) {
    // Electron userData: ~/.config/slavedrop (Linux)
    let electron_db = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join(".config/slavedrop/airdrop.db"))
        .filter(|p| p.exists());
    let Some(electron_db) = electron_db else { return };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return; // already has data
    }

    eprintln!("[slavedrop-tauri] migrating Electron DB from {:?}", electron_db);
    let src = match Connection::open_with_flags(
        &electron_db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[slavedrop-tauri] electron db open failed: {e}");
            return;
        }
    };
    // safety: run migrate() on the source so its schema is current
    // (read-only open blocks that; instead open read-write but only if writable)
    let _ = src;

    // copy projects
    let mut copied = 0i64;
    if let Ok(mut stmt) = src.prepare("SELECT * FROM projects") {
        let ncols = stmt.column_count();
        let Ok(rows) = stmt.query([]) else { return };
        let mut rows = rows;
        // read all as serialized JSON strings via rusqlite's dynamic rows
        while let Ok(Some(row)) = rows.next() {
            let mut vals: Vec<String> = vec![];
            for i in 0..ncols {
                let v: String = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => String::new(),
                    Ok(rusqlite::types::ValueRef::Integer(n)) => n.to_string(),
                    Ok(rusqlite::types::ValueRef::Real(f)) => f.to_string(),
                    Ok(rusqlite::types::ValueRef::Text(t)) => {
                        String::from_utf8_lossy(t).to_string()
                    }
                    Ok(rusqlite::types::ValueRef::Blob(b)) => {
                        String::from_utf8_lossy(b).to_string()
                    }
                    Err(_) => String::new(),
                };
                vals.push(v);
            }
            let _ = conn.execute(
                "INSERT INTO projects (id, name, website, x_account, category, network, note, icon, done, archived, rank, cost, chains, status, platform, wallet_app, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
                rusqlite::params_from_iter(vals.iter()),
            );
            copied += 1;
        }
    }
    // copy child tables
    for table in ["links", "wallets", "x_accounts", "emails", "tasks"] {
        let Ok(mut stmt) = src.prepare(&format!("SELECT * FROM {table}")) else { continue };
        let ncols = stmt.column_count();
        let Ok(rows) = stmt.query([]) else { continue };
        let mut rows = rows;
        while let Ok(Some(row)) = rows.next() {
            let mut vals: Vec<String> = vec![];
            for i in 0..ncols {
                let v: String = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => String::new(),
                    Ok(rusqlite::types::ValueRef::Integer(n)) => n.to_string(),
                    Ok(rusqlite::types::ValueRef::Real(f)) => f.to_string(),
                    Ok(rusqlite::types::ValueRef::Text(t)) => String::from_utf8_lossy(t).to_string(),
                    Ok(rusqlite::types::ValueRef::Blob(b)) => String::from_utf8_lossy(b).to_string(),
                    Err(_) => String::new(),
                };
                vals.push(v);
            }
            let placeholders: Vec<String> = (1..=ncols).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "INSERT OR IGNORE INTO {table} VALUES ({})",
                placeholders.join(",")
            );
            let _ = conn.execute(&sql, rusqlite::params_from_iter(vals.iter()));
        }
    }
    // copy config (settings + option lists)
    if let Ok(mut stmt) = src.prepare("SELECT key, value FROM config") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for r in rows.flatten() {
                let (k, v) = r;
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO config(key, value) VALUES(?1, ?2)",
                    params![k, v.unwrap_or_default()],
                );
            }
        }
    }
    // fix sqlite sequence so new inserts don't collide
    let _ = conn.execute_batch(
        "DELETE FROM sqlite_sequence WHERE name IN ('projects','links','wallets','x_accounts','emails','tasks');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'projects', IFNULL((SELECT MAX(id) FROM projects), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='projects');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'links', IFNULL((SELECT MAX(id) FROM links), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='links');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'wallets', IFNULL((SELECT MAX(id) FROM wallets), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='wallets');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'x_accounts', IFNULL((SELECT MAX(id) FROM x_accounts), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='x_accounts');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'emails', IFNULL((SELECT MAX(id) FROM emails), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='emails');
         INSERT INTO sqlite_sequence(name, seq) SELECT 'tasks', IFNULL((SELECT MAX(id) FROM tasks), 0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='tasks');",
    );
    eprintln!("[slavedrop-tauri] migrated {copied} projects from Electron DB");
}


pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = db_file(&app.handle());
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let conn = open_db(&path);
            migrate(&conn);
            migrate_from_electron(&conn);
            app.manage(Db(Mutex::new(Some(conn))));
            // QA/testing hook: navigate webview with a hash (e.g. SD_QA_HASH="#detail=2")
            if let Ok(hash) = std::env::var("SD_QA_HASH") {
                if let Some(win) = app.get_webview_window("main") {
                    let full = format!("tauri://localhost/index.html{hash}");
                    if let Ok(u) = tauri::Url::parse(&full) {
                        let _ = win.navigate(u);
                    }
                }
            }
            // QA/testing hook: force window size (SD_QA_W x SD_QA_H logical) or maximized (SD_QA_MAX=1)
            if let Some(win) = app.get_webview_window("main") {
                if std::env::var("SD_QA_MAX").is_ok() {
                    let _ = win.maximize();
                } else if let (Ok(w), Ok(h)) = (std::env::var("SD_QA_W"), std::env::var("SD_QA_H")) {
                    if let (Ok(w), Ok(h)) = (w.parse::<f64>(), h.parse::<f64>()) {
                        let _ = win.unmaximize();
                        let _ = win.set_size(tauri::LogicalSize::new(w, h));
                    }
                }
            }
            Ok(())
    })
        .invoke_handler(tauri::generate_handler![
            db_options,
            db_option_usage,
            db_option_delete,
            db_option_add,
            db_option_set,
            db_projects,
            db_project_get,
            db_deadlines,
            db_project_save,
            db_project_delete,
            db_project_toggle,
            db_task_toggle,
            db_stats,
            db_settings_get,
            db_settings_set,
            db_t,
            dialog_pick_icon,
            dialog_pick_bg,
            db_project_icon,
            db_backup,
            db_restore,
            clipboard_write,
            shell_open,
            shell_x,
            parse_x,
            confirm_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
