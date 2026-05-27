/**
 * Google Apps Script for Orphanage Management System
 * Optimized for fast CRUD operations (< 1 second response time)
 */

// Configuration
const SHEET_NAME = 'Data';
const CACHE_DURATION = 300; // 5 minutes cache
const DEFAULT_ADMIN_OTP_EMAIL = 'theesquire2020@gmail.com';
const OTP_CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Handle GET requests - Read operations
 */
function doGet(e) {
  if (!e || !e.parameter) {
    return jsonResponse({ success: false, error: 'No parameters provided. Use ?action=testConnection, ?action=setup, ?action=readAll or ?action=readById&id=123' });
  }
  
  const action = e.parameter.action;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  console.log('doGet called with action:', action);
  console.log('All parameters:', e.parameter);
  
  try {
    if (action === 'testConnection') {
      return jsonResponse({ 
        success: true, 
        message: 'Connected!', 
        spreadsheet: ss.getName(), 
        timestamp: new Date().toISOString() 
      });
    }
    
    if (action === 'setup') {
      return jsonResponse(runSetup(ss));
    }
    
    // Read all sheets (multi-sheet support)
    if (action === 'readAll') {
      try {
        return jsonResponse(readAllSheets(ss));
      } catch(error) {
        return jsonResponse({ success: false, error: error.toString() });
      }
    }
    
    // Read single sheet
    if (action === 'readSheet') {
      const sheetName = e.parameter.sheet;
      if (!sheetName) return jsonResponse({ success: false, error: 'Missing sheet parameter' });
      return jsonResponse(readOneSheet(ss, sheetName));
    }
    
    const sheet = getSheet();
    
    switch(action) {
      case 'readById':
        return jsonResponse(readById(sheet, e.parameter.id));
      case 'readByRange':
        return jsonResponse(readByRange(sheet, e.parameter.startRow, e.parameter.endRow));
      default:
        console.log('Unknown action received:', action);
        return jsonResponse({ success: false, error: 'Invalid action: ' + action });
    }
  } catch(error) {
    console.log('Error in doGet:', error);
    return jsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * Handle POST requests - Create, Update, Delete operations
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Debug logging
  console.log('doPost called');
  
  try {
    const data = JSON.parse(e.postData.contents);
    console.log('doPost action:', data.action);
    
    // Multi-sheet saveRecord action (compatible with frontend)
    if (data.action === 'saveRecord') {
      return jsonResponse(saveRecord(ss, data));
    }
    
    // Delete record action
    if (data.action === 'deleteRecord') {
      return jsonResponse(deleteRecord(ss, data));
    }
    
    // Authentication actions
    if (data.action === 'loginUser') {
      return jsonResponse(loginUser(ss, data));
    }
    
    if (data.action === 'registerUser') {
      return jsonResponse(registerUser(ss, data));
    }
    
    if (data.action === 'verifyAdminOTP') {
      return jsonResponse(verifyAdminOTP(ss, data));
    }
    
    // Original single-sheet actions
    const sheet = getSheet();
    switch(data.action) {
      case 'create':
        return jsonResponse(createData(sheet, data.rowData));
      case 'update':
        return jsonResponse(updateData(sheet, data.rowId, data.rowData));
      case 'delete':
        return jsonResponse(deleteData(sheet, data.rowId));
      case 'batchCreate':
        return jsonResponse(batchCreate(sheet, data.rows));
      case 'batchUpdate':
        return jsonResponse(batchUpdate(sheet, data.updates));
      case 'batchDelete':
        return jsonResponse(batchDelete(sheet, data.rowIds));
      case 'sync':
        return jsonResponse(syncData(sheet, data.clientData, data.lastSyncTime));
      default:
        console.log('Unknown POST action received:', data.action);
        return jsonResponse({ success: false, error: 'Invalid action: ' + data.action });
    }
  } catch(error) {
    console.log('Error in doPost:', error);
    return jsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * Get or create the sheet with headers
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // Create header row
    sheet.getRange(1, 1, 1, 10).setValues([['ID', 'Name', 'Age', 'Gender', 'AdmissionDate', 'Status', 'Guardian', 'Contact', 'Notes', 'LastModified']]);
    // Format header row
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF').setHorizontalAlignment('center');
  } else {
    // Check if headers exist, if not add them
    const firstRow = sheet.getRange(1, 1, 1, 10).getValues()[0];
    if (!firstRow[0] || firstRow[0] !== 'ID') {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, 10).setValues([['ID', 'Name', 'Age', 'Gender', 'AdmissionDate', 'Status', 'Guardian', 'Contact', 'Notes', 'LastModified']]);
      sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF').setHorizontalAlignment('center');
    }
  }
  
  return sheet;
}

