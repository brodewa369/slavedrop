<div align="center">
<img src="src-tauri/icons/icon.png" width="128" height="128" alt="SlaveDrop logo">

# SlaveDrop

**Local-first airdrop farming tracker.** Everything is stored on your machine — nothing leaves it.

[Build from source](#-build-from-source) · [Features](#-features) · [Your data](#-your-data) · [Migrating from Electron](#-migrating-from-electron) · [License](#-license)

</div>

---

**SlaveDrop** is a desktop app for airdrop farmers. It tracks every project you're farming — ranks, statuses, deadlines, the wallets and accounts you use for each, and your daily progress — in one place, on your own computer. No accounts, no servers, no telemetry. Just a single SQLite file you fully control.

> **v2 — now built with [Tauri](https://tauri.app).** Same UI, same data format, same zero-network guarantee, but the Electron runtime is gone: the app is one ~7 MB Rust binary using the system webview. The previous Electron implementation is preserved on the [`electron` branch](../../tree/electron).

## ✦ Why SlaveDrop

- **One dashboard for every farm.** Every project, its rank, status, chains, wallets, and tasks — in one window instead of scattered across tabs and notes.
- **Never miss a deadline.** A monthly calendar marks every task deadline across all projects, with a "this month" list that highlights what's overdue.
- **Know your daily output.** The daily progress strip tells you exactly how many projects you've fully completed today — driven by per-task checkboxes, not a manual toggle.
- **Your data is yours.** No signup, no login, no cloud sync, no analytics. The database is a plain file at a known path — back it up, copy it, delete it, it's yours.
- **Works offline.** Nothing phones home. The only network access is when you click a link, and that's handed to your own browser.

## ✦ Build from source

Needs [Git](https://git-scm.com) and [Rust](https://rustup.rs) (stable). On Linux you also need the Tauri v2 webview stack — on Arch/CachyOS:

```bash
sudo pacman -S webkit2gtk-4.1 gst-plugins-good gst-plugin-glsink
```

```bash
git clone https://github.com/brodewa369/slavedrop.git
cd slavedrop
./run.sh                 # dev mode (cargo run)
cargo build --release    # -> src-tauri/target/release/slavedrop
```

**Install on Linux (XDG desktops)** — binary + app-menu entry:

```bash
install -Dm755 src-tauri/target/release/slavedrop ~/.local/bin/slavedrop
install -Dm644 src-tauri/icons/32x32.png   ~/.local/share/icons/hicolor/32x32/apps/slavedrop.png
install -Dm644 src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/slavedrop.png
install -Dm644 src-tauri/icons/icon.png    ~/.local/share/icons/hicolor/512x512/apps/slavedrop.png

cat > ~/.local/share/applications/com.brodewa.slavedrop.desktop <<EOF
[Desktop Entry]
Type=Application
Name=SlaveDrop
Comment=Minimalist local airdrop farming tracker — your data never leaves your machine
Exec=$HOME/.local/bin/slavedrop
Icon=slavedrop
Terminal=false
Categories=Office;
StartupWMClass=slavedrop
StartupNotify=true
EOF

update-desktop-database ~/.local/share/applications
```

**Windows and macOS** build with the standard [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) — the maintainer only runs Linux, so no prebuilt binaries are published for those platforms.

## ✦ Your data

- Linux: `~/.local/share/com.brodewa.slavedrop/airdrop.db`
- One plain SQLite file. Back it up, copy it, delete it — it's yours.
- Nothing in the app opens a network connection except handing link clicks to your browser.

## ✦ Migrating from Electron

On first launch, if the Tauri database is empty and the old Electron database exists (`~/.config/slavedrop/airdrop.db`), every project, task, and setting is migrated automatically. Install the Tauri build, run it once, verify your data, then remove the Electron app.

## ✦ Platform notes

- **Linux (Wayland):** window decorations are provided by your compositor. A small vendored patch of [`tao`](vendor/tao) skips tao's fallback client-side headerbar when decorations are enabled, so the app gets the same native titlebar as every other window (KWin, Sway, …). X11, Windows, and macOS use stock `tao`.
- **Prebuilt installers:** not published for the Tauri build yet — anything on the Releases page currently predates the port.

## ✦ License

[MIT](LICENSE) © brodewa
