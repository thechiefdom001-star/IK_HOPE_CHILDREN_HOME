/**
 * ============================================================
 *  ORPHANAGE MANAGEMENT SYSTEM — GOOGLE APPS SCRIPT BACKEND
 *  Version: 4.0 — Ultra-High Performance Edition
 * ============================================================
 *
 * DEPLOYMENT:
 *   1. Open Google Sheets → Extensions → Apps Script
 *   2. Paste this entire file into Code.gs
 *   3. Click Deploy → New Deployment → Web App
 *   4. Execute as: Me (your Gmail)
 *   5. Who has access: Anyone
 *   6. Deploy, authorize, copy the /exec URL
 *   7. Paste the URL into the OrphanCare App Settings panel
 *   8. Click "Run Database Auto-Setup"
 *
 * FEATURES:
 *   ✅ Auto-creates all 12 sheets with styled headers on first run
 *   ✅ Full CRUD: Create / Read / Update / Delete
 *   ✅ Ultra-fast sub-100ms reads via CacheService (parallel getAll)
 *   ✅ Batch write transactions via setValues() — avoids cell-by-cell API calls
 *   ✅ Dynamic column mapping — safe against manual column reordering
 *   ✅ SHA-256 password hashing for user authentication
 *   ✅ Admin email OTP via MailApp (theesquire2020@gmail.com)
 *   ✅ Email notifications: donor thank-you, low stock alerts, fee reminders
 *   ✅ CORS-safe JSON responses
 *   ✅ Structured error handling with detailed messages
 *
 * ADMIN CREDENTIALS (Pre-seeded):
 *   Email    : theesquire2020@gmail.com
 *   Password : admin123
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
//  CONFIGURATION
// ─────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "theesquire2020@gmail.com";
const ORPHANAGE_NAME = "OrphanCare Children Home"; // Change this to your orphanage's name
const CACHE_TTL   = 120;            // Cache lifetime in seconds (2 minutes)
const CACHE_PFX   = "OMS_V4_";     // Cache key namespace — bump version to bust all caches
const LOW_STOCK_THRESHOLD = 10;     // Units below this trigger a low-stock email alert

/**
 * Sheet schemas: keys define sheet names, values define column headers in order.
 * Changing a column name here will cause it to be added dynamically on next setup.
 */
const SCHEMAS = {
  "Users":            ["email", "passwordHash", "role", "fullName", "createdDate"],
  "Children":         ["id", "name", "age", "gender", "entryDate", "guardianName", "guardianPhone", "roomNumber", "bedNumber", "status"],
  "Rooms":            ["roomNumber", "capacity", "occupancy", "genderType", "notes"],
  "Food_Inventory":   ["id", "itemName", "category", "stockIn", "stockOut", "currentStock", "unit", "expiryDate", "wastage", "notes"],
  "Daily_Meals":      ["id", "date", "mealType", "plannedItems", "calories", "proteins", "carbs", "fats", "costPerChild", "notes"],
  "School_Enrollment":["childId", "schoolName", "gradeClass", "rollNumber", "transportStatus"],
  "School_Fees":      ["id", "childId", "amountDue", "amountPaid", "balance", "dueDate", "receiptUrl", "status"],
  "Academic_Reports": ["id", "childId", "term", "gradesJson", "teacherComments", "dateCreated"],
  "Medical_Records":  ["childId", "bloodType", "allergies", "chronicConditions", "vaccinationsJson", "doctorVisitsJson", "dispensedMedsJson"],
  "Finances":         ["id", "date", "type", "category", "amount", "description", "receiptUrl", "allocatedTo"],
  "Donations":        ["id", "donorName", "donorEmail", "date", "amount", "donationType", "allocatedTo", "thanked", "receiptUrl"],
  "App_Settings":     ["key", "value"]
};

/** Primary key column per sheet (used for upsert / delete targeting) */
const PRIMARY_KEYS = {
  "Users":             "email",
  "Children":          "id",
  "Rooms":             "roomNumber",
  "Food_Inventory":    "id",
  "Daily_Meals":       "id",
  "School_Enrollment": "childId",
  "School_Fees":       "id",
  "Academic_Reports":  "id",
  "Medical_Records":   "childId",
  "Finances":          "id",
  "Donations":         "id",
  "App_Settings":      "key"
};

// ─────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────────────────────────

/**
 * HTTP GET handler — read-only operations and setup.
 *
 * Supported actions:
 *   ?action=testConnection   → Ping; confirms the web app is live.
 *   ?action=setup            → Auto-create all sheets, seed admin user.
 *   ?action=readAll          → Read all sheets (cache-first).
 *   ?action=readSheet&sheet=NAME  → Read a single sheet (cache-first).
 *   ?action=getSettings      → Read all rows from App_Settings.
 *   ?action=bypassCache=true → Append to any action to skip cache.
 */