/**
 * Create sheet with default headers based on sheet name
 */
function createSheetWithHeaders(ss, sheetName) {
  const sheetConfig = {
    'Children': ['ID', 'FullName', 'DateOfBirth', 'Gender', 'AdmissionDate', 'Status', 'RoomID', 'BedNumber', 'GuardianName', 'GuardianContact', 'MedicalNotes', 'PortraitUrl', 'LastModified'],
    'Rooms': ['ID', 'RoomNumber', 'Capacity', 'CurrentOccupancy', 'RoomType', 'Floor', 'Supervisor', 'Notes', 'LastModified'],
    'Food_Inventory': ['ID', 'ItemName', 'Category', 'Quantity', 'Unit', 'ExpiryDate', 'Supplier', 'CostPerUnit', 'LastModified'],
    'Daily_Meals': ['ID', 'Date', 'MealType', 'MenuItems', 'PreparedBy', 'ServedCount', 'Notes', 'LastModified'],
    'School_Enrollment': ['ID', 'ChildID', 'SchoolName', 'Grade', 'EnrollmentDate', 'Status', 'FeesPaid', 'LastModified'],
    'School_Fees': ['ID', 'ChildID', 'Term', 'Amount', 'DueDate', 'PaymentDate', 'PaymentMethod', 'Status', 'LastModified'],
    'Academic_Reports': ['ID', 'ChildID', 'Term', 'Subject', 'Grade', 'Comments', 'ReportDate', 'LastModified'],
    'Medical_Records': ['ChildID', 'BloodType', 'Allergies', 'ChronicConditions', 'VaccinationsJson', 'DoctorVisitsJson', 'DispensedMedsJson', 'LastModified'],
    'Finances': ['ID', 'TransactionDate', 'Category', 'Description', 'Amount', 'Type', 'Reference', 'LastModified'],
    'Donations': ['ID', 'DonorName', 'DonorEmail', 'Amount', 'DonationDate', 'Type', 'Notes', 'LastModified'],
    'App_Settings': ['ID', 'SettingKey', 'SettingValue', 'DisplayCurrency', 'ExchangeRates', 'LastModified'],
    'Users': ['ID', 'Email', 'PasswordHash', 'FullName', 'Role', 'CreatedDate', 'LastModified']
  };
  
  const headers = sheetConfig[sheetName] || ['id', 'lastModified'];
  const sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4285F4')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');
  
  return sheet;
}

/**
 * Save record to specific sheet (multi-sheet support)
 */
function saveRecord(ss, data) {
  const sheetName = data.sheetName;
  const record = data.record;
  const keyColumn = data.keyColumn || 'id';
  
  if (!sheetName || !record) {
    return { success: false, error: 'saveRecord requires: sheetName, record' };
  }
  
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = createSheetWithHeaders(ss, sheetName);
  }
  
  let headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missingHeaders = Object.keys(record).filter(key => headerRow.indexOf(key) === -1);
  if (missingHeaders.length > 0) {
    const startCol = headerRow.length + 1;
    sheet.getRange(1, startCol, 1, missingHeaders.length).setValues([missingHeaders]);
    headerRow = headerRow.concat(missingHeaders);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    if (!record.ID && !record.id) {
      record.ID = generateId();
      record.id = record.ID;
    }
    const newValues = headerRow.map(header => Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '');
    sheet.appendRow(newValues);
    return { success: true, message: 'Record created', operation: 'create', sheetName: sheetName, id: record.ID };
  }
  
  const keyValue = getValueByKeyVariants(record, keyColumn);
  if (keyValue === undefined || keyValue === null || keyValue === '') {
    return { success: false, error: 'Missing key value for column: ' + keyColumn };
  }
  const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = dataRange.getValues();
  
  const keyCandidates = [keyColumn, normalizeKeyName(keyColumn), keyColumn.toLowerCase(), keyColumn.toUpperCase()];
  const keyIndexes = [];
  keyCandidates.forEach(candidate => {
    const idx = headerRow.indexOf(candidate);
    if (idx !== -1 && keyIndexes.indexOf(idx) === -1) {
      keyIndexes.push(idx);
    }
  });
  
  if (keyIndexes.length === 0) {
    return { success: false, error: 'Key column not found: ' + keyColumn };
  }
  
  let rowIndex = -1;
  for (let i = 0; i < values.length; i++) {
    const matched = keyIndexes.some(index => values[i][index] && values[i][index].toString() === keyValue.toString());
    if (matched) {
      rowIndex = i + 2;
      break;
    }
  }
  
  if (rowIndex !== -1) {
    const updateValues = headerRow.map(header => Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '');
    sheet.getRange(rowIndex, 1, 1, headerRow.length).setValues([updateValues]);
    return { success: true, message: 'Record updated', operation: 'update', sheetName: sheetName };
  } else {
    if (!record.ID && !record.id) {
      record.ID = generateId();
      record.id = record.ID;
    }
    const newValues = headerRow.map(header => Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '');
    sheet.appendRow(newValues);
    return { success: true, message: 'Record created', operation: 'create', sheetName: sheetName, id: record.ID };
  }
}

