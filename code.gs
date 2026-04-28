/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                    INBOX RADAR v2.0                              ║
 * ║         Gmail → Telegram Intelligent Notification Engine         ║
 * ║  Author: Amirhossein Dehghaniazar                                ║
 * ║  Stack:  Google Apps Script · Telegram Bot API                   ║
 * ║  Infra:  Zero external dependencies                              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  MODULES:
 *   1. configManager      – Script Properties KV store
 *   2. dedupeStore        – Persistent processed-ID set
 *   3. emailFetcher       – Gmail query + batch reader
 *   4. ruleEngine         – JSON rule matching
 *   5. formatter          – Structured Telegram message builder
 *   6. telegramSender     – Bot API with retry + rate-limit
 *   7. scheduler          – Trigger installer / manager
 *   8. controlPanel       – Public API: enable, disable, setRules, etc.
 *   9. digestEngine       – Optional daily summary
 *  10. debugLogger        – Toggle-able verbose logging
 *
 * ──────────────────────────────────────────────────────────────────
 *  QUICK START:
 *   1. Paste this file into script.google.com
 *   2. Run:  setup("YOUR_BOT_TOKEN", "YOUR_CHAT_ID")
 *   3. Run:  installTriggers(5, 8)
 *   4. Run:  sendTestNotification()
 * ──────────────────────────────────────────────────────────────────
 *
 * ⚠️  SECURITY: Never hardcode tokens in source. Pass them only via
 *     setup() — they are stored encrypted in Script Properties.
 */

"use strict";

// ═══════════════════════════════════════════════════════════════════
// 1. CONFIG MANAGER
// ═══════════════════════════════════════════════════════════════════

/**
 * FIX #1 (Critical): CONFIG_KEYS values must be plain strings used as
 * property-store KEY NAMES — not the actual secret values.
 * Previously BOT_TOKEN and CHAT_ID held the live token/chat ID, which
 * caused all PropertiesService reads/writes to use the wrong key and
 * the "BOT_TOKEN and CHAT_ID are required" error on every setup() call.
 */
const CONFIG_KEYS = {
  BOT_TOKEN:  "BOT_TOKEN",
  CHAT_ID:    "CHAT_ID",
  RULES_JSON: "RULES_JSON",
  ENABLED:    "ENABLED",
  DEBUG:      "DEBUG",
  MAX_BATCH:  "MAX_BATCH",
  SCAN_QUERY: "SCAN_QUERY",
};

const configManager = (() => {
  const _props = () => PropertiesService.getScriptProperties();

  function get(key) {
    return _props().getProperty(key);
  }

  function set(key, value) {
    _props().setProperty(key, String(value));
  }

  function getAll() {
    return _props().getProperties();
  }

  function initialize(botToken, chatId) {
    if (!botToken || !chatId) throw new Error("BOT_TOKEN and CHAT_ID are required.");
    set(CONFIG_KEYS.BOT_TOKEN,  botToken);
    set(CONFIG_KEYS.CHAT_ID,    chatId);
    set(CONFIG_KEYS.ENABLED,    "true");
    set(CONFIG_KEYS.DEBUG,      "false");
    set(CONFIG_KEYS.MAX_BATCH,  "20");
    set(CONFIG_KEYS.SCAN_QUERY, "is:unread newer_than:1d");

    if (!get(CONFIG_KEYS.RULES_JSON)) {
      set(CONFIG_KEYS.RULES_JSON, JSON.stringify(DEFAULT_RULES));
    }

    console.log("✅ Inbox Radar initialized successfully.");
  }

  /**
   * FIX #3 (Medium): Guard against null before setup() runs.
   * Previously null === "true" silently returned false and caused
   * runInboxRadar() to skip with "Inbox Radar is disabled" even though
   * setup() had not yet been called (making the root cause invisible).
   */
  function isEnabled() {
    const val = get(CONFIG_KEYS.ENABLED);
    if (val === null) return false; // not yet initialized
    return val === "true";
  }

  function isDebug() {
    return get(CONFIG_KEYS.DEBUG) === "true";
  }

  function maxBatch() {
    return parseInt(get(CONFIG_KEYS.MAX_BATCH) || "20", 10);
  }

  function scanQuery() {
    return get(CONFIG_KEYS.SCAN_QUERY) || "is:unread newer_than:1d";
  }

  return { get, set, getAll, initialize, isEnabled, isDebug, maxBatch, scanQuery };
})();