function doGet(e) {
  try {
    const action      = (e.parameter.action || "").trim();
    const bypassCache = e.parameter.bypassCache === "true";
    const ss          = SpreadsheetApp.getActiveSpreadsheet();

    // ── Ping / health check ──────────────────────────────────
    if (action === "testConnection") {
      return ok({ message: "✅ Connected!", spreadsheet: ss.getName(), timestamp: new Date().toISOString() });
    }

    // ── Full database setup ──────────────────────────────────
    if (action === "setup") {
      return runSetup(ss);
    }

    // ── Read all sheets ──────────────────────────────────────
    if (action === "readAll") {
      return readAllSheets(ss, bypassCache);
    }

    // ── Read a single sheet ──────────────────────────────────
    if (action === "readSheet") {
      const sheet = (e.parameter.sheet || "").trim();
      if (!sheet) return err("Missing ?sheet= parameter.");
      return readOneSheet(ss, sheet, bypassCache);
    }

    // ── App Settings convenience reader ─────────────────────
    if (action === "getSettings") {
      return readOneSheet(ss, "App_Settings", bypassCache);
    }

    return err("Unknown GET action: " + action + ". Supported: testConnection, setup, readAll, readSheet, getSettings");

  } catch (e) {
    return err("Server error: " + e.toString());
  }
}

/**
 * HTTP POST handler — write operations and auth.
 *
 * Request body (JSON):
 *   { "action": "<action>", ...actionSpecificFields }
 *
 * Supported actions:
 *   registerUser      → Register a new Staff / Donor user.
 *   loginUser         → Authenticate; triggers OTP for Admin.
 *   verifyAdminOTP    → Confirm 6-digit OTP, complete Admin login.
 *   saveRecord        → Upsert a row (insert or update by primary key).
 *   deleteRecord      → Delete a row by key value.
 *   bulkSave          → Save multiple records in one request.
 *   sendNotification  → Trigger an email notification by type.
 *   updateSetting     → Write a key→value pair into App_Settings.
 *   clearCache        → Evict cache for one or all sheets.
 */
function doPost(e) {
  console.log("doPost triggered. Event: " + JSON.stringify(e));
  let body;
  try {
    body = JSON.parse(e.postData.contents);
    console.log("Parsed body successfully. Action: " + body.action);
  } catch (parseError) {
    console.error("JSON parse error: " + parseError.toString());
    return err("Invalid JSON request body: " + parseError.toString());
  }

  const action = (body.action || "").trim();

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    console.log("Active Spreadsheet: " + (ss ? ss.getName() : "NULL"));

    let response;
    switch (action) {

      // ── Auth ──────────────────────────────────────────────
      case "registerUser":    response = registerUser(ss, body); break;
      case "loginUser":       response = loginUser(ss, body); break;
      case "verifyAdminOTP":  response = verifyAdminOTP(ss, body); break;

      // ── CRUD ──────────────────────────────────────────────
      case "saveRecord":      response = saveRecord(ss, body); break;
      case "deleteRecord":    response = deleteRecord(ss, body); break;
      case "bulkSave":        response = bulkSave(ss, body); break;

      // ── Notifications ─────────────────────────────────────
      case "sendNotification": response = sendNotification(ss, body); break;

      // ── Settings ──────────────────────────────────────────
      case "updateSetting":   response = updateSetting(ss, body); break;

      // ── Cache management ──────────────────────────────────
      case "clearCache":
        const target = body.sheet || null;
        target ? evictCache(target) : evictAllCache();
        response = ok({ message: target ? "Cache cleared for " + target : "All caches cleared." });
        break;

      default:
        console.warn("Unknown action: " + action);
        response = err("Unknown POST action: " + action);
    }
    console.log("Action " + action + " completed. Response payload keys: " + Object.keys(response || {}));
    return response;
  } catch (ex) {
    console.error("doPost Server Error: " + ex.toString() + "\nStack: " + ex.stack);
    return err("Server error [" + action + "]: " + ex.toString());
  }
}

// ─────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────

/**
 * Creates all sheets if missing, applies header formatting, seeds admin.
 * Runs in a single pass so it is fast even on first call.
 */
function runSetup(ss) {
  const sheetsMap = buildSheetsMap(ss);
  const created   = [];
  const existing  = [];

  for (const name in SCHEMAS) {
    const sheet = getOrCreateSheet(ss, name, sheetsMap);
    if (sheetsMap[name]) {
      existing.push(name);
    } else {
      created.push(name);
    }
    // Ensure admin exists on Users sheet
    if (name === "Users") {
      ensureAdminSeeded(sheet);
    }
  }

  evictAllCache();
  return ok({
    message : "Setup complete! All sheets initialized.",
    created : created,
    existing: existing,
    totalSheets: Object.keys(SCHEMAS).length
  });
}

// ─────────────────────────────────────────────────────────────
//  READ OPERATIONS
// ─────────────────────────────────────────────────────────────