/**
 * Delete record from specific sheet
 */
function deleteRecord(ss, data) {
  const sheetName = data.sheetName;
  const keyColumn = data.keyColumn || 'id';
  const keyValue = data.keyValue;
  
  if (!sheetName || !keyValue) {
    return { success: false, error: 'deleteRecord requires: sheetName, keyValue' };
  }
  
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: false, error: 'Sheet is empty' };
  }
  
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const keyVariants = [keyColumn, normalizeKeyName(keyColumn), keyColumn.toLowerCase(), keyColumn.toUpperCase()];
  let keyIndex = -1;
  for (const variant of keyVariants) {
    keyIndex = headerRow.indexOf(variant);
    if (keyIndex !== -1) break;
  }
  
  if (keyIndex === -1) {
    return { success: false, error: 'Key column not found: ' + keyColumn };
  }
  
  const dataRange = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = dataRange.getValues();
  
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][keyIndex] && values[i][keyIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 2);
      return { success: true, message: 'Record deleted' };
    }
  }
  
  return { success: false, error: 'Record not found' };
}

/**
 * Read all sheets data
 */
function readAllSheets(ss) {
  try {
    const sheetNames = ['Children', 'Rooms', 'Food_Inventory', 'Daily_Meals', 'School_Enrollment', 
                        'School_Fees', 'Academic_Reports', 'Medical_Records', 'Finances', 'Donations', 
                        'App_Settings', 'Users'];
    
    const allData = {};
    
    for (const sheetName of sheetNames) {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet) {
          const lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
            const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
            
            const formattedData = data.map(row => {
              const obj = {};
              headers.forEach((header, index) => {
                obj[header] = row[index];
              });
              return obj;
            });
            
            // Convert sheet name to lowercase for frontend compatibility
            allData[sheetName.toLowerCase()] = formattedData;
          } else {
            allData[sheetName.toLowerCase()] = [];
          }
        } else {
          allData[sheetName.toLowerCase()] = [];
        }
      } catch(sheetError) {
        console.error('Error reading sheet ' + sheetName + ': ' + sheetError.toString());
        allData[sheetName.toLowerCase()] = [];
      }
    }
    
    return { success: true, data: allData, fromCache: false };
  } catch(error) {
    console.error('Error in readAllSheets: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * Read single sheet data
 */

function findHeaderIndex(headers, headerName) {
  const lowerHeaderName = headerName.toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && headers[i].toLowerCase() === lowerHeaderName) {
      return i;
    }
  }
  return -1;
}

/**
 * Authentication - Login User
 */
function loginUser(ss, data) {
  const email = (data.email || "").trim().toLowerCase();
  const password = data.password || "";
  
  if (!email || !password) {
    return { success: false, error: "Email and password are required" };
  }
  
  const usersSheet = ss.getSheetByName('Users');
  if (!usersSheet) {
    return { success: false, error: "Users sheet not found" };
  }
  
  const lastRow = usersSheet.getLastRow();
  if (lastRow <= 1) {
    return { success: false, error: "No users registered" };
  }
  
  const userData = usersSheet.getRange(2, 1, lastRow - 1, usersSheet.getLastColumn()).getValues();
  const headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
  const emailIndex = findHeaderIndex(headers, 'Email');
  const passwordIndex = findHeaderIndex(headers, 'PasswordHash');
  const roleIndex = findHeaderIndex(headers, 'Role');
  const nameIndex = findHeaderIndex(headers, 'FullName');
  if (emailIndex === -1 || passwordIndex === -1 || roleIndex === -1 || nameIndex === -1) {
    return { success: false, error: "Users sheet headers are invalid" };
  }

  const passwordHash = hashPasswordSha256(password);
  
  const user = userData.find(row => {
    const rowEmail = row[emailIndex] ? row[emailIndex].toString().toLowerCase() : '';
    const rowPasswordHash = row[passwordIndex] ? row[passwordIndex].toString() : '';
    return rowEmail === email && rowPasswordHash === passwordHash;
  });
  
  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }
  