// ═══════════════════════════════════════════════════════════════════
// 2. DEBUG LOGGER
// ═══════════════════════════════════════════════════════════════════

const debugLogger = (() => {
  function log(level, ...args) {
    const prefix = { INFO: "ℹ️", WARN: "⚠️", ERROR: "❌", DEBUG: "🔍" }[level] || "📝";
    const msg = `[InboxRadar][${level}] ${args.join(" ")}`;
    if (level === "DEBUG" && !configManager.isDebug()) return;
    console.log(`${prefix} ${msg}`);
  }

  return {
    info:  (...a) => log("INFO",  ...a),
    warn:  (...a) => log("WARN",  ...a),
    error: (...a) => log("ERROR", ...a),
    debug: (...a) => log("DEBUG", ...a),
  };
})();


// ═══════════════════════════════════════════════════════════════════
// 3. DEDUPE STORE
// ═══════════════════════════════════════════════════════════════════

const dedupeStore = (() => {
  const PROP_KEY   = "PROCESSED_IDS";
  const MAX_STORED = 2000;
  const SEPARATOR  = ",";

  function _load() {
    const raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY) || "";
    return raw ? new Set(raw.split(SEPARATOR)) : new Set();
  }

  function _save(ids) {
    const arr     = [...ids];
    const trimmed = arr.slice(-MAX_STORED);
    PropertiesService.getScriptProperties().setProperty(PROP_KEY, trimmed.join(SEPARATOR));
  }

  function has(id) {
    return _load().has(id);
  }

  function markProcessed(id) {
    const ids = _load();
    ids.add(id);
    _save(ids);
  }

  function markBatch(idsArray) {
    const ids = _load();
    idsArray.forEach(id => ids.add(id));
    _save(ids);
  }

  function size() {
    return _load().size;
  }

  /**
   * FIX #5 (Performance): Expose a one-shot snapshot so the fetch loop
   * can call _load() exactly once instead of once per message.
   */
  function snapshot() {
    return _load();
  }

  function clear() {
    PropertiesService.getScriptProperties().deleteProperty(PROP_KEY);
    debugLogger.warn("Dedupe store cleared.");
  }

  return { has, markProcessed, markBatch, size, snapshot, clear };
})();


// ═══════════════════════════════════════════════════════════════════
// 4. DEFAULT RULES (fallback if none configured)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_RULES = [
  {
    name: "OTP & Security",
    emoji: "🔐",
    conditions: {
      subjectContains:  ["otp", "verification code", "verify", "security code", "2fa", "two-factor", "login code"],
      fromContains:     [],
      keywordContains:  []
    },
    priority: "critical",
    silent:   false
  },
  {
    name: "Finance & Banking",
    emoji: "💳",
    conditions: {
      subjectContains:  ["invoice", "payment", "transaction", "receipt", "billing", "charge", "refund", "bank", "statement"],
      fromContains:     ["paypal", "stripe", "revolut", "wise", "bank"],
      keywordContains:  []
    },
    priority: "high",
    silent:   false
  },
  {
    name: "Jobs & Recruiting",
    emoji: "💼",
    conditions: {
      subjectContains:  ["recruiter", "interview", "job opportunity", "hiring", "position", "application", "offer letter"],
      fromContains:     ["linkedin", "greenhouse.io", "lever.co", "workday", "ashbyhq"],
      keywordContains:  []
    },
    priority: "high",
    silent:   false
  },
  {
    name: "SaaS & Subscriptions",
    emoji: "📦",
    conditions: {
      subjectContains:  ["subscription", "your plan", "trial ending", "upgrade", "plan renewal", "account"],
      fromContains:     [],
      keywordContains:  ["expires", "renews", "trial ends"]
    },
    priority: "medium",
    silent:   false
  },
  {
    name: "Calendar & Meetings",
    emoji: "📅",
    conditions: {
      subjectContains:  ["invitation", "meeting", "calendar", "event", "scheduled", "zoom", "google meet"],
      fromContains:     ["calendar-notification", "no-reply@calendar"],
      keywordContains:  []
    },
    priority: "medium",
    silent:   false
  },
  {
    name: "Newsletters",
    emoji: "📰",
    conditions: {
      subjectContains:  [],
      fromContains:     ["noreply", "newsletter", "digest", "substack", "mailchimp"],
      keywordContains:  ["unsubscribe"]
    },
    priority: "low",
    silent:   true
  }
];