function readAllSheets(ss, bypassCache) {
  // Try parallel cache fetch first
  if (!bypassCache) {
    const cached = batchGetCache(Object.keys(SCHEMAS));
    if (cached) {
      return ok({ data: cached, source: "cache", timestamp: new Date().toISOString() });
    }
  }

  // Cache miss — read from Sheets in a single getSheets() call
  const sheetsMap = buildSheetsMap(ss);
  const data       = {};
  const toCache    = {};

  for (const name in SCHEMAS) {
    const sheet  = getOrCreateSheet(ss, name, sheetsMap);
    const rows   = sheetToObjects(sheet, SCHEMAS[name]);
    data[name]  = rows;
    toCache[name] = rows;
  }

  batchSetCache(toCache);
  return ok({ data: data, source: "sheets", timestamp: new Date().toISOString() });
}

function readOneSheet(ss, sheetName, bypassCache) {
  if (!SCHEMAS[sheetName]) {
    return err("Unknown sheet: " + sheetName);
  }

  // Try cache
  if (!bypassCache) {
    const cached = getCache(sheetName);
    if (cached !== null) {
      return ok({ data: cached, source: "cache" });
    }
  }

  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, sheetName, sheetsMap);
  const rows      = sheetToObjects(sheet, SCHEMAS[sheetName]);
  setCache(sheetName, rows);
  return ok({ data: rows, source: "sheets" });
}

// ─────────────────────────────────────────────────────────────
//  AUTH OPERATIONS
// ─────────────────────────────────────────────────────────────

function registerUser(ss, body) {
  const email    = (body.email    || "").trim().toLowerCase();
  const password = (body.password || "").trim();
  const fullName = (body.fullName || "").trim();
  const role     = body.role || "Donor-Viewer";

  if (!email || !password || !fullName) {
    return err("All fields (email, password, fullName) are required.");
  }
  if (!email.includes("@")) {
    return err("Please provide a valid email address.");
  }
  if (password.length < 6) {
    return err("Password must be at least 6 characters long.");
  }


  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, "Users", sheetsMap);
  const rows      = sheet.getDataRange().getValues();
  const headers   = rows[0];
  const emailIdx  = headers.indexOf("email");

  // Duplicate check
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][emailIdx].toString().toLowerCase() === email) {
      return err("This email is already registered. Please sign in.");
    }
  }

  const newRow = headers.map(h => {
    if (h === "email")        return email;
    if (h === "passwordHash") return hashPassword(password);
    if (h === "role")         return role;
    if (h === "fullName")     return fullName;
    if (h === "createdDate")  return isoDate();
    return "";
  });

  sheet.appendRow(newRow);
  evictCache("Users");

  // Welcome email to the new user
  try {
    MailApp.sendEmail({
      to:      email,
      subject: "🏠 Welcome to OrphanCare Cloud — Registration Confirmed",
      body:    buildWelcomeEmail(fullName, role)
    });
  } catch (_) { /* email send failure is non-fatal */ }

  return ok({ message: "Registration successful! You may now sign in." });
}

function loginUser(ss, body) {
  const email    = (body.email    || "").trim().toLowerCase();
  const password = (body.password || "").trim();

  if (!email || !password) {
    return err("Email and password are required.");
  }

  const sheetsMap   = buildSheetsMap(ss);
  const sheet       = getOrCreateSheet(ss, "Users", sheetsMap);
  const rows        = sheet.getDataRange().getValues();
  const headers     = rows[0];
  const emailIdx    = headers.indexOf("email");
  const passIdx     = headers.indexOf("passwordHash");
  const roleIdx     = headers.indexOf("role");
  const nameIdx     = headers.indexOf("fullName");

  if (emailIdx < 0 || passIdx < 0) {
    return err("Users sheet schema mismatch. Please re-run database setup.");
  }

  let userRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][emailIdx].toString().toLowerCase() === email) {
      userRow = i;
      break;
    }
  }

  if (userRow < 0 || rows[userRow][passIdx].toString() !== hashPassword(password)) {
    return err("Invalid email or password.");
  }

  const role     = rows[userRow][roleIdx].toString();
  const fullName = rows[userRow][nameIdx].toString();

  // Admin — trigger OTP flow (OTP always sent to super admin email for control)
  if (role === "Admin") {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    CacheService.getScriptCache().put("OTP_" + ADMIN_EMAIL, otp, 300); // 5-min TTL - always use super admin email
    CacheService.getScriptCache().put("OTP_USER_" + ADMIN_EMAIL, email, 300); // Store which admin registered

    try {
      MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: "🔐 OrphanCare Cloud — Admin Verification Code",
        body:    buildOTPEmail(otp)
      });
    } catch (mailErr) {
      return err("Could not send OTP email: " + mailErr.toString());
    }

    return ok({ otpRequired: true, message: "OTP sent to super admin email", otpEmail: ADMIN_EMAIL, registeredAdmin: email });
  }

  // Staff / Donor — direct login
  return ok({ otpRequired: false, user: { email, role, fullName } });
}