// For admin, require OTP - ALWAYS sent to super admin email
   if (user[roleIndex] === 'Admin') {
     const otpResult = issueAndSendAdminOtp(DEFAULT_ADMIN_OTP_EMAIL, email);
     if (!otpResult.success) return otpResult;

     return { 
       success: true, 
       otpRequired: true, 
       message: "OTP required for admin login. Code sent to super admin email.",
       otpEmail: DEFAULT_ADMIN_OTP_EMAIL,
       registeredAdmin: email
     };
   }
  
  return {
    success: true,
    otpRequired: false,
    user: {
      email: email,
      role: user[roleIndex],
      fullName: user[nameIndex]
    }
  };
}

/**
 * Authentication - Register User
 */
function registerUser(ss, data) {
  const email = (data.email || "").trim().toLowerCase();
  const password = data.password || "";
  const fullName = data.fullName || "";
  const role = data.role || "Staff";
  
  if (!email || !password || !fullName) {
    return { success: false, error: "Email, password, and full name are required" };
  }
  
  const usersSheet = ss.getSheetByName('Users');
  if (!usersSheet) {
    return { success: false, error: "Users sheet not found" };
  }

  
  // Check if user already exists
  const lastRow = usersSheet.getLastRow();
  if (lastRow > 1) {
    const userData = usersSheet.getRange(2, 1, lastRow - 1, usersSheet.getLastColumn()).getValues();
    const headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    const emailIndex = findHeaderIndex(headers, 'Email');
    
    const existingUser = userData.find(row => row[emailIndex] && row[emailIndex].toString().toLowerCase() === email);
    if (existingUser) {
      return { success: false, error: "Email already registered" };
    }
  }
  
  // Create password hash (simple hash for demo - in production use proper hashing)
  const passwordHash = hashPasswordSha256(password);
  
  usersSheet.appendRow([
    Utilities.getUuid(),
    email,
    passwordHash,
    fullName,
    role,
    new Date().toISOString().substring(0, 10),
    new Date().toISOString()
  ]);
  
  return { success: true, message: "Registration successful" };
}

/**
 * Authentication - Verify Admin OTP
 */
function verifyAdminOTP(ss, data) {
  const otp = (data.otp || "").toString().trim();
  const cache = CacheService.getScriptCache();
  
  // Always use super admin email for OTP lookup
  const otpKey = DEFAULT_ADMIN_OTP_EMAIL;
  const cachedOtp = cache.get(getOtpCacheKey(otpKey));
  
  // Get the registered admin email BEFORE removing cache
  const registeredAdminEmail = cache.get(getOtpLoginEmailCacheKey(otpKey)) || otpKey;

  if (!cachedOtp) {
    return { success: false, error: "OTP expired or not requested. Please login again." };
  }
  if (otp !== cachedOtp) {
    return { success: false, error: "Invalid OTP code" };
  }

  cache.remove(getOtpCacheKey(otpKey));
  cache.remove(getOtpLoginEmailCacheKey(otpKey));

  // Get user by the registered admin email (not the super admin email)
  const user = getUserByEmail(ss, registeredAdminEmail);
  if (!user || user.role !== 'Admin') {
    return { success: false, error: 'Admin account not found for OTP verification' };
  }
  return {
    success: true,
    user: {
      email: user.email,
      role: 'Admin',
      fullName: user.fullName || 'System Admin'
    }
  };
}

/**
 * Read single sheet data
 */
function readOneSheet(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return { success: false, error: 'Sheet not found: ' + sheetName };
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, data: [] };
  }
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
const formattedData = data.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
  
  return { success: true, data: formattedData };
}

/**
 * Run database setup - create all required sheets
 */