// ═══════════════════════════════════════════════════════════════════
// 5. RULE ENGINE
// ═══════════════════════════════════════════════════════════════════

const ruleEngine = (() => {
  function _loadRules() {
    try {
      const raw = configManager.get(CONFIG_KEYS.RULES_JSON);
      return raw ? JSON.parse(raw) : DEFAULT_RULES;
    } catch (e) {
      debugLogger.error("Failed to parse RULES_JSON, using defaults.", e.message);
      return DEFAULT_RULES;
    }
  }

  function _matchList(haystack, needles) {
    if (!needles || needles.length === 0) return false;
    const h = haystack.toLowerCase();
    return needles.some(n => h.includes(n.toLowerCase()));
  }

  /**
   * Returns true if ALL present condition groups match
   * (OR within a group, AND between groups).
   */
  function _evaluateRule(rule, email) {
    const c = rule.conditions || {};
    const checks = [];

    if (c.subjectContains && c.subjectContains.length > 0) {
      checks.push(_matchList(email.subject, c.subjectContains));
    }
    if (c.fromContains && c.fromContains.length > 0) {
      checks.push(_matchList(email.from, c.fromContains));
    }
    if (c.keywordContains && c.keywordContains.length > 0) {
      checks.push(_matchList(email.bodyPreview, c.keywordContains));
    }

    return checks.length > 0 && checks.every(Boolean);
  }

  function match(email) {
    const rules = _loadRules();
    for (const rule of rules) {
      if (_evaluateRule(rule, email)) {
        debugLogger.debug(`Rule matched: "${rule.name}" for subject: "${email.subject}"`);
        return rule;
      }
    }
    return {
      name:     "General",
      emoji:    "📩",
      priority: "low",
      silent:   false
    };
  }

  function validate(rulesJson) {
    const rules = JSON.parse(rulesJson);
    if (!Array.isArray(rules)) throw new Error("Rules must be a JSON array.");
    rules.forEach((r, i) => {
      if (!r.name)       throw new Error(`Rule[${i}] missing 'name'.`);
      if (!r.conditions) throw new Error(`Rule[${i}] missing 'conditions'.`);
      if (!r.priority)   throw new Error(`Rule[${i}] missing 'priority'.`);
    });
    return true;
  }

  return { match, validate };
})();


// ═══════════════════════════════════════════════════════════════════
// 6. EMAIL FETCHER
// ═══════════════════════════════════════════════════════════════════

const emailFetcher = (() => {
  function _cleanBody(body) {
    if (!body) return "";
    return body
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/https?:\/\/\S+/g, "[link]")
      .trim()
      .substring(0, 800);
  }

  function _extractEmail(rawFrom) {
    const m = rawFrom.match(/<([^>]+)>/);
    return m ? m[1] : rawFrom;
  }

  /**
   * FIX #2 (High): _parseMessage previously accepted a thread but called
   * message-only methods (getPlainBody, getId on wrong object). Rewritten
   * to correctly accept a GmailMessage + its parent GmailThread.
   * Also promoted from dead-letter code to actually be used in fetch().
   */
  function _parseMessage(msg, thread) {
    return {
      id:          msg.getId(),
      from:        msg.getFrom(),
      fromEmail:   _extractEmail(msg.getFrom()),
      subject:     thread.getFirstMessageSubject(),
      date:        msg.getDate(),
      bodyPreview: _cleanBody(msg.getPlainBody() || msg.getBody()),
      rawMessage:  msg
    };
  }

  function fetch() {
    const query    = configManager.scanQuery();
    const maxBatch = configManager.maxBatch();
    const results  = [];

    debugLogger.info(`Scanning Gmail: "${query}" (max ${maxBatch})`);

    let threads;
    try {
      threads = GmailApp.search(query, 0, maxBatch * 2);
    } catch (e) {
      debugLogger.error("GmailApp.search failed:", e.message);
      return results;
    }

    /**
     * FIX #5 (Performance): Load the full dedupe set once here rather
     * than calling dedupeStore.has() (which calls _load() internally)
     * once per message — which was N separate PropertiesService reads.
     */
    const processedSet = dedupeStore.snapshot();
    let processed = 0;

    for (const thread of threads) {
      if (processed >= maxBatch) break;

      try {
        const messages = thread.getMessages();
        for (const msg of messages) {
          if (processed >= maxBatch) break;
          if (!msg.isUnread()) continue;

          const id = msg.getId();
          if (processedSet.has(id)) {
            debugLogger.debug(`Skipping already-processed: ${id}`);
            continue;
          }

          results.push(_parseMessage(msg, thread));
          processed++;
        }
      } catch (e) {
        debugLogger.warn(`Error reading thread: ${e.message}`);
      }
    }

    debugLogger.info(`Fetched ${results.length} new unread messages.`);
    return results;
  }

  function markAsRead(messages) {
    messages.forEach(email => {
      try {
        email.rawMessage.markRead();
      } catch (e) {
        debugLogger.warn(`Could not mark as read: ${email.id} — ${e.message}`);
      }
    });
  }

  return { fetch, markAsRead };
})();