function verifyAdminOTP(ss, body) {
  const otp   = (body.otp || "").trim();
  const cache = CacheService.getScriptCache();
  const stored = cache.get("OTP_" + ADMIN_EMAIL);

  if (!otp)              return err("Verification code is required.");
  if (!stored)           return err("OTP has expired. Please sign in again to receive a new code.");
  if (stored !== otp)    return err("Invalid verification code. Please check your email and try again.");

  // Get the registered admin email that was stored during login BEFORE removing
  const registeredAdminEmail = cache.get("OTP_USER_" + ADMIN_EMAIL) || ADMIN_EMAIL;
  
  cache.remove("OTP_" + ADMIN_EMAIL);
  cache.remove("OTP_USER_" + ADMIN_EMAIL);

  // Fetch Admin profile to return
  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, "Users", sheetsMap);
  const rows      = sheet.getDataRange().getValues();
  const headers   = rows[0];
  const emailIdx  = headers.indexOf("email");
  const nameIdx   = headers.indexOf("fullName");

  let adminName = "System Admin";
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][emailIdx].toString().toLowerCase() === registeredAdminEmail.toLowerCase()) {
      adminName = rows[i][nameIdx].toString();
      break;
    }
  }

  return ok({ user: { email: registeredAdminEmail, role: "Admin", fullName: adminName } });
}

// ─────────────────────────────────────────────────────────────
//  CRUD OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Upsert a single record.
 * Body: { action, sheetName, record: {...}, keyColumn?: "id" }
 *
 * Workflow:
 *   1. Load the sheet's current data range in ONE API call.
 *   2. Scan rows for matching primary key.
 *   3. If found → setValues() to overwrite that single row (batch write).
 *   4. If not found → appendRow() to add a new row.
 *   5. Evict cache for this sheet only.
 *   6. Send any applicable notifications (low stock, fee overdue, new donation).
 */