function runSetup(ss) {
  const sheets = [
    {
      name: 'Children',
      headers: ['ID', 'FullName', 'DateOfBirth', 'Gender', 'AdmissionDate', 'Status', 'RoomID', 'BedNumber', 'GuardianName', 'GuardianContact', 'MedicalNotes', 'PortraitUrl', 'LastModified']
    },
    {
      name: 'Rooms',
      headers: ['ID', 'RoomNumber', 'Capacity', 'CurrentOccupancy', 'RoomType', 'Floor', 'Supervisor', 'Notes', 'LastModified']
    },
    {
      name: 'Food_Inventory',
      headers: ['ID', 'ItemName', 'Category', 'Quantity', 'Unit', 'ExpiryDate', 'Supplier', 'CostPerUnit', 'LastModified']
    },
    {
      name: 'Daily_Meals',
      headers: ['ID', 'Date', 'MealType', 'MenuItems', 'PreparedBy', 'ServedCount', 'Notes', 'LastModified']
    },
    {
      name: 'School_Enrollment',
      headers: ['ID', 'ChildID', 'SchoolName', 'Grade', 'EnrollmentDate', 'Status', 'FeesPaid', 'LastModified']
    },
    {
      name: 'School_Fees',
      headers: ['ID', 'ChildID', 'Term', 'Amount', 'DueDate', 'PaymentDate', 'PaymentMethod', 'Status', 'LastModified']
    },
    {
      name: 'Academic_Reports',
      headers: ['ID', 'ChildID', 'Term', 'Subject', 'Grade', 'Comments', 'ReportDate', 'LastModified']
    },
    {
      name: 'Medical_Records',
      headers: ['ChildID', 'BloodType', 'Allergies', 'ChronicConditions', 'VaccinationsJson', 'DoctorVisitsJson', 'DispensedMedsJson', 'LastModified']
    },
    {
      name: 'Finances',
      headers: ['ID', 'TransactionDate', 'Category', 'Description', 'Amount', 'Type', 'Reference', 'LastModified']
    },
    {
      name: 'Donations',
      headers: ['ID', 'DonorName', 'DonorEmail', 'Amount', 'DonationDate', 'Type', 'Notes', 'LastModified']
    },
    {
      name: 'App_Settings',
      headers: ['ID', 'SettingKey', 'SettingValue', 'DisplayCurrency', 'ExchangeRates', 'LastModified']
    },
    {
      name: 'Users',
      headers: ['ID', 'Email', 'PasswordHash', 'FullName', 'Role', 'CreatedDate', 'LastModified']
    }
  ];
  
  const created = [];
  let existingCount = 0;
  
  for (const sheetConfig of sheets) {
    let sheet = ss.getSheetByName(sheetConfig.name);
    if (!sheet) {
      sheet = ss.insertSheet(sheetConfig.name);
      sheet.getRange(1, 1, 1, sheetConfig.headers.length).setValues([sheetConfig.headers]);
      sheet.getRange(1, 1, 1, sheetConfig.headers.length)
        .setFontWeight('bold')
        .setBackground('#4285F4')
        .setFontColor('#FFFFFF')
        .setHorizontalAlignment('center');
      created.push(sheetConfig.name);
    } else {
      existingCount++;
    }
  }
  
  ensureDefaultAdminOtpSetting(ss);
  
  return {
    success: true,
    message: 'Database setup completed',
    totalSheets: sheets.length,
    created: created,
    existing: existingCount
  };
}

/**
 * READ OPERATIONS
 */

/**
 * Read all data with caching
 */
function readAllData(sheet) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'all_data';
  let cached = cache.get(cacheKey);
  
  if (cached) {
    return { success: true, data: JSON.parse(cached), fromCache: true };
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, data: [], fromCache: false };
  }
  
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const formattedData = data.map((row, index) => ({
    id: row[0],
    name: row[1],
    age: row[2],
    gender: row[3],
    admissionDate: row[4],
    status: row[5],
    guardian: row[6],
    contact: row[7],
    notes: row[8],
    lastModified: row[9],
    rowIndex: index + 2
  }));
  
  cache.put(cacheKey, JSON.stringify(formattedData), CACHE_DURATION);
  return { success: true, data: formattedData, fromCache: false };
}

/**
 * Read by ID
 */
function readById(sheet, id) {
  const data = readAllData(sheet);
  if (!data.success) return data;
  
  const row = data.data.find(r => r.id == id);
  return { success: true, data: row || null };
}

/**
 * Read by range
 */
function readByRange(sheet, startRow, endRow) {
  const lastRow = sheet.getLastRow();
  const actualEndRow = Math.min(endRow, lastRow);
  
  if (startRow > lastRow) {
    return { success: true, data: [] };
  }
  
  const data = sheet.getRange(startRow, 1, actualEndRow - startRow + 1, 10).getValues();
  const formattedData = data.map((row, index) => ({
    id: row[0],
    name: row[1],
    age: row[2],
    gender: row[3],
    admissionDate: row[4],
    status: row[5],
    guardian: row[6],
    contact: row[7],
    notes: row[8],
    lastModified: row[9],
    rowIndex: startRow + index
  }));
  
  return { success: true, data: formattedData };
}

