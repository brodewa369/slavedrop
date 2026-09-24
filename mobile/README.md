# SlaveDrop — Android

The mobile build of [SlaveDrop](../): the same local-first airdrop tracker as the
desktop app, wrapped in an Android WebView shell with mobile-specific UI
(single-column cards, hold-to-delete tags, system browser chooser for links,
full-screen drawers).

## Downloads

| APK | Use it for |
|---|---|
| [`releases/SlaveDrop-android-1.0.0-debug.apk`](./releases/SlaveDrop-android-1.0.0-debug.apk) | Daily testing — installs over any previous debug build |
| [`releases/SlaveDrop-android-1.0.0-release.apk`](./releases/SlaveDrop-android-1.0.0-release.apk) | Normal use — non-debuggable, same signing key as debug (they upgrade each other, no data loss) |

GitHub Releases mirror the same APKs under tag
[`android-v1.0.0`](../../releases/tag/android-v1.0.0).

Enable *Install unknown apps* for your file manager/browser, then open the APK.

## Build from source

Prerequisites: JDK 17, Android SDK (API 33), the web assets in
`android/app/src/main/assets/www/`.

```bash
# 1. sync the web app into the Android assets (run after every www/ change)
rsync -a www/ android/app/src/main/assets/www/

# 2. build
cd android
./gradlew assembleDebug assembleRelease
# outputs: app/build/outputs/apk/{debug,release}/
```

Sign the release APK with your own keystore (`apksigner sign --ks ...`) — the
committed release APK in `releases/` was signed with the maintainer's key.

## Layout

```
mobile/
├── www/          # web app (fork of ../ui + mobile.css/mobile.js/mobile-capacitor.js)
├── android/      # Gradle project (package com.slavedrop.app, minSdk 21)
├── harness/      # desktop test harness for the mock API (npm i && npm start)
├── mdebug.py     # CDP debug helper (headless Chromium)
└── releases/     # prebuilt APKs
```

`www/` is the source of truth — never edit `android/app/src/main/assets/www/`
directly; it is a generated copy (gitignored) refreshed by the `rsync` step.

## Desktop

Linux / macOS / Windows builds live at the repository root (Tauri v2) — see the
[main README](../).