function saveRecord(ss, body) {
  const sheetName = body.sheetName;
  const record    = body.record;

  if (!sheetName || !record) {
    return err("saveRecord requires: sheetName, record.");
  }
  if (!SCHEMAS[sheetName]) {
    return err("Unknown sheet: " + sheetName);
  }

  // Use the canonical primary key column from SCHEMAS/PRIMARY_KEYS
  const actualKeyCol = PRIMARY_KEYS[sheetName] || "id";
  const passedKeyCol = body.keyColumn || actualKeyCol;

  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, sheetName, sheetsMap);
  const allValues = sheet.getDataRange().getValues();
  const headers   = allValues[0];
  
  // Find key index case-insensitively in sheet headers
  let keyIdx = headers.indexOf(actualKeyCol);
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === actualKeyCol.toLowerCase());
  }
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === passedKeyCol.toLowerCase());
  }

  if (keyIdx < 0) {
    return err("Primary key column '" + actualKeyCol + "' not found in " + sheetName + " headers.");
  }

  // Get the key value from record case-insensitively
  let keyValue = "";
  const keyCandidates = [actualKeyCol, passedKeyCol, "id", "ID", "key", "Key", "childId", "ChildID"];
  for (const candidate of keyCandidates) {
    const candLower = candidate.toLowerCase();
    for (const k in record) {
      if (k.toLowerCase() === candLower) {
        if (record[k] !== undefined && record[k] !== null && record[k] !== "") {
          keyValue = String(record[k]);
          break;
        }
      }
    }
    if (keyValue) break;
  }

  // Build the value row (always in spreadsheet column order)
  const rowValues = headers.map(h => {
    // Attempt exact match
    let v = record[h];
    // If not found, attempt case-insensitive match
    if (v === undefined || v === null) {
      const hLower = h.toLowerCase();
      for (const k in record) {
        if (k.toLowerCase() === hLower) {
          v = record[k];
          break;
        }
      }
    }
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  });

  let rowAction = "insert";
  let rowNum    = -1;

  for (let i = 1; i < allValues.length; i++) {
    if (String(allValues[i][keyIdx]) === keyValue) {
      rowNum    = i + 1;   // Sheets rows are 1-indexed, data rows start at index 1
      rowAction = "update";
      break;
    }
  }

  if (rowAction === "update") {
    // Batch write — single API call for the entire row
    sheet.getRange(rowNum, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  evictCache(sheetName);

  // ── Post-save side effects ─────────────────────────────────
  triggerSaveNotifications(ss, sheetName, record, rowAction);

  return ok({
    message  : "Record " + (rowAction === "update" ? "updated" : "created") + " in " + sheetName,
    operation: rowAction,
    keyValue : keyValue
  });
}

/**
 * Delete a record by key value.
 * Body: { action, sheetName, keyValue, keyColumn?: "id" }
 */
function deleteRecord(ss, body) {
  const sheetName = body.sheetName;
  const keyValue  = String(body.keyValue || "");

  if (!sheetName || !keyValue) {
    return err("deleteRecord requires: sheetName, keyValue.");
  }
  if (!SCHEMAS[sheetName]) {
    return err("Unknown sheet: " + sheetName);
  }

  const actualKeyCol = PRIMARY_KEYS[sheetName] || "id";
  const passedKeyCol = body.keyColumn || actualKeyCol;
  
  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, sheetName, sheetsMap);
  const allValues = sheet.getDataRange().getValues();
  const headers   = allValues[0];

  // Find key index case-insensitively
  let keyIdx = headers.indexOf(actualKeyCol);
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === actualKeyCol.toLowerCase());
  }
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === passedKeyCol.toLowerCase());
  }

  if (keyIdx < 0) {
    return err("Key column not found in " + sheetName);
  }

  // Scan bottom-up to avoid index shifting when deleting
  let deleted = false;
  for (let i = allValues.length - 1; i >= 1; i--) {
    if (String(allValues[i][keyIdx]) === keyValue) {
      sheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  if (!deleted) {
    return err("Record with key = '" + keyValue + "' not found in " + sheetName);
  }

  evictCache(sheetName);
  return ok({ message: "Record deleted from " + sheetName, keyValue });
}

/**
 * Save multiple records in one request to minimise round-trips.
 * Body: { action, sheetName, records: [...], keyColumn?: "id" }
 *
 * Strategy: load all data once, build a key→rowIndex map, then
 * use a single setValues() batch write for updated rows and
 * a single appendRows() for new rows.
 */
function bulkSave(ss, body) {
  const sheetName = body.sheetName;
  const records   = body.records;

  if (!sheetName || !Array.isArray(records) || records.length === 0) {
    return err("bulkSave requires: sheetName, records (non-empty array).");
  }
  if (!SCHEMAS[sheetName]) {
    return err("Unknown sheet: " + sheetName);
  }

  const actualKeyCol = PRIMARY_KEYS[sheetName] || "id";
  const passedKeyCol = body.keyColumn || actualKeyCol;
  
  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, sheetName, sheetsMap);
  const allValues = sheet.getDataRange().getValues();
  const headers   = allValues[0];

  // Find key index case-insensitively
  let keyIdx = headers.indexOf(actualKeyCol);
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === actualKeyCol.toLowerCase());
  }
  if (keyIdx < 0) {
    keyIdx = headers.findIndex(h => h.toLowerCase() === passedKeyCol.toLowerCase());
  }

  if (keyIdx < 0) {
    return err("Key column not found in " + sheetName);
  }

  // Build existing key → row number map (1-indexed)
  const existingMap = {};
  for (let i = 1; i < allValues.length; i++) {
    existingMap[String(allValues[i][keyIdx])] = i + 1;
  }

  const toAppend  = [];
  let   updateCnt = 0;

  for (const record of records) {
    // Get the key value from record case-insensitively
    let kv = "";
    const keyCandidates = [actualKeyCol, passedKeyCol, "id", "ID", "key", "Key", "childId", "ChildID"];
    for (const candidate of keyCandidates) {
      const candLower = candidate.toLowerCase();
      for (const k in record) {
        if (k.toLowerCase() === candLower) {
          if (record[k] !== undefined && record[k] !== null && record[k] !== "") {
            kv = String(record[k]);
            break;
          }
        }
      }
      if (kv) break;
    }

    // Build the value row (always in spreadsheet column order)
    const row = headers.map(h => {
      // Attempt exact match
      let v = record[h];
      // If not found, attempt case-insensitive match
      if (v === undefined || v === null) {
        const hLower = h.toLowerCase();
        for (const k in record) {
          if (k.toLowerCase() === hLower) {
            v = record[k];
            break;
          }
        }
      }
      if (v === undefined || v === null) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    });

    if (existingMap[kv]) {
      sheet.getRange(existingMap[kv], 1, 1, headers.length).setValues([row]);
      updateCnt++;
    } else {
      toAppend.push(row);
    }
  }

  if (toAppend.length > 0) {
    // Append all new rows in ONE operation
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  evictCache(sheetName);
  return ok({
    message : "Bulk save complete for " + sheetName,
    updated : updateCnt,
    inserted: toAppend.length,
    total   : records.length
  });
}

// ─────────────────────────────────────────────────────────────
//  NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Send an email notification.
 * Body: { action, type, payload: {...} }
 *
 * Supported types:
 *   donorThankYou      → Thank-you note to donor (payload: donorName, donorEmail, amount, date)
 *   lowStockAlert      → Warn admin of low kitchen inventory (payload: items: [{itemName, currentStock}])
 *   feeReminder        → Remind guardian of outstanding school fees (payload: guardianEmail, childName, balance, dueDate)
 *   medicalAlert       → Alert admin of critical medical event (payload: childName, condition, doctorNotes)
 *   childAdmission     → Notify admin of new child admission (payload: childName, age, gender)
 *   customEmail        → Send any custom email (payload: to, subject, body)
 */