/**
 * CREATE OPERATIONS
 */

/**
 * Create single row
 */
function createData(sheet, rowData) {
  const lastRow = sheet.getLastRow();
  const newId = generateId();
  const timestamp = new Date().toISOString();
  
  const newRow = [
    newId,
    rowData.name || '',
    rowData.age || '',
    rowData.gender || '',
    rowData.admissionDate || '',
    rowData.status || 'Active',
    rowData.guardian || '',
    rowData.contact || '',
    rowData.notes || '',
    timestamp
  ];
  
  sheet.appendRow(newRow);
  clearCache();
  
  return { 
    success: true, 
    id: newId, 
    rowIndex: lastRow + 1,
    lastModified: timestamp 
  };
}

/**
 * Batch create multiple rows
 */
function batchCreate(sheet, rows) {
  const lastRow = sheet.getLastRow();
  const timestamp = new Date().toISOString();
  const newRows = [];
  const results = [];
  
  for (let i = 0; i < rows.length; i++) {
    const newId = generateId();
    newRows.push([
      newId,
      rows[i].name || '',
      rows[i].age || '',
      rows[i].gender || '',
      rows[i].admissionDate || '',
      rows[i].status || 'Active',
      rows[i].guardian || '',
      rows[i].contact || '',
      rows[i].notes || '',
      timestamp
    ]);
    results.push({ id: newId, tempId: rows[i].tempId });
  }
  
  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, 10).setValues(newRows);
    clearCache();
  }
  
  return { success: true, results: results };
}

/**
 * UPDATE OPERATIONS
 */

/**
 * Update single row by ID
 */
function updateData(sheet, rowId, rowData) {
  const data = readAllData(sheet);
  if (!data.success) return data;
  
  const rowIndex = data.data.findIndex(r => r.id == rowId);
  if (rowIndex === -1) {
    return { success: false, error: 'Row not found' };
  }
  
  const actualRowIndex = data.data[rowIndex].rowIndex;
  const timestamp = new Date().toISOString();
  
  const updatedRow = [
    rowId,
    rowData.name !== undefined ? rowData.name : data.data[rowIndex].name,
    rowData.age !== undefined ? rowData.age : data.data[rowIndex].age,
    rowData.gender !== undefined ? rowData.gender : data.data[rowIndex].gender,
    rowData.admissionDate !== undefined ? rowData.admissionDate : data.data[rowIndex].admissionDate,
    rowData.status !== undefined ? rowData.status : data.data[rowIndex].status,
    rowData.guardian !== undefined ? rowData.guardian : data.data[rowIndex].guardian,
    rowData.contact !== undefined ? rowData.contact : data.data[rowIndex].contact,
    rowData.notes !== undefined ? rowData.notes : data.data[rowIndex].notes,
    timestamp
  ];
  
  sheet.getRange(actualRowIndex, 1, 1, 10).setValues([updatedRow]);
  clearCache();
  
  return { success: true, rowIndex: actualRowIndex, lastModified: timestamp };
}

/**
 * Batch update multiple rows
 */
function batchUpdate(sheet, updates) {
  const data = readAllData(sheet);
  if (!data.success) return data;
  
  const rowsToUpdate = [];
  const results = [];
  
  for (const update of updates) {
    const rowIndex = data.data.findIndex(r => r.id == update.rowId);
    if (rowIndex === -1) {
      results.push({ success: false, rowId: update.rowId, error: 'Not found' });
      continue;
    }
    
    const actualRowIndex = data.data[rowIndex].rowIndex;
    const timestamp = new Date().toISOString();
    
    rowsToUpdate.push({
      rowIndex: actualRowIndex,
      values: [
        update.rowId,
        update.rowData.name !== undefined ? update.rowData.name : data.data[rowIndex].name,
        update.rowData.age !== undefined ? update.rowData.age : data.data[rowIndex].age,
        update.rowData.gender !== undefined ? update.rowData.gender : data.data[rowIndex].gender,
        update.rowData.admissionDate !== undefined ? update.rowData.admissionDate : data.data[rowIndex].admissionDate,
        update.rowData.status !== undefined ? update.rowData.status : data.data[rowIndex].status,
        update.rowData.guardian !== undefined ? update.rowData.guardian : data.data[rowIndex].guardian,
        update.rowData.contact !== undefined ? update.rowData.contact : data.data[rowIndex].contact,
        update.rowData.notes !== undefined ? update.rowData.notes : data.data[rowIndex].notes,
        timestamp
      ]
    });
    
    results.push({ success: true, rowId: update.rowId, lastModified: timestamp });
  }
  
  // Batch update all rows
  for (const row of rowsToUpdate) {
    sheet.getRange(row.rowIndex, 1, 1, 10).setValues([row.values]);
  }
  
  clearCache();
  return { success: true, results: results };
}

