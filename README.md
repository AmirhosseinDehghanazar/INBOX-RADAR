<div align="center">


<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=3B82F6&center=true&vCenter=true&width=600&lines=Inbox+Radar+v2.0;Gmail+%E2%86%92+Telegram+in+5+Minutes;Zero+Infra+%C2%B7+Zero+Dependencies;Rule-based+Intelligent+Filtering" alt="Typing SVG" />

<br/>

[![Made with Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://script.google.com)
[![Telegram Bot API](https://img.shields.io/badge/Telegram%20Bot%20API-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-10D9A0?style=for-the-badge)]()

<br/>

   👉 [LIVE DOCUMENT TO LEARN MORE AND BE UPDATED](https://amirhosseindehghanazar.github.io/INBOX-RADAR) 

   
> **Transform your Gmail inbox into an intelligent Telegram notification feed.**  
> Filters. Deduplicates. Prioritizes. Ships alerts in seconds.  
> No servers. No databases. No bills. Just paste and go.

<br/>

---

</div>

## ⚡ What Is This?

**Inbox Radar** is a production-grade Gmail monitoring system that runs **entirely inside Google Apps Script** — meaning it lives inside Google's own infrastructure for free, forever.

Every few minutes it wakes up, scans your Gmail for unread messages, passes each one through a configurable rule engine, formats it into a clean Telegram message, and delivers it to your phone. Duplicates are tracked. Rules are hot-swappable. A daily digest summarizes everything you missed.

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────┐
│  Gmail API  │────▶│ emailFetcher │────▶│ ruleEngine │────▶│  formatter   │────▶│ Telegram │
│  GmailApp   │     │  + dedupe    │     │ 6 built-in │     │  Markdown    │     │  Bot API │
└─────────────┘     └──────────────┘     └────────────┘     └──────────────┘     └──────────┘
                           │                                                            │
                    ┌──────────────┐                                          ┌──────────────────┐
                    │ PropertiesKV │                                          │  Your Phone 📱   │
                    │  (dedupe DB) │                                          │  Telegram Chat   │
                    └──────────────┘                                          └──────────────────┘
```

<br/>

---

## 🔥 Features

| Feature | Details |
|---|---|
| **🧠 Smart Rule Engine** | 6 built-in priority tiers (Critical → Low). Add your own rules as plain JSON |
| **🔁 Deduplication** | Persistent ID store (cap 2,000). Never sends the same email twice |
| **⚡ Retry + Rate Limiting** | 3× retry with exponential backoff + Telegram 429 auto-wait |
| **📊 Daily Digest** | Optional morning summary of everything from the past 24h |
| **🔇 Silent Rules** | Newsletters tracked but never trigger a ping |
| **🔍 Toggle Debug** | One function call to flip verbose logging on/off — no deploys |
| **🔒 Secure by Design** | Credentials stored encrypted in Script Properties, never in source |
| **♾️ Free Forever** | Google Apps Script quota is generous — zero infra cost |

<br/>

---
   👉 [LIVE DOCUMENT TO LEARN MORE AND BE UPDATED](https://amirhosseindehghanazar.github.io/INBOX-RADAR) 

## 🚀 Quick Start (6 Steps, ~5 Minutes)

### Step 1 — Create a Telegram Bot

Message [@BotFather](https://t.me/BotFather) on Telegram:

```
/newbot
→ Name it whatever you like
→ Copy the API token: 123456:ABCdef...
```

### Step 2 — Get Your Chat ID

Send any message to your new bot, then visit:

```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

Look for `"chat": {"id": 987654321}` — that number is your Chat ID.

### Step 3 — Open Google Apps Script

Go to **[script.google.com](https://script.google.com)** → New project → paste the full `InboxRadar.gs` file → save as **"Inbox Radar"**.

### Step 4 — Initialize

In the Apps Script editor, run the `setup` function — **pass your credentials as arguments, never hardcode them in source:**

```javascript
setup("123456:ABCdef...", "987654321")
```

Grant the Gmail and URL Fetch permissions when prompted.

### Step 5 — Install Triggers

```javascript
installTriggers(5, 8)
// ↑ Scan every 5 minutes + send daily digest at 8:00 AM
```

### Step 6 — Verify

```javascript
sendTestNotification()
// ✅ You should receive a Telegram message within seconds
```

<br/>

---

## 📋 Alert Format

Every matched email arrives like this:

```
🔐 INBOX RADAR ALERT

🏷 Type: OTP & Security
⚡ Priority: 🚨 CRITICAL

👤 From: security@github.com
📌 Subject: Your GitHub login code

🧠 Preview:
Your one-time authentication code is 847291. It
expires in 15 minutes. If you didn't request this...

⏱ Time: Apr 28, 2026 · 14:32

─────────────────────
Sent by Inbox Radar
```

<br/>

---

## ⚙️ Rule Engine

Rules are evaluated **top to bottom** — first match wins. Within each rule, conditions are AND-ed between groups, OR-ed within a group.

### Built-in Rules

| # | Rule | Priority | Silent | Triggers On |
|---|------|----------|--------|-------------|
| 1 | 🔐 OTP & Security | CRITICAL | No | `otp`, `2fa`, `verification code`, `login code` in subject |
| 2 | 💳 Finance & Banking | HIGH | No | `invoice`, `payment`, `receipt` / PayPal, Stripe, Revolut in from |
| 3 | 💼 Jobs & Recruiting | HIGH | No | `interview`, `offer letter` / LinkedIn, Greenhouse in from |
| 4 | 📦 SaaS & Subscriptions | MEDIUM | No | `trial ending`, `plan renewal` / `expires` in body |
| 5 | 📅 Calendar & Meetings | MEDIUM | No | `meeting`, `zoom`, `google meet` in subject |
| 6 | 📰 Newsletters | LOW | **Yes** | `unsubscribe` in body / newsletter domains in from |
| — | 📩 General (fallback) | LOW | No | Everything else |

### Add Your Own Rules

```javascript
const myRules = JSON.stringify([
  {
    name: "Boss Emails",
    emoji: "🎯",
    conditions: {
      fromContains:    ["boss@company.com"],
      subjectContains: [],
      keywordContains: []
    },
    priority: "critical",
    silent: false
  },
  // ... other rules
]);

setRules(myRules);
```

<br/>

---

## 🎛 Full Public API

```javascript
// ── Setup ─────────────────────────────────────────────────────────
setup("BOT_TOKEN", "CHAT_ID")       // Initialize + verify bot connection
installTriggers(5, 8)               // 5-min watcher + 8am daily digest
sendTestNotification()              // Verify pipeline end-to-end

// ── Control ───────────────────────────────────────────────────────
enable()  /  disable()              // Pause without removing triggers
toggleDebug()                       // Verbose logging on/off
status()                            // Full health check report

// ── Rules ─────────────────────────────────────────────────────────
setRules(rulesJson)                 // Replace active rules (validates first)
getRules()                          // Print current rules to log

// ── Maintenance ───────────────────────────────────────────────────
reset()                             // Wipe all config + triggers
clearDedupeStore()                  // Allow re-processing old emails
setScanQuery("is:unread label:vip") // Custom Gmail search query
setMaxBatch(30)                     // Emails per run (default: 20)
```

<br/>

---

## 🏗 Architecture

```
InboxRadar.gs
│
├── configManager      Script Properties KV store — all config lives here
│   └── initialize()   Stores credentials, defaults, and initial rules
│
├── dedupeStore        Persistent Set of processed message IDs (cap: 2,000)
│   └── snapshot()     Single-read performance optimization (Bug #5 fix)
│
├── emailFetcher       GmailApp.search() → thread/message walker
│   ├── fetch()        Returns array of {id, from, subject, bodyPreview, ...}
│   └── markAsRead()   Batch marks successfully processed messages
│
├── ruleEngine         Evaluates rules against each email
│   ├── match()        Returns first matching rule or fallback "General"
│   └── validate()     Throws on malformed rule JSON before saving
│
├── formatter          Builds Telegram Markdown strings
│   ├── build()        Per-email alert format
│   └── buildDigest()  Daily summary format (plain dots, not MarkdownV2)
│
├── telegramSender     UrlFetchApp → Telegram Bot API
│   ├── send()         3× retry, 429 backoff, 4096-char truncation
│   └── testConnection() getMe validation call
│
├── scheduler          ScriptApp time-based trigger management
│   ├── installWatcherTrigger()
│   └── installDailyDigestTrigger()
│
├── digestEngine       Day-cache accumulator → morning summary sender
│
├── debugLogger        Leveled logging (INFO/WARN/ERROR/DEBUG)
│
└── controlPanel       Public functions callable from the editor
```

<br/>

---

## 🐛 Bugs Fixed in v2.0

Five bugs were identified and corrected from v1:

| Severity | Location | Issue | Fix |
|----------|----------|-------|-----|
| 🔴 Critical | `CONFIG_KEYS` | Token/ChatID stored as key *names* — broke all PropertiesService I/O | Changed to plain string key names |
| 🟠 High | `emailFetcher._parseMessage` | Wrong Gmail API: called `GmailThread` methods on a `GmailMessage` | Rewritten with correct `(msg, thread)` signature |
| 🔵 Medium | `configManager.isEnabled` | `null === "true"` silently returned `false` before `setup()` | Added explicit null guard |
| 🔵 Medium | `formatter.buildDigest` | MarkdownV2 escape `\.` inside legacy Markdown mode → literal backslash | Removed escape — plain dots are correct |
| 🟢 Perf | `dedupeStore` in fetch loop | N × PropertiesService reads (one per message) | Added `snapshot()` — load Set once before loop |

<br/>

---

## 📊 Quotas & Limits

| Resource | Google Quota | Inbox Radar Usage |
|----------|-------------|-------------------|
| Script runtime/day | 6 hours | ~1s per run × 288 runs = ~5 min |
| Gmail read/day | 20,000 | ≤20 per run × 288 = 5,760 max |
| URL Fetch calls/day | 20,000 | 1 per email + retries |
| Properties store | 500KB | ~2,000 IDs @ ~100 bytes each = 200KB |

All well within free tier limits.

<br/>

---

## 🔒 Security Notes

- **Never hardcode your bot token** in source code. Pass it only through `setup()`.
- Script Properties are stored **encrypted at rest** by Google.
- The script only requests **Gmail (read)** and **URL Fetch** permissions.
- Token is never logged even in debug mode.

<br/>

---

## 🛠 Troubleshooting

<details>
<summary><b>"BOT_TOKEN and CHAT_ID are required" on setup()</b></summary>

You ran `setup()` without arguments. Pass your credentials:
```javascript
setup("YOUR_ACTUAL_TOKEN", "YOUR_ACTUAL_CHAT_ID")
```
</details>

<details>
<summary><b>"Inbox Radar is disabled" on every run</b></summary>

`setup()` was not completed. Run it first, then `installTriggers()`.
Check `status()` to see current state.
</details>

<details>
<summary><b>Telegram messages have a backslash before numbers in digest</b></summary>

This was Bug #4 (now fixed in v2.0). Pull the latest `InboxRadar.gs`.
</details>

<details>
<summary><b>Same email delivered twice</b></summary>

The dedupe store may have been cleared. Run `clearDedupeStore()` only when you want to re-process old emails. Check `status()` for store size.
</details>

<details>
<summary><b>No emails being fetched</b></summary>

Check your scan query: `setScanQuery("is:unread newer_than:1d")`.  
Run `status()` and verify `enabled: true` and `botConnected: true`.
</details>

<br/>

---

## 📁 File Structure

```
InboxRadar/
├── InboxRadar.gs          ← The entire engine (single file, zero deps)
└── README.md              ← This file
```

That's it. One file. Paste it. Run it. Done.

<br/>

---

## 🤝 Contributing

Pull requests welcome. If you add a new module, follow the IIFE pattern used throughout. If you add rules, make sure `validate()` catches malformed JSON before it's saved.

<br/>

---

## 📄 License

MIT — use it, fork it, ship it.

<br/>

---

<div align="center">

**Built by [Amirhossein Dehghanazar](https://github.com/AmirhosseinDehghanazar)**  
Tehran, Iran · Software Engineer · [@AJESUS_S](https://twitter.com/AJESUS_S)

<br/>

[![GitHub followers](https://img.shields.io/github/followers/AmirhosseinDehghanazar?style=social)](https://github.com/AmirhosseinDehghanazar)
[![Twitter Follow](https://img.shields.io/twitter/follow/AJESUS_S?style=social)](https://twitter.com/AJESUS_S)

<br/>

*If this saved you time, drop a ⭐ — it means a lot.*

</div>
