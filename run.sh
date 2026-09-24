#!/usr/bin/env bash
# SlaveDrop (Tauri) — dev launcher
cd "$(dirname "$0")"
exec cargo tauri dev 2>/dev/null || (cd src-tauri && exec cargo run)