// ═══════════════════════════════════════════════════════════════════
// 7. FORMATTER
// ═══════════════════════════════════════════════════════════════════

const formatter = (() => {
  const PRIORITY_LABELS = {
    critical: "🚨 CRITICAL",
    high:     "🔴 High",
    medium:   "🟡 Medium",
    low:      "🟢 Low"
  };

  function _formatDate(date) {
    if (!date) return "Unknown";
    try {
      return Utilities.formatDate(date, Session.getScriptTimeZone(), "MMM d, yyyy · HH:mm");
    } catch (e) {
      return String(date);
    }
  }

  function build(email, rule) {
    const emoji    = rule.emoji || "📩";
    const type     = rule.name  || "General";
    const priority = PRIORITY_LABELS[rule.priority] || "🟢 Low";
    const preview  = email.bodyPreview
      ? email.bodyPreview.substring(0, 500) + (email.bodyPreview.length > 500 ? "…" : "")
      : "_No preview available_";

    const lines = [
      `${emoji} *INBOX RADAR ALERT*`,
      ``,
      `🏷 *Type:* ${type}`,
      `⚡ *Priority:* ${priority}`,
      ``,
      `👤 *From:* \`${email.fromEmail}\``,
      `📌 *Subject:* ${email.subject}`,
      ``,
      `🧠 *Preview:*`,
      `${preview}`,
      ``,
      `⏱ *Time:* ${_formatDate(email.date)}`,
      ``,
      `─────────────────────`,
      `_Sent by Inbox Radar_`
    ];

    return lines.join("\n");
  }

  /**
   * FIX #4 (Medium): buildDigest was using MarkdownV2 escape syntax
   * (\.) but telegramSender.send() defaults to legacy Markdown mode,
   * causing a literal backslash to appear before every list number.
   * Removed the escape — plain dots are correct in Markdown mode.
   */
  function buildDigest(emails) {
    if (!emails || emails.length === 0) {
      return `📊 *Daily Digest — No new emails today.*`;
    }

    const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM d, yyyy");
    const lines = [
      `📊 *INBOX RADAR — DAILY DIGEST*`,
      `📅 ${dateStr}`,
      `📬 *Total:* ${emails.length} email(s)`,
      ``,
      `─────────────────────`
    ];

    emails.slice(0, 15).forEach((item, i) => {
      const rule  = item.rule;
      const email = item.email;
      const emoji = rule.emoji || "📩";
      // FIX: plain dot, not \\. — legacy Markdown does not need the escape
      lines.push(`${i + 1}. ${emoji} *${email.subject}*`);
      lines.push(`   👤 ${email.fromEmail} · ⚡ ${rule.priority}`);
      lines.push(``);
    });

    if (emails.length > 15) {
      lines.push(`_...and ${emails.length - 15} more._`);
    }

    return lines.join("\n");
  }

  return { build, buildDigest };
})();


// ═══════════════════════════════════════════════════════════════════
// 8. TELEGRAM SENDER
// ═══════════════════════════════════════════════════════════════════

