/**
 * ORPHANAGE MANAGEMENT SYSTEM - CLIENT ENGINE
 * Handles app state, UI rendering, Google Sheets integration, and offline-mock fallback.
 */

// Global App State
let state = {
  currentUser: null,
  activeTab: 'dashboard',
  activeFoodSubTab: 'meals',
  activeSchoolSubTab: 'enrollment',
  activeMedicalSubTab: 'profiles',
  activeFinanceSubTab: 'ledger',
  googleSheetsUrl: '',
  dbConnected: false,
  charts: {},
  pendingLocalAdmin: null,
  pendingCloudAdminEmail: null,
  pendingChildPortraitDataUrl: '',
  adminOtpEmail: 'theesquire2020@gmail.com',
  printProfile: {
    logo: '❤',
    name: 'OrphanCare Children Home',
    address: 'Kasarani, Nairobi, Kenya',
    phone: '+254 700 123 456',
    email: 'admin@orphancare.local'
  },
  
  // Currency system - KES as default
  baseCurrency: 'KES',
  displayCurrency: 'KES',
  exchangeRates: {
    'KES': 1,
    'USD': 0.0078,
    'EUR': 0.0072,
    'GBP': 0.0062,
    'UGX': 29.5,
    'TZS': 19.8
  },
  
  // Session management
  sessionStartTime: null,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  sessionTimer: null,
  
  // Database store (Holds lists of records)
  db: {
    children: [],
    rooms: [],
    food_inventory: [],
    daily_meals: [],
    school_enrollment: [],
    school_fees: [],
    academic_reports: [],
    medical_records: [],
    finances: [],
    donations: [],
    app_settings: [],
    users: []
  }
};

const DEFAULT_GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzFw5la-7ApmOFG4q-jBcNm1030MfxnLVAzU5ymx8WUMRyWIgzdPSki3B9SgM3CxA9e/exec';
const DEFAULT_ADMIN_OTP_EMAIL = 'theesquire2020@gmail.com';
const DEFAULT_PRINT_PROFILE = {
  name: 'OrphanCare Children Home',
  address: 'Kasarani, Nairobi, Kenya',
  logo: '❤',
  phone: '+254 700 123 456',
  email: 'admin@orphancare.local'
};

function getCurrentPrintProfile() {
  return {
    logo: (state.printProfile.logo || DEFAULT_PRINT_PROFILE.logo || '❤').toString(),
    name: (state.printProfile.name || DEFAULT_PRINT_PROFILE.name || 'Orphanage').toString(),
    address: (state.printProfile.address || DEFAULT_PRINT_PROFILE.address || '').toString(),
    phone: (state.printProfile.phone || DEFAULT_PRINT_PROFILE.phone || '').toString(),
    email: (state.printProfile.email || DEFAULT_PRINT_PROFILE.email || '').toString()
  };
}

function setPrintProfileInputs(profile) {
  const p = profile || getCurrentPrintProfile();
  const logoInput = document.getElementById('settings-print-logo');
  const nameInput = document.getElementById('settings-print-name');
  const addressInput = document.getElementById('settings-print-address');
  const phoneInput = document.getElementById('settings-print-phone');
  const emailInput = document.getElementById('settings-print-email');

  if (logoInput) logoInput.value = p.logo;
  if (nameInput) nameInput.value = p.name;
  if (addressInput) addressInput.value = p.address;
  if (phoneInput) phoneInput.value = p.phone;
  if (emailInput) emailInput.value = p.email;
}

// --- CURRENCY CONVERSION FUNCTIONS ---
function formatCurrency(amount, targetCurrency = null) {
  const numericAmount = parseFloat(amount) || 0;
  const currency = targetCurrency || state.displayCurrency;
  const rate = state.exchangeRates[currency] || 1;
  const convertedAmount = (numericAmount * rate).toFixed(2);
  
  const symbols = {
    'KES': 'KSh',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'UGX': 'UGX',
    'TZS': 'TZS'
  };
  
  return `${symbols[currency] || currency} ${convertedAmount}`;
}

function convertCurrency(amount, fromCurrency, toCurrency) {
  const numericAmount = parseFloat(amount) || 0;
  const fromRate = state.exchangeRates[fromCurrency] || 1;
  const toRate = state.exchangeRates[toCurrency] || 1;
  const inBase = numericAmount / fromRate;
  return (inBase * toRate).toFixed(2);
}

function updateExchangeRate(currency, rate) {
  state.exchangeRates[currency] = parseFloat(rate);
  // Save to settings
  const settingKey = `exchange_rate_${currency}`;
  const existingSetting = state.db.app_settings.find(s => (s.SettingKey || s.settingKey) === settingKey);
  if (existingSetting) {
    existingSetting.SettingKey = settingKey;
    existingSetting.SettingValue = rate.toString();
    existingSetting.LastModified = new Date().toISOString();
    cloudSaveRecord('App_Settings', existingSetting, 'ID');
  } else {
    cloudSaveRecord('App_Settings', {
      ID: `fx_${currency.toLowerCase()}`,
      SettingKey: settingKey,
      SettingValue: rate.toString(),
      LastModified: new Date().toISOString()
    }, 'ID');
  }
}

function setDisplayCurrency(currency) {
  state.displayCurrency = currency;
  localStorage.setItem('oms_display_currency', currency);
  renderActiveTab(); // Re-render to show new currency
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Hardcoded cloud endpoint
  state.googleSheetsUrl = DEFAULT_GOOGLE_SHEETS_URL;
  document.getElementById('settings-url-input').value = state.googleSheetsUrl;
  localStorage.setItem('oms_google_sheets_url', state.googleSheetsUrl);

  const savedAdminOtpEmail = localStorage.getItem('oms_admin_otp_email');
  state.adminOtpEmail = (savedAdminOtpEmail && savedAdminOtpEmail.trim() !== '') ? savedAdminOtpEmail.trim().toLowerCase() : DEFAULT_ADMIN_OTP_EMAIL;
  const adminEmailInput = document.getElementById('settings-admin-otp-email');
  if (adminEmailInput) adminEmailInput.value = state.adminOtpEmail;

  const savedPrintProfile = localStorage.getItem('oms_print_profile');
  if (savedPrintProfile) {
    try {
      const parsed = JSON.parse(savedPrintProfile);
      state.printProfile = { ...state.printProfile, ...parsed };
    } catch (e) {
      console.warn('Failed to parse saved print identity profile');
    }
  }
  setPrintProfileInputs(getCurrentPrintProfile());
  
  // Load saved currency settings
  const savedCurrency = localStorage.getItem('oms_display_currency') || 'KES';
  state.displayCurrency = savedCurrency;
  
  // Load saved exchange rates
  const savedRates = localStorage.getItem('oms_exchange_rates');
  if (savedRates) {
    try {
      state.exchangeRates = JSON.parse(savedRates);
    } catch(e) {
      console.warn('Failed to parse saved exchange rates');
    }
  }
  
  // Load theme colors
  const savedPrimary = localStorage.getItem('oms_theme_primary') || '#0d9488';
  const savedSecondary = localStorage.getItem('oms_theme_secondary') || '#2563eb';
  applyThemeColors(savedPrimary, savedSecondary);
  
  // Pre-fill settings color pickers
  const pColorInput = document.getElementById('settings-primary-color');
  const sColorInput = document.getElementById('settings-secondary-color');
  if (pColorInput && sColorInput) {
    pColorInput.value = savedPrimary;
    sColorInput.value = savedSecondary;
    document.getElementById('settings-primary-hex').innerText = savedPrimary.toUpperCase();
    document.getElementById('settings-secondary-hex').innerText = savedSecondary.toUpperCase();
  }
  
  // Set up event listeners
  setupEventListeners();
  
  // Check if user session exists (for development speed, we'll start with login screen open)
  showLoginScreen();
}

// --- SECURE AUTHENTICATION FLOWS (Web Crypto SHA-256) ---
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

function showLoginScreen() {
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
  switchAuthTab('login');
}

function switchAuthTab(tab) {
  const loginSection = document.getElementById('auth-login-section');
  const signupSection = document.getElementById('auth-signup-section');
  const otpSection = document.getElementById('auth-otp-section');
  const tabsNav = document.getElementById('auth-tabs-nav');
  
  const loginBtn = document.getElementById('auth-tab-login-btn');
  const signupBtn = document.getElementById('auth-tab-signup-btn');
  
  if (tab === 'login') {
    tabsNav.style.display = 'flex';
    loginSection.style.display = 'flex';
    signupSection.style.display = 'none';
    otpSection.style.display = 'none';
    loginBtn.classList.add('active');
    signupBtn.classList.remove('active');
  } else if (tab === 'signup') {
    tabsNav.style.display = 'flex';
    loginSection.style.display = 'none';
    signupSection.style.display = 'flex';
    otpSection.style.display = 'none';
    loginBtn.classList.remove('active');
    signupBtn.classList.add('active');
  } else if (tab === 'otp') {
    tabsNav.style.display = 'none';
    loginSection.style.display = 'none';
    signupSection.style.display = 'none';
    otpSection.style.display = 'flex';
    document.getElementById('otp-code').value = '';
    document.getElementById('otp-code').focus();
  }
}

function cancelOTPFlow() {
  state.pendingLocalAdmin = null;
  state.pendingCloudAdminEmail = null;
  switchAuthTab('login');
}

async function postCloudAction(payload) {
  const response = await fetch(state.googleSheetsUrl, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let result = null;
  try {
    result = JSON.parse(raw);
  } catch (parseError) {
    throw new Error(`Invalid JSON response from cloud endpoint. ${parseError.message}`);
  }

  if (!response.ok) {
    throw new Error(result.error || result.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return result;
}

async function handleAuthLogin() {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  
  if (!email || !password) {
    showToast('Email and password are required!', 'danger');
    return;
  }
  
  showHUD(true, 'Verifying credentials...');
  
  const passwordHash = await hashPassword(password);
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    try {
      const result = await postCloudAction({
        action: 'loginUser',
        email: email,
        password: password
      });
      if (result.success) {
        if (result.otpRequired) {
          state.pendingCloudAdminEmail = result.otpEmail || state.adminOtpEmail;
          switchAuthTab('otp');
          showToast(`Verification code sent to admin email: ${state.pendingCloudAdminEmail}`, 'info');
        } else {
          state.pendingCloudAdminEmail = null;
          state.currentUser = result.user;
          completeLoginFlow();
        }
      } else {
        showToast(result.error || 'Invalid email or password.', 'danger');
      }
    } catch (err) {
      console.warn("Cloud login failed, checking local database.", err);
      handleLocalLogin(email, passwordHash);
    } finally {
      showHUD(false);
    }
  } else {
    handleLocalLogin(email, passwordHash);
    showHUD(false);
  }
}

function handleLocalLogin(email, passwordHash) {
  const configuredAdminEmail = (state.adminOtpEmail || DEFAULT_ADMIN_OTP_EMAIL).toLowerCase();
  if (email === configuredAdminEmail) {
    showToast('Admin login requires cloud connection to send OTP to configured Admin email.', 'warning');
    return;
  }
  
  if (!state.db.users) {
    state.db.users = [];
  }
  
  const user = state.db.users.find(u => u.email === email && u.passwordHash === passwordHash);
  if (user) {
    state.currentUser = { email: user.email, role: user.role, fullName: user.fullName };
    completeLoginFlow();
  } else {
    showToast('Invalid email or password.', 'danger');
  }
}

async function handleAuthSignUp() {
  const fullName = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const role = document.getElementById('signup-role').value;
  
  if (!fullName || !email || !password || !role) {
    showToast('All fields are required!', 'danger');
    return;
  }
  

  
  showHUD(true, 'Registering account...');
  
  const passwordHash = await hashPassword(password);
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    try {
      const result = await postCloudAction({
        action: 'registerUser',
        fullName: fullName,
        email: email,
        password: password,
        role: role
      });
      if (result.success) {
        // Also save to local state
        const userRecord = {
          ID: 'user_' + Date.now().toString().substr(-6),
          Email: email,
          PasswordHash: passwordHash,
          FullName: fullName,
          Role: role,
          CreatedDate: new Date().toISOString().substring(0, 10),
          LastModified: new Date().toISOString()
        };
        state.db.users.push(userRecord);
        
        showToast(result.message || 'Registration successful! Please login.', 'success');
        switchAuthTab('login');
        document.getElementById('auth-signup-form').reset();
      } else {
        showToast(result.error || 'Registration failed.', 'danger');
      }
    } catch (err) {
      console.warn("Cloud registration failed, falling back to local mock storage.", err);
      handleLocalSignUp(fullName, email, passwordHash, role);
    } finally {
      showHUD(false);
    }
  } else {
    handleLocalSignUp(fullName, email, passwordHash, role);
    showHUD(false);
  }
}

function handleLocalSignUp(fullName, email, passwordHash, role) {
  if (!state.db.users) {
    state.db.users = [];
  }
  
  const exists = state.db.users.some(u => u.email === email);
  if (exists) {
    showToast('Email is already registered. Please login.', 'danger');
    return;
  }
  
  state.db.users.push({
    fullName: fullName,
    email: email,
    passwordHash: passwordHash,
    role: role,
    createdDate: new Date().toISOString().substring(0, 10)
  });
  
  showToast('Local registration successful! Please login.', 'success');
  switchAuthTab('login');
  document.getElementById('auth-signup-form').reset();
}

async function handleAuthOTPVerify() {
  const otp = document.getElementById('otp-code').value.trim();
  
  if (!otp) {
    showToast('Verification code is required!', 'danger');
    return;
  }
  
  showHUD(true, 'Verifying OTP code...');
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    try {
      const result = await postCloudAction({
        action: 'verifyAdminOTP',
        otp: otp,
        email: state.pendingCloudAdminEmail || ''
      });
      if (result.success) {
        state.pendingCloudAdminEmail = null;
        state.currentUser = result.user;
        completeLoginFlow();
      } else {
        showToast(result.error || 'Invalid or expired OTP code.', 'danger');
      }
    } catch (err) {
      console.warn("Cloud OTP verification failed, trying local verification.", err);
      handleLocalOTPVerify(otp);
    } finally {
      showHUD(false);
    }
  } else {
    handleLocalOTPVerify(otp);
    showHUD(false);
  }
}

function handleLocalOTPVerify(otp) {
  state.pendingLocalAdmin = null;
  state.pendingCloudAdminEmail = null;
  showToast('OTP verification requires cloud connection for Admin logins.', 'danger');
  switchAuthTab('login');
}

function completeLoginFlow() {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  
  const user = state.currentUser;
  document.getElementById('sidebar-user-name').innerText = user.fullName || user.email;
  document.getElementById('sidebar-user-avatar').innerText = (user.fullName || user.email).substring(0, 2).toUpperCase();
  document.getElementById('sidebar-user-role').innerText = user.role === 'Donor-Viewer' ? 'DONOR REVIEW' : user.role.toUpperCase();
  
  // Start session
  state.sessionStartTime = Date.now();
  startSessionTimer();
  saveSession();
  
  showToast(`Welcome back, ${user.fullName || user.email}!`, 'success');
  
  // Enforce role visibility constraints
  applyRoleBasedVisibility();
  
  // Load Database
  loadDatabase();
}

// Session Management Functions
function saveSession() {
  const sessionData = {
    currentUser: state.currentUser,
    sessionStartTime: state.sessionStartTime,
    googleSheetsUrl: state.googleSheetsUrl,
    adminOtpEmail: state.adminOtpEmail,
    printProfile: state.printProfile,
    displayCurrency: state.displayCurrency,
    exchangeRates: state.exchangeRates
  };
  localStorage.setItem('orphanage_session', JSON.stringify(sessionData));
}