/**
 * DELETE OPERATIONS
 */

/**
 * Delete single row by ID
 */
function deleteData(sheet, rowId) {
  const data = readAllData(sheet);
  if (!data.success) return data;
  
  const rowIndex = data.data.findIndex(r => r.id == rowId);
  if (rowIndex === -1) {
    return { success: false, error: 'Row not found' };
  }
  
  const actualRowIndex = data.data[rowIndex].rowIndex;
  sheet.deleteRow(actualRowIndex);
  clearCache();
  
  return { success: true, deletedRowIndex: actualRowIndex };
}

/**
 * Batch delete multiple rows
 */
function batchDelete(sheet, rowIds) {
  const data = readAllData(sheet);
  if (!data.success) return data;
  
  // Sort by rowIndex descending to avoid index shifting issues
  const rowsToDelete = rowIds.map(id => {
    const rowIndex = data.data.findIndex(r => r.id == id);
    return rowIndex === -1 ? null : data.data[rowIndex].rowIndex;
  }).filter(r => r !== null).sort((a, b) => b - a);
  
  for (const rowIndex of rowsToDelete) {
    sheet.deleteRow(rowIndex);
  }
  
  clearCache();
  return { success: true, deletedCount: rowsToDelete.length };
}

/**
 * SYNC OPERATIONS
 */

/**
 * Sync data with frontend - optimized for speed
 */
function syncData(sheet, clientData, lastSyncTime) {
  const serverData = readAllData(sheet);
  if (!serverData.success) return serverData;
  
  const syncTime = new Date().toISOString();
  const changes = [];
  const deletions = [];
  
  // Find new/modified records on server
  for (const row of serverData.data) {
    const clientRow = clientData.find(c => c.id == row.id);
    if (!clientRow) {
      // New record on server
      changes.push({ type: 'create', data: row });
    } else if (new Date(row.lastModified) > new Date(clientRow.lastModified)) {
      // Modified on server
      changes.push({ type: 'update', data: row });
    }
  }
  
  // Find deletions (records on client but not on server)
  for (const clientRow of clientData) {
    const serverRow = serverData.data.find(s => s.id == clientRow.id);
    if (!serverRow) {
      deletions.push(clientRow.id);
    }
  }
  
  return {
    success: true,
    syncTime: syncTime,
    changes: changes,
    deletions: deletions,
    serverCount: serverData.data.length
  };
}

/**
 * UTILITY FUNCTIONS
 */

function normalizeKeyName(keyName) {
  if (!keyName) return '';
  return keyName.charAt(0).toUpperCase() + keyName.slice(1);
}