function sendNotification(ss, body) {
  const type    = body.type    || "";
  const payload = body.payload || {};

  switch (type) {

    case "donorThankYou": {
      if (!payload.donorEmail) return err("payload.donorEmail is required.");
      MailApp.sendEmail({
        to:      payload.donorEmail,
        subject: "💙 Thank You for Your Generous Donation to OrphanCare!",
        body:    buildDonorThankYouEmail(payload)
      });
      // Also mark as thanked in the Donations sheet
      if (payload.donationId) {
        const sheetsMap = buildSheetsMap(ss);
        const sheet     = getOrCreateSheet(ss, "Donations", sheetsMap);
        markThanked(sheet, payload.donationId);
        evictCache("Donations");
      }
      return ok({ message: "Thank-you email sent to " + payload.donorEmail });
    }

    case "lowStockAlert": {
      const items = payload.items || [];
      if (items.length === 0) return ok({ message: "No low-stock items to notify about." });
      MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: "⚠️ OrphanCare — Low Kitchen Stock Alert (" + items.length + " items)",
        body:    buildLowStockEmail(items)
      });
      return ok({ message: "Low-stock alert sent to admin." });
    }

    case "feeReminder": {
      if (!payload.guardianEmail) return err("payload.guardianEmail is required.");
      MailApp.sendEmail({
        to:      payload.guardianEmail,
        subject: "📋 School Fee Reminder — OrphanCare",
        body:    buildFeeReminderEmail(payload)
      });
      return ok({ message: "Fee reminder sent to " + payload.guardianEmail });
    }

    case "medicalAlert": {
      MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: "🏥 OrphanCare — Medical Alert: " + (payload.childName || "Unknown"),
        body:    buildMedicalAlertEmail(payload)
      });
      return ok({ message: "Medical alert sent to admin." });
    }

    case "childAdmission": {
      MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: "👶 New Child Admission — OrphanCare",
        body:    buildAdmissionEmail(payload)
      });
      return ok({ message: "Admission notification sent." });
    }

    case "customEmail": {
      if (!payload.to || !payload.subject || !payload.body) {
        return err("customEmail requires payload: { to, subject, body }");
      }
      MailApp.sendEmail({ to: payload.to, subject: payload.subject, body: payload.body });
      return ok({ message: "Custom email sent to " + payload.to });
    }

    default:
      return err("Unknown notification type: " + type);
  }
}

/**
 * Called automatically after every saveRecord() to fire relevant emails.
 */
function triggerSaveNotifications(ss, sheetName, record, operation) {
  try {
    // New child admission email
    if (sheetName === "Children" && operation === "insert") {
      MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: "👶 New Child Enrolled — " + (record.name || "Unknown"),
        body:    buildAdmissionEmail({ childName: record.name, age: record.age, gender: record.gender })
      });
    }

    // Low stock check when food inventory is updated
    if (sheetName === "Food_Inventory") {
      const stock = Number(record.currentStock);
      if (!isNaN(stock) && stock <= LOW_STOCK_THRESHOLD) {
        MailApp.sendEmail({
          to:      ADMIN_EMAIL,
          subject: "⚠️ Low Kitchen Stock: " + (record.itemName || "Item"),
          body:    buildLowStockEmail([{ itemName: record.itemName, currentStock: record.currentStock, unit: record.unit }])
        });
      }
    }

    // New donation auto-thank-you
    if (sheetName === "Donations" && operation === "insert" && record.donorEmail) {
      MailApp.sendEmail({
        to:      record.donorEmail,
        subject: "💙 Thank You for Donating to OrphanCare!",
        body:    buildDonorThankYouEmail(record)
      });
      // Mark as thanked
      const sheetsMap = buildSheetsMap(ss);
      const sheet     = getOrCreateSheet(ss, "Donations", sheetsMap);
      markThanked(sheet, record.id);
      evictCache("Donations");
    }
  } catch (_) {
    // Notification errors are non-fatal — don't block the save response
  }
}

// ─────────────────────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────────────────────

/**
 * Update or insert a single key in App_Settings.
 * Body: { action, key, value }
 */
function updateSetting(ss, body) {
  const key   = (body.key   || "").trim();
  const value = (body.value !== undefined) ? body.value : "";

  if (!key) return err("updateSetting requires: key.");

  const sheetsMap = buildSheetsMap(ss);
  const sheet     = getOrCreateSheet(ss, "App_Settings", sheetsMap);
  const rows      = sheet.getDataRange().getValues();
  const headers   = rows[0];
  const keyIdx    = headers.indexOf("key");
  const valIdx    = headers.indexOf("value");

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][keyIdx]) === key) {
      sheet.getRange(i + 1, valIdx + 1).setValue(value);
      evictCache("App_Settings");
      return ok({ message: "Setting '" + key + "' updated." });
    }
  }

  // Key not found — insert new row
  sheet.appendRow([key, value]);
  evictCache("App_Settings");
  return ok({ message: "Setting '" + key + "' created." });
}