const telegramSender = (() => {
  const BASE_URL       = "https://api.telegram.org/bot";
  const MAX_RETRIES    = 3;
  const RETRY_DELAY_MS = 2000;
  const MAX_MSG_LEN    = 4096;

  function _apiUrl(method) {
    const token = configManager.get(CONFIG_KEYS.BOT_TOKEN);
    if (!token) throw new Error("BOT_TOKEN is not configured. Run setup() first.");
    return `${BASE_URL}${token}/${method}`;
  }

  function _sleep(ms) {
    Utilities.sleep(ms);
  }

  function _truncate(text) {
    if (text.length <= MAX_MSG_LEN) return text;
    return text.substring(0, MAX_MSG_LEN - 20) + "\n…*(truncated)*";
  }

  function send(text, options = {}) {
    const chatId = options.chatId || configManager.get(CONFIG_KEYS.CHAT_ID);
    if (!chatId) throw new Error("CHAT_ID is not configured. Run setup() first.");

    const payload = {
      chat_id:              chatId,
      text:                 _truncate(text),
      parse_mode:           options.parseMode || "Markdown",
      disable_notification: options.silent || false,
      disable_web_page_preview: true
    };

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = UrlFetchApp.fetch(_apiUrl("sendMessage"), {
          method:             "post",
          contentType:        "application/json",
          payload:            JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const code = response.getResponseCode();
        const body = JSON.parse(response.getContentText());

        if (code === 200 && body.ok) {
          debugLogger.debug(`Telegram sent OK on attempt ${attempt}.`);
          return { success: true, messageId: body.result.message_id };
        }

        if (code === 429) {
          const retryAfter = (body.parameters && body.parameters.retry_after) || 5;
          debugLogger.warn(`Rate-limited by Telegram. Waiting ${retryAfter}s…`);
          _sleep(retryAfter * 1000);
          continue;
        }

        lastError = `Telegram API error ${code}: ${body.description}`;
        debugLogger.warn(`Attempt ${attempt} failed: ${lastError}`);

      } catch (e) {
        lastError = e.message;
        debugLogger.warn(`Attempt ${attempt} network error: ${lastError}`);
      }

      if (attempt < MAX_RETRIES) _sleep(RETRY_DELAY_MS);
    }

    debugLogger.error(`Failed to send message after ${MAX_RETRIES} attempts: ${lastError}`);
    return { success: false, error: lastError };
  }

  function sendPhoto(photoUrl, caption) {
    const chatId = configManager.get(CONFIG_KEYS.CHAT_ID);
    const payload = {
      chat_id:    chatId,
      photo:      photoUrl,
      caption:    caption || "",
      parse_mode: "Markdown"
    };
    try {
      UrlFetchApp.fetch(_apiUrl("sendPhoto"), {
        method:             "post",
        contentType:        "application/json",
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (e) {
      debugLogger.error("sendPhoto failed:", e.message);
    }
  }

  function testConnection() {
    try {
      const resp = UrlFetchApp.fetch(_apiUrl("getMe"), { muteHttpExceptions: true });
      const data = JSON.parse(resp.getContentText());
      if (data.ok) {
        debugLogger.info(`Bot connected: @${data.result.username}`);
        return { ok: true, username: data.result.username };
      }
      return { ok: false, error: data.description };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { send, sendPhoto, testConnection };
})();


// ═══════════════════════════════════════════════════════════════════
// 9. SCHEDULER
// ═══════════════════════════════════════════════════════════════════

const scheduler = (() => {
  const TRIGGER_FUNC  = "runInboxRadar";
  const DIGEST_FUNC   = "runDailyDigest";
  const INTERVAL_MINS = 5;

  function installWatcherTrigger(intervalMinutes) {
    _removeTriggersByFunction(TRIGGER_FUNC);

    ScriptApp.newTrigger(TRIGGER_FUNC)
      .timeBased()
      .everyMinutes(intervalMinutes || INTERVAL_MINS)
      .create();

    debugLogger.info(`Watcher trigger installed: every ${intervalMinutes || INTERVAL_MINS} minutes.`);
  }

  function installDailyDigestTrigger(hour) {
    _removeTriggersByFunction(DIGEST_FUNC);

    ScriptApp.newTrigger(DIGEST_FUNC)
      .timeBased()
      .everyDays(1)
      .atHour(hour || 8)
      .create();

    debugLogger.info(`Daily digest trigger installed at ${hour || 8}:00.`);
  }

  function _removeTriggersByFunction(funcName) {
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === funcName)
      .forEach(t => ScriptApp.deleteTrigger(t));
  }

  function removeAllTriggers() {
    ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
    debugLogger.warn("All triggers removed.");
  }

  function listTriggers() {
    return ScriptApp.getProjectTriggers().map(t => ({
      id:    t.getUniqueId(),
      func:  t.getHandlerFunction(),
      type:  t.getTriggerSource().toString(),
      event: t.getEventType().toString()
    }));
  }

  return { installWatcherTrigger, installDailyDigestTrigger, removeAllTriggers, listTriggers };
})();


// ═══════════════════════════════════════════════════════════════════
// 10. DIGEST ENGINE
// ═══════════════════════════════════════════════════════════════════

const digestEngine = (() => {
  const DIGEST_CACHE_KEY = "DIGEST_CACHE";

  function addToCache(email, rule) {
    let cache;
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(DIGEST_CACHE_KEY);
      cache = raw ? JSON.parse(raw) : [];
    } catch (e) {
      cache = [];
    }

    cache.push({
      email: {
        subject:   email.subject,
        fromEmail: email.fromEmail,
        date:      email.date ? email.date.toISOString() : null
      },
      rule: { name: rule.name, emoji: rule.emoji, priority: rule.priority }
    });

    if (cache.length > 50) cache = cache.slice(-50);

    PropertiesService.getScriptProperties().setProperty(
      DIGEST_CACHE_KEY,
      JSON.stringify(cache)
    );
  }

  function sendDigest() {
    let cache;
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(DIGEST_CACHE_KEY);
      cache = raw ? JSON.parse(raw) : [];
    } catch (e) {
      cache = [];
    }

    const message = formatter.buildDigest(cache);
    const result  = telegramSender.send(message);

    if (result.success) {
      PropertiesService.getScriptProperties().deleteProperty(DIGEST_CACHE_KEY);
      debugLogger.info(`Daily digest sent. ${cache.length} items included.`);
    }

    return result;
  }

  return { addToCache, sendDigest };
})();


// ═══════════════════════════════════════════════════════════════════
// 11. CONTROL PANEL (Public API)
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize Inbox Radar with your Telegram bot credentials.
 * Run this ONCE from the Apps Script editor.
 *
 * Example: setup("123456:ABCdef...", "987654321")
 */
function setup(botToken, chatId) {
  configManager.initialize(botToken, chatId);
  const test = telegramSender.testConnection();
  if (!test.ok) {
    throw new Error(`Bot connection test failed: ${test.error}`);
  }
  telegramSender.send("🚀 *Inbox Radar is online!*\nYour Gmail → Telegram pipeline is active.", { parseMode: "Markdown" });
  console.log("✅ Setup complete. Bot:", test.username);
}

/** Enable the watcher. */
function enable() {
  configManager.set(CONFIG_KEYS.ENABLED, "true");
  debugLogger.info("Inbox Radar ENABLED.");
}

/** Pause processing without removing triggers. */
function disable() {
  configManager.set(CONFIG_KEYS.ENABLED, "false");
  debugLogger.warn("Inbox Radar DISABLED.");
}

/** Toggle verbose debug logging. */
function toggleDebug() {
  const current = configManager.isDebug();
  configManager.set(CONFIG_KEYS.DEBUG, String(!current));
  console.log(`Debug mode: ${!current ? "ON" : "OFF"}`);
}

/** Replace active rules. Pass a valid JSON string. */
function setRules(rulesJson) {
  ruleEngine.validate(rulesJson);
  configManager.set(CONFIG_KEYS.RULES_JSON, rulesJson);
  debugLogger.info("Rules updated successfully.");
}

/** Print current rules to the Apps Script log. */
function getRules() {
  const rules = JSON.parse(configManager.get(CONFIG_KEYS.RULES_JSON) || "[]");
  console.log(JSON.stringify(rules, null, 2));
  return rules;
}

/** Reset ALL state: rules, dedupe store, config. */
function reset() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  scheduler.removeAllTriggers();
  console.log("⚠️ Inbox Radar fully reset. Re-run setup() to reconfigure.");
}

/** Install time-based triggers (call once after setup). */
function installTriggers(intervalMinutes, digestHour) {
  scheduler.installWatcherTrigger(intervalMinutes || 5);
  if (digestHour !== undefined) {
    scheduler.installDailyDigestTrigger(digestHour);
  }
  console.log("✅ Triggers installed.");
  console.log(JSON.stringify(scheduler.listTriggers(), null, 2));
}

/** Send a test notification to verify the pipeline. */
function sendTestNotification() {
  const msg = telegramSender.send(
    `🧪 *Inbox Radar Test*\n\nIf you see this, the pipeline is working correctly!\n\n⏱ ${new Date().toLocaleString()}`,
    { parseMode: "Markdown" }
  );
  console.log("Test result:", JSON.stringify(msg));
}


// ═══════════════════════════════════════════════════════════════════
// 12. MAIN RUNNER (called by trigger every N minutes)
// ═══════════════════════════════════════════════════════════════════

function runInboxRadar() {
  const startTime = Date.now();
  debugLogger.info("━━━ Inbox Radar run started ━━━");

  if (!configManager.isEnabled()) {
    debugLogger.info("Inbox Radar is disabled. Skipping run.");
    return;
  }

  const botToken = configManager.get(CONFIG_KEYS.BOT_TOKEN);
  const chatId   = configManager.get(CONFIG_KEYS.CHAT_ID);
  if (!botToken || !chatId) {
    debugLogger.error("Missing BOT_TOKEN or CHAT_ID. Run setup() first.");
    return;
  }

  let emails;
  try {
    emails = emailFetcher.fetch();
  } catch (e) {
    debugLogger.error("Email fetch failed:", e.message);
    return;
  }

  if (emails.length === 0) {
    debugLogger.info("No new emails to process.");
    return;
  }

  let sent    = 0;
  let skipped = 0;
  let failed  = 0;
  const processedIds       = [];
  const messagesToMarkRead = [];

  for (const email of emails) {
    try {
      const rule = ruleEngine.match(email);

      debugLogger.debug(`Processing: "${email.subject}" → Rule: "${rule.name}" [${rule.priority}]`);

      if (!rule.silent) {
        const message = formatter.build(email, rule);
        const result  = telegramSender.send(message, {
          silent: rule.priority === "low"
        });

        if (result.success) {
          sent++;
          digestEngine.addToCache(email, rule);
        } else {
          failed++;
          debugLogger.error(`Failed to send for: "${email.subject}"`);
          continue;
        }
      } else {
        skipped++;
        debugLogger.info(`Silent rule: skipping Telegram send for "${email.subject}"`);
      }

      processedIds.push(email.id);
      messagesToMarkRead.push(email);

    } catch (e) {
      failed++;
      debugLogger.error(`Error processing email "${email.subject}": ${e.message}`);
    }
  }

  if (processedIds.length > 0) {
    dedupeStore.markBatch(processedIds);
    emailFetcher.markAsRead(messagesToMarkRead);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  debugLogger.info(`━━━ Run complete: ${sent} sent, ${skipped} silent, ${failed} failed | ${elapsed}s ━━━`);
}

/** Daily digest runner — triggered separately. */
function runDailyDigest() {
  debugLogger.info("Sending daily digest…");
  const result = digestEngine.sendDigest();
  if (result.success) {
    debugLogger.info("Daily digest sent successfully.");
  } else {
    debugLogger.error("Digest failed:", result.error);
  }
}


// ═══════════════════════════════════════════════════════════════════
// 13. STATUS & UTILITIES
// ═══════════════════════════════════════════════════════════════════

/** Print a full status report to the Apps Script log. */
function status() {
  const botTest = telegramSender.testConnection();
  const report = {
    enabled:         configManager.isEnabled(),
    debug:           configManager.isDebug(),
    botConnected:    botTest.ok,
    botUsername:     botTest.username || "N/A",
    chatId:          configManager.get(CONFIG_KEYS.CHAT_ID),
    scanQuery:       configManager.scanQuery(),
    maxBatch:        configManager.maxBatch(),
    dedupeStoreSize: dedupeStore.size(),
    triggers:        scheduler.listTriggers(),
    rulesCount: (() => {
      try { return JSON.parse(configManager.get(CONFIG_KEYS.RULES_JSON) || "[]").length; }
      catch (e) { return 0; }
    })()
  };
  console.log("📊 Inbox Radar Status:\n" + JSON.stringify(report, null, 2));
  return report;
}

/** Clear dedupe store (re-allows re-processing of old emails). */
function clearDedupeStore() {
  dedupeStore.clear();
  console.log("Dedupe store cleared.");
}

/** Update the Gmail scan query. */
function setScanQuery(query) {
  configManager.set(CONFIG_KEYS.SCAN_QUERY, query);
  console.log("Scan query updated:", query);
}

/** Set max emails per run. */
function setMaxBatch(n) {
  configManager.set(CONFIG_KEYS.MAX_BATCH, String(n));
  console.log("Max batch size set to:", n);
}