function getValueByKeyVariants(obj, keyName) {
  if (!obj || !keyName) return undefined;
  const variants = [
    keyName,
    normalizeKeyName(keyName),
    keyName.toLowerCase(),
    keyName.toUpperCase()
  ];
  for (const key of variants) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== '' && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function hashPasswordSha256(password) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getAppSettingsMap(ss) {
  const settings = {};
  const settingsSheet = ss.getSheetByName('App_Settings');
  if (!settingsSheet) return settings;
  const lastRow = settingsSheet.getLastRow();
  if (lastRow <= 1) return settings;

  const values = settingsSheet.getRange(2, 1, lastRow - 1, settingsSheet.getLastColumn()).getValues();
  const headers = settingsSheet.getRange(1, 1, 1, settingsSheet.getLastColumn()).getValues()[0];
  const keyIndex = findHeaderIndex(headers, 'SettingKey') !== -1 ? findHeaderIndex(headers, 'SettingKey') : findHeaderIndex(headers, 'key');
  const valueIndex = findHeaderIndex(headers, 'SettingValue') !== -1 ? findHeaderIndex(headers, 'SettingValue') : findHeaderIndex(headers, 'value');
  if (keyIndex === -1 || valueIndex === -1) return settings;

  values.forEach(row => {
    const key = row[keyIndex];
    const value = row[valueIndex];
    if (key !== undefined && key !== null && key !== '') {
      settings[key.toString()] = value !== undefined && value !== null ? value.toString() : '';
    }
  });
  return settings;
}

function getAdminOtpEmail(ss) {
  const settings = getAppSettingsMap(ss);
  const configured = settings.admin_otp_email || settings.ADMIN_OTP_EMAIL || DEFAULT_ADMIN_OTP_EMAIL;
  return configured.toString().trim().toLowerCase();
}

function getOtpCacheKey(adminOtpEmail) {
  return 'oms_admin_otp_' + adminOtpEmail;
}

function getOtpLoginEmailCacheKey(adminOtpEmail) {
  return 'oms_admin_otp_login_' + adminOtpEmail;
}

function issueAndSendAdminOtp(adminOtpEmail, loginEmail) {
  try {
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const cache = CacheService.getScriptCache();
    cache.put(getOtpCacheKey(adminOtpEmail), otp, OTP_CACHE_TTL_SECONDS);
    cache.put(getOtpLoginEmailCacheKey(adminOtpEmail), loginEmail, OTP_CACHE_TTL_SECONDS);

    const subject = 'OrphanCare Admin OTP Code';
    const body = 'Your one-time admin verification code is: ' + otp + '\n\n'
      + 'This code expires in 5 minutes.\n'
      + 'If you did not request this login, ignore this email.';
    MailApp.sendEmail(adminOtpEmail, subject, body);
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Failed to send OTP email: ' + err.toString() };
  }
}

function getUserByEmail(ss, email) {
  const usersSheet = ss.getSheetByName('Users');
  if (!usersSheet) return null;
  const lastRow = usersSheet.getLastRow();
  if (lastRow <= 1) return null;
  const values = usersSheet.getRange(2, 1, lastRow - 1, usersSheet.getLastColumn()).getValues();
  const headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
  const emailIndex = findHeaderIndex(headers, 'Email');
  const roleIndex = findHeaderIndex(headers, 'Role');
  const nameIndex = findHeaderIndex(headers, 'FullName');
  if (emailIndex === -1 || roleIndex === -1 || nameIndex === -1) return null;

  for (let i = 0; i < values.length; i++) {
    const rowEmail = values[i][emailIndex] ? values[i][emailIndex].toString().toLowerCase() : '';
    if (rowEmail === email.toString().toLowerCase()) {
      return {
        email: rowEmail,
        role: values[i][roleIndex] ? values[i][roleIndex].toString() : 'Staff',
        fullName: values[i][nameIndex] ? values[i][nameIndex].toString() : rowEmail
      };
    }
  }
  return null;
}

function ensureDefaultAdminOtpSetting(ss) {
  const settingsSheet = ss.getSheetByName('App_Settings');
  if (!settingsSheet) return;
  const lastRow = settingsSheet.getLastRow();
  if (lastRow <= 1) {
    settingsSheet.appendRow(['admin_otp_email', 'admin_otp_email', DEFAULT_ADMIN_OTP_EMAIL, '', '', new Date().toISOString()]);
    return;
  }
  const values = settingsSheet.getRange(2, 1, lastRow - 1, settingsSheet.getLastColumn()).getValues();
  const headers = settingsSheet.getRange(1, 1, 1, settingsSheet.getLastColumn()).getValues()[0];
  const idIndex = findHeaderIndex(headers, 'ID');
  const keyIndex = findHeaderIndex(headers, 'SettingKey');
  const valueIndex = findHeaderIndex(headers, 'SettingValue');
  if (idIndex === -1 || keyIndex === -1 || valueIndex === -1) return;

  const existing = values.some(row => {
    const id = row[idIndex] ? row[idIndex].toString() : '';
    const key = row[keyIndex] ? row[keyIndex].toString() : '';
    return id === 'admin_otp_email' || key === 'admin_otp_email';
  });
  if (!existing) {
    settingsSheet.appendRow(['admin_otp_email', 'admin_otp_email', DEFAULT_ADMIN_OTP_EMAIL, '', '', new Date().toISOString()]);
  }
}

/**
 * Generate unique ID
 */
function generateId() {
  return Utilities.getUuid();
}

/**
 * Clear cache
 */
function clearCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('all_data');
}

/**
 * Format JSON response with CORS headers
 */
function jsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Get deployment URL for frontend
 */
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Set up triggers (optional for automated tasks)
 */
function setupTriggers() {
  // Clear cache every hour
  ScriptApp.newTrigger('clearCache')
    .timeBased()
    .everyHours(1)
    .create();
}