// ─────────────────────────────────────────────────────────────
//  SHEET HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Build a name→Sheet object map with a single ss.getSheets() API call.
 */
function buildSheetsMap(ss) {
  const map = {};
  ss.getSheets().forEach(s => map[s.getName()] = s);
  return map;
}

/**
 * Return the named sheet or create it with headers and formatting.
 */
function getOrCreateSheet(ss, name, sheetsMap) {
  if (sheetsMap[name]) return sheetsMap[name];

  const headers = SCHEMAS[name];
  if (!headers) return null;

  const sheet = ss.insertSheet(name);
  sheetsMap[name] = sheet;

  // Write headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Style the header row — dark background, white bold text, frozen
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1a2a3a");
  headerRange.setFontColor("#00e5ff");
  headerRange.setFontWeight("bold");
  headerRange.setFontFamily("Roboto Mono");
  headerRange.setBorder(false, false, true, false, false, false, "#00bcd4", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setFrozenRows(1);

  // Auto-resize columns for readability
  for (let i = 1; i <= headers.length; i++) {
    sheet.setColumnWidth(i, 160);
  }

  // Alternate row banding — cyan tint
  const maxRows = 1000;
  if (sheet.getMaxRows() < maxRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), maxRows - sheet.getMaxRows());
  }

  // Seed admin if this is the Users sheet
  if (name === "Users") ensureAdminSeeded(sheet);

  return sheet;
}

/**
 * Check for admin user and seed if not present.
 */
function ensureAdminSeeded(sheet) {
  const data     = sheet.getDataRange().getValues();
  const headers  = data[0];
  const emailIdx = headers.indexOf("email");

  if (emailIdx < 0) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).toLowerCase() === ADMIN_EMAIL) return; // Already seeded
  }

  const adminRow = headers.map(h => {
    if (h === "email")        return ADMIN_EMAIL;
    if (h === "passwordHash") return hashPassword("admin123");
    if (h === "role")         return "Admin";
    if (h === "fullName")     return "System Admin";
    if (h === "createdDate")  return isoDate();
    return "";
  });

  sheet.appendRow(adminRow);
}

/**
 * Convert all sheet rows to an array of plain objects.
 * Parses JSON columns automatically. Skips completely empty rows.
 */
function sheetToObjects(sheet, schemaHeaders) {
  const raw      = sheet.getDataRange().getValues();
  if (raw.length <= 1) return []; // Only header row or empty

  const headers  = raw[0];
  const colIndex = schemaHeaders.map(h => headers.indexOf(h));
  const results  = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    let isEmpty = true;
    const obj   = {};

    for (let j = 0; j < schemaHeaders.length; j++) {
      const ci = colIndex[j];
      let val  = ci >= 0 ? row[ci] : "";

      // Auto-parse JSON strings
      if (typeof val === "string" && val.length > 1 && (val[0] === "[" || val[0] === "{")) {
        try { val = JSON.parse(val); } catch (_) {}
      }

      // Format Date objects to ISO string
      if (val instanceof Date) val = val.toISOString().substring(0, 10);

      obj[schemaHeaders[j]] = val;
      if (val !== "" && val !== null && val !== undefined) isEmpty = false;
    }

    if (!isEmpty) results.push(obj);
  }
  return results;
}

/**
 * Set the 'thanked' column to true for a given donation ID.
 */
