# ⚡ WhoseTab

> **Never lose track of who you bought what for.**  
> A high-performance, offline-first peer expense manager and Paytm logger built in **Rust** for mobile and desktop.

---

## 🎯 The Problem

When purchasing groceries, lab supplies, food, cab rides, or stationery for **roommates, classmates, and friends**, tracking debts via WhatsApp is a nightmare:
- **Disputed calculations** — mental math and WhatsApp message threads always go wrong.
- **Cluttered chats** — group chats get bogged down with "Hey, you owe me ₹120 for samosas" and "Paid ₹340 for wifi".
- **Forgotten purchases** — you pay at the counter with Paytm or UPI, walk away, and forget to log who it was actually for.

---

## 🚀 The Solution: WhoseTab

**WhoseTab** is built from the ground up to solve this in under **2 seconds**:
1. **Paytm Payment Intent / Snapper**: Right after paying via Paytm, the paid amount automatically pre-fills in WhoseTab via deep-link (`whosetab://snap?amount=...`), clipboard detection, or the Android Share sheet.
2. **One-Tap "Who was this for?" Picker**: Tap your roommate or classmate's chip, choose whether it was **100% for them** or **Split 50/50**, and tap **Save to Tab**. Done!
3. **Rust Core Performance**: Built in Rust for sub-millisecond calculation speeds, zero lag, zero battery drain, and graph-based debt minimization.
4. **100% Offline Storage**: All data stays private on your device in persistent local storage with zero cloud dependence.
5. **Generic Dark Theme Default + White Mode Toggle**: Follows system default, with an instant toggle in settings and in the top header.
6. **Mobile HIG & Material 3 Compliant**:
   - Safe Area Insets (notch, status bar, and gesture navigation bar).
   - 16dp standard horizontal margin on mobile screens.
   - 8dp spacing grid system.
   - Minimum 48x48dp touch targets on all interactive chips, buttons, and form inputs.
   - Thumb-friendly bottom navigation.

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
│   ├── app.js                    # Offline ledger logic, clipboard sniffer, deep link
│   └── manifest.json             # PWA manifest with Android share target
├── android/                      # Native Android integration files
│   ├── AndroidManifest.xml       # Deep link (whosetab://), ACTION_SEND, Notification listener
│   └── PaytmNotificationService.java # Background listener for Paytm (net.one97.paytm)
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

## 📱 Mobile App Features

### 1. Direct Paytm Integration
- **Deep Link URL**: `whosetab://snap?amount=340&to=Sharma%20Kirana&note=Groceries`
- **Android Share Target**: When paying on Paytm, tap "Share Receipt" and select **WhoseTab** from the Android share sheet.
- **Smart Clipboard Sniffer**: Automatically checks clipboard on app focus for copied Paytm SMS text or UPI confirmations and pops up a quick snap banner.
- **Paytm Simulation Strip**: One-tap demo buttons (`₹340 Groceries`, `₹120 Canteen`, `₹450 Xerox`) to test the flow instantly.

### 2. Design & Mobile Guidelines
- **Margins & Alignment**:
  - Horizontal screen margins: **16dp** padding.
  - Spacing grid: **8dp** base spacing.
  - Touch targets: Every button, tab, and chip has a minimum touch bounding box of **48x48dp**.
  - Safe Areas: Respects top notch/island (`env(safe-area-inset-top)`) and bottom gesture home bar (`env(safe-area-inset-bottom)`).
- **Theme Modes**:
  - **Dark Theme (Default)**: Deep `#0B0F19` background, `#141C2E` surfaces, `#2A374D` subtle borders, emerald accents for balances.
  - **White Mode (Light)**: Clean `#F8FAFC` background, pure `#FFFFFF` cards, high-contrast text.
  - **System Default**: Automatically synchronizes with your device's dark/light schedule.

---

## 🔐 GitHub PAT Setup & Updates

This private repository is configured for token-based Git operations. To update or refresh your GitHub Personal Access Token (PAT) for this repository:

### Windows (PowerShell):
```powershell
.\scripts\update-pat.ps1
```
Or with an inline token:
```powershell
.\scripts\update-pat.ps1 -Token "ghp_yourPersonalAccessTokenHere"
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