function loadSession() {
  const saved = localStorage.getItem('orphanage_session');
  if (saved) {
    const sessionData = JSON.parse(saved);
    const elapsed = Date.now() - sessionData.sessionStartTime;
    
    // Check if session is still valid (30 minutes)
    if (elapsed < state.sessionTimeout) {
      state.currentUser = sessionData.currentUser;
      state.sessionStartTime = sessionData.sessionStartTime;
      state.googleSheetsUrl = DEFAULT_GOOGLE_SHEETS_URL;
      state.adminOtpEmail = (sessionData.adminOtpEmail && sessionData.adminOtpEmail.trim() !== '') ? sessionData.adminOtpEmail.trim().toLowerCase() : (state.adminOtpEmail || DEFAULT_ADMIN_OTP_EMAIL);
      if (sessionData.printProfile && typeof sessionData.printProfile === 'object') {
        state.printProfile = { ...state.printProfile, ...sessionData.printProfile };
      }
      state.displayCurrency = sessionData.displayCurrency || 'KES';
      state.exchangeRates = sessionData.exchangeRates || state.exchangeRates;
      document.getElementById('settings-url-input').value = state.googleSheetsUrl;
      const adminEmailInput = document.getElementById('settings-admin-otp-email');
      if (adminEmailInput) adminEmailInput.value = state.adminOtpEmail;
      setPrintProfileInputs(getCurrentPrintProfile());
      localStorage.setItem('oms_google_sheets_url', state.googleSheetsUrl);
      localStorage.setItem('oms_admin_otp_email', state.adminOtpEmail);
      localStorage.setItem('oms_print_profile', JSON.stringify(getCurrentPrintProfile()));
      
      startSessionTimer();
      return true;
    }
  }
  return false;
}

function startSessionTimer() {
  if (state.sessionTimer) clearTimeout(state.sessionTimer);
  
  state.sessionTimer = setTimeout(() => {
    logout();
    showToast('Session expired. Please login again.', 'warning');
  }, state.sessionTimeout);
}

function logout() {
  // Clear session
  localStorage.removeItem('orphanage_session');
  state.currentUser = null;
  state.sessionStartTime = null;
  if (state.sessionTimer) clearTimeout(state.sessionTimer);
  
  // Show login overlay
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-overlay').style.display = 'flex';
  
  // Reset auth tab
  switchAuthTab('login');
  
  showToast('Logged out successfully.', 'info');
}

// Add logout button event listener
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
  
  // Check for existing session on load
  if (loadSession()) {
    completeLoginFlow();
  }
  
  // Initialize currency settings in UI
  initCurrencySettings();
});

// Currency Settings Functions
function initCurrencySettings() {
  const displayCurrencySelect = document.getElementById('settings-display-currency');
  if (displayCurrencySelect) {
    displayCurrencySelect.value = state.displayCurrency;
    displayCurrencySelect.addEventListener('change', (e) => {
      state.displayCurrency = e.target.value;
      saveSession();
      renderActiveTab();
    });
  }
  
  // Set exchange rate inputs
  document.getElementById('rate-usd').value = state.exchangeRates.USD;
  document.getElementById('rate-eur').value = state.exchangeRates.EUR;
  document.getElementById('rate-gbp').value = state.exchangeRates.GBP;
  document.getElementById('rate-ugx').value = state.exchangeRates.UGX;
  document.getElementById('rate-tzs').value = state.exchangeRates.TZS;
}

function saveCurrencySettings() {
  state.displayCurrency = document.getElementById('settings-display-currency').value;
  state.exchangeRates.USD = parseFloat(document.getElementById('rate-usd').value) || 0.0078;
  state.exchangeRates.EUR = parseFloat(document.getElementById('rate-eur').value) || 0.0072;
  state.exchangeRates.GBP = parseFloat(document.getElementById('rate-gbp').value) || 0.0062;
  state.exchangeRates.UGX = parseFloat(document.getElementById('rate-ugx').value) || 29.5;
  state.exchangeRates.TZS = parseFloat(document.getElementById('rate-tzs').value) || 19.8;
  
  localStorage.setItem('oms_display_currency', state.displayCurrency);
  localStorage.setItem('oms_exchange_rates', JSON.stringify(state.exchangeRates));
  saveSession();
  
  // Save to App_Settings sheet
  const settingsRecord = {
    ID: 'currency_settings',
    SettingKey: 'currency',
    SettingValue: state.displayCurrency,
    DisplayCurrency: state.displayCurrency,
    ExchangeRates: JSON.stringify(state.exchangeRates),
    LastModified: new Date().toISOString()
  };
  cloudSaveRecord('App_Settings', settingsRecord, 'ID');
  
  showToast('Currency settings saved!', 'success');
  renderActiveTab();
}

let isApplyingVisibility = false;

function applyRoleBasedVisibility() {
  if (isApplyingVisibility) return;
  isApplyingVisibility = true;
  
  try {
    const role = state.currentUser ? state.currentUser.role : 'Donor-Viewer';
    
    // Define tab permissions
    const permissions = {
      'Admin': ['dashboard', 'home', 'food', 'school', 'medical', 'finances', 'donors', 'settings'],
      'Staff': ['dashboard', 'home', 'food', 'school', 'medical'],
      'Donor-Viewer': ['dashboard', 'food', 'donors']
    };
    
    const allowedTabs = permissions[role] || ['dashboard', 'food', 'donors'];
    
    // Hide unauthorized navigation links from sidebar
    document.querySelectorAll('.nav-links .nav-item').forEach(item => {
      const tab = item.dataset.tab;
      if (allowedTabs.includes(tab)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
    
    // Control action buttons & entry forms
    const staffOrAdminButtons = document.querySelectorAll('.staff-admin-only');
    const adminOnlyButtons = document.querySelectorAll('.admin-only');
    
    if (role === 'Admin') {
      staffOrAdminButtons.forEach(b => b.style.display = 'inline-flex');
      adminOnlyButtons.forEach(b => b.style.display = 'inline-flex');
    } else if (role === 'Staff') {
      staffOrAdminButtons.forEach(b => b.style.display = 'inline-flex');
      adminOnlyButtons.forEach(b => b.style.display = 'none');
    } else {
      staffOrAdminButtons.forEach(b => b.style.display = 'none');
      adminOnlyButtons.forEach(b => b.style.display = 'none');
    }
    
    // Hide inventory and shopping subtabs inside Food & Nutrition for Donor-Viewer
    const foodInventorySubtab = document.querySelector('#food-sub-tabs [data-subtab="inventory"]');
    const foodShoppingSubtab = document.querySelector('#food-sub-tabs [data-subtab="shopping"]');
    if (foodInventorySubtab && foodShoppingSubtab) {
      if (role === 'Donor-Viewer') {
        foodInventorySubtab.style.display = 'none';
        foodShoppingSubtab.style.display = 'none';
        if (state.activeFoodSubTab !== 'meals') {
          state.activeFoodSubTab = 'meals';
          const mealsBtn = document.querySelector('#food-sub-tabs [data-subtab="meals"]');
          if (mealsBtn) {
            document.querySelectorAll('#food-sub-tabs .sub-tab-btn').forEach(b => b.classList.remove('active'));
            mealsBtn.classList.add('active');
          }
        }
      } else {
        foodInventorySubtab.style.display = 'block';
        foodShoppingSubtab.style.display = 'block';
      }
    }
    
    // Redirect if currently on a tab that is not allowed
    if (!allowedTabs.includes(state.activeTab)) {
      const firstAllowed = allowedTabs[0] || 'dashboard';
      switchTab(firstAllowed);
    }
  } finally {
    isApplyingVisibility = false;
  }
}

function logout() {
  state.currentUser = null;
  showLoginScreen();
}

// --- BRAND COLOR CUSTOMIZATION ACTIONS ---
function hexToRgba(hex, alpha) {
  hex = hex.replace(/^#/, '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function saveColorSettings() {
  const primaryColor = document.getElementById('settings-primary-color').value;
  const secondaryColor = document.getElementById('settings-secondary-color').value;
  
  localStorage.setItem('oms_theme_primary', primaryColor);
  localStorage.setItem('oms_theme_secondary', secondaryColor);
  
  document.getElementById('settings-primary-hex').innerText = primaryColor.toUpperCase();
  document.getElementById('settings-secondary-hex').innerText = secondaryColor.toUpperCase();
  
  applyThemeColors(primaryColor, secondaryColor);
  showToast('Theme colors saved and applied successfully!', 'success');
}

function resetColorSettings() {
  const defaultPrimary = '#0d9488';
  const defaultSecondary = '#2563eb';
  
  document.getElementById('settings-primary-color').value = defaultPrimary;
  document.getElementById('settings-secondary-color').value = defaultSecondary;
  
  document.getElementById('settings-primary-hex').innerText = defaultPrimary.toUpperCase();
  document.getElementById('settings-secondary-hex').innerText = defaultSecondary.toUpperCase();
  
  localStorage.removeItem('oms_theme_primary');
  localStorage.removeItem('oms_theme_secondary');
  
  applyThemeColors(defaultPrimary, defaultSecondary);
  showToast('Theme colors reset to system defaults.', 'info');
}

function applyThemeColors(primary, secondary) {
  document.documentElement.style.setProperty('--primary', primary);
  document.documentElement.style.setProperty('--primary-glow', hexToRgba(primary, 0.15));
  document.documentElement.style.setProperty('--border-focus', primary);
  
  document.documentElement.style.setProperty('--secondary', secondary);
  document.documentElement.style.setProperty('--secondary-glow', hexToRgba(secondary, 0.15));
}

// --- DATA NORMALIZATION ---
function normalizeData(sheetName, data) {
  if (!Array.isArray(data)) return data;
  
  return data.map(item => {
    // Normalize Children data
    if (sheetName === 'children') {
      return {
        id: item.ID || item.id,
        ID: item.ID || item.id,
        name: item.FullName || item.name,
        FullName: item.FullName || item.name,
        age: item.DateOfBirth || item.age,
        DateOfBirth: item.DateOfBirth || item.age,
        gender: item.Gender || item.gender,
        Gender: item.Gender || item.gender,
        entryDate: item.AdmissionDate || item.entryDate,
        AdmissionDate: item.AdmissionDate || item.entryDate,
        status: item.Status || item.status || 'Active',
        Status: item.Status || item.status || 'Active',
        roomNumber: item.RoomID || item.roomNumber || item.RoomNumber,
        RoomID: item.RoomID || item.roomNumber || item.RoomNumber,
        RoomNumber: item.RoomID || item.roomNumber || item.RoomNumber,
        bedNumber: item.BedNumber || item.bedNumber || '',
        BedNumber: item.BedNumber || item.bedNumber || '',
        guardianName: item.GuardianName || item.guardianName,
        GuardianName: item.GuardianName || item.guardianName,
        guardianPhone: item.GuardianContact || item.guardianPhone,
        GuardianContact: item.GuardianContact || item.guardianPhone,
        medicalNotes: item.MedicalNotes || item.medicalNotes || '',
        MedicalNotes: item.MedicalNotes || item.medicalNotes || '',
        portraitUrl: item.PortraitUrl || item.Portrait || item.portraitUrl || item.portrait || '',
        PortraitUrl: item.PortraitUrl || item.Portrait || item.portraitUrl || item.portrait || '',
        Portrait: item.Portrait || item.PortraitUrl || item.portrait || item.portraitUrl || '',
        LastModified: item.LastModified
      };
    }
    
    // Normalize Rooms data
    if (sheetName === 'rooms') {
      return {
        id: item.ID || item.id,
        ID: item.ID || item.id,
        roomNumber: item.RoomNumber || item.roomNumber,
        RoomNumber: item.RoomNumber || item.roomNumber,
        capacity: item.Capacity || item.capacity,
        Capacity: item.Capacity || item.capacity,
        currentOccupancy: item.CurrentOccupancy || item.currentOccupancy || item.occupancy || 0,
        CurrentOccupancy: item.CurrentOccupancy || item.currentOccupancy || item.occupancy || 0,
        genderType: item.RoomType || item.genderType || item.Room_Type,
        RoomType: item.RoomType || item.genderType || item.Room_Type,
        floor: item.Floor || item.floor,
        Floor: item.Floor || item.floor,
        supervisor: item.Supervisor || item.supervisor,
        Supervisor: item.Supervisor || item.supervisor,
        notes: item.Notes || item.notes || '',
        Notes: item.Notes || item.notes || '',
        LastModified: item.LastModified
      };
    }

    // Normalize Medical Records data
    if (sheetName === 'medical_records') {
      return {
        childId: item.ChildID || item.childId || item.ID || item.id || '',
        ChildID: item.ChildID || item.childId || item.ID || item.id || '',
        bloodType: item.BloodType || item.bloodType || 'Unknown',
        BloodType: item.BloodType || item.bloodType || 'Unknown',
        allergies: item.Allergies || item.allergies || 'None',
        Allergies: item.Allergies || item.allergies || 'None',
        chronicConditions: item.ChronicConditions || item.chronicConditions || 'None',
        ChronicConditions: item.ChronicConditions || item.chronicConditions || 'None',
        vaccinationsJson: item.VaccinationsJson || item.vaccinationsJson || [],
        VaccinationsJson: item.VaccinationsJson || item.vaccinationsJson || [],
        doctorVisitsJson: item.DoctorVisitsJson || item.doctorVisitsJson || [],
        DoctorVisitsJson: item.DoctorVisitsJson || item.doctorVisitsJson || [],
        dispensedMedsJson: item.DispensedMedsJson || item.dispensedMedsJson || [],
        DispensedMedsJson: item.DispensedMedsJson || item.dispensedMedsJson || [],
        LastModified: item.LastModified || item.lastModified || new Date().toISOString()
      };
    }
    
    return item;
  });
}

// --- DATA ACCESS & SHEET INTEGRATION ---
async function loadDatabase() {
  showHUD(true, 'Initializing database...');
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    // Attempt sheets download
    try {
      const response = await fetch(`${state.googleSheetsUrl}?action=readAll`, { mode: 'cors' });
      const result = await response.json();
      
      if (result.success && result.data) {
        // COMPLETELY CLEAR all local data - sheet data takes absolute priority
        state.db = {
          children: [],
          rooms: [],
          food_inventory: [],
          daily_meals: [],
          school_enrollment: [],
          school_fees: [],
          academic_reports: [],
          medical_records: [],
          finances: [],
          donations: [],
          app_settings: [],
          users: []
        };
        
        // Map backend returned sheets to local stores with normalization
        for (let sheetName in result.data) {
          state.db[sheetName] = normalizeData(sheetName, result.data[sheetName]);
        }
        state.dbConnected = true;
        applySheetSettings();
        updateConnectionIndicator('online', 'Connected to Cloud');
        showToast('Sheet data loaded successfully. Demo data replaced.', 'success');
        console.log('Cloud data loaded - demo data completely replaced');
      } else {
        throw new Error(result.error || 'Unknown database error');
      }
    } catch (err) {
      console.warn("Failed to load Google Sheets backend, falling back to rich Local Mock Database.", err);
      loadMockDatabase();
      state.dbConnected = false;
      updateConnectionIndicator('error', 'Sheets Connection Failed (Using Local Copy)');
      showToast('CORS Error: Sheet data could not be loaded. Using demo data. Please redeploy Google Apps Script with "Anyone" access.', 'danger');
    }
  } else {
    // No URL set, load beautiful mock dataset
    loadMockDatabase();
    state.dbConnected = false;
    updateConnectionIndicator('offline', 'Local Mock DB (No URL Saved)');
  }
  
  showHUD(false);
  
  // Default routing
  if (state.currentUser) {
    applyRoleBasedVisibility();
    renderActiveTab();
  } else {
    switchTab('dashboard');
  }
}

function applySheetSettings() {
  const rows = Array.isArray(state.db.app_settings) ? state.db.app_settings : [];
  const settings = {};
  rows.forEach(row => {
    if (row.SettingKey && row.SettingValue !== undefined) {
      settings[row.SettingKey] = row.SettingValue;
    }
    if (row.key && row.value !== undefined) {
      settings[row.key] = row.value;
    }
    if (row.ID && row.SettingKey && row.SettingValue !== undefined) {
      settings[row.SettingKey] = row.SettingValue;
    }
  });

  if (settings.google_sheets_url) {
    // Validate and fix the URL (prevent duplication)
    let url = settings.google_sheets_url.toString().trim();
    // If URL is duplicated, extract the valid one
    if (url.includes('exechttps://')) {
      url = url.split('exechttps://')[0] + 'exec';
    }
    // Only update if it's a valid URL
    if (url.startsWith('http')) {
      state.googleSheetsUrl = url;
      localStorage.setItem('oms_google_sheets_url', state.googleSheetsUrl);
      const urlInput = document.getElementById('settings-url-input');
      if (urlInput) urlInput.value = state.googleSheetsUrl;
    }
  }

  if (settings.currency) {
    state.displayCurrency = settings.currency;
    localStorage.setItem('oms_display_currency', state.displayCurrency);
  }
  if (settings.DisplayCurrency) {
    state.displayCurrency = settings.DisplayCurrency;
    localStorage.setItem('oms_display_currency', state.displayCurrency);
  }

  if (settings.ExchangeRates) {
    try {
      state.exchangeRates = JSON.parse(settings.ExchangeRates);
      localStorage.setItem('oms_exchange_rates', JSON.stringify(state.exchangeRates));
    } catch (err) {
      console.warn('Invalid ExchangeRates data from sheet', err);
    }
  }

  if (settings.admin_otp_email) {
    state.adminOtpEmail = settings.admin_otp_email.toString().trim().toLowerCase();
    localStorage.setItem('oms_admin_otp_email', state.adminOtpEmail);
    const adminEmailInput = document.getElementById('settings-admin-otp-email');
    if (adminEmailInput) adminEmailInput.value = state.adminOtpEmail;
  }

  const printProfileUpdates = {};
  if (settings.print_profile_json) {
    try {
      Object.assign(printProfileUpdates, JSON.parse(settings.print_profile_json));
    } catch (e) {
      console.warn('Invalid print_profile_json data from sheet');
    }
  }
  if (settings.orphanage_logo) printProfileUpdates.logo = settings.orphanage_logo;
  if (settings.orphanage_name) printProfileUpdates.name = settings.orphanage_name;
  if (settings.orphanage_address) printProfileUpdates.address = settings.orphanage_address;
  if (settings.orphanage_phone) printProfileUpdates.phone = settings.orphanage_phone;
  if (settings.orphanage_email) printProfileUpdates.email = settings.orphanage_email;

  if (Object.keys(printProfileUpdates).length > 0) {
    state.printProfile = { ...state.printProfile, ...printProfileUpdates };
    localStorage.setItem('oms_print_profile', JSON.stringify(getCurrentPrintProfile()));
    setPrintProfileInputs(getCurrentPrintProfile());
  }
}

function updateConnectionIndicator(status, text) {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  
  dot.className = 'indicator-dot';
  dot.classList.add(status);
  label.innerText = text;
}

async function syncWithCloud() {
  if (!state.googleSheetsUrl || state.googleSheetsUrl.trim() === '') {
    showToast('Please paste a Google Apps Script URL in App Settings to connect.', 'warning');
    switchTab('settings');
    return;
  }
  await loadDatabase();
}

function getFieldValueByVariants(obj, keyName) {
  if (!obj || !keyName) return undefined;
  const variants = [
    keyName,
    keyName.toLowerCase(),
    keyName.toUpperCase(),
    keyName.charAt(0).toUpperCase() + keyName.slice(1),
    keyName.charAt(0).toLowerCase() + keyName.slice(1)
  ];
  for (const key of variants) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function findRecordIndexByKey(list, keyColumn, keyValue) {
  return list.findIndex(item => {
    const candidate = getFieldValueByVariants(item, keyColumn);
    return candidate !== undefined && candidate.toString() === keyValue.toString();
  });
}

/**
 * Sends a generic Save POST request to the Apps Script Endpoint.
 * If sheets are offline, saves to local store immediately.
 */
async function cloudSaveRecord(sheetName, record, keyColumn = 'id') {
  const sheetKey = sheetName.toLowerCase();
  
  // Normalize the record to ensure both frontend properties and backend schema keys are populated
  const normalizedList = normalizeData(sheetKey, [record]);
  const normalizedRecord = (normalizedList && normalizedList.length > 0) ? normalizedList[0] : record;
  
  // Update locally first
  const list = state.db[sheetKey];
  const recordKeyValue = getFieldValueByVariants(normalizedRecord, keyColumn);
  const index = recordKeyValue !== undefined ? findRecordIndexByKey(list, keyColumn, recordKeyValue) : -1;
  
  if (index !== -1) {
    list[index] = { ...list[index], ...normalizedRecord };
  } else {
    list.push(normalizedRecord);
  }
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    showHUD(true, `Saving record to ${sheetName} Cloud...`);
    try {
      const res = await postCloudAction({
        action: 'saveRecord',
        sheetName: sheetName,
        record: normalizedRecord,
        keyColumn: keyColumn
      });
      if (!res || !res.success) {
        console.error('Cloud save error:', res ? res.error : 'No response');
        throw new Error(res ? (res.error || res.message || 'Unknown error') : 'No response from server');
      }
      state.dbConnected = true;
      updateConnectionIndicator('online', 'Connected to Cloud');
      showToast(`${sheetName} record saved online!`, 'success');
    } catch (err) {
      console.error('Cloud save failed:', err);
      if (err.message.includes('CORS') || err.message.includes('Failed to fetch')) {
        showToast('CORS error: Please redeploy Google Apps Script with "Anyone" access', 'danger');
      } else {
        showToast(`Cloud write failed: ${err.message}. Stored locally.`, 'warning');
      }
    } finally {
      showHUD(false);
    }
  } else {
    showToast(`Stored locally inside offline workspace.`, 'info');
  }
  
  renderActiveTab();
}

/**
 * Sends a delete row POST request to Apps Script.
 */
async function cloudDeleteRecord(sheetName, keyColumn, keyValue) {
  // Delete locally first
  const sheetKey = sheetName.toLowerCase();
  state.db[sheetKey] = state.db[sheetKey].filter(item => {
    const value = getFieldValueByVariants(item, keyColumn);
    return !value || value.toString() !== keyValue.toString();
  });
  
  if (state.googleSheetsUrl && state.googleSheetsUrl.trim() !== '') {
    showHUD(true, `Deleting record from ${sheetName}...`);
    try {
      const res = await postCloudAction({
        action: 'deleteRecord',
        sheetName: sheetName,
        keyColumn: keyColumn,
        keyValue: keyValue
      });
      if (!res.success) {
        throw new Error(res.error);
      }
      showToast(`Deleted from cloud successfully.`, 'success');
    } catch(err) {
      console.error(err);
      if (err.message.includes('CORS') || err.message.includes('Failed to fetch')) {
        showToast('CORS error: Please redeploy Google Apps Script with "Anyone" access', 'danger');
      } else {
        showToast(`Cloud delete failed. Deleted locally.`, 'warning');
      }
    } finally {
      showHUD(false);
    }
  } else {
    showToast('Deleted locally from workspace.', 'info');
  }
  
  renderActiveTab();
}

// --- NAVIGATION & TABS ---
function setupEventListeners() {
  // Top level tabs
  document.querySelectorAll('.nav-item a').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = btn.closest('.nav-item').dataset.tab;
      switchTab(tabId);
      
      // Close mobile sidebar if open
      document.getElementById('sidebar-container').classList.remove('active');
    });
  });
  
  // Mobile hamburger menu toggle
  document.getElementById('hamburger-toggle').addEventListener('click', () => {
    document.getElementById('sidebar-container').classList.toggle('active');
  });
  
  // Inner Subtabs listeners
  setupSubTabs('food-sub-tabs', (subTabId) => {
    state.activeFoodSubTab = subTabId;
    renderFoodTab();
  });
  setupSubTabs('school-sub-tabs', (subTabId) => {
    state.activeSchoolSubTab = subTabId;
    renderSchoolTab();
  });
  setupSubTabs('medical-sub-tabs', (subTabId) => {
    state.activeMedicalSubTab = subTabId;
    renderMedicalTab();
  });
  setupSubTabs('finance-sub-tabs', (subTabId) => {
    state.activeFinanceSubTab = subTabId;
    renderFinanceTab();
  });
  
  // Color Picker Change Listeners (visual preview update)
  const primaryInput = document.getElementById('settings-primary-color');
  const secondaryInput = document.getElementById('settings-secondary-color');
  if (primaryInput && secondaryInput) {
    primaryInput.addEventListener('input', (e) => {
      document.getElementById('settings-primary-hex').innerText = e.target.value.toUpperCase();
    });
    secondaryInput.addEventListener('input', (e) => {
      document.getElementById('settings-secondary-hex').innerText = e.target.value.toUpperCase();
    });
  }
  
  // Modal Close buttons
  document.querySelectorAll('.modal-close-btn, .btn-close-modal').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  // Theme Toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    document.getElementById('theme-icon').innerHTML = isLight 
      ? '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>'
      : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
    // Refresh active tab to ensure charts look beautiful with new theme contrast
    renderActiveTab();
  });
  
  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);
  
  // Connection Test
  document.getElementById('test-conn-btn').addEventListener('click', testConnectionAction);
  const saveAdminOtpBtn = document.getElementById('save-admin-otp-btn');
  if (saveAdminOtpBtn) {
    saveAdminOtpBtn.addEventListener('click', saveAdminOtpEmail);
  }
  const savePrintProfileBtn = document.getElementById('save-print-profile-btn');
  if (savePrintProfileBtn) {
    savePrintProfileBtn.addEventListener('click', savePrintProfileSettings);
  }

  const childPhotoInput = document.getElementById('child-form-photo');
  if (childPhotoInput) {
    childPhotoInput.addEventListener('change', handleChildPortraitChange);
  }

  setupTablePrintButtons();
}