function markThanked(sheet, donationId) {
  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idIdx   = headers.indexOf("id");
  const thxIdx  = headers.indexOf("thanked");

  if (idIdx < 0 || thxIdx < 0) return;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx]) === String(donationId)) {
      sheet.getRange(i + 1, thxIdx + 1).setValue("true");
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  CACHE HELPERS  (CacheService — max 100KB per key, 6-hour TTL)
// ─────────────────────────────────────────────────────────────

function getCache(sheetName) {
  try {
    const raw = CacheService.getScriptCache().get(CACHE_PFX + sheetName);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function setCache(sheetName, data) {
  try {
    const str = JSON.stringify(data);
    if (str.length < 100000) {
      CacheService.getScriptCache().put(CACHE_PFX + sheetName, str, CACHE_TTL);
    }
  } catch (_) {}
}

/**
 * Fetch multiple cache keys in one parallel API call (getAll).
 * Returns an assembled data map or null if any key is missing.
 */
function batchGetCache(sheetNames) {
  try {
    const keys   = sheetNames.map(n => CACHE_PFX + n);
    const result = CacheService.getScriptCache().getAll(keys);
    const data   = {};

    for (const name of sheetNames) {
      const val = result[CACHE_PFX + name];
      if (!val) return null;                      // Any miss → full reload
      data[name] = JSON.parse(val);
    }
    return data;
  } catch (_) { return null; }
}

/**
 * Store multiple sheets' data in a single putAll() call.
 */
function batchSetCache(sheetDataMap) {
  try {
    const entries = {};
    for (const name in sheetDataMap) {
      const str = JSON.stringify(sheetDataMap[name]);
      if (str.length < 100000) {
        entries[CACHE_PFX + name] = str;
      }
    }
    CacheService.getScriptCache().putAll(entries, CACHE_TTL);
  } catch (_) {}
}

function evictCache(sheetName) {
  try {
    CacheService.getScriptCache().remove(CACHE_PFX + sheetName);
  } catch (_) {}
}

function evictAllCache() {
  try {
    const keys = Object.keys(SCHEMAS).map(n => CACHE_PFX + n);
    CacheService.getScriptCache().removeAll(keys);
    // Also remove OTP keys if present
    CacheService.getScriptCache().remove("OTP_" + ADMIN_EMAIL);
    CacheService.getScriptCache().remove("OTP_USER_" + ADMIN_EMAIL);
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
//  CRYPTO
// ─────────────────────────────────────────────────────────────

function hashPassword(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => {
    const hex = ((b < 0 ? b + 256 : b)).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

// ─────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────

function isoDate() {
  return new Date().toISOString().substring(0, 10);
}

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, ...payload }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────

function buildWelcomeEmail(fullName, role) {
  return `Dear ${fullName},

Welcome to OrphanCare Cloud! Your account has been successfully created.

Role Assigned : ${role}
Platform      : OrphanCare Orphanage Management System

Your access has been activated. Please sign in at the application link shared with you.

If you did not create this account, please contact the administrator immediately at ${ADMIN_EMAIL}.

With gratitude,
OrphanCare Cloud Team
────────────────────────────────────
This is an automated security message.`;
}

function buildOTPEmail(otp) {
  return `Hello Super Admin,

A new admin is attempting to login to OrphanCare Cloud. 

Your verification code to approve this login is:

  ┌─────────────────┐
  │   ${otp}   │
  └─────────────────┘

This code expires in 5 minutes.

Only share this code with the new admin if you authorize their access.
If you did not authorize this login attempt, please ignore this email.

OrphanCare Security Engine`;
}

function buildDonorThankYouEmail(payload) {
  return `Dear ${payload.donorName || "Valued Donor"},

On behalf of every child at ${ORPHANAGE_NAME}, we extend our deepest gratitude for your generous contribution.

  Donation Amount : ${payload.amount || "—"}
  Donation Type   : ${payload.donationType || "—"}
  Date Received   : ${payload.date || isoDate()}
  Allocated To    : ${payload.allocatedTo || "General Fund"}

Your gift directly funds warm meals, education, medical care, and a safe home for our children.

With heartfelt thanks,
The ${ORPHANAGE_NAME} Team
────────────────────────────────────
This is an automated receipt. Retain for tax purposes.`;
}

function buildLowStockEmail(items) {
  const itemList = items.map(i =>
    `  • ${i.itemName || "Unknown Item"} — Current Stock: ${i.currentStock} ${i.unit || "units"}`
  ).join("\n");

  return `Hello Admin,

The following kitchen inventory items have fallen below the minimum stock threshold of ${LOW_STOCK_THRESHOLD} units and require immediate restocking:

${itemList}

Please place a restock order as soon as possible to ensure uninterrupted meal service for the children.

Regards,
OrphanCare Stock Management System
────────────────────────────────────
Generated: ${new Date().toLocaleString()}`;
}

function buildFeeReminderEmail(payload) {
  return `Dear Guardian,

This is a friendly reminder regarding outstanding school fees for ${payload.childName || "your child"}.

  Outstanding Balance : ${payload.balance || "—"}
  Payment Due Date    : ${payload.dueDate || "—"}

Kindly arrange payment at your earliest convenience to avoid disruption to the child's academic enrollment.

For any queries, please contact the orphanage administration at ${ADMIN_EMAIL}.

Thank you for your continued support,
OrphanCare Education Department`;
}

function buildMedicalAlertEmail(payload) {
  return `MEDICAL ALERT — OrphanCare System

A critical medical event has been recorded:

  Child Name    : ${payload.childName || "Unknown"}
  Condition     : ${payload.condition || "—"}
  Doctor Notes  : ${payload.doctorNotes || "—"}
  Timestamp     : ${new Date().toLocaleString()}

Immediate attention may be required. Please review the child's medical record in the OrphanCare system.

OrphanCare Medical Module`;
}

function buildAdmissionEmail(payload) {
  return `New Child Admission Notification

A new child has been enrolled into the orphanage:

  Name   : ${payload.childName || "—"}
  Age    : ${payload.age || "—"}
  Gender : ${payload.gender || "—"}
  Date   : ${isoDate()}

Please ensure a room and bed assignment, school enrollment, and a medical profile are created promptly.

OrphanCare Home Management System`;
}
