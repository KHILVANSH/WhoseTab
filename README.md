# ⚡ WhoseTab

> **Never lose track of who you bought what for.**  
> A high-performance, offline-first peer expense manager and Paytm logger built in **Rust** and native Android.

[![Release](https://img.shields.io/github/v/release/KHILVANSH/WhoseTab?label=Release&color=3B82F6)](https://github.com/KHILVANSH/WhoseTab/releases)
[![Rust](https://img.shields.io/badge/Rust-1.100-orange.svg)](https://www.rust-lang.org/)
[![Android](https://img.shields.io/badge/Android-APK_v1.0.0-green.svg)](https://github.com/KHILVANSH/WhoseTab/releases/tag/v1.0.0)

---

## 🎯 The Problem

When purchasing groceries, lab supplies, canteen snacks, cab rides, or stationery for **roommates, classmates, and friends**, tracking debts via WhatsApp is a nightmare:
- **Disputed calculations** — mental math and WhatsApp message threads always go wrong.
- **Cluttered chats** — group chats get bogged down with "Hey, you owe me ₹120 for samosas" and "Paid ₹340 for wifi".
- **Forgotten purchases** — you pay at the counter with Paytm or UPI, walk away, and forget to log who it was actually for.

---

## 🚀 The Solution: WhoseTab

**WhoseTab** solves this in under **2 seconds**:
1. **Paytm Payment Snapper**: When you pay on Paytm, WhoseTab automatically detects the payment and brings the app right to the foreground with the amount pre-filled.
2. **Configurable Open Delay**: Option in Settings to choose the launch behavior:
   - ⚡ **Instant (No delay, 0s)**
   - ⏱️ **Slight delay (1 second)**
   - ⏱️ **2 seconds / 3 seconds / 5 seconds**
3. **One-Tap "Who was this for?" Picker**: Tap your roommate or classmate's chip, choose whether it was **100% for them** or **Split 50/50**, and tap **Save to Tab**. Done!
4. **In-App Auto-Updates from GitHub**: The app checks the private GitHub repository (`KHILVANSH/WhoseTab/releases`) for new APK releases and downloads/installs updates directly on your phone with one tap.
5. **Rust Core Performance**: Built in Rust for sub-millisecond calculation speeds, zero lag, zero battery drain, and graph-based debt minimization.
6. **100% Offline Storage**: All data stays private on your device in persistent local storage with zero cloud dependence.
7. **Generic Dark Theme Default + White Mode Toggle**: Follows system default, with an instant toggle in settings and in the top header.
8. **Mobile HIG & Material 3 Compliant**:
   - Safe Area Insets (notch, status bar, and gesture navigation bar).
   - 16dp standard horizontal margin on mobile screens.
   - 8dp spacing grid system.
   - Minimum 48x48dp touch targets on all interactive chips, buttons, and form inputs.
   - Thumb-friendly bottom navigation.

---

## 📥 Download Release APK

The signed, release APK is compiled and ready:
- **Direct file**: [`releases/WhoseTab-v1.0.0.apk`](releases/WhoseTab-v1.0.0.apk)
- **GitHub Release Page**: [https://github.com/KHILVANSH/WhoseTab/releases/tag/v1.0.0](https://github.com/KHILVANSH/WhoseTab/releases/tag/v1.0.0)

To install on your phone:
```bash
adb install -r "releases/WhoseTab-v1.0.0.apk"
```

---

## ⚙️ Android Permissions (For Auto-Opening after Paytm)

To allow WhoseTab to launch right after completing a payment in Paytm, open **Settings** inside the app and tap:
1. **Notification Access** (`Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`): Allows `PaytmNotificationListenerService` to detect transactions from `net.one97.paytm`.
2. **Draw Over Other Apps / Overlay** (`Settings.ACTION_MANAGE_OVERLAY_PERMISSION`): Allows Android to bring WhoseTab directly over Paytm without Android OS background activity restrictions.

---

## 📁 Project Architecture

```
WhoseTab/
├── Cargo.toml                    # Root Rust workspace
├── crates/
│   └── whosetab-core/            # Rust core engine
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs            # Public exports
│           ├── models.rs         # Person, Expense, Settlement, Relationship models
│           ├── debt_simplifier.rs# Graph debt minimization algorithm
│           ├── paytm_parser.rs   # Regex parser for Paytm/UPI SMS & receipts
│           └── storage.rs        # Atomic offline JSON storage manager
├── whosetab-cli/                 # Command-line utility for instant terminal logging
│   ├── Cargo.toml
│   └── src/main.rs               # CLI commands (demo, snap, parse, summary, settle)
├── mobile/                       # Mobile-optimized application UI
│   ├── index.html                # Responsive mobile viewport with Safe Area insets
│   ├── style.css                 # Generic dark theme, white mode toggle, 8dp grid
│   ├── app.js                    # Offline ledger logic, clipboard sniffer, delay settings
│   └── manifest.json             # PWA manifest with Android share target
├── android/                      # Standalone Native Android Gradle Project
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradle.properties
│   └── app/
│       ├── build.gradle          # Signed Release build configuration
│       ├── keystore.jks          # Release signing keystore
│       └── src/main/
│           ├── AndroidManifest.xml # Intent filters, permissions, FileProvider
│           ├── java/com/khilvansh/whosetab/
│           │   ├── MainActivity.java
│           │   ├── PaytmNotificationListenerService.java
│           │   ├── UpdateManager.java
│           │   └── WebAppInterface.java
│           └── assets/web/       # Embedded offline assets
├── releases/
│   └── WhoseTab-v1.0.0.apk       # Compiled release APK
└── scripts/
    ├── update-pat.ps1            # Windows PowerShell GitHub PAT configuration helper
    └── update-pat.sh             # Linux/macOS GitHub PAT configuration helper
```

---

## ⚡ Rust CLI Quickstart

The workspace includes a native Rust CLI (`whosetab-cli`) to inspect and manage your offline ledger directly from the terminal:

```bash
# Run unit tests across all crates
cargo test --workspace

# Seed demo roommates, classmates, and expenses
cargo run --bin whosetab-cli -- demo

# View ledger balance summary
cargo run --bin whosetab-cli -- summary

# Parse a Paytm notification / SMS text
cargo run --bin whosetab-cli -- parse "Paid ₹350 to Sharma Groceries successfully via Paytm. Txn ID: PT192837482"

# Snap an expense to a friend in one command
cargo run --bin whosetab-cli -- snap 350 "Aman Verma" "Sharma Groceries"

# Record a settlement received
cargo run --bin whosetab-cli -- settle "Aman Verma" 350
```

---

## 🔐 GitHub PAT Setup & Updates

This private repository is configured for token-based Git operations. To update or refresh your GitHub Personal Access Token (PAT) for this repository:

### Windows (PowerShell):
```powershell
.\scripts\update-pat.ps1
```

### Linux / macOS / Git Bash:
```bash
chmod +x scripts/update-pat.sh
./scripts/update-pat.sh
```

---

## 🛡️ Privacy & Offline Guarantee

- **Zero Cloud Dependence**: Everything is saved to your device's local persistent storage (`localStorage` / local JSON).
- **Zero Tracking**: No external analytics, trackers, or telemetries.
- **Backup & Restore**: Export your complete ledger to JSON anytime with one click in Settings, or restore it on any new device.