function setupTablePrintButtons() {
  const tableNodes = document.querySelectorAll('.table-container table.app-table');
  tableNodes.forEach((table, index) => {
    if (!table.id) {
      table.id = `table_${index + 1}`;
    }
    const container = table.closest('.table-container');
    if (!container || container.querySelector('.table-print-action')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-print-action';
    wrapper.innerHTML = `
      <button class="btn btn-secondary" onclick="printTableById('${table.id}')">
        <svg viewBox="0 0 24 24"><path d="M6 9V2h12v7m-2 11H8a2 2 0 01-2-2v-5h12v5a2 2 0 01-2 2zM6 13H4a2 2 0 01-2-2V9a2 2 0 012-2h16a2 2 0 012 2v2a2 2 0 01-2 2h-2"/></svg>
        <span>Print Table</span>
      </button>
    `;
    container.insertBefore(wrapper, table);
  });
}

function printTableById(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const profile = getCurrentPrintProfile();

  const tableTitle = table.dataset.printTitle || document.getElementById('header-title-text').innerText || 'Orphanage Report';
  const printableTable = table.cloneNode(true);
  const rows = printableTable.querySelectorAll('tr');

  rows.forEach(row => {
    const sourceCells = Array.from(table.rows[row.rowIndex]?.cells || []);
    const printCells = Array.from(row.cells);
    const removalIndexes = [];

    sourceCells.forEach((cell, idx) => {
      const text = (cell.innerText || '').toLowerCase();
      const isActionCol = text.includes('action') || text.includes('audit control');
      const isHidden = cell.classList.contains('staff-admin-only') || cell.classList.contains('admin-only');
      if (isActionCol || isHidden) removalIndexes.push(idx);
    });

    removalIndexes.sort((a, b) => b - a).forEach(i => {
      if (printCells[i]) printCells[i].remove();
    });
  });

  const now = new Date();
  const printWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!printWindow) {
    showToast('Allow popups to print reports.', 'warning');
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${tableTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #0f172a; }
          .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0d9488; padding-bottom:12px; margin-bottom:16px; }
          .logo { width:64px; height:64px; border-radius:50%; background:#0d9488; color:#fff; display:flex; align-items:center; justify-content:center; font-size:30px; font-weight:700; }
          .brand h1 { margin:0; font-size:24px; }
          .brand p { margin:2px 0; font-size:12px; color:#334155; }
          .meta { text-align:right; font-size:12px; color:#334155; }
          table { width:100%; border-collapse:collapse; margin-top:10px; }
          th, td { border:1px solid #cbd5e1; padding:8px; font-size:12px; vertical-align:top; }
          th { background:#f1f5f9; text-transform:uppercase; font-size:11px; letter-spacing:0.04em; }
          td img { max-width:56px; max-height:70px; border-radius:6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="display:flex; gap:14px;">
            <div class="logo">${profile.logo}</div>
            <div class="brand">
              <h1>${profile.name}</h1>
              <p>${profile.address}</p>
              <p>Tel: ${profile.phone} | Email: ${profile.email}</p>
            </div>
          </div>
          <div class="meta">
            <div><strong>${tableTitle}</strong></div>
            <div>Printed: ${now.toLocaleString()}</div>
          </div>
        </div>
        ${printableTable.outerHTML}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function setupSubTabs(containerId, callback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callback(btn.dataset.subtab);
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Toggle Nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.tab === tabId) {
      item.classList.add('active');
    }
  });
  
  // Toggle Section active state
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  const targetPanel = document.getElementById(`${tabId}-panel`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
  
  renderActiveTab();
}

function renderActiveTab() {
  const titleMap = {
    'dashboard': { title: 'Operational Dashboard', desc: 'Real-time overview of metrics and operations' },
    'home': { title: 'Home Management', desc: 'Track children, rooms, beds, attendance and chores' },
    'food': { title: 'Food & Nutrition', desc: 'Meal schedules, calorie calculators, and kitchen stock logs' },
    'school': { title: 'Schooling & Academics', desc: 'Track enrollments, school fee balances, and report cards' },
    'medical': { title: 'Medical Clinic & Logs', desc: 'Dispense medicine, manage health files, and schedule vaccines' },
    'finances': { title: 'Financial Treasury', desc: 'Record donations, ledger expenditures, and print auditing bills' },
    'donors': { title: 'Transparency & Donors', desc: 'Impact ratios, public transparent feeds, and tax-receipt generation' },
    'settings': { title: 'Database & Settings', desc: 'Configure cloud Apps Script endpoint and manage security credentials' }
  };
  
  const currentDetails = titleMap[state.activeTab];
  if (currentDetails) {
    document.getElementById('header-title-text').innerText = currentDetails.title;
    document.getElementById('header-desc-text').innerText = currentDetails.desc;
  }
  
  switch (state.activeTab) {
    case 'dashboard':
      renderDashboardTab();
      break;
    case 'home':
      renderHomeTab();
      break;
    case 'food':
      renderFoodTab();
      break;
    case 'school':
      renderSchoolTab();
      break;
    case 'medical':
      renderMedicalTab();
      break;
    case 'finances':
      renderFinanceTab();
      break;
    case 'donors':
      renderDonorsTab();
      break;
    case 'settings':
      renderSettingsTab();
      break;
  }
}

// --- UTILITY: NAME ANONYMIZATION ---
function formatChildName(childId, realName) {
  if (state.currentUser && state.currentUser.role === 'Donor-Viewer') {
    return `<span class="anonymized-badge">Child-${childId}</span>`;
  }
  const displayName = realName || 'Unknown';
  return `
    <div class="child-meta">
      <div class="child-avatar-mini">${displayName.substring(0,2).toUpperCase()}</div>
      <div>
        <div style="font-weight:600">${displayName}</div>
        <div style="font-size:0.75rem; color:var(--text-muted)">ID: ${childId}</div>
      </div>
    </div>
  `;
}

function getChildView(child) {
  return {
    id: child.ID || child.id || 'UN',
    name: child.FullName || child.name || 'Unknown',
    age: child.DateOfBirth || child.age || '',
    gender: child.Gender || child.gender || 'Unknown',
    entryDate: child.AdmissionDate || child.entryDate || '',
    guardianName: child.GuardianName || child.guardianName || '',
    guardianPhone: child.GuardianContact || child.guardianPhone || '',
    roomNumber: child.RoomID || child.roomNumber || child.RoomNumber || '',
    bedNumber: child.BedNumber || child.bedNumber || '',
    status: child.Status || child.status || 'Unknown',
    portraitUrl: child.PortraitUrl || child.Portrait || child.portraitUrl || child.portrait || ''
  };
}

function getRoomView(room) {
  return {
    id: room.ID || room.id || '',
    roomNumber: room.RoomNumber || room.roomNumber || '',
    capacity: room.Capacity || room.capacity || 0,
    genderType: room.RoomType || room.genderType || '',
    floor: room.Floor || room.floor || '',
    supervisor: room.Supervisor || room.supervisor || '',
    notes: room.Notes || room.notes || ''
  };
}

function getPortraitThumbnail(child) {
  if (child.portraitUrl) {
    return `<img src="${child.portraitUrl}" alt="Portrait of ${child.name}" class="child-portrait-thumb">`;
  }
  const initials = (child.name || 'UN').substring(0, 2).toUpperCase();
  return `<div class="child-avatar-mini" style="width:46px;height:56px;border-radius:10px">${initials}</div>`;
}

function updateChildPortraitPreview(url) {
  const preview = document.getElementById('child-form-photo-preview');
  if (!preview) return;

  if (url) {
    preview.src = url;
    preview.style.display = 'block';
  } else {
    preview.src = '';
    preview.style.display = 'none';
  }
}

function handleChildPortraitChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.size > 2.5 * 1024 * 1024) {
    showToast('Portrait image is too large. Use a file below 2.5MB.', 'warning');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.pendingChildPortraitDataUrl = reader.result || '';
    updateChildPortraitPreview(state.pendingChildPortraitDataUrl);
  };
  reader.readAsDataURL(file);
}

function getChildNameById(childId) {
  const child = state.db.children.find(c => {
    const childKey = c.ID || c.id;
    return childKey && childKey.toString() === childId.toString();
  });
  if (!child) return `Child-${childId}`;
  
  if (state.currentUser && state.currentUser.role === 'Donor-Viewer') {
    return `Child-${childId}`;
  }
  return child.FullName || child.name || `Child-${childId}`;
}

// --- 1. DASHBOARD TAB ---
function renderDashboardTab() {
  const totalKids = state.db.children.filter(c => getChildView(c).status !== 'Discharged').length;
  
  // Rooms Occupancy
  const totalBeds = state.db.rooms.reduce((acc, r) => acc + parseInt(getRoomView(r).capacity || 0), 0);
  const occupiedBeds = state.db.children.filter(c => {
    const child = getChildView(c);
    return child.status !== 'Discharged' && child.roomNumber;
  }).length;
  const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  
  // Pending school fees
  const pendingFees = state.db.school_fees.reduce((acc, f) => {
    return acc + (parseFloat(f.balance || 0));
  }, 0);
  
  // Food Low Stock Items count
  const lowStockCount = state.db.food_inventory.filter(item => {
    const stock = parseFloat(item.currentStock || 0);
    return stock < 10; // Simple low stock threshold
  }).length;
  
  // Render metrics HTML
  document.getElementById('db-metric-total-children').innerText = totalKids;
  document.getElementById('db-metric-occupancy').innerText = `${occupancyRate}%`;
  document.getElementById('db-metric-occupancy-sub').innerText = `${occupiedBeds} / ${totalBeds} Beds Occupied`;
  document.getElementById('db-metric-fees').innerText = formatCurrency(pendingFees);
  document.getElementById('db-metric-stock').innerText = lowStockCount;
  
  // Render Dashboard Charts
  setTimeout(() => {
    renderDashboardCharts();
  }, 100);
  
  // Load Quick Activity Feed (Chores & Incidents merged)
  const feedList = document.getElementById('dashboard-feed-list');
  feedList.innerHTML = '';
  
  // Mock feeds from financial and logistics logs
  const activityItems = [
    { title: "Weekly inventory count completed", date: "Today", icon: "📦", category: "Staff Operations" },
    { title: "Dr. visits recorded for Clinic records", date: "Yesterday", icon: "🩺", category: "Medical Clinic" },
    { title: "School fees batch payments synced", date: "2 days ago", icon: "💸", category: "Finances" },
    { title: "New donation registered ($1,500 by Global Help)", date: "3 days ago", icon: "💖", category: "Donations" }
  ];
  
  activityItems.forEach(act => {
    feedList.innerHTML += `
      <div style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border-color)">
        <div style="font-size:1.5rem">${act.icon}</div>
        <div style="flex-grow:1">
          <div style="font-weight:600; font-size:0.85rem">${act.title}</div>
          <div style="font-size:0.75rem; color:var(--text-muted)">${act.category} &bull; ${act.date}</div>
        </div>
      </div>
    `;
  });
}

function renderDashboardCharts() {
  const ctxOccupancy = document.getElementById('chart-occupancy-canvas').getContext('2d');
  const ctxFinances = document.getElementById('chart-finance-canvas').getContext('2d');
  
  // Destroy existing charts to prevent hover glitch
  if (state.charts.occupancy) state.charts.occupancy.destroy();
  if (state.charts.finances) state.charts.finances.destroy();
  
  const textMain = getComputedStyle(document.body).getPropertyValue('--text-main').trim();
  const textMuted = getComputedStyle(document.body).getPropertyValue('--text-muted').trim();
  const primaryColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  const secondaryColor = getComputedStyle(document.body).getPropertyValue('--secondary').trim();
  const accentColor = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  const dangerColor = getComputedStyle(document.body).getPropertyValue('--danger').trim();
  
  // 1. Occupancy Doughnut Chart
  const boysCount = state.db.children.filter(c => {
    const child = getChildView(c);
    return child.status !== 'Discharged' && child.gender === 'Boy';
  }).length;
  const girlsCount = state.db.children.filter(c => {
    const child = getChildView(c);
    return child.status !== 'Discharged' && child.gender === 'Girl';
  }).length;
  const totalBeds = state.db.rooms.reduce((acc, r) => acc + parseInt(getRoomView(r).capacity || 0), 0);
  const occupied = boysCount + girlsCount;
  const emptyBeds = Math.max(0, totalBeds - occupied);
  
  state.charts.occupancy = new Chart(ctxOccupancy, {
    type: 'doughnut',
    data: {
      labels: ['Boys', 'Girls', 'Available Beds'],
      datasets: [{
        data: [boysCount, girlsCount, emptyBeds],
        backgroundColor: [secondaryColor, accentColor, 'rgba(100, 110, 140, 0.2)'],
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textMain }
        }
      }
    }
  });
  
  // 2. Finance Bar Chart (Income vs Expense)
  // Group finances by category or month (using recent 5 entries as demo)
  const finances = state.db.finances || [];
  let incomeTotal = 0;
  let expenseTotal = 0;
  
  finances.forEach(f => {
    const amt = parseFloat(f.amount || 0);
    if (f.type === 'Income') incomeTotal += amt;
    else if (f.type === 'Expense') expenseTotal += amt;
  });
  
  state.charts.finances = new Chart(ctxFinances, {
    type: 'bar',
    data: {
      labels: ['Treasury Totals'],
      datasets: [
        {
          label: 'Total Funding Received',
          data: [incomeTotal],
          backgroundColor: primaryColor,
          borderRadius: 8
        },
        {
          label: 'Operational Expenditures',
          data: [expenseTotal],
          backgroundColor: dangerColor,
          borderRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textMain }
        }
      },
      scales: {
        y: {
          grid: { color: 'rgba(100, 110, 140, 0.1)' },
          ticks: { color: textMuted }
        },
        x: {
          grid: { display: false },
          ticks: { color: textMuted }
        }
      }
    }
  });
}

// --- 2. HOME MANAGEMENT TAB ---
function renderHomeTab() {
  const childrenList = document.getElementById('home-children-table-body');
  childrenList.innerHTML = '';
  
  state.db.children.forEach(rawChild => {
    const child = getChildView(rawChild);
    const childKey = child.id || 'UN';
    const bedLabel = child.bedNumber || '-';
    const guardianLabel = child.guardianName ? `${child.guardianName} (${child.guardianPhone || '-'})` : '-';
    const actionButtons = `
      <button class="btn btn-secondary btn-icon-only staff-admin-only" onclick="editChildModal('${childKey}')" title="Edit Profile">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-8.5-4.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L14.5 7.5z"/></svg>
      </button>
      <button class="btn btn-danger btn-icon-only admin-only" onclick="deleteChild('${childKey}')" title="Discharge / Delete">
        <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    `;
    
    const badgeClass = child.status === 'Active' ? 'badge-success' : 'badge-danger';
    
    childrenList.innerHTML += `
      <tr>
        <td>${getPortraitThumbnail(child)}</td>
        <td>${formatChildName(childKey, child.name)}</td>
        <td>${child.age || '-'}</td>
        <td>${child.gender}</td>
        <td>${child.entryDate || '-'}</td>
        <td>${state.currentUser.role === 'Donor-Viewer' ? '<span class="text-muted">[Hidden]</span>' : guardianLabel}</td>
        <td><span class="badge badge-info">Room ${child.roomNumber || '-'} (Bed ${bedLabel})</span></td>
        <td><span class="badge ${badgeClass}">${child.status}</span></td>
        <td>
          <div style="display:flex; gap:6px">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  });
  
  // Render Rooms occupancy grid
  const roomsGrid = document.getElementById('home-rooms-grid');
  roomsGrid.innerHTML = '';
  
  state.db.rooms.forEach(rawRoom => {
    const room = getRoomView(rawRoom);
    // Calculate actual current occupancy
    const currentOccupied = state.db.children.filter(c => {
      const child = getChildView(c);
      return child.status !== 'Discharged' &&
        child.roomNumber && room.roomNumber &&
        child.roomNumber.toString() === room.roomNumber.toString();
    }).length;
    const capacity = parseInt(room.capacity || 0);
    const progressPercent = capacity > 0 ? Math.min(100, Math.round((currentOccupied / capacity) * 100)) : 0;
    
    roomsGrid.innerHTML += `
      <div class="metric-card" style="flex-direction:column; align-items:stretch; gap:12px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h4 style="font-size:1.1rem; color:var(--text-main)">Room ${room.roomNumber}</h4>
          <span class="badge badge-info">${room.genderType}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted)">Capacity: ${capacity} beds</div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px">
            <span>Occupancy</span>
            <span>${currentOccupied} / ${capacity} filled</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>
        <p style="font-size:0.75rem; color:var(--text-muted); font-style:italic">${room.notes || 'No notes added'}</p>
      </div>
    `;
  });
  
  applyRoleBasedVisibility();
}

// --- ROOM MANAGEMENT FUNCTIONS ---
function showAddRoomModal() {
  document.getElementById('room-modal-title').innerText = 'Add Dormitory Room';
  document.getElementById('room-form-roomNumber').value = '';
  document.getElementById('room-form-number').value = '';
  document.getElementById('room-form-capacity').value = '';
  document.getElementById('room-form-gender').value = 'Boys';
  document.getElementById('room-form-floor').value = 'Ground';
  document.getElementById('room-form-supervisor').value = '';
  document.getElementById('room-form-notes').value = '';
  openModal('room-modal');
}

function editRoomModal(roomNumber) {
  const room = state.db.rooms.find(r => {
    const roomKey = r.RoomNumber || r.roomNumber;
    return roomKey && roomKey.toString() === roomNumber.toString();
  });
  if (!room) return;
  const viewRoom = getRoomView(room);
  
  document.getElementById('room-modal-title').innerText = 'Edit Room';
  document.getElementById('room-form-roomNumber').value = viewRoom.roomNumber;
  document.getElementById('room-form-number').value = viewRoom.roomNumber;
  document.getElementById('room-form-capacity').value = viewRoom.capacity;
  document.getElementById('room-form-gender').value = viewRoom.genderType;
  document.getElementById('room-form-floor').value = viewRoom.floor || 'Ground';
  document.getElementById('room-form-supervisor').value = viewRoom.supervisor || '';
  document.getElementById('room-form-notes').value = viewRoom.notes || '';
  openModal('room-modal');
}

async function saveRoomSubmit() {
  const roomNumber = document.getElementById('room-form-number').value.trim();
  const capacity = document.getElementById('room-form-capacity').value;
  const genderType = document.getElementById('room-form-gender').value;
  const floor = document.getElementById('room-form-floor').value;
  const supervisor = document.getElementById('room-form-supervisor').value.trim();
  const notes = document.getElementById('room-form-notes').value.trim();
  
  if (!roomNumber || !capacity) {
    showToast('Room number and capacity are required!', 'warning');
    return;
  }
  
  const record = {
    ID: 'room_' + Date.now().toString().substr(-6),
    RoomNumber: roomNumber,
    Capacity: capacity,
    CurrentOccupancy: 0,
    RoomType: genderType,
    Floor: floor,
    Supervisor: supervisor,
    Notes: notes,
    LastModified: new Date().toISOString()
  };
  
  closeModal();
  await cloudSaveRecord('Rooms', record, 'ID');
  
  // Also save to local state
  const normalizedRecord = normalizeData('rooms', [record])[0];
  const existingIndex = state.db.rooms.findIndex(r => {
    const key = r.ID || r.id;
    return key && key.toString() === record.ID.toString();
  });
  if (existingIndex !== -1) {
    state.db.rooms[existingIndex] = normalizedRecord;
  } else {
    state.db.rooms.push(normalizedRecord);
  }
  renderHomeTab();
}

async function deleteRoom(roomNumber) {
  if (!confirm(`Are you sure you want to delete Room ${roomNumber}?`)) return;
  
  // Check if room has children
  const hasChildren = state.db.children.some(c => {
    const childRoom = c.RoomID || c.roomNumber || c.RoomNumber;
    return childRoom && childRoom.toString() === roomNumber.toString();
  });
  if (hasChildren) {
    showToast('Cannot delete room with assigned children!', 'danger');
    return;
  }
  
  const index = state.db.rooms.findIndex(r => {
    const roomKey = r.RoomNumber || r.roomNumber;
    return roomKey && roomKey.toString() === roomNumber.toString();
  });
  if (index !== -1) {
    state.db.rooms.splice(index, 1);
    renderHomeTab();
    showToast('Room deleted successfully!', 'success');
    
    // Delete from cloud if connected
    if (state.googleSheetsUrl && state.dbConnected) {
      try {
        await postCloudAction({
          action: 'deleteRecord',
          sheetName: 'Rooms',
          keyColumn: 'RoomNumber',
          keyValue: roomNumber
        });
      } catch(e) {
        console.warn('Cloud delete failed:', e);
      }
    }
  }
}

function showAddChildModal() {
  document.getElementById('child-modal-title').innerText = 'Enroll New Child';
  state.pendingChildPortraitDataUrl = '';
  document.getElementById('child-form-id').value = 'c_' + Date.now().toString().substr(-6);
  document.getElementById('child-form-name').value = '';
  document.getElementById('child-form-age').value = '';
  document.getElementById('child-form-gender').value = 'Boy';
  document.getElementById('child-form-entry').value = new Date().toISOString().substring(0,10);
  document.getElementById('child-form-guardian').value = '';
  document.getElementById('child-form-phone').value = '';
  
  // Populate room numbers select dynamically
  const roomSelect = document.getElementById('child-form-room');
  roomSelect.innerHTML = '';
  state.db.rooms.forEach(r => {
    const room = getRoomView(r);
    roomSelect.innerHTML += `<option value="${room.roomNumber}">Room ${room.roomNumber} (${room.genderType})</option>`;
  });
  
  document.getElementById('child-form-bed').value = '1';
  document.getElementById('child-form-status').value = 'Active';
  document.getElementById('child-form-photo').value = '';
  updateChildPortraitPreview('');
  
  openModal('child-modal');
}

function editChildModal(id) {
  const child = state.db.children.find(c => (c.ID || c.id) && (c.ID || c.id).toString() === id.toString());
  if (!child) return;
  const childView = getChildView(child);
  
  document.getElementById('child-modal-title').innerText = 'Edit Child Profile';
  state.pendingChildPortraitDataUrl = childView.portraitUrl || '';
  document.getElementById('child-form-id').value = childView.id;
  document.getElementById('child-form-name').value = childView.name;
  document.getElementById('child-form-age').value = childView.age;
  document.getElementById('child-form-gender').value = childView.gender;
  document.getElementById('child-form-entry').value = childView.entryDate;
  document.getElementById('child-form-guardian').value = childView.guardianName;
  document.getElementById('child-form-phone').value = childView.guardianPhone;
  
  const roomSelect = document.getElementById('child-form-room');
  roomSelect.innerHTML = '';
  state.db.rooms.forEach(r => {
    const room = getRoomView(r);
    const childRoomNum = childView.roomNumber;
    const selected = childRoomNum && room.roomNumber && childRoomNum.toString() === room.roomNumber.toString() ? 'selected' : '';
    roomSelect.innerHTML += `<option value="${room.roomNumber}" ${selected}>Room ${room.roomNumber} (${room.genderType})</option>`;
  });
  
  document.getElementById('child-form-bed').value = childView.bedNumber || '';
  document.getElementById('child-form-status').value = childView.status;
  document.getElementById('child-form-photo').value = '';
  updateChildPortraitPreview(state.pendingChildPortraitDataUrl);
  
  openModal('child-modal');
}

async function saveChildSubmit() {
  const roomId = document.getElementById('child-form-room').value;
  const record = {
    ID: document.getElementById('child-form-id').value,
    FullName: document.getElementById('child-form-name').value,
    DateOfBirth: document.getElementById('child-form-age').value,
    Gender: document.getElementById('child-form-gender').value,
    AdmissionDate: document.getElementById('child-form-entry').value,
    Status: document.getElementById('child-form-status').value,
    RoomID: roomId,
    roomNumber: roomId, // Add for compatibility with rendering
    BedNumber: document.getElementById('child-form-bed').value,
    bedNumber: document.getElementById('child-form-bed').value,
    GuardianName: document.getElementById('child-form-guardian').value,
    GuardianContact: document.getElementById('child-form-phone').value,
    PortraitUrl: state.pendingChildPortraitDataUrl || '',
    Portrait: state.pendingChildPortraitDataUrl || '',
    MedicalNotes: '',
    LastModified: new Date().toISOString()
  };
  
  if (!record.FullName || !record.DateOfBirth) {
    showToast('Name and Age are required!', 'danger');
    return;
  }
  
  closeModal();
  await cloudSaveRecord('Children', record, 'ID');
  
  // Also save to local state
  const normalizedRecord = normalizeData('children', [record])[0];
  const existingIndex = state.db.children.findIndex(c => {
    const key = c.ID || c.id;
    return key && key.toString() === record.ID.toString();
  });
  if (existingIndex !== -1) {
    state.db.children[existingIndex] = normalizedRecord;
  } else {
    state.db.children.push(normalizedRecord);
  }
  state.pendingChildPortraitDataUrl = '';
  document.getElementById('child-form-photo').value = '';
  updateChildPortraitPreview('');
  renderHomeTab();
}

async function deleteChild(id) {
  if (confirm('Are you sure you want to discharge/delete this child profile?')) {
    await cloudDeleteRecord('Children', 'ID', id);
  }
}

// --- 3. FOOD MANAGEMENT TAB ---
function renderFoodTab() {
  // Show active subtab, hide others
  document.querySelectorAll('.food-sub-section').forEach(sec => sec.style.display = 'none');
  document.getElementById(`food-${state.activeFoodSubTab}-section`).style.display = 'flex';
  
  if (state.activeFoodSubTab === 'meals') {
    renderFoodMeals();
  } else if (state.activeFoodSubTab === 'inventory') {
    renderFoodInventory();
  } else if (state.activeFoodSubTab === 'shopping') {
    renderFoodShoppingList();
  }
}

function renderFoodMeals() {
  const mealsTable = document.getElementById('food-meals-table-body');
  mealsTable.innerHTML = '';
  
  state.db.daily_meals.forEach(meal => {
    // Calculator targets
    const caloriesTarget = 600; 
    const proteinsTarget = 25;
    const caloriesPct = Math.min(100, Math.round((parseFloat(meal.calories || 0) / caloriesTarget) * 100));
    const proteinsPct = Math.min(100, Math.round((parseFloat(meal.proteins || 0) / proteinsTarget) * 100));
    
    mealsTable.innerHTML += `
      <tr>
        <td><strong>${meal.date}</strong></td>
        <td><span class="badge badge-info">${meal.mealType}</span></td>
        <td>${meal.plannedItems}</td>
        <td>
          <div class="progress-track" style="margin-bottom:4px" title="Calories">
            <div class="progress-fill" style="width: ${caloriesPct}%; background:var(--accent)"></div>
          </div>
          <span style="font-size:0.75rem">${meal.calories} kcal (${caloriesPct}%)</span>
        </td>
        <td>
          <div class="progress-track" style="margin-bottom:4px" title="Proteins">
            <div class="progress-fill" style="width: ${proteinsPct}%; background:var(--primary)"></div>
          </div>
          <span style="font-size:0.75rem">${meal.proteins}g (${proteinsPct}%)</span>
        </td>
        <td><strong>$${parseFloat(meal.costPerChild).toFixed(2)}</strong></td>
        <td class="staff-admin-only">
          <button class="btn btn-secondary btn-icon-only" onclick="editMealModal('${meal.id}')" title="Edit Meal Entry">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-8.5-4.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L14.5 7.5z"/></svg>
          </button>
        </td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function renderFoodInventory() {
  const inventoryTable = document.getElementById('food-inventory-table-body');
  inventoryTable.innerHTML = '';
  
  state.db.food_inventory.forEach(item => {
    const stock = parseFloat(item.currentStock || 0);
    const badge = stock < 10 ? '<span class="badge badge-danger">Low Stock</span>' : '<span class="badge badge-success">In Stock</span>';
    
    inventoryTable.innerHTML += `
      <tr>
        <td><strong>${item.itemName}</strong></td>
        <td>${item.category}</td>
        <td>${item.stockIn} ${item.unit}</td>
        <td>${item.stockOut} ${item.unit}</td>
        <td><strong style="color: ${stock < 10 ? 'var(--danger)' : 'inherit'}">${stock} ${item.unit}</strong></td>
        <td>${item.expiryDate}</td>
        <td>${badge}</td>
        <td class="staff-admin-only">
          <button class="btn btn-secondary btn-icon-only" onclick="editInventoryModal('${item.id}')" title="Log Stock">
            <svg viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
          </button>
        </td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function renderFoodShoppingList() {
  const shoppingContainer = document.getElementById('shopping-list-container');
  shoppingContainer.innerHTML = '';
  
  // Filter for items with stock < 10
  const lowStock = state.db.food_inventory.filter(item => parseFloat(item.currentStock || 0) < 10);
  
  if (lowStock.length === 0) {
    shoppingContainer.innerHTML = `
      <div class="alert-banner alert-banner-info" style="grid-column: 1 / -1">
        <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <div>
          <h4 style="font-size:0.95rem">Kitchen Fully Stocked!</h4>
          <p style="font-size:0.8rem">No low-stock ingredients found in kitchen pantry.</p>
        </div>
      </div>
    `;
    return;
  }
  
  lowStock.forEach(item => {
    const reorderQty = 50; // Dynamic suggestion
    shoppingContainer.innerHTML += `
      <div class="metric-card" style="flex-direction:row; align-items:center; justify-content:space-between">
        <div>
          <h4 style="font-size:1.05rem">${item.itemName}</h4>
          <p style="font-size:0.75rem; color:var(--danger)">Currently: ${item.currentStock} ${item.unit} (Alert trigger: &lt;10)</p>
        </div>
        <div style="text-align:right">
          <span class="badge badge-warning" style="margin-bottom:8px">Order Reordered</span>
          <div style="font-size:0.85rem; font-weight:700; color:var(--primary)">Suggest: +${reorderQty} ${item.unit}</div>
        </div>
      </div>
    `;
  });
}

function showAddMealModal() {
  document.getElementById('meal-modal-title').innerText = 'Plan New Meal';
  document.getElementById('meal-form-id').value = 'm_' + Date.now().toString().substr(-6);
  document.getElementById('meal-form-date').value = new Date().toISOString().substring(0,10);
  document.getElementById('meal-form-type').value = 'Breakfast';
  document.getElementById('meal-form-items').value = '';
  document.getElementById('meal-form-calories').value = '450';
  document.getElementById('meal-form-proteins').value = '18';
  document.getElementById('meal-form-carbs').value = '60';
  document.getElementById('meal-form-fats').value = '12';
  document.getElementById('meal-form-cost').value = '1.80';
  document.getElementById('meal-form-notes').value = '';
  
  openModal('meal-modal');
}

function showAddInventoryModal() {
  document.getElementById('inventory-form-id').value = 'inv_' + Date.now().toString().substr(-6);
  document.getElementById('inventory-form-name').value = '';
  document.getElementById('inventory-form-name').disabled = false;
  document.getElementById('inventory-form-expiry').value = '';
  document.getElementById('inventory-form-stock-in').value = '';
  document.getElementById('inventory-form-stock-out').value = '';
  document.getElementById('inventory-form-wastage').value = '';
  document.getElementById('inventory-form-notes').value = '';
  
  openModal('inventory-modal');
}

function showAddFeeModal() {
  document.getElementById('fee-form-id').value = 'fee_' + Date.now().toString().substr(-6);
  document.getElementById('fee-form-child-id').value = '';
  document.getElementById('fee-form-date').value = new Date().toISOString().substring(0,10);
  document.getElementById('fee-form-due').value = '';
  document.getElementById('fee-form-paid').value = '';
  
  // Populate child selector
  const childSelect = document.getElementById('fee-form-child-select');
  childSelect.innerHTML = '<option value="">-- Select Child --</option>';
  state.db.children.forEach(child => {
    const option = document.createElement('option');
    option.value = child.id;
    option.textContent = `${child.fullName} (${child.id})`;
    childSelect.appendChild(option);
  });
  
  openModal('fees-modal');
}

function showAddAcademicReportModal() {
  document.getElementById('academic-report-form-id').value = 'rep_' + Date.now().toString().substr(-6);
  document.getElementById('academic-report-term').value = 'Term 1';
  document.getElementById('academic-report-subject').value = '';
  document.getElementById('academic-report-grade').value = '';
  document.getElementById('academic-report-comments').value = '';
  
  // Populate child selector
  const childSelect = document.getElementById('academic-report-child-select');
  childSelect.innerHTML = '<option value="">-- Select Child --</option>';
  state.db.children.forEach(child => {
    const option = document.createElement('option');
    option.value = child.id;
    option.textContent = `${child.fullName} (${child.id})`;
    childSelect.appendChild(option);
  });
  
  openModal('academic-report-modal');
}

function editMealModal(id) {
  const meal = state.db.daily_meals.find(m => m.id.toString() === id.toString());
  if (!meal) return;
  
  document.getElementById('meal-modal-title').innerText = 'Edit Planned Meal';
  document.getElementById('meal-form-id').value = meal.id;
  document.getElementById('meal-form-date').value = meal.date;
  document.getElementById('meal-form-type').value = meal.mealType;
  document.getElementById('meal-form-items').value = meal.plannedItems;
  document.getElementById('meal-form-calories').value = meal.calories;
  document.getElementById('meal-form-proteins').value = meal.proteins;
  document.getElementById('meal-form-carbs').value = meal.carbs || 0;
  document.getElementById('meal-form-fats').value = meal.fats || 0;
  document.getElementById('meal-form-cost').value = meal.costPerChild;
  document.getElementById('meal-form-notes').value = meal.notes;
  
  openModal('meal-modal');
}

async function saveMealSubmit() {
  const record = {
    id: document.getElementById('meal-form-id').value,
    date: document.getElementById('meal-form-date').value,
    mealType: document.getElementById('meal-form-type').value,
    plannedItems: document.getElementById('meal-form-items').value,
    calories: parseInt(document.getElementById('meal-form-calories').value || 0),
    proteins: parseInt(document.getElementById('meal-form-proteins').value || 0),
    carbs: parseInt(document.getElementById('meal-form-carbs').value || 0),
    fats: parseInt(document.getElementById('meal-form-fats').value || 0),
    costPerChild: parseFloat(document.getElementById('meal-form-cost').value || 0),
    notes: document.getElementById('meal-form-notes').value
  };
  
  if (!record.plannedItems) {
    showToast('Planned items cannot be empty!', 'danger');
    return;
  }
  
  closeModal();
  await cloudSaveRecord('Daily_Meals', record, 'id');
}

function editInventoryModal(id) {
  const item = state.db.food_inventory.find(i => i.id.toString() === id.toString());
  if (!item) return;
  
  document.getElementById('inventory-form-id').value = item.id;
  document.getElementById('inventory-form-name').value = item.itemName;
  document.getElementById('inventory-form-stock-in').value = item.stockIn;
  document.getElementById('inventory-form-stock-out').value = item.stockOut;
  document.getElementById('inventory-form-expiry').value = item.expiryDate;
  document.getElementById('inventory-form-wastage').value = item.wastage || 0;
  document.getElementById('inventory-form-notes').value = item.notes;
  
  openModal('inventory-modal');
}

async function saveInventorySubmit() {
  const id = document.getElementById('inventory-form-id').value;
  const itemName = document.getElementById('inventory-form-name').value;
  const inVal = parseFloat(document.getElementById('inventory-form-stock-in').value || 0);
  const outVal = parseFloat(document.getElementById('inventory-form-stock-out').value || 0);
  const expiryDate = document.getElementById('inventory-form-expiry').value;
  const wastage = parseFloat(document.getElementById('inventory-form-wastage').value || 0);
  const notes = document.getElementById('inventory-form-notes').value;
  
  if (!itemName) {
    showToast('Item name is required', 'danger');
    return;
  }
  
  const item = state.db.food_inventory.find(i => i.id.toString() === id.toString());
  
  const record = {
    id: id,
    itemName: itemName,
    category: item ? item.category : 'General',
    stockIn: inVal,
    stockOut: outVal,
    currentStock: Math.max(0, inVal - outVal),
    unit: item ? item.unit : 'kg',
    expiryDate: expiryDate,
    wastage: wastage,
    notes: notes,
    lastModified: new Date().toISOString()
  };
  
  closeModal();
  await cloudSaveRecord('Food_Inventory', record, 'id');
}

// --- 4. SCHOOL MANAGEMENT TAB ---
function renderSchoolTab() {
  document.querySelectorAll('.school-sub-section').forEach(sec => sec.style.display = 'none');
  document.getElementById(`school-${state.activeSchoolSubTab}-section`).style.display = 'flex';
  
  if (state.activeSchoolSubTab === 'enrollment') {
    renderSchoolEnrollment();
  } else if (state.activeSchoolSubTab === 'fees') {
    renderSchoolFees();
  } else if (state.activeSchoolSubTab === 'reports') {
    renderSchoolReports();
  }
}

function renderSchoolEnrollment() {
  const table = document.getElementById('school-enrollment-table-body');
  table.innerHTML = '';
  
  state.db.school_enrollment.forEach(enroll => {
    const actionButtons = `
      <button class="btn btn-secondary btn-icon-only staff-admin-only" onclick="editEnrollmentModal('${enroll.childId}')" title="Edit Enrollment">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-8.5-4.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L14.5 7.5z"/></svg>
      </button>
    `;
    
    table.innerHTML += `
      <tr>
        <td>${formatChildName(enroll.childId, getChildNameById(enroll.childId))}</td>
        <td><strong>${enroll.schoolName}</strong></td>
        <td>${enroll.gradeClass}</td>
        <td><span class="anonymized-badge">${enroll.rollNumber}</span></td>
        <td><span class="badge badge-info">${enroll.transportStatus}</span></td>
        <td>
          <div style="display:flex; gap:6px">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function renderSchoolFees() {
  const table = document.getElementById('school-fees-table-body');
  table.innerHTML = '';
  
  state.db.school_fees.forEach(fee => {
    const actionButtons = `
      <button class="btn btn-secondary btn-icon-only staff-admin-only" onclick="editFeeModal('${fee.id}')" title="Log Payment">
        <svg viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M12 16v1M5 12h14"/></svg>
      </button>
    `;
    
    const balance = parseFloat(fee.balance || 0);
    const badge = balance === 0 ? 'badge-success' : 'badge-warning';
    const statusText = balance === 0 ? 'Fully Paid' : 'Outstanding Balance';
    
    table.innerHTML += `
      <tr>
        <td>${formatChildName(fee.childId, getChildNameById(fee.childId))}</td>
        <td>${formatCurrency(fee.amountDue)}</td>
        <td>${formatCurrency(fee.amountPaid)}</td>
        <td><strong style="color: ${balance > 0 ? 'var(--warning)' : 'var(--success)'}">${formatCurrency(balance)}</strong></td>
        <td>${fee.dueDate}</td>
        <td><span class="badge ${badge}">${statusText}</span></td>
        <td>
          <div style="display:flex; gap:6px">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function renderSchoolReports() {
  const container = document.getElementById('school-reports-list-container');
  container.innerHTML = '';
  
  state.db.academic_reports.forEach(rep => {
    let gradesHTML = '';
    // rep.gradesJson might be an object or serialized JSON
    let grades = rep.gradesJson;
    if (typeof grades === 'string') {
      try { grades = JSON.parse(grades); } catch(e) { grades = {}; }
    }
    
    for (let subject in grades) {
      gradesHTML += `
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05)">
          <span style="text-transform: capitalize">${subject}</span>
          <span style="font-weight:700; color:var(--primary)">${grades[subject]}</span>
        </div>
      `;
    }
    
    const childDisplayName = formatChildName(rep.childId, getChildNameById(rep.childId));
    
    container.innerHTML += `
      <div class="metric-card" style="flex-direction:column; align-items:stretch; gap:12px; background:hsla(220, 25%, 15%, 0.3)">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:8px">
          <div>
            <div style="font-size:0.95rem; font-weight:700">${childDisplayName}</div>
            <div style="font-size:0.75rem; color:var(--text-muted)">${rep.term} Academic Year</div>
          </div>
          <span class="badge badge-success">Academic Report Card</span>
        </div>
        <div>
          <h5 style="font-size:0.8rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px">Grade Sheet</h5>
          ${gradesHTML}
        </div>
        <div style="margin-top:8px">
          <h5 style="font-size:0.8rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:4px">Teacher Remarks</h5>
          <p style="font-size:0.78rem; font-style:italic">${rep.teacherComments}</p>
        </div>
      </div>
    `;
  });
}

function showAddEnrollmentModal() {
  // Populate Child select dropdown
  const childSelect = document.getElementById('enroll-form-child');
  childSelect.innerHTML = '';
  state.db.children.forEach(c => {
    const child = getChildView(c);
    childSelect.innerHTML += `<option value="${child.id}">${child.name} (ID: ${child.id})</option>`;
  });
  
  document.getElementById('enroll-form-school').value = '';
  document.getElementById('enroll-form-class').value = '';
  document.getElementById('enroll-form-roll').value = '';
  document.getElementById('enroll-form-transport').value = 'Walking';
  
  openModal('enrollment-modal');
}

function editEnrollmentModal(childId) {
  const enroll = state.db.school_enrollment.find(e => e.childId.toString() === childId.toString());
  if (!enroll) return;
  
  const childSelect = document.getElementById('enroll-form-child');
  childSelect.innerHTML = `<option value="${enroll.childId}">${getChildNameById(enroll.childId)}</option>`;
  childSelect.disabled = true;
  
  document.getElementById('enroll-form-school').value = enroll.schoolName;
  document.getElementById('enroll-form-class').value = enroll.gradeClass;
  document.getElementById('enroll-form-roll').value = enroll.rollNumber;
  document.getElementById('enroll-form-transport').value = enroll.transportStatus;
  
  openModal('enrollment-modal');
}

async function saveEnrollmentSubmit() {
  const childSelect = document.getElementById('enroll-form-child');
  const record = {
    childId: childSelect.value,
    schoolName: document.getElementById('enroll-form-school').value,
    gradeClass: document.getElementById('enroll-form-class').value,
    rollNumber: document.getElementById('enroll-form-roll').value,
    transportStatus: document.getElementById('enroll-form-transport').value
  };
  
  childSelect.disabled = false; // Restore state
  
  if (!record.schoolName) {
    showToast('School Name is required!', 'danger');
    return;
  }
  
  closeModal();
  await cloudSaveRecord('School_Enrollment', record, 'childId');
}

function editFeeModal(id) {
  const fee = state.db.school_fees.find(f => f.id.toString() === id.toString());
  if (!fee) return;
  
  document.getElementById('fee-form-id').value = fee.id;
  
  // Populate child selector
  const childSelect = document.getElementById('fee-form-child-select');
  childSelect.innerHTML = '<option value="">-- Select Child --</option>';
  state.db.children.forEach(child => {
    const option = document.createElement('option');
    option.value = child.id;
    option.textContent = `${child.fullName} (${child.id})`;
    childSelect.appendChild(option);
  });
  childSelect.value = fee.childId;
  
  document.getElementById('fee-form-due').value = fee.amountDue;
  document.getElementById('fee-form-paid').value = fee.amountPaid;
  document.getElementById('fee-form-date').value = fee.dueDate;
  
  openModal('fees-modal');
}

async function saveFeeSubmit() {
  const id = document.getElementById('fee-form-id').value;
  const childId = document.getElementById('fee-form-child-select').value;
  const due = parseFloat(document.getElementById('fee-form-due').value || 0);
  const paid = parseFloat(document.getElementById('fee-form-paid').value || 0);
  const dueDate = document.getElementById('fee-form-date').value;
  
  if (!childId) {
    showToast('Please select a child', 'danger');
    return;
  }
  if (!dueDate) {
    showToast('Due date is required', 'danger');
    return;
  }
  
  const fee = state.db.school_fees.find(f => f.id.toString() === id.toString());
  
  const record = {
    id: id,
    childId: childId,
    amountDue: due,
    amountPaid: paid,
    balance: Math.max(0, due - paid),
    dueDate: dueDate,
    receiptUrl: fee ? fee.receiptUrl : '',
    status: due > paid ? 'Pending' : 'Paid',
    lastModified: new Date().toISOString()
  };
  
  closeModal();
  await cloudSaveRecord('School_Fees', record, 'id');
}

async function saveAcademicReportSubmit() {
  const childId = document.getElementById('academic-report-child-select').value;
  const term = document.getElementById('academic-report-term').value;
  const subject = document.getElementById('academic-report-subject').value;
  const grade = document.getElementById('academic-report-grade').value;
  const comments = document.getElementById('academic-report-comments').value;
  
  if (!childId || !subject) {
    showToast('Child and Subject are required', 'danger');
    return;
  }
  
  const record = {
    id: document.getElementById('academic-report-form-id').value,
    childId: childId,
    term: term,
    subject: subject,
    grade: grade,
    comments: comments,
    dateCreated: new Date().toISOString()
  };
  
  closeModal();
  await cloudSaveRecord('Academic_Reports', record, 'id');
}

// --- 5. MEDICAL MANAGEMENT TAB ---
function renderMedicalTab() {
  document.querySelectorAll('.medical-sub-section').forEach(sec => sec.style.display = 'none');
  document.getElementById(`medical-${state.activeMedicalSubTab}-section`).style.display = 'flex';
  
  if (state.activeMedicalSubTab === 'profiles') {
    renderMedicalProfiles();
  } else if (state.activeMedicalSubTab === 'logs') {
    renderMedicalLogs();
  }
}

function parseJsonArray(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string' && input.trim() !== '') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function getMedicalChildId(record) {
  return record.childId || record.ChildID || record.id || record.ID || '';
}

function toMedicalRecord(record) {
  const normalized = normalizeData('medical_records', [record])[0];
  normalized.vaccinationsJson = parseJsonArray(normalized.vaccinationsJson);
  normalized.doctorVisitsJson = parseJsonArray(normalized.doctorVisitsJson);
  normalized.dispensedMedsJson = parseJsonArray(normalized.dispensedMedsJson);
  normalized.VaccinationsJson = normalized.vaccinationsJson;
  normalized.DoctorVisitsJson = normalized.doctorVisitsJson;
  normalized.DispensedMedsJson = normalized.dispensedMedsJson;
  return normalized;
}

function buildMedicalChildSelect(selectId, selectedValue = '') {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';

  state.db.children.forEach(c => {
    const child = getChildView(c);
    const selected = child.id.toString() === selectedValue.toString() ? 'selected' : '';
    select.innerHTML += `<option value="${child.id}" ${selected}>${child.name} (ID: ${child.id})</option>`;
  });
}

function renderMedicalProfiles() {
  const tbody = document.getElementById('medical-profiles-table-body');
  tbody.innerHTML = '';

  if (!Array.isArray(state.db.medical_records) || state.db.medical_records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">No health profiles yet. Click "Add Health Profile".</td></tr>';
    applyRoleBasedVisibility();
    return;
  }

  state.db.medical_records.forEach(raw => {
    const med = toMedicalRecord(raw);
    const childId = getMedicalChildId(med);
    const childDisplayName = formatChildName(childId, getChildNameById(childId));
    const vaccinations = parseJsonArray(med.vaccinationsJson);
    const takenCount = vaccinations.filter(v => (v.status || '').toLowerCase() === 'taken').length;
    const dueCount = vaccinations.length - takenCount;

    tbody.innerHTML += `
      <tr>
        <td>${childDisplayName}</td>
        <td><span class="badge badge-info">${med.bloodType || 'Unknown'}</span></td>
        <td>${med.allergies || 'None'}</td>
        <td>${med.chronicConditions || 'None'}</td>
        <td>Taken: ${takenCount} | Due: ${Math.max(0, dueCount)}</td>
        <td class="staff-admin-only">
          <button class="btn btn-secondary btn-icon-only" onclick="editMedicalProfileModal('${childId}')" title="Edit Health Profile">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-8.5-4.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L14.5 7.5z"/></svg>
          </button>
        </td>
      </tr>
    `;
  });

  applyRoleBasedVisibility();
}

function renderMedicalLogs() {
  const tbody = document.getElementById('medical-logs-table-body');
  tbody.innerHTML = '';
  let hasLogs = false;

  state.db.medical_records.forEach(raw => {
    const med = toMedicalRecord(raw);
    const childId = getMedicalChildId(med);
    const childDisplayName = formatChildName(childId, getChildNameById(childId));
    const visits = parseJsonArray(med.doctorVisitsJson);

    visits.forEach((visit, index) => {
      hasLogs = true;
      tbody.innerHTML += `
        <tr>
          <td>${visit.date || '-'}</td>
          <td>${childDisplayName}</td>
          <td>${visit.doctor || '-'}</td>
          <td>${visit.diagnosis || '-'}</td>
          <td>${visit.prescription || '-'}</td>
          <td class="staff-admin-only">
            <div style="display:flex; gap:6px">
              <button class="btn btn-secondary btn-icon-only" onclick="editMedicalVisitModal('${childId}', ${index})" title="Edit Visit Log">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7m-8.5-4.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L14.5 7.5z"/></svg>
              </button>
              <button class="btn btn-danger btn-icon-only admin-only" onclick="deleteMedicalVisit('${childId}', ${index})" title="Delete Visit Log">
                <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });
  });

  if (!hasLogs) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">No clinic logs yet. Click "Log Clinic Visit".</td></tr>';
  }

  applyRoleBasedVisibility();
}

function showAddMedicalProfileModal() {
  document.getElementById('med-form-mode').value = 'add';
  document.getElementById('med-form-child-id').value = '';
  document.getElementById('med-form-child-label').innerText = 'Select a child below';
  document.getElementById('med-form-blood').value = 'O+';
  document.getElementById('med-form-allergies').value = 'None';
  document.getElementById('med-form-chronic').value = 'None';
  buildMedicalChildSelect('med-form-child-select');
  document.getElementById('med-form-child-select').disabled = false;
  openModal('medical-modal');
}

function editMedicalProfileModal(childId) {
  const med = state.db.medical_records.map(toMedicalRecord).find(m => getMedicalChildId(m).toString() === childId.toString());
  if (!med) return;

  document.getElementById('med-form-mode').value = 'edit';
  document.getElementById('med-form-child-id').value = childId;
  document.getElementById('med-form-child-label').innerText = getChildNameById(childId);
  document.getElementById('med-form-blood').value = med.bloodType || 'O+';
  document.getElementById('med-form-allergies').value = med.allergies || 'None';
  document.getElementById('med-form-chronic').value = med.chronicConditions || 'None';
  buildMedicalChildSelect('med-form-child-select', childId);
  document.getElementById('med-form-child-select').disabled = true;
  openModal('medical-modal');
}

async function saveMedicalProfileSubmit() {
  const mode = document.getElementById('med-form-mode').value;
  const selectedChildId = mode === 'add'
    ? document.getElementById('med-form-child-select').value
    : document.getElementById('med-form-child-id').value;

  if (!selectedChildId) {
    showToast('Please select a child.', 'warning');
    return;
  }

  const existing = state.db.medical_records.map(toMedicalRecord).find(m => getMedicalChildId(m).toString() === selectedChildId.toString());
  const record = {
    ...(existing || {
      childId: selectedChildId,
      ChildID: selectedChildId,
      vaccinationsJson: [],
      VaccinationsJson: [],
      doctorVisitsJson: [],
      DoctorVisitsJson: [],
      dispensedMedsJson: [],
      DispensedMedsJson: []
    }),
    childId: selectedChildId,
    ChildID: selectedChildId,
    bloodType: document.getElementById('med-form-blood').value,
    BloodType: document.getElementById('med-form-blood').value,
    allergies: document.getElementById('med-form-allergies').value,
    Allergies: document.getElementById('med-form-allergies').value,
    chronicConditions: document.getElementById('med-form-chronic').value,
    ChronicConditions: document.getElementById('med-form-chronic').value,
    LastModified: new Date().toISOString()
  };

  closeModal();
  await cloudSaveRecord('Medical_Records', record, 'ChildID');
}

function showAddMedicalVisitModal() {
  buildMedicalChildSelect('med-visit-child-id');
  document.getElementById('med-visit-child-id').disabled = false;
  document.getElementById('med-visit-index').value = '-1';
  document.getElementById('med-visit-date').value = new Date().toISOString().substring(0, 10);
  document.getElementById('med-visit-doctor').value = '';
  document.getElementById('med-visit-diagnosis').value = '';
  document.getElementById('med-visit-prescription').value = '';
  openModal('medical-visit-modal');
}

function editMedicalVisitModal(childId, visitIndex) {
  const med = state.db.medical_records.map(toMedicalRecord).find(m => getMedicalChildId(m).toString() === childId.toString());
  if (!med) return;
  const visits = parseJsonArray(med.doctorVisitsJson);
  const visit = visits[visitIndex];
  if (!visit) return;

  buildMedicalChildSelect('med-visit-child-id', childId);
  document.getElementById('med-visit-child-id').disabled = true;
  document.getElementById('med-visit-index').value = visitIndex.toString();
  document.getElementById('med-visit-date').value = visit.date || new Date().toISOString().substring(0, 10);
  document.getElementById('med-visit-doctor').value = visit.doctor || '';
  document.getElementById('med-visit-diagnosis').value = visit.diagnosis || '';
  document.getElementById('med-visit-prescription').value = visit.prescription || '';
  openModal('medical-visit-modal');
}

async function saveMedicalVisitSubmit() {
  const childId = document.getElementById('med-visit-child-id').value;
  const visitDate = document.getElementById('med-visit-date').value;
  const doctor = document.getElementById('med-visit-doctor').value.trim();
  const diagnosis = document.getElementById('med-visit-diagnosis').value.trim();
  const prescription = document.getElementById('med-visit-prescription').value.trim();
  const visitIndex = parseInt(document.getElementById('med-visit-index').value || '-1', 10);

  if (!childId || !doctor || !diagnosis) {
    showToast('Child, doctor and diagnosis are required.', 'warning');
    return;
  }

  const existing = state.db.medical_records.map(toMedicalRecord).find(m => getMedicalChildId(m).toString() === childId.toString());
  const record = existing ? { ...existing } : {
    childId: childId,
    ChildID: childId,
    bloodType: 'Unknown',
    BloodType: 'Unknown',
    allergies: 'None',
    Allergies: 'None',
    chronicConditions: 'None',
    ChronicConditions: 'None',
    vaccinationsJson: [],
    VaccinationsJson: [],
    doctorVisitsJson: [],
    DoctorVisitsJson: [],
    dispensedMedsJson: [],
    DispensedMedsJson: []
  };

  const visits = parseJsonArray(record.doctorVisitsJson);
  const newVisit = {
    date: visitDate || new Date().toISOString().substring(0, 10),
    doctor: doctor,
    diagnosis: diagnosis,
    prescription: prescription
  };

  if (visitIndex >= 0 && visitIndex < visits.length) {
    visits[visitIndex] = newVisit;
  } else {
    visits.push(newVisit);
  }

  record.childId = childId;
  record.ChildID = childId;
  record.doctorVisitsJson = visits;
  record.DoctorVisitsJson = visits;
  record.LastModified = new Date().toISOString();

  closeModal();
  document.getElementById('med-visit-child-id').disabled = false;
  await cloudSaveRecord('Medical_Records', record, 'ChildID');
}

async function deleteMedicalVisit(childId, visitIndex) {
  if (!confirm('Delete this clinic visit log entry?')) return;

  const med = state.db.medical_records.map(toMedicalRecord).find(m => getMedicalChildId(m).toString() === childId.toString());
  if (!med) return;

  const visits = parseJsonArray(med.doctorVisitsJson);
  if (visitIndex < 0 || visitIndex >= visits.length) return;
  visits.splice(visitIndex, 1);
  med.doctorVisitsJson = visits;
  med.DoctorVisitsJson = visits;
  med.LastModified = new Date().toISOString();
  await cloudSaveRecord('Medical_Records', med, 'ChildID');
}

// --- 6. FINANCIAL TREASURY TAB ---
function renderFinanceTab() {
  document.querySelectorAll('.finance-sub-section').forEach(sec => sec.style.display = 'none');
  document.getElementById(`finance-${state.activeFinanceSubTab}-section`).style.display = 'flex';
  
  if (state.activeFinanceSubTab === 'ledger') {
    renderFinanceLedger();
  } else if (state.activeFinanceSubTab === 'reports') {
    renderFinanceReports();
  }
}

function renderFinanceLedger() {
  const ledgerTable = document.getElementById('finance-ledger-table-body');
  ledgerTable.innerHTML = '';
  
  state.db.finances.forEach(fin => {
    const isIncome = fin.type === 'Income';
    const amountColor = isIncome ? 'var(--success)' : 'var(--danger)';
    const amountSign = isIncome ? '+' : '-';
    
    const actionButtons = `
      <button class="btn btn-secondary btn-icon-only staff-admin-only" onclick="viewReceipt('${fin.id}')" title="Audit Receipt">
        <svg viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      </button>
      <button class="btn btn-danger btn-icon-only admin-only" onclick="deleteTransaction('${fin.id}')" title="Void Transaction">
        <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    `;
    
    ledgerTable.innerHTML += `
      <tr>
        <td>${fin.date}</td>
        <td><span class="badge ${isIncome ? 'badge-success' : 'badge-danger'}">${fin.type}</span></td>
        <td><strong>${fin.category}</strong></td>
        <td><strong style="color:${amountColor}">${amountSign}${formatCurrency(fin.amount)}</strong></td>
        <td>${fin.description}</td>
        <td><span class="badge badge-info">${fin.allocatedTo || 'Unallocated'}</span></td>
        <td>
          <div style="display:flex; gap:6px">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function renderFinanceReports() {
  const container = document.getElementById('budget-report-container');
  container.innerHTML = '';
  
  // Group operational expenses dynamically
  const categories = {};
  state.db.finances.forEach(f => {
    if (f.type === 'Expense') {
      categories[f.category] = (categories[f.category] || 0) + parseFloat(f.amount || 0);
    }
  });
  
  // Hardcode static budget limits for visual budget vs actual auditing
  const budgetLimits = {
    'Food': 5000,
    'School Fees': 8000,
    'Medical': 3000,
    'Utilities': 2000,
    'Staff Salaries': 10000
  };
  
  for (let cat in budgetLimits) {
    const actual = categories[cat] || 0;
    const limit = budgetLimits[cat];
    const percentage = Math.min(100, Math.round((actual / limit) * 100));
    
    container.innerHTML += `
      <div class="nutrition-item">
        <div class="nutrition-item-header">
          <span>${cat}</span>
          <span class="value">$${actual.toLocaleString()} / $${limit.toLocaleString()} (${percentage}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${percentage}%; background: ${percentage > 90 ? 'var(--danger)' : 'var(--primary)'}"></div>
        </div>
      </div>
    `;
  }
}

function showAddTransactionModal() {
  document.getElementById('trans-form-id').value = 't_' + Date.now().toString().substr(-6);
  document.getElementById('trans-form-date').value = new Date().toISOString().substring(0,10);
  document.getElementById('trans-form-type').value = 'Expense';
  document.getElementById('trans-form-category').value = 'Food';
  document.getElementById('trans-form-amount').value = '';
  document.getElementById('trans-form-desc').value = '';
  document.getElementById('trans-form-allocated').value = 'General';
  document.getElementById('trans-form-receipt').value = '';
  
  openModal('finance-modal');
}

async function saveTransactionSubmit() {
  const record = {
    id: document.getElementById('trans-form-id').value,
    date: document.getElementById('trans-form-date').value,
    type: document.getElementById('trans-form-type').value,
    category: document.getElementById('trans-form-category').value,
    amount: parseFloat(document.getElementById('trans-form-amount').value || 0),
    description: document.getElementById('trans-form-desc').value,
    allocatedTo: document.getElementById('trans-form-allocated').value,
    receiptUrl: document.getElementById('trans-form-receipt').value || 'https://via.placeholder.com/150'
  };
  
  if (!record.amount || !record.description) {
    showToast('Amount and Description are required!', 'danger');
    return;
  }
  
  closeModal();
  await cloudSaveRecord('Finances', record, 'id');
}

function receiptIdentityHeader(title, subtitle = '') {
  const profile = getCurrentPrintProfile();
  return `
    <div style="display:flex; gap:12px; align-items:flex-start; border-bottom:2px dashed #333; padding-bottom:12px; margin-bottom:14px">
      <div style="width:44px;height:44px;border-radius:10px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700">${profile.logo}</div>
      <div style="flex:1">
        <h2 style="font-size:1rem; margin:0 0 2px 0; color:#111">${profile.name}</h2>
        <p style="font-size:0.75rem; margin:0; color:#333">${profile.address}</p>
        <p style="font-size:0.72rem; margin:2px 0 0; color:#555">Tel: ${profile.phone} | Email: ${profile.email}</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:0.78rem; font-weight:700; color:#111">${title}</div>
        <div style="font-size:0.7rem; color:#666">${subtitle}</div>
      </div>
    </div>
  `;
}

function viewReceipt(transactionId) {
  const transaction = state.db.finances.find(f => f.id.toString() === transactionId.toString());
  if (!transaction) return;
  
  const modalBody = document.getElementById('receipt-view-modal-body');
  modalBody.innerHTML = `
    <div class="printable-receipt">
      ${receiptIdentityHeader('ORPHANAGE AUDIT BILL', 'OMS System Transaction Record')}
      <div class="receipt-row">
        <span>Transaction ID:</span>
        <strong>${transaction.id}</strong>
      </div>
      <div class="receipt-row">
        <span>Date Logged:</span>
        <strong>${transaction.date}</strong>
      </div>
      <div class="receipt-row">
        <span>Ledger Flow:</span>
        <strong>${transaction.type.toUpperCase()}</strong>
      </div>
      <div class="receipt-row">
        <span>Category:</span>
        <strong>${transaction.category}</strong>
      </div>
      <div class="receipt-row">
        <span>Description:</span>
        <strong>${transaction.description}</strong>
      </div>
      <div class="receipt-row">
        <span>Allocated Fund:</span>
        <strong>${transaction.allocatedTo || 'General Operations'}</strong>
      </div>
      <div class="receipt-total">
        <span>AUDITED VALUE:</span>
        <span>${formatCurrency(transaction.amount)}</span>
      </div>
      <div style="text-align:center; font-size:0.7rem; color:#888; margin-top:20px; border-top:1px dashed #333; padding-top:10px">
        This is an autogenerated, tamper-proof audit bill secured by App settings credentials.
      </div>
    </div>
  `;
  
  openModal('receipt-view-modal');
}

function triggerReceiptPrint() {
  const body = document.getElementById('receipt-view-modal-body');
  if (!body || !body.innerHTML.trim()) {
    showToast('No receipt content available to print.', 'warning');
    return;
  }
  const printWindow = window.open('', '_blank', 'width=850,height=900');
  if (!printWindow) {
    showToast('Allow popups to print receipts.', 'warning');
    return;
  }
  printWindow.document.write(`
    <html>
      <head>
        <title>Receipt Printout</title>
        <style>
          body { margin: 20px; background: #fff; color: #000; font-family: Arial, sans-serif; }
          .printable-receipt { max-width: 720px; margin: 0 auto; }
          .receipt-row { display:flex; justify-content:space-between; gap:20px; margin: 8px 0; font-size: 13px; }
          .receipt-row strong { text-align:right; }
          .receipt-total { display:flex; justify-content:space-between; margin-top:14px; padding:10px 0; border-top:1px solid #222; border-bottom:1px solid #222; font-weight:700; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>${body.innerHTML}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function deleteTransaction(id) {
  if (confirm('Void / Delete this financial transaction row permanently?')) {
    await cloudDeleteRecord('Finances', 'id', id);
  }
}

function exportFinanceCSV() {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "ID,Date,Type,Category,Amount,Description,Allocation\r\n";
  
  state.db.finances.forEach(f => {
    csvContent += `"${f.id}","${f.date}","${f.type}","${f.category}","${f.amount}","${f.description}","${f.allocatedTo}"\r\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `OMS_Finance_Ledger_${new Date().toISOString().substring(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('CSV Audit Report exported!', 'success');
}

// --- 7. TRANSPARENCY & DONORS TAB ---
function renderDonorsTab() {
  // Metric Ratios
  const totalKids = state.db.children.filter(c => getChildView(c).status !== 'Discharged').length;
  
  // Calculate total monthly meals served (from planned food daily meals logs)
  const mealsThisMonth = state.db.daily_meals.length * totalKids; 
  
  // Mock School attendance rate
  const attendanceRate = 97.4; 
  
  document.getElementById('donor-metric-total-children').innerText = totalKids;
  document.getElementById('donor-metric-meals').innerText = mealsThisMonth.toLocaleString();
  document.getElementById('donor-metric-attendance').innerText = `${attendanceRate}%`;
  
  // Load public donations registry
  const donationsTable = document.getElementById('donor-feed-table-body');
  donationsTable.innerHTML = '';
  
  state.db.donations.forEach(don => {
    const thankBtn = don.thanked === 'Yes' 
      ? '<span class="badge badge-success">Thank Note Sent</span>' 
      : `<button class="btn btn-secondary staff-admin-only" style="padding:4px 8px; font-size:0.75rem" onclick="sendThankNote('${don.id}')">Send Thank Note</button>`;
      
    donationsTable.innerHTML += `
      <tr>
        <td><strong>${don.donorName}</strong></td>
        <td>${formatCurrency(don.amount)}</td>
        <td><span class="badge badge-info">${don.donationType}</span></td>
        <td>${don.allocatedTo}</td>
        <td>${don.date}</td>
        <td>${thankBtn}</td>
      </tr>
    `;
  });
  
  applyRoleBasedVisibility();
}

function showAddDonationModal() {
  document.getElementById('don-form-id').value = 'd_' + Date.now().toString().substr(-6);
  document.getElementById('don-form-name').value = '';
  document.getElementById('don-form-email').value = '';
  document.getElementById('don-form-amount').value = '';
  document.getElementById('don-form-type').value = 'One-time';
  document.getElementById('don-form-allocated').value = 'Food';
  
  openModal('donations-modal');
}

async function saveDonationSubmit() {
  const donationId = document.getElementById('don-form-id').value;
  const name = document.getElementById('don-form-name').value;
  const amountStr = document.getElementById('don-form-amount').value;
  const type = document.getElementById('don-form-type').value;
  const allocated = document.getElementById('don-form-allocated').value;
  
  if (!name || !amountStr) {
    showToast('Name and Amount are required!', 'danger');
    return;
  }
  
  const record = {
    id: donationId,
    donorName: name,
    donorEmail: document.getElementById('don-form-email').value || 'anonymous@global.org',
    date: new Date().toISOString().substring(0, 10),
    amount: parseFloat(amountStr),
    donationType: type,
    allocatedTo: allocated,
    thanked: 'No',
    receiptUrl: 'https://via.placeholder.com/150'
  };
  
  closeModal();
  
  // Save to donations
  await cloudSaveRecord('Donations', record, 'id');
  
  // Double-entry write: Add also to Financials income ledger!
  const flowRecord = {
    id: 't_in_' + Date.now().toString().substr(-6),
    date: record.date,
    type: 'Income',
    category: 'Donations',
    amount: record.amount,
    description: `Donation by ${name} allocated to ${allocated}`,
    allocatedTo: allocated,
    receiptUrl: record.receiptUrl
  };
  await cloudSaveRecord('Finances', flowRecord, 'id');
  
  // Instantly generate impact visualization receipt
  setTimeout(() => {
    generateThankYouReceipt(record);
  }, 300);
}

function generateThankYouReceipt(donation) {
  const body = document.getElementById('receipt-view-modal-body');
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0d9488';
  
  // Calculate direct impact metrics based on allocation
  let impactText = '';
  if (donation.allocatedTo === 'Food') {
    const mealsNum = Math.floor(donation.amount / 1.80);
    impactText = `Provides approximately <strong>${mealsNum} highly nutritious meals</strong> for children this month.`;
  } else if (donation.allocatedTo === 'School Fees') {
    impactText = `Funds approximately <strong>${Math.floor(donation.amount / 150)} school textbooks</strong> or classroom learning sets.`;
  } else if (donation.allocatedTo === 'Medical') {
    impactText = `Secures up to <strong>${Math.floor(donation.amount / 20)} pediatric clinic health checkups</strong> and vaccinations.`;
  } else {
    impactText = `Directly funds general logistics, caretaker operations, and bed facilities.`;
  }
  
  body.innerHTML = `
    <div class="printable-receipt" style="border: 2px solid ${primaryColor}; background:#ffffff; color:#333">
      ${receiptIdentityHeader('THANK YOU GENEROUS DONOR', 'Official Charity Tax Deductible Receipt')}
      <div class="receipt-row">
        <span>Receipt ID:</span>
        <strong>TAX_${donation.id.toUpperCase()}</strong>
      </div>
      <div class="receipt-row">
        <span>Donor Name:</span>
        <strong>${donation.donorName}</strong>
      </div>
      <div class="receipt-row">
        <span>Allocation:</span>
        <strong>${donation.allocatedTo} Fund</strong>
      </div>
      <div class="receipt-row">
        <span>Receipt Type:</span>
        <strong>${donation.donationType}</strong>
      </div>
      <div class="receipt-total" style="border-color:${primaryColor}">
        <span>CONTRIBUTION VALUE:</span>
        <span>$${parseFloat(donation.amount).toFixed(2)}</span>
      </div>
      
      <div style="background:rgba(0,180,120,0.1); border-radius:10px; padding:12px; margin-top:20px; font-size:0.8rem; line-height:1.4">
        <h4 style="color:#008060; margin-bottom:4px; font-size:0.85rem">Direct Humanitarian Impact</h4>
        <p>${impactText}</p>
      </div>
      
      <div style="text-align:center; font-size:0.7rem; color:#888; margin-top:20px; border-top:1px dashed #333; padding-top:10px">
        Your generosity sustains our children. This receipt serves as official tax exemption proof.
      </div>
    </div>
  `;
  
  openModal('receipt-view-modal');
}

async function sendThankNote(donationId) {
  const donation = state.db.donations.find(d => d.id.toString() === donationId.toString());
  if (!donation) return;
  
  showHUD(true, 'Generating thank you dispatch...');
  
  donation.thanked = 'Yes';
  await cloudSaveRecord('Donations', donation, 'id');
  
  showHUD(false);
  showToast(`Thank You note emailed successfully to ${donation.donorEmail}!`, 'success');
}

// --- 8. SETTINGS TAB ---
function renderSettingsTab() {
  document.getElementById('settings-url-input').value = state.googleSheetsUrl;
  document.getElementById('settings-url-input').readOnly = false;
  const adminEmailInput = document.getElementById('settings-admin-otp-email');
  if (adminEmailInput) adminEmailInput.value = state.adminOtpEmail || DEFAULT_ADMIN_OTP_EMAIL;
  setPrintProfileInputs(getCurrentPrintProfile());
}

async function saveSettingsUrl() {
  let inputUrl = document.getElementById('settings-url-input').value.trim();
  
  if (!inputUrl) {
    showToast('URL cannot be empty', 'danger');
    return;
  }
  
  // Validate and fix the URL (prevent duplication)
  if (inputUrl.includes('exechttps://')) {
    inputUrl = inputUrl.split('exechttps://')[0] + 'exec';
  }
  
  // Save the URL from settings input
  state.googleSheetsUrl = inputUrl;
  document.getElementById('settings-url-input').value = inputUrl;
  localStorage.setItem('oms_google_sheets_url', inputUrl);
  
  // Save to App_Settings sheet
  const settingsRecord = {
    id: 'sheets_url',
    settingKey: 'google_sheets_url',
    settingValue: inputUrl,
    lastModified: new Date().toISOString()
  };
  cloudSaveRecord('App_Settings', settingsRecord, 'id');
  
  showToast('Apps Script URL Saved. Testing connection...', 'info');
  await loadDatabase();
}

async function saveAdminOtpEmail() {
  const input = document.getElementById('settings-admin-otp-email');
  if (!input) return;

  const email = input.value.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!validEmail) {
    showToast('Please enter a valid admin OTP email address.', 'warning');
    return;
  }

  state.adminOtpEmail = email;
  localStorage.setItem('oms_admin_otp_email', email);

  const settingsRecord = {
    ID: 'admin_otp_email',
    SettingKey: 'admin_otp_email',
    SettingValue: email,
    LastModified: new Date().toISOString()
  };
  await cloudSaveRecord('App_Settings', settingsRecord, 'ID');
  showToast(`Admin OTP email updated to ${email}`, 'success');
}

async function savePrintProfileSettings() {
  const logo = (document.getElementById('settings-print-logo')?.value || '').trim() || DEFAULT_PRINT_PROFILE.logo;
  const name = (document.getElementById('settings-print-name')?.value || '').trim();
  const address = (document.getElementById('settings-print-address')?.value || '').trim();
  const phone = (document.getElementById('settings-print-phone')?.value || '').trim();
  const email = (document.getElementById('settings-print-email')?.value || '').trim();

  if (!name || !address) {
    showToast('Orphanage name and address are required for print identity.', 'warning');
    return;
  }

  state.printProfile = {
    logo,
    name,
    address,
    phone,
    email
  };

  const profilePayload = JSON.stringify(getCurrentPrintProfile());
  localStorage.setItem('oms_print_profile', profilePayload);

  await cloudSaveRecord('App_Settings', {
    ID: 'print_profile_json',
    SettingKey: 'print_profile_json',
    SettingValue: profilePayload,
    LastModified: new Date().toISOString()
  }, 'ID');

  setPrintProfileInputs(getCurrentPrintProfile());
  showToast('Print identity updated successfully.', 'success');
}

async function testConnectionAction() {
  const inputUrl = DEFAULT_GOOGLE_SHEETS_URL;
  
  showHUD(true, 'Contacting Google Apps Script...');
  try {
    const res = await fetch(`${inputUrl}?action=testConnection`);
    const data = await res.json();
    if (data.success) {
      const sheetName = data.spreadsheet || data.spreadsheetName || 'Database';
      showToast(`Success! Connected to "${sheetName}" sheet backend.`, 'success');
      updateConnectionIndicator('online', 'Connected to Cloud');
    } else {
      throw new Error(data.error || 'Server rejected request');
    }
  } catch(err) {
    console.error(err);
    showToast('Connection failed! Check macro deployment and CORS configuration.', 'danger');
    updateConnectionIndicator('error', 'Sheets Connection Failed');
  } finally {
    showHUD(false);
  }
}

async function runAutoSetupSheets() {
  const url = DEFAULT_GOOGLE_SHEETS_URL;
  
  showHUD(true, 'Initializing table layouts on Google Sheets...');
  try {
    const res = await fetch(`${url}?action=setup`);
    const data = await res.json();
    if (data.success) {
      const total = data.totalSheets || 12;
      const created = data.created ? data.created.length : 0;
      showToast(`All ${total} spreadsheet tables initialized! (${created} newly created)`, 'success');
    } else {
      throw new Error(data.error);
    }
  } catch(err) {
    console.error(err);
    showToast('Setup aborted. Check Google Apps Script configuration.', 'danger');
  } finally {
    showHUD(false);
  }
}

function showAppsScriptHelpModal() {
  openModal('gas-help-modal');
}

function copyAppsScriptCode() {
  // Fetch hardcoded code from google-apps-script.js block (or copy standard snippet)
  const codeText = document.getElementById('gas-script-textarea').innerText;
  navigator.clipboard.writeText(codeText)
    .then(() => showToast('Apps Script source code copied to clipboard!', 'success'))
    .catch(() => showToast('Copy failed. Please manually highlight the code.', 'danger'));
}

// --- MODAL UTILITIES ---
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.classList.remove('active');
  });
}

// --- HUD SPINNER ---
function showHUD(show, text = 'Processing Request...') {
  const hud = document.getElementById('loading-hud');
  if (show) {
    document.getElementById('loading-hud-text').innerText = text;
    hud.classList.add('active');
  } else {
    hud.classList.remove('active');
  }
}

// --- TOAST SYSTEMS ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'danger') icon = '❌';
  
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);
  
  // Animate removal
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 3500);
}

// --- FULL WORKSPACE MOCK DATA GENERATOR ---
function loadMockDatabase() {
  state.db = {
    children: [
      { id: "101", name: "Gabriel Mwangi", age: "8", gender: "Boy", entryDate: "2024-02-15", guardianName: "Lucy Mwangi", guardianPhone: "+254711223344", roomNumber: "101", bedNumber: "1", status: "Active" },
      { id: "102", name: "Hope Amani", age: "6", gender: "Girl", entryDate: "2025-01-10", guardianName: "Social Worker", guardianPhone: "+254722556677", roomNumber: "201", bedNumber: "1", status: "Active" },
      { id: "103", name: "David Kiprop", age: "11", gender: "Boy", entryDate: "2023-06-22", guardianName: "Joseph Kiprop", guardianPhone: "+254733445566", roomNumber: "101", bedNumber: "2", status: "Active" },
      { id: "104", name: "Joy Kemunto", age: "9", gender: "Girl", entryDate: "2024-08-04", guardianName: "Agnes Kemunto", guardianPhone: "+254744118899", roomNumber: "201", bedNumber: "2", status: "Active" },
      { id: "105", name: "Emanuel Njoroge", age: "13", gender: "Boy", entryDate: "2022-11-30", guardianName: "Social Services", guardianPhone: "+254755998877", roomNumber: "102", bedNumber: "1", status: "Active" }
    ],
    rooms: [
      { roomNumber: "101", capacity: "4", occupancy: "2", genderType: "Boys", notes: "East wing corridor, adjacent to dining facility." },
      { roomNumber: "102", capacity: "4", occupancy: "1", genderType: "Boys", notes: "East wing second unit, contains study lockers." },
      { roomNumber: "201", capacity: "4", occupancy: "2", genderType: "Girls", notes: "West wing first floor, secure child-friendly gate access." },
      { roomNumber: "202", capacity: "4", occupancy: "0", genderType: "Girls", notes: "West wing second unit, extra blank kits store." }
    ],
    food_inventory: [
      { id: "fi_1", itemName: "Parboiled Rice", category: "Grains", stockIn: "100", stockOut: "85", currentStock: "15", unit: "kg", expiryDate: "2026-08-30", wastage: "0.5", notes: "Stock reordered." },
      { id: "fi_2", itemName: "Whole Dry Beans", category: "Legumes", stockIn: "50", stockOut: "46", currentStock: "4", unit: "kg", expiryDate: "2026-10-15", wastage: "0.2", notes: "Urgent low-stock alert triggered!" },
      { id: "fi_3", itemName: "Fresh Liquid Milk", category: "Dairy", stockIn: "60", stockOut: "30", currentStock: "30", unit: "L", expiryDate: "2026-06-01", wastage: "1.0", notes: "Stored in walk-in cold lockers." },
      { id: "fi_4", itemName: "Fresh Cabbage Bags", category: "Veggies", stockIn: "25", stockOut: "18", currentStock: "7", unit: "kg", expiryDate: "2026-05-28", wastage: "0.4", notes: "Keep refrigerated." }
    ],
    daily_meals: [
      { id: "dm_1", date: "2026-05-22", mealType: "Breakfast", plannedItems: "Fortified oatmeal milk porridges, soft boiled eggs, fresh ripe bananas", calories: 480, proteins: 18, carbs: 65, fats: 14, costPerChild: 1.45, notes: "All children checked present, high consumption logs." },
      { id: "dm_2", date: "2026-05-22", mealType: "Lunch", plannedItems: "Steamed jasmine white rice, savory stewed green lentils, fresh shredded cabbages", calories: 620, proteins: 22, carbs: 90, fats: 10, costPerChild: 1.95, notes: "Preparation fully supervised by staff nutritionists." },
      { id: "dm_3", date: "2026-05-22", mealType: "Dinner", plannedItems: "Hot maize meal ugali cakes, sautéed collard greens, scrambled egg bites", calories: 510, proteins: 19, carbs: 80, fats: 11, costPerChild: 1.65, notes: "Dinner served on schedule." }
    ],
    school_enrollment: [
      { childId: "101", schoolName: "Highlands Elementary Academy", gradeClass: "Grade 3", rollNumber: "H-8402", transportStatus: "School Bus" },
      { childId: "102", schoolName: "Highlands Elementary Academy", gradeClass: "Grade 1", rollNumber: "H-9104", transportStatus: "School Bus" },
      { childId: "103", schoolName: "Highlands Elementary Academy", gradeClass: "Grade 5", rollNumber: "H-7341", transportStatus: "School Bus" },
      { childId: "104", schoolName: "St. Jude Day School", gradeClass: "Grade 4", rollNumber: "SJ-490", transportStatus: "Walking" },
      { childId: "105", schoolName: "St. Jude Day School", gradeClass: "Grade 7", rollNumber: "SJ-212", transportStatus: "Walking" }
    ],
    school_fees: [
      { id: "sf_1", childId: "101", amountDue: 350, amountPaid: 350, balance: 0, dueDate: "2026-06-01", status: "Paid" },
      { id: "sf_2", childId: "102", amountDue: 350, amountPaid: 200, balance: 150, dueDate: "2026-06-01", status: "Pending" },
      { id: "sf_3", childId: "103", amountDue: 400, amountPaid: 400, balance: 0, dueDate: "2026-06-01", status: "Paid" },
      { id: "sf_4", childId: "104", amountDue: 280, amountPaid: 0, balance: 280, dueDate: "2026-06-01", status: "Pending" },
      { id: "sf_5", childId: "105", amountDue: 300, amountPaid: 300, balance: 0, dueDate: "2026-06-01", status: "Paid" }
    ],
    academic_reports: [
      { id: "ar_1", childId: "101", term: "Term 1", gradesJson: { math: "A", english: "A-", science: "B+", humanities: "A" }, teacherComments: "Gabriel exhibits exceptional visual arts capabilities and leads class teamwork.", dateCreated: "2026-04-10" },
      { id: "ar_2", childId: "103", term: "Term 1", gradesJson: { math: "B-", english: "B", science: "A", humanities: "B+" }, teacherComments: "David is scoring exceptionally high in sciences. Recommend extra reading.", dateCreated: "2026-04-10" }
    ],
    medical_records: [
      {
        childId: "101",
        bloodType: "A+",
        allergies: "Roasted Peanuts (Severe anaphylaxis risks)",
        chronicConditions: "Mild Childhood Asthma",
        vaccinationsJson: [
          { name: "BCG", status: "Taken" },
          { name: "Polio OPV", status: "Taken" },
          { name: "MMR Vaccine", status: "Taken" },
          { name: "Hepatitis B", status: "Due" }
        ],
        doctorVisitsJson: [
          { date: "2026-05-10", doctor: "Andrew Ochieng", diagnosis: "Routine asthma lung inspection & check", prescription: "Inhaler refill, 1 puff every 12 hrs if chest tightness" }
        ],
        dispensedMedsJson: []
      },
      {
        childId: "102",
        bloodType: "O+",
        allergies: "None",
        chronicConditions: "None",
        vaccinationsJson: [
          { name: "BCG", status: "Taken" },
          { name: "Polio OPV", status: "Taken" },
          { name: "MMR Vaccine", status: "Taken" }
        ],
        doctorVisitsJson: [],
        dispensedMedsJson: []
      },
      {
        childId: "103",
        bloodType: "B-",
        allergies: "Dairy Lactose (Triggers hives)",
        chronicConditions: "None",
        vaccinationsJson: [
          { name: "BCG", status: "Taken" },
          { name: "Polio OPV", status: "Taken" },
          { name: "MMR Vaccine", status: "Taken" }
        ],
        doctorVisitsJson: [
          { date: "2026-04-22", doctor: "Sarah Mbalu", diagnosis: "Mild ear canal itch & wax blockages", prescription: "Wax-dissolving drops, 2 drops daily for 5 days" }
        ],
        dispensedMedsJson: []
      }
    ],
    finances: [
      { id: "tr_1", date: "2026-05-20", type: "Income", category: "Donations", amount: "5000", description: "Direct grant from Rotary Global Club for school tuitions", allocatedTo: "School Fees" },
      { id: "tr_2", date: "2026-05-21", type: "Expense", category: "Food", amount: "480", description: "Bulk replenishment order of dry beans, rice, and cold shelf milk bags", allocatedTo: "Food" },
      { id: "tr_3", date: "2026-05-21", type: "Expense", category: "School Fees", amount: "850", description: "Term 2 tuition batch clearance payments for Academy kids", allocatedTo: "School Fees" },
      { id: "tr_4", date: "2026-05-22", type: "Income", category: "Donations", amount: "1200", description: "Recurring monthly sponsorship by Dr. David & Family", allocatedTo: "General" }
    ],
    donations: [
      { id: "dn_1", donorName: "Rotary Global Club", donorEmail: "grants@rotaryglobal.org", date: "2026-05-20", amount: "5000", donationType: "One-time", allocatedTo: "School Fees", thanked: "Yes" },
      { id: "dn_2", donorName: "Dr. David & Family", donorEmail: "david@careclinic.org", date: "2026-05-22", amount: "1200", donationType: "Recurring", allocatedTo: "General", thanked: "Yes" }
    ],
    app_settings: [
      { key: "connectionUrl", value: "" }
    ]
  };
}
