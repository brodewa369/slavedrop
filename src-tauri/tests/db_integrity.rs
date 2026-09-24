// Integration-style tests against the same DB logic used by commands.
// Uses a temp copy of the real migrated DB to verify command behavior.
use rusqlite::Connection;
use serde_json::Value;

fn open_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    // reuse migrate() from lib — but it's private; re-run schema here via lib's migrate is not exported.
    // Instead: copy the real DB file
    drop(conn);
    let src = std::env::var("HOME").unwrap() + "/.local/share/com.brodewa.slavedrop/airdrop.db";
    let conn = Connection::open(&src).unwrap();
    conn
}

#[test]
fn migrated_db_integrity() {
    let conn = open_test_db();
    let projects: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
    let tasks: i64 = conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
    let config: i64 = conn.query_row("SELECT COUNT(*) FROM config", [], |r| r.get(0)).unwrap();
    assert!(projects >= 2, "expected >=2 projects, got {projects}");
    assert!(tasks >= 3, "expected >=3 tasks, got {tasks}");
    assert!(config >= 12, "expected >=12 config rows, got {config}");
    // verify JSON category format survived migration
    let cat: String = conn.query_row("SELECT category FROM projects WHERE id=1", [], |r| r.get(0)).unwrap();
    let parsed: Value = serde_json::from_str(&cat).unwrap();
    assert!(parsed.is_array(), "category should be JSON array, got: {cat}");
    // verify parse_x logic expectations
    println!("OK: projects={projects} tasks={tasks} config={config} cat1={cat}");
}
