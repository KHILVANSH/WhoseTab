/**
 * WhoseTab: Application Logic
 * Offline bidirectional expense ledger, scanned payment linking, phone contact picker, and listener bridge.
 */

const STORAGE_KEY = 'whosetab_ledger_v1';
const THEME_KEY = 'whosetab_theme_preference';
const PURGE_V120_KEY = 'whosetab_purged_entries_v120';
const CLEAN_ALIASES_V130_KEY = 'whosetab_clean_aliases_v130';

const COMMERCIAL_MERCHANTS = new Set([
  'amazon', 'amazonpay', 'amazonindia', 'amazonin', 'flipkart', 'myntra', 'meesho',
  'ajio', 'nykaa', 'swiggy', 'zomato', 'blinkit', 'zepto', 'instamart', 'bigbasket',
  'uber', 'ola', 'rapido', 'irctc', 'bookmyshow', 'redbus', 'makemytrip', 'goibibo',
  'paytm', 'phonepe', 'gpay', 'googlepay', 'bhim', 'razorpay', 'cashfree', 'payu',
  'jio', 'airtel', 'vodafone', 'bsnl', 'delhivery', 'bluedart', 'ecomexpress', 'xpressbees'
]);

const GENERIC_ALIAS_TOKENS = new Set([
  'merchant', 'someone', 'purchase', 'payment', 'upi', 'bank', 'pay', 'transfer',
  'wallet', 'cash', 'card', 'order', 'delivery', 'store', 'shop', 'mart', 'canteen', 'paid'
]);

class WhoseTabApp {
  constructor() {
    this.selectedPersonIds = new Set();
    this.manualSplits = new Map();
    this.detectedPaytmData = null;
    this.detectedRepaymentData = null;
    this.toastSelectedIds = new Set();

    this.currentEntryKind = 'split'; // 'split' | 'lent' | 'borrowed'
    this.settleDirection = 'received'; // 'received' | 'paid'
    this.currentFilter = 'all';
    this.peopleSearchQuery = '';
    this.dashboardBalanceMode = 'active'; // 'active' | 'all'
    this.activityFilter = 'all'; // 'all' | 'lent' | 'borrowed' | 'repayment'
    this.activeActionPersonId = null;
    this.activeDetailItem = null;
    this.currentTabIndex = 0;
    this.currentEntryLocation = null;
    this.lastGeoLat = 0;
    this.lastGeoLng = 0;
    this.shopSearchTimer = null;
    this.nearbyShopsCache = [];
    this.onlineShopResults = [];
    this.modalCloseTimers = new WeakMap();
    this.toastCloseTimer = null;

    this.ledger = this.loadLedger();

    this.initElements();
    this.initTheme();
    this.initAppVersion();
    this.syncContactsToNative();
    this.drainQueuedNativeExpenses();
    this.bindEvents();
    this.checkScannerStatus();
    this.checkInitialSetup();
    this.checkUrlParameters();
    this.checkPendingPayment();
    this.render();
  }

  // ================= PERSISTENCE, PURGE MIGRATION & NATIVE SYNC =================
  loadLedger() {
    let loaded = {
      version: 2,
      people: [],
      expenses: [],
      settlements: [],
      savedShops: [],
      settings: { theme: 'dark' }
    };

    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.people)) {
          loaded = {
            version: parsed.version || 1,
            people: parsed.people.map(p => ({
              ...p,
              aliases: Array.isArray(p.aliases) ? p.aliases : []
            })),
            expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
            settlements: Array.isArray(parsed.settlements) ? parsed.settlements : [],
            savedShops: Array.isArray(parsed.savedShops) ? parsed.savedShops : [],
            settings: parsed.settings || { theme: 'dark' }
          };
        }
      }
    } catch (e) {
      console.warn('Could not read ledger storage', e);
    }

    // One-time v1.2.0 entry purge migration: clears legacy test entries while keeping contacts
    if (!localStorage.getItem(PURGE_V120_KEY)) {
      loaded.version = 2;
      loaded.expenses = [];
      loaded.settlements = [];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
        localStorage.setItem(PURGE_V120_KEY, 'true');
        localStorage.removeItem('whosetab_dismissed_payments_v2');
        localStorage.removeItem('whosetab_dismissed_repayments_v2');
      } catch (e) {}
      if (window.AndroidBridge && window.AndroidBridge.clearStalePaymentCache) {
        try { window.AndroidBridge.clearStalePaymentCache(); } catch (e) {}
      }
    }

    // One-time v1.3.0 alias sanitization: prune short (<4 chars), generic, or commercial merchant aliases
    if (!localStorage.getItem(CLEAN_ALIASES_V130_KEY)) {
      let dirty = false;
      loaded.people.forEach(p => {
        if (!Array.isArray(p.aliases) || p.aliases.length === 0) return;
        const filtered = p.aliases.filter(alias => {
          const na = String(alias || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!na || na.length < 4) return false;
          if (GENERIC_ALIAS_TOKENS.has(na) || COMMERCIAL_MERCHANTS.has(na)) return false;
          return true;
        });
        if (filtered.length !== p.aliases.length) {
          p.aliases = filtered;
          dirty = true;
        }
      });
      try {
        if (dirty) localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
        localStorage.setItem(CLEAN_ALIASES_V130_KEY, 'true');
      } catch (e) {}
    }

    return loaded;
  }

  saveLedger() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ledger));
    } catch (e) {
      console.error('Error saving ledger', e);
    }
    this.syncContactsToNative();
    this.render();
  }

  syncContactsToNative() {
    if (window.AndroidBridge && window.AndroidBridge.syncContacts) {
      try {
        const compact = this.ledger.people.map(p => ({
          id: p.id,
          name: p.name,
          relationship: p.relationship,
          phone: p.phone || '',
          upi: p.upi || '',
          aliases: Array.isArray(p.aliases) ? p.aliases : []
        }));
        window.AndroidBridge.syncContacts(JSON.stringify(compact));
      } catch (e) {}
    }
  }

  drainQueuedNativeExpenses() {
    if (window.AndroidBridge && window.AndroidBridge.consumeQueuedQuickExpenses) {
      try {
        const raw = window.AndroidBridge.consumeQueuedQuickExpenses();
        if (raw && raw.length > 2) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            this.applyNativeQuickExpenses(arr);
          }
        }
      } catch (e) {
        console.error('Failed to drain quick expenses', e);
      }
    }
  }

  applyNativeQuickExpenses(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    let addedCount = 0;
    const existingIds = new Set(this.ledger.expenses.map(e => e.id));

    items.forEach(item => {
      if (!item || !item.id || existingIds.has(item.id)) return;
      const expense = {
        id: item.id,
        title: item.title || 'Payment',
        counterpartyName: item.counterpartyName || item.title || '',
        counterpartyHandle: item.counterpartyHandle || '',
        entryKind: item.entryKind || (item.splitType === 'EqualSplit' ? 'split' : 'lent'),
        totalAmount: parseFloat(item.totalAmount) || 0,
        paidById: 'me',
        splitType: item.splitType || 'BoughtForPerson',
        splits: Array.isArray(item.splits) ? item.splits : [],
        category: item.category || 'General',
        paymentSource: item.paymentSource || 'Paytm',
        date: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
        myShare: parseFloat(item.myShare) || 0
      };
      if (expense.totalAmount > 0 && expense.splits.length > 0) {
        this.ledger.expenses.unshift(expense);
        existingIds.add(item.id);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      this.saveLedger();
    }
  }

  // ================= DOM CACHE =================
  initElements() {
    this.dom = {
      scannerStatusBadge: document.getElementById('scannerStatusBadge'),
      scannerStatusText: document.getElementById('scannerStatusText'),

      headerMoreBtn: document.getElementById('headerMoreBtn'),
      headerOverflowMenu: document.getElementById('headerOverflowMenu'),
      menuRecentDetections: document.getElementById('menuRecentDetections'),
      menuSharePendingSummary: document.getElementById('menuSharePendingSummary'),
      menuAddContact: document.getElementById('menuAddContact'),
      menuPermissions: document.getElementById('menuPermissions'),
      menuTestOverlay: document.getElementById('menuTestOverlay'),
      menuExportData: document.getElementById('menuExportData'),
      menuImportData: document.getElementById('menuImportData'),
      menuCheckUpdates: document.getElementById('menuCheckUpdates'),

      heroBalanceLabel: document.getElementById('heroBalanceLabel'),
      totalOwedToMe: document.getElementById('totalOwedToMe'),
      heroCollectSummary: document.getElementById('heroCollectSummary'),
      heroOweSummary: document.getElementById('heroOweSummary'),
      heroExpenseCount: document.getElementById('heroExpenseCount'),
      heroAddBtn: document.getElementById('heroAddBtn'),
      dashboardBalActiveBtn: document.getElementById('dashboardBalActiveBtn'),
      dashboardBalAllBtn: document.getElementById('dashboardBalAllBtn'),
      expenseCountBadge: document.getElementById('expenseCountBadge'),
      activityFilterBtns: document.querySelectorAll('[data-act-filter]'),
      peopleList: document.getElementById('peopleList'),
      recentExpensesList: document.getElementById('recentExpensesList'),

      peopleSearchInput: document.getElementById('peopleSearchInput'),
      filterChips: document.querySelectorAll('.filter-strip .chip'),
      contactsFullList: document.getElementById('contactsFullList'),
      addPersonPageBtn: document.getElementById('addPersonPageBtn'),
      pickPhonePersonPageBtn: document.getElementById('pickPhonePersonPageBtn'),

      detectionModeSelector: document.getElementById('detectionModeSelector'),
      paytmDelaySelector: document.getElementById('paytmDelaySelector'),
      testOverlaySettingsBtn: document.getElementById('testOverlaySettingsBtn'),
      grantNotificationAccessBtn: document.getElementById('grantNotificationAccessBtn'),
      grantPostNotifBtn: document.getElementById('grantPostNotifBtn'),
      grantOverlayAccessBtn: document.getElementById('grantOverlayAccessBtn'),
      grantBatteryAccessBtn: document.getElementById('grantBatteryAccessBtn'),
      themeDarkBtn: document.getElementById('themeDarkBtn'),
      themeLightBtn: document.getElementById('themeLightBtn'),
      appVersionDisplay: document.getElementById('appVersionDisplay'),
      updateStatusNotice: document.getElementById('updateStatusNotice'),
      checkForUpdatesBtn: document.getElementById('checkForUpdatesBtn'),
      exportDataBtn: document.getElementById('exportDataBtn'),
      importDataBtn: document.getElementById('importDataBtn'),
      importFileInput: document.getElementById('importFileInput'),
      clearEntriesOnlyBtn: document.getElementById('clearEntriesOnlyBtn'),
      clearDataBtn: document.getElementById('clearDataBtn'),

      inAppQuickToast: document.getElementById('inAppQuickToast'),
      qtAmountTitle: document.getElementById('qtAmountTitle'),
      qtSubtitle: document.getElementById('qtSubtitle'),
      qtCloseBtn: document.getElementById('qtCloseBtn'),
      qtContactsRow: document.getElementById('qtContactsRow'),
      qtSecondaryBtn: document.getElementById('qtSecondaryBtn'),
      qtPrimaryBtn: document.getElementById('qtPrimaryBtn'),

      navItems: document.querySelectorAll('.bottom-nav .nav-item'),
      tabViews: document.querySelectorAll('.tab-view'),
      openSnapModalBtn: document.getElementById('openSnapModalBtn'),

      setupModal: document.getElementById('setupModal'),
      closeSetupModalBtn: document.getElementById('closeSetupModalBtn'),
      setupGrantNotifBtn: document.getElementById('setupGrantNotifBtn'),
      setupGrantPostNotifBtn: document.getElementById('setupGrantPostNotifBtn'),
      setupGrantOverlayBtn: document.getElementById('setupGrantOverlayBtn'),
      setupGrantBatteryBtn: document.getElementById('setupGrantBatteryBtn'),
      completeSetupBtn: document.getElementById('completeSetupBtn'),
      skipSetupBtn: document.getElementById('skipSetupBtn'),

      recentDetectionsModal: document.getElementById('recentDetectionsModal'),
      closeRecentDetectionsBtn: document.getElementById('closeRecentDetectionsBtn'),
      recentDetectionsList: document.getElementById('recentDetectionsList'),
      clearRecentDetectionsBtn: document.getElementById('clearRecentDetectionsBtn'),
      doneRecentDetectionsBtn: document.getElementById('doneRecentDetectionsBtn'),

      personActionsModal: document.getElementById('personActionsModal'),
      actionPersonName: document.getElementById('actionPersonName'),
      actionPersonMeta: document.getElementById('actionPersonMeta'),
      actionPersonBalance: document.getElementById('actionPersonBalance'),
      actionPersonHistoryWrap: document.getElementById('actionPersonHistoryWrap'),
      actionPersonHistory: document.getElementById('actionPersonHistory'),
      actionSplitBtn: document.getElementById('actionSplitBtn'),
      actionLentBtn: document.getElementById('actionLentBtn'),
      actionBorrowBtn: document.getElementById('actionBorrowBtn'),
      actionSettleBtn: document.getElementById('actionSettleBtn'),
      actionPayUpiBtn: document.getElementById('actionPayUpiBtn'),
      actionPayUpiLabel: document.getElementById('actionPayUpiLabel'),
      actionShareSummaryBtn: document.getElementById('actionShareSummaryBtn'),
      actionEditPersonBtn: document.getElementById('actionEditPersonBtn'),
      closePersonActionsBtn: document.getElementById('closePersonActionsBtn'),

      activityDetailModal: document.getElementById('activityDetailModal'),
      closeActivityDetailBtn: document.getElementById('closeActivityDetailBtn'),
      detailTypeBadge: document.getElementById('detailTypeBadge'),
      detailTitle: document.getElementById('detailTitle'),
      detailAmount: document.getElementById('detailAmount'),
      detailTimestamp: document.getElementById('detailTimestamp'),
      detailMetaCard: document.getElementById('detailMetaCard'),
      detailSplitsContainer: document.getElementById('detailSplitsContainer'),
      deleteActivityEntryBtn: document.getElementById('deleteActivityEntryBtn'),
      doneActivityDetailBtn: document.getElementById('doneActivityDetailBtn'),

      snapExpenseModal: document.getElementById('snapExpenseModal'),
      modalTitle: document.getElementById('modalTitle'),
      closeSnapModalBtn: document.getElementById('closeSnapModalBtn'),
      snapExpenseForm: document.getElementById('snapExpenseForm'),
      snapFormError: document.getElementById('snapFormError'),
      entryKindBar: document.getElementById('entryKindBar'),
      paymentLinkBanner: document.getElementById('paymentLinkBanner'),
      paymentLinkSourceTag: document.getElementById('paymentLinkSourceTag'),
      paymentLinkName: document.getElementById('paymentLinkName'),
      paymentLinkCreateBtn: document.getElementById('paymentLinkCreateBtn'),
      paymentSaveAliasRow: document.getElementById('paymentSaveAliasRow'),
      paymentSaveAliasCheck: document.getElementById('paymentSaveAliasCheck'),
      paymentSaveAliasText: document.getElementById('paymentSaveAliasText'),
      snapAmount: document.getElementById('snapAmount'),
      snapTitle: document.getElementById('snapTitle'),
      openLocationPickerBtn: document.getElementById('openLocationPickerBtn'),
      selectedLocationChip: document.getElementById('selectedLocationChip'),
      selectedLocationText: document.getElementById('selectedLocationText'),
      clearSelectedLocationBtn: document.getElementById('clearSelectedLocationBtn'),
      snapCategoryGroup: document.getElementById('snapCategoryGroup'),
      snapPeopleLabel: document.getElementById('snapPeopleLabel'),
      pickPhoneEntryBtn: document.getElementById('pickPhoneEntryBtn'),
      modalPeopleChips: document.getElementById('modalPeopleChips'),
      selectAllPeopleBtn: document.getElementById('selectAllPeopleBtn'),
      clearAllPeopleBtn: document.getElementById('clearAllPeopleBtn'),
      selectedPeopleSummary: document.getElementById('selectedPeopleSummary'),
      myShareSection: document.getElementById('myShareSection'),
      myShareLabel: document.getElementById('myShareLabel'),
      snapMyShare: document.getElementById('snapMyShare'),
      clearMyShareBtn: document.getElementById('clearMyShareBtn'),
      preset100ThemBtn: document.getElementById('preset100ThemBtn'),
      presetSplitEvenBtn: document.getElementById('presetSplitEvenBtn'),
      breakdownHeaderLabel: document.getElementById('breakdownHeaderLabel'),
      summaryFriendsTotal: document.getElementById('summaryFriendsTotal'),
      summaryBreakdownList: document.getElementById('summaryBreakdownList'),
      submitSnapBtn: document.getElementById('submitSnapBtn'),

      addPersonModal: document.getElementById('addPersonModal'),
      closeAddPersonModalBtn: document.getElementById('closeAddPersonModalBtn'),
      fillFromPhoneBtn: document.getElementById('fillFromPhoneBtn'),
      addPersonForm: document.getElementById('addPersonForm'),
      personName: document.getElementById('personName'),
      personPhone: document.getElementById('personPhone'),
      personUpi: document.getElementById('personUpi'),

      editPersonModal: document.getElementById('editPersonModal'),
      closeEditPersonModalBtn: document.getElementById('closeEditPersonModalBtn'),
      editPersonForm: document.getElementById('editPersonForm'),
      editPersonId: document.getElementById('editPersonId'),
      editPersonName: document.getElementById('editPersonName'),
      editPersonPhone: document.getElementById('editPersonPhone'),
      editPersonUpi: document.getElementById('editPersonUpi'),
      editPersonAliasesWrap: document.getElementById('editPersonAliasesWrap'),
      editPersonAliasesList: document.getElementById('editPersonAliasesList'),
      deletePersonBtn: document.getElementById('deletePersonBtn'),

      settleModal: document.getElementById('settleModal'),
      closeSettleModalBtn: document.getElementById('closeSettleModalBtn'),
      settleForm: document.getElementById('settleForm'),
      settlePersonInfo: document.getElementById('settlePersonInfo'),
      settleDirectionBar: document.getElementById('settleDirectionBar'),
      settleAmountLabel: document.getElementById('settleAmountLabel'),
      settleAmount: document.getElementById('settleAmount'),
      settleNotes: document.getElementById('settleNotes'),

      confirmRepaymentModal: document.getElementById('confirmRepaymentModal'),
      closeConfirmRepaymentModalBtn: document.getElementById('closeConfirmRepaymentModalBtn'),
      confirmRepaymentForm: document.getElementById('confirmRepaymentForm'),
      repaymentAmountDisplay: document.getElementById('repaymentAmountDisplay'),
      repaymentSourceDetail: document.getElementById('repaymentSourceDetail'),
      repaymentGuessBadge: document.getElementById('repaymentGuessBadge'),
      repaymentNewContactBtn: document.getElementById('repaymentNewContactBtn'),
      repaymentPersonSelect: document.getElementById('repaymentPersonSelect'),
      repaymentSaveAliasRow: document.getElementById('repaymentSaveAliasRow'),
      repaymentSaveAliasCheck: document.getElementById('repaymentSaveAliasCheck'),
      repaymentSaveAliasText: document.getElementById('repaymentSaveAliasText'),
      repaymentBalancePreview: document.getElementById('repaymentBalancePreview'),
      repaymentAmountInput: document.getElementById('repaymentAmountInput'),
      repaymentNotesInput: document.getElementById('repaymentNotesInput'),
      dismissRepaymentBtn: document.getElementById('dismissRepaymentBtn'),

      shopLocationModal: document.getElementById('shopLocationModal'),
      closeShopLocationModalBtn: document.getElementById('closeShopLocationModalBtn'),
      shopSearchInput: document.getElementById('shopSearchInput'),
      shopUseGpsBtn: document.getElementById('shopUseGpsBtn'),
      shopOpenGmapsBtn: document.getElementById('shopOpenGmapsBtn'),
      shopLocationStatus: document.getElementById('shopLocationStatus'),
      shopResultsList: document.getElementById('shopResultsList'),

      updateModal: document.getElementById('updateModal'),
      closeUpdateModalBtn: document.getElementById('closeUpdateModalBtn'),
      updateVersionTitle: document.getElementById('updateVersionTitle'),
      updateReleaseNotes: document.getElementById('updateReleaseNotes'),
      updateProgressContainer: document.getElementById('updateProgressContainer'),
      updateProgressBar: document.getElementById('updateProgressBar'),
      updateProgressText: document.getElementById('updateProgressText'),
      downloadUpdateBtn: document.getElementById('downloadUpdateBtn')
    };
  }

  // ================= THEME & VERSION =================
  initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    this.setTheme(savedTheme, false);
  }

  setTheme(theme, save = true) {
    const isDark = theme !== 'light';
    const activeTheme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', activeTheme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isDark ? '#09090B' : '#F8FAFC');

    if (this.dom.themeDarkBtn && this.dom.themeLightBtn) {
      this.dom.themeDarkBtn.classList.toggle('active', isDark);
      this.dom.themeLightBtn.classList.toggle('active', !isDark);
    }

    if (window.AndroidBridge && window.AndroidBridge.setSystemBarTheme) {
      try { window.AndroidBridge.setSystemBarTheme(isDark); } catch (e) {}
    }
    if (save) localStorage.setItem(THEME_KEY, activeTheme);
  }

  initAppVersion() {
    if (!this.dom.appVersionDisplay) return;
    if (window.AndroidBridge && window.AndroidBridge.getAppVersion) {
      try {
        const ver = window.AndroidBridge.getAppVersion();
        if (ver) {
          this.dom.appVersionDisplay.textContent = 'v' + ver;
          return;
        }
      } catch (e) {}
    }
    this.dom.appVersionDisplay.textContent = 'v1.3.1';
  }

  // ================= SCANNER STATUS & PERMISSIONS =================
  checkScannerStatus() {
    let isRunning = false;
    let notifGranted = false;
    let postNotifGranted = false;

    if (window.AndroidBridge) {
      if (window.AndroidBridge.isScannerRunning) isRunning = window.AndroidBridge.isScannerRunning();
      if (window.AndroidBridge.isNotificationAccessGranted) notifGranted = window.AndroidBridge.isNotificationAccessGranted();
      if (window.AndroidBridge.isPostNotificationsGranted) postNotifGranted = window.AndroidBridge.isPostNotificationsGranted();
    } else {
      isRunning = true;
      notifGranted = true;
      postNotifGranted = true;
    }

    if (this.dom.scannerStatusBadge && this.dom.scannerStatusText) {
      if (isRunning && notifGranted && postNotifGranted) {
        this.dom.scannerStatusBadge.className = 'status-pill active';
        this.dom.scannerStatusText.textContent = 'Listening';
      } else {
        this.dom.scannerStatusBadge.className = 'status-pill inactive';
        this.dom.scannerStatusText.textContent = 'Setup';
      }
    }
  }

  checkInitialSetup() {
    let notifGranted = false;
    let postNotifGranted = false;
    let overlayGranted = false;
    let batteryIgnored = false;

    if (window.AndroidBridge) {
      if (window.AndroidBridge.isNotificationAccessGranted) notifGranted = window.AndroidBridge.isNotificationAccessGranted();
      if (window.AndroidBridge.isPostNotificationsGranted) postNotifGranted = window.AndroidBridge.isPostNotificationsGranted();
      if (window.AndroidBridge.isOverlayPermissionGranted) overlayGranted = window.AndroidBridge.isOverlayPermissionGranted();
      if (window.AndroidBridge.isIgnoringBatteryOptimizations) batteryIgnored = window.AndroidBridge.isIgnoringBatteryOptimizations();
    } else {
      notifGranted = true;
      postNotifGranted = true;
      overlayGranted = true;
      batteryIgnored = true;
    }

    this.updatePermissionButton('setupGrantNotifBtn', 'grantNotificationAccessBtn', notifGranted, 'Enable');
    this.updatePermissionButton('setupGrantPostNotifBtn', 'grantPostNotifBtn', postNotifGranted, 'Allow');
    this.updatePermissionButton('setupGrantOverlayBtn', 'grantOverlayAccessBtn', overlayGranted, 'Enable');
    this.updatePermissionButton('setupGrantBatteryBtn', 'grantBatteryAccessBtn', batteryIgnored, 'Allow');

    const dismissed = localStorage.getItem('whosetab_setup_dismissed');
    if (!dismissed && (!notifGranted || !postNotifGranted || !overlayGranted)) {
      this.openSetupModal();
    }
  }

  updatePermissionButton(setupBtnId, settingsBtnId, isGranted, defaultLabel) {
    [document.getElementById(setupBtnId), document.getElementById(settingsBtnId)].forEach(btn => {
      if (!btn) return;
      if (isGranted) {
        btn.textContent = 'Granted';
        btn.className = 'btn-status-action granted';
        btn.disabled = true;
      } else {
        btn.textContent = defaultLabel;
        btn.className = 'btn-status-action';
        btn.disabled = false;
      }
    });
  }

  openModalElement(el) {
    if (!el) return;
    const prevTimer = this.modalCloseTimers?.get(el);
    if (prevTimer) {
      clearTimeout(prevTimer);
      this.modalCloseTimers.delete(el);
    }
    el.classList.remove('closing');
    el.classList.remove('hidden');
  }

  closeModalElement(el, onAfterHide = null) {
    if (!el || el.classList.contains('hidden')) {
      if (typeof onAfterHide === 'function') onAfterHide();
      return;
    }
    const prevTimer = this.modalCloseTimers?.get(el);
    if (prevTimer) clearTimeout(prevTimer);
    el.classList.add('closing');
    const timer = setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('closing');
      this.modalCloseTimers?.delete(el);
      if (typeof onAfterHide === 'function') onAfterHide();
    }, 180);
    this.modalCloseTimers?.set(el, timer);
  }

  openSetupModal() {
    this.openModalElement(this.dom.setupModal);
  }

  closeSetupModal() {
    this.closeModalElement(this.dom.setupModal);
  }

  // ================= EVENT BINDING =================
  bindEvents() {
    if (this.dom.headerMoreBtn && this.dom.headerOverflowMenu) {
      this.dom.headerMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !this.dom.headerOverflowMenu.classList.contains('hidden');
        this.dom.headerOverflowMenu.classList.toggle('hidden', isOpen);
        this.dom.headerMoreBtn.setAttribute('aria-expanded', String(!isOpen));
      });

      document.addEventListener('click', (e) => {
        if (!this.dom.headerOverflowMenu.classList.contains('hidden')
            && !this.dom.headerOverflowMenu.contains(e.target)
            && e.target !== this.dom.headerMoreBtn) {
          this.closeHeaderMenu();
        }
      });
    }

    this.dom.menuRecentDetections?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.openRecentDetectionsModal();
    });
    this.dom.menuSharePendingSummary?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.shareAllPendingSummary();
    });
    this.dom.menuAddContact?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.openAddPersonModal();
    });
    this.dom.menuPermissions?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.openSetupModal();
    });
    this.dom.menuTestOverlay?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.triggerQuickAddPreview();
    });
    this.dom.menuExportData?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.exportBackup();
    });
    this.dom.menuImportData?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.dom.importFileInput.click();
    });
    this.dom.menuCheckUpdates?.addEventListener('click', () => {
      this.closeHeaderMenu();
      this.triggerUpdateCheck();
    });

    this.dom.scannerStatusBadge?.addEventListener('click', () => this.openSetupModal());

    // Recent Detections modal
    [this.dom.closeRecentDetectionsBtn, this.dom.doneRecentDetectionsBtn].forEach(b => {
      b?.addEventListener('click', () => this.closeRecentDetectionsModal());
    });
    this.dom.recentDetectionsModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.recentDetectionsModal) this.closeRecentDetectionsModal();
    });
    this.dom.clearRecentDetectionsBtn?.addEventListener('click', () => {
      window.AndroidBridge?.clearRecentDetections?.();
      this.renderRecentDetectionsList();
    });

    // Setup Modal Actions
    const grantNotif = () => window.AndroidBridge?.openNotificationAccessSettings?.();
    const grantPostNotif = () => window.AndroidBridge?.requestPostNotificationsPermission?.();
    const grantOverlay = () => window.AndroidBridge?.openOverlayPermissionSettings?.();
    const grantBattery = () => window.AndroidBridge?.requestIgnoreBatteryOptimizations?.();

    this.dom.setupGrantNotifBtn?.addEventListener('click', grantNotif);
    this.dom.grantNotificationAccessBtn?.addEventListener('click', grantNotif);
    this.dom.setupGrantPostNotifBtn?.addEventListener('click', grantPostNotif);
    this.dom.grantPostNotifBtn?.addEventListener('click', grantPostNotif);
    this.dom.setupGrantOverlayBtn?.addEventListener('click', grantOverlay);
    this.dom.grantOverlayAccessBtn?.addEventListener('click', grantOverlay);
    this.dom.setupGrantBatteryBtn?.addEventListener('click', grantBattery);
    this.dom.grantBatteryAccessBtn?.addEventListener('click', grantBattery);

    [this.dom.completeSetupBtn, this.dom.skipSetupBtn, this.dom.closeSetupModalBtn].forEach(btn => {
      btn?.addEventListener('click', () => {
        localStorage.setItem('whosetab_setup_dismissed', 'true');
        this.closeSetupModal();
      });
    });

    // Dashboard Toggles
    [this.dom.dashboardBalActiveBtn, this.dom.dashboardBalAllBtn].forEach(btn => {
      btn?.addEventListener('click', () => {
        this.dashboardBalanceMode = btn.dataset.mode;
        this.dom.dashboardBalActiveBtn.classList.toggle('active', this.dashboardBalanceMode === 'active');
        this.dom.dashboardBalAllBtn.classList.toggle('active', this.dashboardBalanceMode === 'all');
        this.renderDashboard();
      });
    });

    this.dom.activityFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.activityFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activityFilter = btn.dataset.actFilter;
        this.renderDashboard();
      });
    });

    // People Search & Filter
    this.dom.peopleSearchInput?.addEventListener('input', (e) => {
      this.peopleSearchQuery = e.target.value.trim().toLowerCase();
      this.renderPeoplePage();
    });

    this.dom.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.dom.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.dataset.filter;
        this.renderPeoplePage();
      });
    });

    this.dom.pickPhonePersonPageBtn?.addEventListener('click', () => this.triggerPhoneContactPicker('peoplePage'));
    this.dom.pickPhoneEntryBtn?.addEventListener('click', () => this.triggerPhoneContactPicker('entry'));
    this.dom.fillFromPhoneBtn?.addEventListener('click', () => this.triggerPhoneContactPicker('addContact'));

    // Settings Controls
    this.dom.themeDarkBtn?.addEventListener('click', () => this.setTheme('dark'));
    this.dom.themeLightBtn?.addEventListener('click', () => this.setTheme('light'));

    if (this.dom.detectionModeSelector) {
      const currentMode = window.AndroidBridge?.getDetectionMode
        ? (window.AndroidBridge.getDetectionMode() || 'overlay')
        : (localStorage.getItem('whosetab_detection_mode') || 'overlay');
      this.dom.detectionModeSelector.value = currentMode;
      this.dom.detectionModeSelector.addEventListener('change', (e) => {
        const mode = e.target.value;
        localStorage.setItem('whosetab_detection_mode', mode);
        window.AndroidBridge?.setDetectionMode?.(mode);
      });
    }

    if (this.dom.paytmDelaySelector) {
      const currentDelay = window.AndroidBridge?.getOpenDelay
        ? window.AndroidBridge.getOpenDelay()
        : parseInt(localStorage.getItem('whosetab_paytm_delay') || '0', 10);
      this.dom.paytmDelaySelector.value = String(currentDelay);
      this.dom.paytmDelaySelector.addEventListener('change', (e) => {
        const delayMs = parseInt(e.target.value, 10);
        localStorage.setItem('whosetab_paytm_delay', String(delayMs));
        window.AndroidBridge?.setOpenDelay?.(delayMs);
      });
    }

    this.dom.testOverlaySettingsBtn?.addEventListener('click', () => this.triggerQuickAddPreview());
    this.dom.checkForUpdatesBtn?.addEventListener('click', () => this.triggerUpdateCheck());
    this.dom.closeUpdateModalBtn?.addEventListener('click', () => this.closeModalElement(this.dom.updateModal));

    this.dom.downloadUpdateBtn?.addEventListener('click', () => {
      const apkUrl = this.dom.downloadUpdateBtn.dataset.apkUrl;
      if (window.AndroidBridge?.downloadAndInstallUpdate) {
        this.dom.downloadUpdateBtn.disabled = true;
        this.dom.downloadUpdateBtn.textContent = 'Connecting...';
        this.dom.updateProgressContainer?.classList.remove('hidden');
        if (this.dom.updateProgressText) this.dom.updateProgressText.textContent = 'Starting download...';
        window.AndroidBridge.downloadAndInstallUpdate(apkUrl);
      } else {
        window.open(apkUrl, '_blank');
        this.closeModalElement(this.dom.updateModal);
      }
    });

    // Bottom Navigation with directional slide transitions
    const navList = Array.from(this.dom.navItems);
    navList.forEach((item, idx) => {
      item.addEventListener('click', () => {
        if (idx === this.currentTabIndex) return;
        const enterClass = idx > this.currentTabIndex ? 'anim-enter-right' : 'anim-enter-left';
        this.currentTabIndex = idx;

        this.dom.navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const targetId = item.dataset.target;
        this.dom.tabViews.forEach(view => {
          view.classList.remove('anim-enter-right', 'anim-enter-left');
          const isTarget = view.id === targetId;
          view.classList.toggle('active', isTarget);
          if (isTarget) {
            void view.offsetWidth;
            view.classList.add(enterClass);
          }
        });
      });
    });

    // In-App Quick Toast Actions
    this.dom.qtCloseBtn?.addEventListener('click', () => this.hideInAppQuickToast(true));
    this.dom.qtSecondaryBtn?.addEventListener('click', () => {
      if (this.detectedPaytmData) {
        const d = this.detectedPaytmData;
        this.hideInAppQuickToast(false);
        this.openSnapModalWithPaytm(d);
      }
    });
    this.dom.qtPrimaryBtn?.addEventListener('click', () => this.handleQuickToastAdd());

    // Entry Modal Triggers & Mode Switcher
    this.dom.openSnapModalBtn?.addEventListener('click', () => this.openSnapModal(true, 'split'));
    this.dom.heroAddBtn?.addEventListener('click', () => this.openSnapModal(true, 'split'));
    this.dom.closeSnapModalBtn?.addEventListener('click', () => this.closeSnapModal());
    this.dom.snapExpenseModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.snapExpenseModal) this.closeSnapModal();
    });

    this.dom.entryKindBar?.querySelectorAll('[data-kind]').forEach(btn => {
      btn.addEventListener('click', () => this.setEntryKind(btn.dataset.kind));
    });

    this.dom.paymentLinkCreateBtn?.addEventListener('click', () => this.createContactFromScannedPayment());

    // Contact Action Sheet Events
    this.dom.closePersonActionsBtn?.addEventListener('click', () => this.closePersonActionsModal());
    this.dom.personActionsModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.personActionsModal) this.closePersonActionsModal();
    });
    this.dom.actionSplitBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) {
        this.selectedPersonIds = new Set([pid]);
        this.openSnapModal(false, 'split');
      }
    });
    this.dom.actionLentBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) {
        this.selectedPersonIds = new Set([pid]);
        this.openSnapModal(false, 'lent');
      }
    });
    this.dom.actionBorrowBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) {
        this.selectedPersonIds = new Set([pid]);
        this.openSnapModal(false, 'borrowed');
      }
    });
    this.dom.actionSettleBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) this.openSettleModal(pid);
    });
    this.dom.actionPayUpiBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      const person = this.ledger.people.find(p => p.id === pid);
      const bal = this.calculateNetBalances()[pid] || 0;
      if (person && person.upi && bal < -0.01) {
        window.AndroidBridge?.openUpiPayApp?.(person.upi, person.name, Math.abs(bal).toFixed(2));
      }
    });
    this.dom.actionShareSummaryBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      if (pid) this.sharePersonSummary(pid);
    });
    this.dom.actionEditPersonBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) this.openEditPersonModal(pid);
    });

    // Activity Detail Sheet Events
    [this.dom.closeActivityDetailBtn, this.dom.doneActivityDetailBtn].forEach(b => {
      b?.addEventListener('click', () => this.closeActivityDetailModal());
    });
    this.dom.activityDetailModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.activityDetailModal) this.closeActivityDetailModal();
    });
    this.dom.deleteActivityEntryBtn?.addEventListener('click', () => this.deleteActiveDetailEntry());

    // Split / Lent / Borrow Controls
    this.dom.selectAllPeopleBtn?.addEventListener('click', () => {
      if (this.currentEntryKind === 'borrowed') return;
      this.ledger.people.forEach(p => this.selectedPersonIds.add(p.id));
      this.manualSplits.clear();
      this.hideSnapError();
      this.renderModalPeopleChips();
      this.recalculateSplitBreakdown(true);
    });
    this.dom.clearAllPeopleBtn?.addEventListener('click', () => {
      this.selectedPersonIds.clear();
      this.manualSplits.clear();
      this.renderModalPeopleChips();
      this.recalculateSplitBreakdown(true);
    });

    this.dom.snapAmount?.addEventListener('input', () => {
      this.hideSnapError();
      this.recalculateSplitBreakdown(false);
    });
    this.dom.snapMyShare?.addEventListener('input', () => {
      this.hideSnapError();
      this.recalculateSplitBreakdown(false);
    });
    this.dom.clearMyShareBtn?.addEventListener('click', () => {
      if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
      this.recalculateSplitBreakdown(false);
    });
    this.dom.preset100ThemBtn?.addEventListener('click', () => {
      if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
      this.manualSplits.clear();
      this.recalculateSplitBreakdown(true);
    });
    this.dom.presetSplitEvenBtn?.addEventListener('click', () => {
      const total = parseFloat(this.dom.snapAmount.value) || 0;
      const numFriends = this.selectedPersonIds.size;
      if (numFriends === 0) {
        this.showSnapError('Select a contact first.');
        return;
      }
      this.manualSplits.clear();
      if (total > 0) {
        const share = Math.round((total / (numFriends + 1)) * 100) / 100;
        if (this.dom.snapMyShare) this.dom.snapMyShare.value = share.toFixed(2);
      }
      this.recalculateSplitBreakdown(true);
    });

    // Add / Edit Person Modals
    this.dom.addPersonPageBtn?.addEventListener('click', () => this.openAddPersonModal());
    this.dom.closeAddPersonModalBtn?.addEventListener('click', () => this.closeAddPersonModal());
    this.dom.addPersonModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.addPersonModal) this.closeAddPersonModal();
    });

    // Relationship segmented bar toggle highlight (radio options only)
    document.querySelectorAll('#addPersonModal .segmented-bar, #editPersonModal .segmented-bar').forEach(bar => {
      bar.querySelectorAll('.seg-option').forEach(opt => {
        opt.addEventListener('click', () => {
          bar.querySelectorAll('.seg-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
        });
      });
    });

    this.dom.closeEditPersonModalBtn?.addEventListener('click', () => this.closeEditPersonModal());
    this.dom.editPersonModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.editPersonModal) this.closeEditPersonModal();
    });
    this.dom.editPersonForm?.addEventListener('submit', (e) => this.handleEditPersonSubmit(e));
    this.dom.deletePersonBtn?.addEventListener('click', () => this.handleDeletePersonSubmit());

    // Settle Direction Toggle & Repayment Form
    this.dom.settleDirectionBar?.querySelectorAll('[data-dir]').forEach(btn => {
      btn.addEventListener('click', () => this.setSettleDirection(btn.dataset.dir));
    });
    this.dom.closeSettleModalBtn?.addEventListener('click', () => this.closeModalElement(this.dom.settleModal));
    this.dom.settleModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.settleModal) this.closeModalElement(this.dom.settleModal);
    });
    this.dom.closeConfirmRepaymentModalBtn?.addEventListener('click', () => this.closeConfirmRepaymentModal());
    this.dom.dismissRepaymentBtn?.addEventListener('click', () => {
      this.dismissRepaymentData();
      this.closeConfirmRepaymentModal();
    });
    this.dom.repaymentNewContactBtn?.addEventListener('click', () => this.createContactFromRepayment());
    this.dom.confirmRepaymentForm?.addEventListener('submit', (e) => this.handleConfirmRepaymentSubmit(e));
    this.dom.repaymentPersonSelect?.addEventListener('change', () => this.updateRepaymentPreview());
    this.dom.repaymentAmountInput?.addEventListener('input', () => this.updateRepaymentPreview());

    // Google Maps Shop Location Picker
    this.dom.openLocationPickerBtn?.addEventListener('click', () => this.openShopLocationModal());
    this.dom.clearSelectedLocationBtn?.addEventListener('click', () => this.setSelectedEntryLocation(null));
    this.dom.closeShopLocationModalBtn?.addEventListener('click', () => this.closeShopLocationModal());
    this.dom.shopLocationModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.shopLocationModal) this.closeShopLocationModal();
    });
    this.dom.shopUseGpsBtn?.addEventListener('click', () => this.requestNearbyShops());
    this.dom.shopOpenGmapsBtn?.addEventListener('click', () => {
      const q = (this.dom.shopSearchInput?.value || this.dom.snapTitle?.value || '').trim();
      this.openLocationInMaps({ name: q || 'Shops near me', lat: this.lastGeoLat, lng: this.lastGeoLng });
    });
    this.dom.shopSearchInput?.addEventListener('input', () => {
      clearTimeout(this.shopSearchTimer);
      const q = this.dom.shopSearchInput.value.trim();
      this.onlineShopResults = [];
      this.renderShopResults();
      if (q.length >= 2) {
        this.shopSearchTimer = setTimeout(() => {
          window.AndroidBridge?.searchShopsOnline?.(q, this.lastGeoLat || 0, this.lastGeoLng || 0);
        }, 420);
      }
    });

    this.dom.snapExpenseForm?.addEventListener('submit', (e) => this.handleSnapSubmit(e));
    this.dom.addPersonForm?.addEventListener('submit', (e) => this.handleAddPersonSubmit(e));
    this.dom.settleForm?.addEventListener('submit', (e) => this.handleSettleSubmit(e));

    // Backup, Purge Entries & Full Reset
    this.dom.exportDataBtn?.addEventListener('click', () => this.exportBackup());
    this.dom.importDataBtn?.addEventListener('click', () => this.dom.importFileInput.click());
    this.dom.importFileInput?.addEventListener('change', (e) => this.importBackup(e));
    this.dom.clearEntriesOnlyBtn?.addEventListener('click', () => {
      if (confirm('Purge all expenses and settlements? Your contacts will stay saved.')) {
        this.ledger.expenses = [];
        this.ledger.settlements = [];
        window.AndroidBridge?.clearStalePaymentCache?.();
        this.saveLedger();
      }
    });
    this.dom.clearDataBtn?.addEventListener('click', () => {
      if (confirm('Erase all saved contacts, expenses, and settlements? This cannot be undone.')) {
        this.ledger = { version: 2, people: [], expenses: [], settlements: [], settings: {} };
        window.AndroidBridge?.clearStalePaymentCache?.();
        this.saveLedger();
      }
    });

    // Focus & Visibility Re-checks
    window.addEventListener('focus', () => {
      this.checkScannerStatus();
      this.checkInitialSetup();
      this.drainQueuedNativeExpenses();
      this.checkClipboardForPaytm();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.drainQueuedNativeExpenses();
        this.checkPendingPayment();
      }
    });
  }

  closeHeaderMenu() {
    this.dom.headerOverflowMenu?.classList.add('hidden');
    this.dom.headerMoreBtn?.setAttribute('aria-expanded', 'false');
  }

  triggerQuickAddPreview() {
    if (window.AndroidBridge && window.AndroidBridge.testQuickAddOverlay) {
      window.AndroidBridge.testQuickAddOverlay();
    } else {
      this.showInAppQuickToast({
        amount: 120,
        recipient: 'Sample Tea Stall',
        suggestedCategory: 'SnacksChai',
        rawText: 'Paid ₹120 to Sample Tea Stall',
        timestamp: Date.now()
      });
    }
  }

  triggerUpdateCheck() {
    if (this.dom.updateStatusNotice) {
      this.dom.updateStatusNotice.textContent = 'Checking for updates...';
    }
    if (window.AndroidBridge && window.AndroidBridge.checkForUpdates) {
      window.AndroidBridge.checkForUpdates();
    } else {
      this.checkGitHubReleasesWeb();
    }
  }

  // ================= PHONE CONTACT PICKER BRIDGE =================
  triggerPhoneContactPicker(tag) {
    if (window.AndroidBridge && window.AndroidBridge.pickPhoneContact) {
      window.AndroidBridge.pickPhoneContact(tag || 'entry');
      return;
    }
    this.openAddPersonModal();
  }

  normalizePhoneDigits(raw) {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.length > 10 && digits.startsWith('91')) {
      return digits.slice(-10);
    }
    return digits.length >= 10 ? digits.slice(-10) : String(raw || '').trim();
  }

  onNativeContactPicked(name, phone, tag) {
    const cleanName = (name || '').trim() || phone || 'Contact';
    const normPhone = this.normalizePhoneDigits(phone);

    if (tag === 'addContact') {
      if (this.dom.personName) this.dom.personName.value = cleanName;
      if (this.dom.personPhone) this.dom.personPhone.value = normPhone;
      return;
    }

    // Match existing contact by 10-digit phone suffix or exact name
    let existing = null;
    if (normPhone.length >= 10) {
      existing = this.ledger.people.find(p => p.phone && this.normalizePhoneDigits(p.phone) === normPhone);
    }
    if (!existing) {
      const lowerName = cleanName.toLowerCase();
      existing = this.ledger.people.find(p => p.name.trim().toLowerCase() === lowerName);
    }

    if (existing) {
      if (!existing.phone && normPhone) {
        existing.phone = normPhone;
        this.saveLedger();
      }
      if (tag === 'entry' || !this.dom.snapExpenseModal.classList.contains('hidden')) {
        if (this.currentEntryKind === 'borrowed') {
          this.selectedPersonIds = new Set([existing.id]);
        } else {
          this.selectedPersonIds.add(existing.id);
        }
        this.renderModalPeopleChips();
        this.recalculateSplitBreakdown(true);
      } else if (tag === 'peoplePage') {
        this.openPersonActionsModal(existing.id);
      }
      return;
    }

    // Create new contact cleanly from phone pick
    const created = {
      id: 'p_' + Date.now(),
      name: cleanName,
      relationship: 'Friend',
      phone: normPhone || null,
      upi: null,
      aliases: [],
      createdAt: new Date().toISOString()
    };
    this.ledger.people.push(created);
    this.saveLedger();

    if (tag === 'entry' || !this.dom.snapExpenseModal.classList.contains('hidden')) {
      if (this.currentEntryKind === 'borrowed') {
        this.selectedPersonIds = new Set([created.id]);
      } else {
        this.selectedPersonIds.add(created.id);
      }
      this.renderModalPeopleChips();
      this.recalculateSplitBreakdown(true);
    } else if (tag === 'peoplePage') {
      this.openPersonActionsModal(created.id);
    }
  }

  // ================= ALIAS & CONTACT MATCHING =================
  isGenericPaymentLabel(str) {
    if (!str) return true;
    const clean = str.trim().toLowerCase();
    const norm = clean.replace(/[^a-z0-9]/g, '');
    return clean.length < 3 || norm.length < 3
      || GENERIC_ALIAS_TOKENS.has(clean) || GENERIC_ALIAS_TOKENS.has(norm)
      || COMMERCIAL_MERCHANTS.has(norm);
  }

  isCommercialMerchantName(str) {
    const norm = String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) return false;
    if (COMMERCIAL_MERCHANTS.has(norm)) return true;
    for (const m of COMMERCIAL_MERCHANTS) {
      if (m.length >= 5 && (norm === m || norm.startsWith(m))) return true;
    }
    return false;
  }

  findMatchingContact(sender, handle = '') {
    if ((!sender && !handle) || !this.ledger.people.length) return null;
    const rawS = (sender || '').trim();
    const rawH = (handle || '').trim();

    // 1. Phone match ONLY from explicit handle OR purely-phone sender (never random body numbers)
    const handleDigits = rawH.replace(/[^0-9]/g, '');
    const senderLooksPhone = /^\+?[\d\s()-]{10,16}$/.test(rawS);
    const senderPhoneDigits = senderLooksPhone ? rawS.replace(/[^0-9]/g, '') : '';
    const phoneDigits = handleDigits.length >= 10 ? handleDigits : senderPhoneDigits;
    if (phoneDigits.length >= 10) {
      const tail10 = phoneDigits.slice(-10);
      const p = this.ledger.people.find(person => person.phone && person.phone.replace(/[^0-9]/g, '').endsWith(tail10));
      if (p) return p;
    }

    // 2. Masked VPA suffix (*7113@wahdfcbank -> unique 4-digit phone tail match)
    const vpaSource = (rawH.includes('@') ? rawH : (rawS.includes('@') ? rawS : '')).toLowerCase();
    const tailMatch = vpaSource.match(/\*?([0-9]{4})@/);
    if (tailMatch && tailMatch[1]) {
      const tail4 = tailMatch[1];
      const matches = this.ledger.people.filter(person => person.phone && person.phone.replace(/[^0-9]/g, '').endsWith(tail4));
      if (matches.length === 1) return matches[0];
    }

    // 3. Exact UPI match on explicit handle
    if (rawH) {
      const lowH = rawH.toLowerCase();
      const pUpi = this.ledger.people.find(person => {
        if (!person.upi) return false;
        const u = person.upi.toLowerCase().trim();
        return lowH === u || lowH.includes(u) || (rawH.includes('@') && u.includes(lowH));
      });
      if (pUpi) return pUpi;
    }

    const norm = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanS = norm(rawS);
    const cleanH = norm(rawH);

    // Commercial merchants (Amazon Pay, Flipkart, Swiggy, Zomato, etc.) must NEVER fuzzily match a personal contact
    if (this.isCommercialMerchantName(rawS)) {
      return null;
    }

    // 4. Learned payment aliases (strict normalized equality, >= 4 chars, non-generic)
    const pAlias = this.ledger.people.find(person => {
      if (!Array.isArray(person.aliases)) return false;
      return person.aliases.some(alias => {
        const na = norm(alias);
        if (!na || na.length < 4 || GENERIC_ALIAS_TOKENS.has(na) || COMMERCIAL_MERCHANTS.has(na)) return false;
        return (cleanS && na === cleanS) || (cleanH && na === cleanH);
      });
    });
    if (pAlias) return pAlias;

    if (!cleanS || cleanS.length < 4) return null;

    // 5. Exact normalized contact name match
    let pName = this.ledger.people.find(person => norm(person.name) === cleanS);
    if (pName) return pName;

    // 6. Exact first-name match (>= 4 chars) only when single word or unique exact first word match
    const senderWords = rawS.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const senderFirst = norm(senderWords[0] || '');
    if (senderFirst.length >= 4 && !GENERIC_ALIAS_TOKENS.has(senderFirst)) {
      const firstMatches = this.ledger.people.filter(person => {
        const pFirst = norm(person.name.split(' ')[0]);
        return pFirst.length >= 4 && pFirst === senderFirst;
      });
      if (firstMatches.length === 1 && (senderWords.length === 1 || norm(firstMatches[0].name) === cleanS)) {
        return firstMatches[0];
      }
    }

    // 7. Exact spelling variant omitting silent 'h' (e.g. Bhuvnesh <-> Buvnesh)
    const nb = cleanS.replace(/h/g, '');
    if (nb.length >= 4) {
      pName = this.ledger.people.find(person => {
        const na = norm(person.name).replace(/h/g, '');
        return na.length >= 4 && na === nb;
      });
      if (pName) return pName;
    }

    return null;
  }

  addAliasToPerson(personId, rawName, rawHandle = '') {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) return;
    if (!Array.isArray(person.aliases)) person.aliases = [];

    const candidates = [rawName, rawHandle];
    let changed = false;

    candidates.forEach(raw => {
      const clean = (raw || '').trim();
      if (!clean || this.isGenericPaymentLabel(clean) || this.isCommercialMerchantName(clean)) return;

      const phoneDigits = this.normalizePhoneDigits(clean);
      if (phoneDigits.length === 10 && /^[6-9][0-9]{9}$/.test(phoneDigits) && !person.phone) {
        person.phone = phoneDigits;
        changed = true;
        return;
      }

      if (clean.includes('@') && !clean.startsWith('*') && !person.upi) {
        person.upi = clean;
        changed = true;
      }

      const normAlpha = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normAlpha.length < 4 || GENERIC_ALIAS_TOKENS.has(normAlpha) || COMMERCIAL_MERCHANTS.has(normAlpha)) return;

      const norm = clean.toLowerCase();
      if (norm === person.name.trim().toLowerCase()) return;
      if (person.upi && norm === person.upi.trim().toLowerCase()) return;
      if (!person.aliases.some(a => a.toLowerCase() === norm)) {
        person.aliases.push(clean);
        changed = true;
      }
    });

    if (changed) {
      this.saveLedger();
    }
  }

  // ================= RECENT DETECTIONS MODAL =================
  openRecentDetectionsModal() {
    this.renderRecentDetectionsList();
    this.openModalElement(this.dom.recentDetectionsModal);
  }

  closeRecentDetectionsModal() {
    this.closeModalElement(this.dom.recentDetectionsModal);
  }

  renderRecentDetectionsList() {
    const container = this.dom.recentDetectionsList;
    if (!container) return;

    let list = [];
    if (window.AndroidBridge && window.AndroidBridge.getRecentDetections) {
      try {
        list = JSON.parse(window.AndroidBridge.getRecentDetections() || '[]');
      } catch (e) {}
    }

    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<div class="list-empty-state">No scanned payment notifications in history yet.</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
      const isRepay = item.type === 'repayment';
      const counterparty = isRepay ? (item.sender || 'Someone') : (item.recipient || 'Merchant');
      const amt = parseFloat(item.amount) || 0;
      const dateStr = item.postTime || item.timestamp
        ? new Date(item.postTime || item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '';
      const matched = this.findMatchingContact(counterparty, item.counterpartyHandle || '');

      const row = document.createElement('div');
      row.className = 'detection-row';
      row.innerHTML = `
        <div class="row-text-stack" style="flex:1;min-width:0;">
          <span class="row-primary-text">${isRepay ? 'Received' : 'Paid'} ₹${amt.toFixed(2)} (${this.escapeHtml(counterparty)})</span>
          <span class="row-secondary-text">${matched ? `Linked: ${this.escapeHtml(matched.name)}` : 'Unlinked'}${dateStr ? ` • ${dateStr}` : ''}</span>
        </div>
        <button type="button" class="btn-inline-chip">Log</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.closeRecentDetectionsModal();
        if (isRepay) {
          this.openConfirmRepaymentModal(item);
        } else {
          this.openSnapModalWithPaytm(item);
        }
      });
      container.appendChild(row);
    });
  }

  // ================= PAYMENT SIGNATURE & CLIPBOARD =================
  getPaymentSignature(data) {
    if (!data) return '';
    if (data.txnId && data.txnId.trim().length > 0) return 'txn_' + data.txnId.trim();
    const amt = (parseFloat(data.amount) || 0).toFixed(2);
    const rec = (data.recipient || '').trim().toLowerCase();
    const ts = data.postTime || data.timestamp || Math.floor(Date.now() / 2000);
    return `${amt}_${rec}_${ts}`;
  }

  isPaymentDismissed(data) {
    const sig = this.getPaymentSignature(data);
    if (!sig) return false;
    try {
      const list = JSON.parse(localStorage.getItem('whosetab_dismissed_payments_v2') || '[]');
      return list.includes(sig);
    } catch (e) {
      return false;
    }
  }

  markPaymentDismissed(data) {
    const sig = this.getPaymentSignature(data);
    if (!sig) return;
    try {
      let list = JSON.parse(localStorage.getItem('whosetab_dismissed_payments_v2') || '[]');
      if (!list.includes(sig)) {
        list.push(sig);
        if (list.length > 80) list = list.slice(list.length - 60);
        localStorage.setItem('whosetab_dismissed_payments_v2', JSON.stringify(list));
      }
    } catch (e) {}
    window.AndroidBridge?.clearPendingPayment?.();
  }

  checkUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const amount = params.get('amount') || params.get('amt');
    const to = params.get('to') || params.get('recipient') || params.get('name');
    const note = params.get('note') || params.get('title') || params.get('desc');
    if (amount) {
      setTimeout(() => {
        const item = {
          amount: parseFloat(amount),
          recipient: to || 'Merchant',
          note: note || '',
          suggestedCategory: 'General',
          timestamp: Date.now()
        };
        if (!this.isPaymentDismissed(item)) {
          this.openSnapModalWithPaytm(item);
        }
      }, 200);
    }
  }

  async checkClipboardForPaytm() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text === this.lastHandledClipboardText) return;
      this.lastHandledClipboardText = text;
      const parsed = this.parsePaytmString(text);
      if (parsed && !this.isPaymentDismissed(parsed)) {
        this.showInAppQuickToast(parsed);
      }
    } catch (e) {}
  }

  parsePaytmString(text) {
    if (!text || text.length < 5 || text.length > 300) return null;
    if (/\/(?:g|gm|kg|mo|yr|unit|day|hr)/i.test(text)) return null;
    const regex = /(?:paid|sent|transfer of|debited|rs\.?|inr|₹)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i;
    const match = text.match(regex);
    if (!match) return null;

    const amt = parseFloat(match[1].replace(/,/g, ''));
    if (!amt || amt <= 0) return null;

    let recipient = 'Merchant';
    const recMatch = text.match(/(?:to|at|for)\s+([A-Za-z0-9\s&'\.@*-]+?)(?:\s+(?:successfully|via|on|ref|upi|txn|is successful|\.|$))/i);
    if (recMatch && recMatch[1]) recipient = recMatch[1].trim();

    return {
      amount: amt,
      recipient,
      rawText: text,
      timestamp: Date.now()
    };
  }

  // ================= BOTTOM-RIGHT IN-APP QUICK TOAST =================
  showInAppQuickToast(data) {
    if (!data || !this.dom.inAppQuickToast) return;
    this.detectedPaytmData = data;
    this.toastSelectedIds.clear();

    const amt = parseFloat(data.amount) || 0;
    const cp = data.recipient || 'Merchant';
    const matched = this.findMatchingContact(cp, data.counterpartyHandle || '');
    if (matched) {
      this.toastSelectedIds.add(matched.id);
    }

    if (this.dom.qtAmountTitle) this.dom.qtAmountTitle.textContent = `Paid ₹${amt.toFixed(2)}`;
    if (this.dom.qtSubtitle) this.dom.qtSubtitle.textContent = cp;

    if (this.dom.qtContactsRow) {
      this.dom.qtContactsRow.innerHTML = '';
      if (this.ledger.people.length === 0) {
        this.dom.qtContactsRow.classList.add('hidden');
        if (this.dom.qtPrimaryBtn) this.dom.qtPrimaryBtn.textContent = 'Log Entry';
      } else {
        this.dom.qtContactsRow.classList.remove('hidden');
        this.ledger.people.forEach(p => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `qt-chip ${this.toastSelectedIds.has(p.id) ? 'selected' : ''}`;
          chip.textContent = p.name.split(' ')[0];
          chip.addEventListener('click', () => {
            if (this.toastSelectedIds.has(p.id)) {
              this.toastSelectedIds.delete(p.id);
              chip.classList.remove('selected');
            } else {
              this.toastSelectedIds.add(p.id);
              chip.classList.add('selected');
            }
            this.updateQuickToastButton();
          });
          this.dom.qtContactsRow.appendChild(chip);
        });
        this.updateQuickToastButton();
      }
    }

    if (this.toastCloseTimer) {
      clearTimeout(this.toastCloseTimer);
      this.toastCloseTimer = null;
    }
    this.dom.inAppQuickToast.classList.remove('closing');
    this.dom.inAppQuickToast.classList.remove('hidden');
  }

  updateQuickToastButton() {
    if (!this.dom.qtPrimaryBtn) return;
    const count = this.toastSelectedIds.size;
    if (count === 0) {
      this.dom.qtPrimaryBtn.textContent = 'Quick Add';
    } else if (count === 1) {
      const pid = Array.from(this.toastSelectedIds)[0];
      const person = this.ledger.people.find(p => p.id === pid);
      const first = person ? person.name.split(' ')[0] : 'Tab';
      this.dom.qtPrimaryBtn.textContent = `Add to ${first}`;
    } else {
      this.dom.qtPrimaryBtn.textContent = `Add (${count})`;
    }
  }

  handleQuickToastAdd() {
    if (!this.detectedPaytmData) return;
    if (this.toastSelectedIds.size === 0) {
      const d = this.detectedPaytmData;
      this.hideInAppQuickToast(false);
      this.openSnapModalWithPaytm(d);
      return;
    }

    const total = parseFloat(this.detectedPaytmData.amount) || 0;
    const pids = Array.from(this.toastSelectedIds);
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / pids.length);
    const remainder = totalCents - (baseCents * pids.length);

    const splits = pids.map((pid, idx) => ({
      personId: pid,
      amountOwed: (baseCents + (idx < remainder ? 1 : 0)) / 100
    }));

    const counterparty = this.detectedPaytmData.recipient || 'Payment';
    const newExpense = {
      id: 'e_' + Date.now(),
      title: counterparty,
      counterpartyName: counterparty,
      counterpartyHandle: this.detectedPaytmData.counterpartyHandle || '',
      entryKind: 'lent',
      totalAmount: total,
      paidById: 'me',
      splitType: 'BoughtForPerson',
      splits,
      category: this.detectedPaytmData.suggestedCategory || 'General',
      paymentSource: 'Paytm',
      date: new Date().toISOString(),
      myShare: 0
    };

    this.ledger.expenses.unshift(newExpense);
    this.saveLedger();
    this.hideInAppQuickToast(true);
  }

  hideInAppQuickToast(markDismissed) {
    const toastEl = this.dom.inAppQuickToast;
    if (markDismissed && this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }
    this.toastSelectedIds.clear();
    if (!toastEl || toastEl.classList.contains('hidden')) return;

    if (this.toastCloseTimer) clearTimeout(this.toastCloseTimer);
    toastEl.classList.add('closing');
    this.toastCloseTimer = setTimeout(() => {
      toastEl.classList.add('hidden');
      toastEl.classList.remove('closing');
      this.toastCloseTimer = null;
    }, 200);
  }

  // ================= PENDING INCOMING BRIDGE EVENTS =================
  checkPendingPayment() {
    this.drainQueuedNativeExpenses();

    if (window._pendingRepayment) {
      const rData = window._pendingRepayment;
      window._pendingRepayment = null;
      if (!this.isRepaymentDismissed(rData)) {
        this.handleRepaymentDetected(rData);
        return;
      } else {
        window.AndroidBridge?.clearPendingRepayment?.();
      }
    } else if (window.AndroidBridge?.getPendingRepayment) {
      try {
        const rawR = window.AndroidBridge.getPendingRepayment();
        if (rawR && rawR.length > 2) {
          const rData = JSON.parse(rawR);
          if (rData && rData.amount > 0) {
            if (!this.isRepaymentDismissed(rData)) {
              this.handleRepaymentDetected(rData);
              return;
            } else {
              window.AndroidBridge.clearPendingRepayment();
            }
          }
        }
      } catch (e) {}
    }

    if (window._pendingPayment) {
      const data = window._pendingPayment;
      window._pendingPayment = null;
      if (!this.isPaymentDismissed(data)) {
        this.handleIncomingPayment(data);
      } else {
        window.AndroidBridge?.clearPendingPayment?.();
      }
      return;
    }

    if (window.AndroidBridge?.getPendingPayment) {
      try {
        const raw = window.AndroidBridge.getPendingPayment();
        if (raw && raw.length > 2) {
          const data = JSON.parse(raw);
          if (data && data.amount > 0) {
            if (!this.isPaymentDismissed(data)) {
              this.handleIncomingPayment(data);
            } else {
              window.AndroidBridge.clearPendingPayment();
            }
          }
        }
      } catch (e) {}
    }
  }

  handleRepaymentDetected(data) {
    if (!data || !data.amount || data.amount <= 0) return;
    if (this.isRepaymentDismissed(data)) {
      window.AndroidBridge?.clearPendingRepayment?.();
      return;
    }
    this.detectedRepaymentData = data;
    this.openConfirmRepaymentModal(data);
  }

  handleIncomingPayment(data) {
    if (!data || !data.amount || data.amount <= 0) return;
    if (this.isPaymentDismissed(data)) {
      window.AndroidBridge?.clearPendingPayment?.();
      return;
    }
    this.detectedPaytmData = data;
    this.hideInAppQuickToast(false);
    this.openSnapModalWithPaytm(data);
  }

  // ================= ENTRY KIND & SPLIT MATH =================
  setEntryKind(kind) {
    this.currentEntryKind = ['split', 'lent', 'borrowed'].includes(kind) ? kind : 'split';
    this.dom.entryKindBar?.querySelectorAll('[data-kind]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.kind === this.currentEntryKind);
    });

    const titleMap = { split: 'New Split Expense', lent: 'Record Lent / Debt', borrowed: 'Record Borrowed' };
    const peopleLabelMap = { split: 'Split between', lent: 'Lent to', borrowed: 'Borrowed from' };
    const placeholderMap = {
      split: 'Description (e.g. Dinner, Tea Stall)',
      lent: 'Note or reason (e.g. UPI transfer, Loan)',
      borrowed: 'Note or reason (e.g. Cash borrow, Lunch)'
    };

    if (this.dom.modalTitle) this.dom.modalTitle.textContent = titleMap[this.currentEntryKind];
    if (this.dom.snapPeopleLabel) this.dom.snapPeopleLabel.textContent = peopleLabelMap[this.currentEntryKind];
    if (this.dom.snapTitle) this.dom.snapTitle.placeholder = placeholderMap[this.currentEntryKind];

    // Borrowed mode always targets 1 lender contact cleanly
    if (this.currentEntryKind === 'borrowed' && this.selectedPersonIds.size > 1) {
      const firstId = Array.from(this.selectedPersonIds)[0];
      this.selectedPersonIds = new Set([firstId]);
    }
    if (this.dom.selectAllPeopleBtn) {
      this.dom.selectAllPeopleBtn.classList.toggle('hidden', this.currentEntryKind === 'borrowed');
    }

    if (this.dom.myShareSection) {
      this.dom.myShareSection.classList.toggle('hidden', this.currentEntryKind === 'lent');
    }
    if (this.currentEntryKind === 'borrowed') {
      if (this.dom.myShareLabel) this.dom.myShareLabel.textContent = 'Your share (leave blank if full)';
      if (this.dom.preset100ThemBtn) this.dom.preset100ThemBtn.textContent = 'Full amount';
      if (this.dom.presetSplitEvenBtn) this.dom.presetSplitEvenBtn.textContent = 'Half of bill';
    } else {
      if (this.dom.myShareLabel) this.dom.myShareLabel.textContent = 'Your share';
      if (this.dom.preset100ThemBtn) this.dom.preset100ThemBtn.textContent = 'None for me';
      if (this.dom.presetSplitEvenBtn) this.dom.presetSplitEvenBtn.textContent = 'Split equally';
    }

    this.manualSplits.clear();
    if (this.currentEntryKind === 'lent' && this.dom.snapMyShare) {
      this.dom.snapMyShare.value = '';
    }
    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown(true);
  }

  calculateCurrentSplits() {
    const total = parseFloat(this.dom.snapAmount.value) || 0;
    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';
    let myShare = rawMyShare !== '' ? parseFloat(rawMyShare) : 0;
    if (isNaN(myShare) || myShare < 0) myShare = 0;

    const selectedList = Array.from(this.selectedPersonIds)
      .map(id => this.ledger.people.find(p => p.id === id))
      .filter(Boolean);

    if (this.currentEntryKind === 'borrowed') {
      const borrowAmt = rawMyShare !== '' ? Math.min(total, myShare) : total;
      const lender = selectedList[0] || null;
      const splits = lender ? [{ person: lender, amount: borrowAmt, isManual: false }] : [];
      return {
        entryKind: 'borrowed',
        total,
        myShare: borrowAmt,
        friendsTotalPool: borrowAmt,
        manualSum: 0,
        hasManual: false,
        splits,
        selectedList: lender ? [lender] : []
      };
    }

    const effectiveMyShare = this.currentEntryKind === 'lent' ? 0 : myShare;
    const friendsTotalPool = Math.max(0, total - effectiveMyShare);

    const manualMap = new Map();
    let manualSum = 0;
    const autoList = [];

    selectedList.forEach(p => {
      if (this.manualSplits.has(p.id)) {
        const val = parseFloat(this.manualSplits.get(p.id)) || 0;
        manualMap.set(p.id, val);
        manualSum += val;
      } else {
        autoList.push(p);
      }
    });

    const remainingForAuto = Math.max(0, friendsTotalPool - manualSum);
    const numAuto = autoList.length;

    const autoMap = new Map();
    if (numAuto > 0) {
      const totalCents = Math.round(remainingForAuto * 100);
      const baseCents = Math.floor(totalCents / numAuto);
      const remainder = totalCents - (baseCents * numAuto);

      autoList.forEach((person, idx) => {
        const cents = baseCents + (idx < remainder ? 1 : 0);
        autoMap.set(person.id, cents / 100);
      });
    }

    const splits = selectedList.map(p => {
      if (manualMap.has(p.id)) {
        return { person: p, amount: manualMap.get(p.id), isManual: true };
      }
      return { person: p, amount: autoMap.get(p.id) || 0, isManual: false };
    });

    return {
      entryKind: this.currentEntryKind,
      total,
      myShare: effectiveMyShare,
      friendsTotalPool,
      manualSum,
      hasManual: manualMap.size > 0,
      splits,
      selectedList
    };
  }

  updateAutoInputsInPlace(activePersonId) {
    const calc = this.calculateCurrentSplits();
    const isBorrow = calc.entryKind === 'borrowed';

    if (this.dom.summaryFriendsTotal) {
      this.dom.summaryFriendsTotal.textContent = isBorrow
        ? `₹${calc.friendsTotalPool.toFixed(2)} you will owe`
        : `₹${calc.friendsTotalPool.toFixed(2)} to collect`;
      this.dom.summaryFriendsTotal.className = `breakdown-total tabular ${isBorrow ? 'borrowed' : ''}`;
    }

    if (!this.dom.summaryBreakdownList) return;

    if (isBorrow) {
      this.recalculateSplitBreakdown(true);
      return;
    }

    calc.splits.forEach(s => {
      const pid = s.person.id;
      const row = this.dom.summaryBreakdownList.querySelector(`.split-person-row[data-id="${pid}"]`);
      if (!row) return;

      const input = row.querySelector('.split-person-input');
      const inputWrap = row.querySelector('.split-person-input-wrap');
      let resetBtn = row.querySelector('.btn-reset-single-split');

      if (pid === activePersonId) {
        if (s.isManual) {
          inputWrap?.classList.add('is-custom');
          if (!resetBtn && inputWrap) {
            resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'btn-reset-single-split';
            resetBtn.dataset.id = pid;
            resetBtn.title = 'Reset share';
            resetBtn.textContent = '↺';
            resetBtn.addEventListener('click', () => {
              this.manualSplits.delete(pid);
              this.recalculateSplitBreakdown(true);
            });
            inputWrap.appendChild(resetBtn);
          }
        } else {
          inputWrap?.classList.remove('is-custom');
          resetBtn?.remove();
        }
      } else if (!s.isManual) {
        if (input) input.value = s.amount.toFixed(2);
        inputWrap?.classList.remove('is-custom');
        resetBtn?.remove();
      }
    });

    let warnRow = this.dom.summaryBreakdownList.querySelector('.split-warning-row');
    if (calc.manualSum > calc.friendsTotalPool && calc.friendsTotalPool > 0) {
      const diff = calc.manualSum - calc.friendsTotalPool;
      if (!warnRow) {
        warnRow = document.createElement('div');
        warnRow.className = 'split-warning-row';
        this.dom.summaryBreakdownList.appendChild(warnRow);
      }
      warnRow.textContent = `Entered splits exceed total by ₹${diff.toFixed(2)}`;
    } else if (warnRow) {
      warnRow.remove();
    }

    this.updateSubmitSnapButtonLabel(calc);
  }

  updateSubmitSnapButtonLabel(calc) {
    if (!this.dom.submitSnapBtn) return;
    const prefix = calc.entryKind === 'borrowed' ? 'Save Borrowed' : calc.entryKind === 'lent' ? 'Save Lent' : 'Save Split';
    if (calc.friendsTotalPool > 0) {
      this.dom.submitSnapBtn.textContent = `${prefix} (₹${calc.friendsTotalPool.toFixed(2)})`;
    } else if (calc.total > 0) {
      this.dom.submitSnapBtn.textContent = `${prefix} (₹${calc.total.toFixed(2)})`;
    } else {
      this.dom.submitSnapBtn.textContent = prefix;
    }
  }

  recalculateSplitBreakdown(rebuildList = true) {
    const calc = this.calculateCurrentSplits();
    const isBorrow = calc.entryKind === 'borrowed';
    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';

    if (this.dom.preset100ThemBtn && this.dom.presetSplitEvenBtn) {
      if (rawMyShare === '' || calc.myShare === 0) {
        this.dom.preset100ThemBtn.classList.add('active');
        this.dom.presetSplitEvenBtn.classList.remove('active');
      } else {
        this.dom.preset100ThemBtn.classList.remove('active');
        this.dom.presetSplitEvenBtn.classList.add('active');
      }
    }

    if (this.dom.summaryFriendsTotal) {
      this.dom.summaryFriendsTotal.textContent = isBorrow
        ? `₹${calc.friendsTotalPool.toFixed(2)} you will owe`
        : `₹${calc.friendsTotalPool.toFixed(2)} to collect`;
      this.dom.summaryFriendsTotal.className = `breakdown-total tabular ${isBorrow ? 'borrowed' : ''}`;
    }

    const numFriends = calc.selectedList.length;
    if (this.dom.selectedPeopleSummary) {
      if (numFriends === 0) {
        this.dom.selectedPeopleSummary.textContent = 'Select a contact or pick from phone';
      } else {
        const names = calc.selectedList.map(p => p.name.split(' ')[0]).join(', ');
        this.dom.selectedPeopleSummary.textContent = isBorrow ? `Lender: ${names}` : `${numFriends} selected: ${names}`;
      }
    }

    this.updatePaymentLinkBanner();
    this.updateSubmitSnapButtonLabel(calc);

    if (!rebuildList) {
      this.updateAutoInputsInPlace(null);
      return;
    }

    if (!this.dom.summaryBreakdownList) return;
    if (numFriends === 0) {
      this.dom.summaryBreakdownList.innerHTML = `<div class="text-xs text-muted mt-2">${isBorrow ? 'Select who you borrowed from.' : 'Select contacts above to set amount.'}</div>`;
      return;
    }

    if (isBorrow) {
      const lender = calc.splits[0].person;
      this.dom.summaryBreakdownList.innerHTML = `
        <div class="split-person-row">
          <span class="split-person-name">You owe ${this.escapeHtml(lender.name)}</span>
          <span class="balance-amt negative tabular">₹${calc.friendsTotalPool.toFixed(2)}</span>
        </div>
      `;
      return;
    }

    let rowsHtml = '';
    calc.splits.forEach(s => {
      const p = s.person;
      const isManual = s.isManual;
      const valStr = isManual
        ? (this.manualSplits.get(p.id) !== undefined ? this.manualSplits.get(p.id) : s.amount.toFixed(2))
        : s.amount.toFixed(2);
      rowsHtml += `
        <div class="split-person-row" data-id="${p.id}">
          <span class="split-person-name">${this.escapeHtml(p.name)}</span>
          <div class="split-person-input-wrap ${isManual ? 'is-custom' : ''}">
            <span class="currency-prefix-xs">₹</span>
            <input type="number" step="any" inputmode="decimal" class="split-person-input tabular" data-id="${p.id}" value="${valStr}" placeholder="0.00">
            ${isManual ? `<button type="button" class="btn-reset-single-split" data-id="${p.id}" title="Reset">↺</button>` : ''}
          </div>
        </div>
      `;
    });

    if (calc.myShare > 0) {
      rowsHtml += `
        <div class="summary-item-row">
          <span>Your share</span>
          <span class="tabular">₹${calc.myShare.toFixed(2)}</span>
        </div>
      `;
    }

    if (calc.manualSum > calc.friendsTotalPool && calc.friendsTotalPool > 0) {
      rowsHtml += `<div class="split-warning-row">Entered splits exceed total by ₹${(calc.manualSum - calc.friendsTotalPool).toFixed(2)}</div>`;
    }

    if (calc.hasManual && numFriends > 1) {
      rowsHtml += `
        <div class="split-reset-all-row">
          <button type="button" class="btn-reset-all-splits" id="resetAllSplitsBtn">Split equally</button>
        </div>
      `;
    }

    this.dom.summaryBreakdownList.innerHTML = rowsHtml;

    this.dom.summaryBreakdownList.querySelectorAll('.split-person-input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const pid = e.target.dataset.id;
        const raw = e.target.value.trim();
        if (raw === '') {
          this.manualSplits.delete(pid);
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 0) this.manualSplits.set(pid, val);
        }
        this.updateAutoInputsInPlace(pid);
      });
      inp.addEventListener('blur', () => this.recalculateSplitBreakdown(true));
    });

    this.dom.summaryBreakdownList.querySelectorAll('.btn-reset-single-split').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manualSplits.delete(btn.dataset.id);
        this.recalculateSplitBreakdown(true);
      });
    });

    document.getElementById('resetAllSplitsBtn')?.addEventListener('click', () => {
      this.manualSplits.clear();
      this.recalculateSplitBreakdown(true);
    });
  }

  // ================= SCANNED PAYMENT LINK BANNER =================
  updatePaymentLinkBanner() {
    if (!this.dom.paymentLinkBanner) return;
    if (!this.detectedPaytmData || !this.detectedPaytmData.recipient) {
      this.dom.paymentLinkBanner.classList.add('hidden');
      return;
    }

    const cp = this.detectedPaytmData.recipient.trim();
    const handle = (this.detectedPaytmData.counterpartyHandle || '').trim();
    if (this.isGenericPaymentLabel(cp) && !handle) {
      this.dom.paymentLinkBanner.classList.add('hidden');
      return;
    }

    const matched = this.findMatchingContact(cp, handle);
    let selPerson = null;
    if (this.selectedPersonIds.size === 1) {
      const pid = Array.from(this.selectedPersonIds)[0];
      selPerson = this.ledger.people.find(p => p.id === pid) || null;
    }

    if (this.dom.paymentLinkSourceTag) {
      if (matched && (!selPerson || matched.id === selPerson.id)) {
        this.dom.paymentLinkSourceTag.textContent = `Linked to ${matched.name}`;
      } else if (selPerson) {
        this.dom.paymentLinkSourceTag.textContent = `Selected: ${selPerson.name}`;
      } else {
        this.dom.paymentLinkSourceTag.textContent = 'Scanned Payment Name';
      }
    }
    if (this.dom.paymentLinkName) {
      this.dom.paymentLinkName.textContent = handle && !cp.includes(handle) ? `${cp} (${handle})` : cp;
    }
    if (this.dom.paymentLinkCreateBtn) {
      this.dom.paymentLinkCreateBtn.classList.toggle('hidden', Boolean(matched) || this.isCommercialMerchantName(cp));
    }

    if (this.dom.paymentSaveAliasRow && this.dom.paymentSaveAliasCheck && this.dom.paymentSaveAliasText) {
      const alreadyKnown = matched && selPerson && matched.id === selPerson.id;
      const canSaveAlias = selPerson && !alreadyKnown && !this.isGenericPaymentLabel(cp) && !this.isCommercialMerchantName(cp);
      if (canSaveAlias) {
        this.dom.paymentSaveAliasRow.classList.remove('hidden');
        this.dom.paymentSaveAliasText.textContent = `Remember "${cp}" for ${selPerson.name}`;
      } else {
        this.dom.paymentSaveAliasRow.classList.add('hidden');
        this.dom.paymentSaveAliasCheck.checked = false;
      }
    }

    this.dom.paymentLinkBanner.classList.remove('hidden');
  }

  createContactFromScannedPayment() {
    if (!this.detectedPaytmData) return;
    const rawName = (this.detectedPaytmData.recipient || '').trim() || 'New Contact';
    const rawHandle = (this.detectedPaytmData.counterpartyHandle || '').trim();
    const phoneDigits = this.normalizePhoneDigits(rawHandle || rawName);
    const isPhone = phoneDigits.length === 10 && /^[6-9][0-9]{9}$/.test(phoneDigits);
    const isUpi = rawHandle.includes('@') && !rawHandle.startsWith('*');

    const created = {
      id: 'p_' + Date.now(),
      name: rawName,
      relationship: 'Friend',
      phone: isPhone ? phoneDigits : null,
      upi: isUpi ? rawHandle : null,
      aliases: rawHandle && !isUpi ? [rawHandle] : [],
      createdAt: new Date().toISOString()
    };

    this.ledger.people.push(created);
    this.selectedPersonIds.add(created.id);
    this.saveLedger();
    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown(true);
  }

  // ================= ENTRY MODAL HANDLERS =================
  showSnapError(msg) {
    if (this.dom.snapFormError) {
      this.dom.snapFormError.textContent = msg;
      this.dom.snapFormError.classList.remove('hidden');
    }
  }

  hideSnapError() {
    if (this.dom.snapFormError) {
      this.dom.snapFormError.textContent = '';
      this.dom.snapFormError.classList.add('hidden');
    }
  }

  openSnapModal(resetPeople = true, kind = 'split') {
    if (resetPeople) {
      this.selectedPersonIds.clear();
      this.detectedPaytmData = null;
    }
    this.manualSplits.clear();
    this.hideSnapError();
    this.dom.snapAmount.value = '';
    this.dom.snapTitle.value = '';
    this.setSelectedEntryLocation(null);
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
    if (this.dom.paymentSaveAliasCheck) this.dom.paymentSaveAliasCheck.checked = false;

    this.setEntryKind(kind);
    this.openModalElement(this.dom.snapExpenseModal);
    if (window.innerHeight > 520) {
      setTimeout(() => this.dom.snapAmount.focus(), 100);
    }
  }

  openSnapModalWithPaytm(data) {
    if (!data) return;
    this.detectedPaytmData = data;
    this.selectedPersonIds.clear();
    this.manualSplits.clear();
    this.hideSnapError();
    this.setSelectedEntryLocation(null);

    const counterparty = (data.recipient || '').trim();
    const handle = (data.counterpartyHandle || '').trim();
    const matched = this.findMatchingContact(counterparty, handle);
    if (matched) {
      this.selectedPersonIds.add(matched.id);
    }

    this.dom.snapAmount.value = data.amount || '';
    this.dom.snapTitle.value = counterparty && !this.isGenericPaymentLabel(counterparty)
      ? counterparty
      : (this.isCommercialMerchantName(counterparty) ? counterparty : 'Payment');
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
    if (this.dom.paymentSaveAliasCheck) this.dom.paymentSaveAliasCheck.checked = false;

    if (data.suggestedCategory) {
      const radio = document.querySelector(`input[name="category"][value="${data.suggestedCategory}"]`);
      if (radio) radio.checked = true;
    }

    this.setEntryKind(matched ? 'lent' : 'split');
    this.openModalElement(this.dom.snapExpenseModal);
    const sheet = this.dom.snapExpenseModal.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  closeSnapModal() {
    this.closeModalElement(this.dom.snapExpenseModal, () => {
      this.hideSnapError();
      this.manualSplits.clear();
      this.setSelectedEntryLocation(null);
    });
    if (this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }
    window.AndroidBridge?.clearPendingPayment?.();
  }

  renderModalPeopleChips() {
    if (!this.dom.modalPeopleChips) return;
    this.dom.modalPeopleChips.innerHTML = '';

    this.ledger.people.forEach(p => {
      const isSelected = this.selectedPersonIds.has(p.id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `person-chip ${isSelected ? 'selected' : ''}`;
      chip.textContent = p.name;
      chip.addEventListener('click', () => {
        if (this.currentEntryKind === 'borrowed') {
          if (this.selectedPersonIds.has(p.id)) {
            this.selectedPersonIds.delete(p.id);
          } else {
            this.selectedPersonIds = new Set([p.id]);
          }
          this.renderModalPeopleChips();
        } else {
          if (this.selectedPersonIds.has(p.id)) {
            this.selectedPersonIds.delete(p.id);
            this.manualSplits.delete(p.id);
            chip.classList.remove('selected');
          } else {
            this.selectedPersonIds.add(p.id);
            chip.classList.add('selected');
          }
        }
        this.hideSnapError();
        this.recalculateSplitBreakdown(true);
      });
      this.dom.modalPeopleChips.appendChild(chip);
    });

    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'person-chip add-chip';
    addChip.textContent = '+ Contact';
    addChip.addEventListener('click', () => this.openAddPersonModal());
    this.dom.modalPeopleChips.appendChild(addChip);
  }

  handleSnapSubmit(e) {
    e.preventDefault();
    this.hideSnapError();

    const amount = parseFloat(this.dom.snapAmount.value);
    const defaultTitle = this.currentEntryKind === 'borrowed'
      ? 'Borrowed'
      : this.currentEntryKind === 'lent' ? 'Lent' : 'Expense';
    const title = this.dom.snapTitle.value.trim() || defaultTitle;
    const category = document.querySelector('input[name="category"]:checked')?.value || 'General';

    if (!amount || amount <= 0) {
      this.showSnapError('Enter a valid amount.');
      return;
    }
    if (this.selectedPersonIds.size === 0) {
      this.showSnapError(this.currentEntryKind === 'borrowed' ? 'Select who you borrowed from.' : 'Select at least one contact.');
      return;
    }

    const calc = this.calculateCurrentSplits();

    if (this.currentEntryKind !== 'borrowed') {
      if (calc.myShare > amount) {
        this.showSnapError(`Your share (₹${calc.myShare.toFixed(2)}) exceeds total (₹${amount.toFixed(2)}).`);
        return;
      }

      const splitsSum = calc.splits.reduce((acc, s) => acc + s.amount, 0);
      if (calc.hasManual && Math.abs((splitsSum + calc.myShare) - amount) > 0.05) {
        this.showSnapError(`Split total (₹${(splitsSum + calc.myShare).toFixed(2)}) does not match ₹${amount.toFixed(2)}.`);
        return;
      }
    }

    // Save learned payment name alias if user opted in
    if (this.detectedPaytmData && this.dom.paymentSaveAliasCheck?.checked && calc.splits.length === 1) {
      this.addAliasToPerson(
        calc.splits[0].person.id,
        this.detectedPaytmData.recipient || '',
        this.detectedPaytmData.counterpartyHandle || ''
      );
    }

    const splits = calc.splits.map(s => ({
      personId: s.person.id,
      amountOwed: Math.round(s.amount * 100) / 100
    }));

    const counterpartyName = this.detectedPaytmData?.recipient || '';
    const counterpartyHandle = this.detectedPaytmData?.counterpartyHandle || '';

    const attachedLoc = this.currentEntryLocation ? { ...this.currentEntryLocation } : null;
    if (attachedLoc) {
      this.saveShopToDirectory(attachedLoc);
    }

    const isBorrow = this.currentEntryKind === 'borrowed';
    const newEntry = {
      id: 'e_' + Date.now(),
      title,
      counterpartyName,
      counterpartyHandle,
      entryKind: this.currentEntryKind,
      totalAmount: amount,
      paidById: isBorrow ? splits[0].personId : 'me',
      splitType: isBorrow ? 'Borrowed' : (calc.myShare > 0 || calc.hasManual ? 'Split' : 'BoughtForPerson'),
      splits,
      category,
      location: attachedLoc,
      paymentSource: this.detectedPaytmData ? 'Paytm' : 'Manual',
      date: new Date().toISOString(),
      myShare: calc.myShare
    };

    this.ledger.expenses.unshift(newEntry);
    this.saveLedger();
    if (this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }
    this.manualSplits.clear();
    this.closeSnapModal();
  }

  // ================= CONTACT SHEETS & CRUD =================
  openAddPersonModal() {
    this.openModalElement(this.dom.addPersonModal);
    if (window.innerHeight > 520) {
      setTimeout(() => document.getElementById('personName')?.focus(), 100);
    }
  }

  closeAddPersonModal() {
    this.closeModalElement(this.dom.addPersonModal);
  }

  handleAddPersonSubmit(e) {
    e.preventDefault();
    const name = this.dom.personName?.value.trim() || '';
    const phone = this.normalizePhoneDigits(this.dom.personPhone?.value.trim() || '');
    const rel = document.querySelector('input[name="relationship"]:checked')?.value || 'Friend';
    const rawUpiOrAlias = this.dom.personUpi?.value.trim() || '';
    const isUpi = rawUpiOrAlias.includes('@');

    if (!name) return;

    const newPerson = {
      id: 'p_' + Date.now(),
      name,
      relationship: rel,
      phone: phone || null,
      upi: isUpi ? rawUpiOrAlias : null,
      aliases: rawUpiOrAlias && !isUpi ? [rawUpiOrAlias] : [],
      createdAt: new Date().toISOString()
    };

    this.ledger.people.push(newPerson);
    this.saveLedger();
    this.dom.addPersonForm.reset();
    document.querySelectorAll('#addPersonModal .seg-option').forEach((opt, i) => opt.classList.toggle('active', i === 0));
    this.closeAddPersonModal();

    if (!this.dom.snapExpenseModal.classList.contains('hidden')) {
      if (this.currentEntryKind === 'borrowed') {
        this.selectedPersonIds = new Set([newPerson.id]);
      } else {
        this.selectedPersonIds.add(newPerson.id);
      }
      this.renderModalPeopleChips();
      this.recalculateSplitBreakdown(true);
    }
  }

  getPersonHistory(personId) {
    const items = [];
    this.ledger.expenses.forEach(exp => {
      const involved = exp.paidById === personId || (exp.splits || []).some(s => s.personId === personId);
      if (involved) {
        items.push({ kind: 'expense', item: exp, ts: new Date(exp.date).getTime() || 0 });
      }
    });
    this.ledger.settlements.forEach(s => {
      if (s.fromPersonId === personId || s.toPersonId === personId) {
        items.push({ kind: 'repayment', item: s, ts: new Date(s.date).getTime() || 0 });
      }
    });
    return items.sort((a, b) => b.ts - a.ts);
  }

  getUnsettledEntriesForPerson(personId) {
    const netBalance = Math.round(((this.calculateNetBalances()[personId] || 0)) * 100) / 100;
    if (Math.abs(netBalance) <= 0.01) {
      return { netBalance: 0, direction: 'settled', openLent: [], openBorrowed: [], unsettledItems: [] };
    }

    const lentQueue = [];
    const borrowQueue = [];
    const sortedExpenses = [...this.ledger.expenses].sort((a, b) => (new Date(a.date).getTime() || 0) - (new Date(b.date).getTime() || 0));

    sortedExpenses.forEach(exp => {
      const isBorrow = exp.entryKind === 'borrowed' || (exp.paidById && exp.paidById !== 'me');
      const sp = (exp.splits || []).find(s => s.personId === personId);
      const amt = sp ? (parseFloat(sp.amountOwed) || 0) : 0;
      if (amt <= 0.01) return;
      const entry = {
        id: exp.id,
        title: exp.title || (isBorrow ? 'Borrowed' : 'Expense'),
        date: exp.date,
        ts: new Date(exp.date).getTime() || 0,
        original: amt,
        remaining: Math.round(amt * 100) / 100,
        kind: isBorrow ? 'borrowed' : 'lent'
      };
      if (isBorrow) borrowQueue.push(entry);
      else lentQueue.push(entry);
    });

    let totalReceived = 0;
    let totalPaid = 0;
    this.ledger.settlements.forEach(s => {
      const amt = parseFloat(s.amount) || 0;
      if (amt <= 0.01) return;
      if (s.toPersonId === 'me' && s.fromPersonId === personId) totalReceived += amt;
      else if (s.fromPersonId === 'me' && s.toPersonId === personId) totalPaid += amt;
    });

    const applyFifo = (queue, credit) => {
      let left = credit;
      for (let i = 0; i < queue.length && left > 0.01; i++) {
        const take = Math.min(queue[i].remaining, left);
        queue[i].remaining = Math.round((queue[i].remaining - take) * 100) / 100;
        left = Math.round((left - take) * 100) / 100;
      }
      return left;
    };

    const excessReceived = applyFifo(lentQueue, totalReceived);
    const excessPaid = applyFifo(borrowQueue, totalPaid);

    // Only apply actual settlement payments across queues; keep unsettled borrowed items intact so they show explicitly
    if (excessReceived > 0.01) applyFifo(borrowQueue, excessReceived);
    if (excessPaid > 0.01) applyFifo(lentQueue, excessPaid);

    const openLent = lentQueue.filter(x => x.remaining > 0.01).sort((a, b) => b.ts - a.ts);
    const openBorrowed = borrowQueue.filter(x => x.remaining > 0.01).sort((a, b) => b.ts - a.ts);

    return {
      netBalance,
      direction: netBalance > 0.01 ? 'owed_to_me' : 'i_owe',
      openLent,
      openBorrowed,
      unsettledItems: [...openLent, ...openBorrowed].sort((a, b) => b.ts - a.ts)
    };
  }

  openPersonActionsModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person || !this.dom.personActionsModal) return;

    this.activeActionPersonId = personId;
    const balances = this.calculateNetBalances();
    const bal = balances[personId] || 0;

    if (this.dom.actionPersonName) this.dom.actionPersonName.textContent = person.name;
    const aliasesCount = Array.isArray(person.aliases) ? person.aliases.length : 0;
    const meta = [
      person.relationship,
      person.phone,
      person.upi,
      aliasesCount > 0 ? `${aliasesCount} linked ${aliasesCount === 1 ? 'name' : 'names'}` : ''
    ].filter(Boolean).join(' • ');
    if (this.dom.actionPersonMeta) this.dom.actionPersonMeta.textContent = meta || person.relationship;

    if (this.dom.actionPersonBalance) {
      this.dom.actionPersonBalance.textContent = bal > 0.01
        ? `Owes ₹${bal.toFixed(2)}`
        : bal < -0.01 ? `You owe ₹${Math.abs(bal).toFixed(2)}` : 'Settled';
      this.dom.actionPersonBalance.className = `action-person-bal tabular ${bal > 0.01 ? 'text-danger' : bal < -0.01 ? 'text-borrow' : 'text-muted'}`;
    }

    if (this.dom.actionPayUpiBtn && this.dom.actionPayUpiLabel) {
      if (bal < -0.01 && person.upi) {
        this.dom.actionPayUpiLabel.textContent = `Pay ₹${Math.abs(bal).toFixed(2)} via UPI`;
        this.dom.actionPayUpiBtn.classList.remove('hidden');
      } else {
        this.dom.actionPayUpiBtn.classList.add('hidden');
      }
    }

    // Recent with this contact
    const history = this.getPersonHistory(personId).slice(0, 4);
    if (this.dom.actionPersonHistoryWrap && this.dom.actionPersonHistory) {
      if (history.length === 0) {
        this.dom.actionPersonHistoryWrap.classList.add('hidden');
      } else {
        this.dom.actionPersonHistoryWrap.classList.remove('hidden');
        this.dom.actionPersonHistory.innerHTML = '';
        history.forEach(entry => {
          const dStr = new Date(entry.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mini-history-row';
          if (entry.kind === 'expense') {
            const exp = entry.item;
            const isBorrow = exp.entryKind === 'borrowed' || (exp.paidById && exp.paidById !== 'me');
            const split = (exp.splits || []).find(s => s.personId === personId);
            const amt = split ? parseFloat(split.amountOwed) : parseFloat(exp.totalAmount);
            btn.innerHTML = `
              <span class="row-secondary-text">${this.escapeHtml(exp.title)} • ${dStr}</span>
              <span class="balance-amt tabular ${isBorrow ? 'negative' : 'positive'}">${isBorrow ? '-' : '+'}₹${amt.toFixed(2)}</span>
            `;
            btn.addEventListener('click', () => {
              this.closePersonActionsModal();
              this.openActivityDetailModal('expense', exp.id);
            });
          } else {
            const s = entry.item;
            const iPaidThem = s.fromPersonId === 'me' || s.direction === 'paid';
            btn.innerHTML = `
              <span class="row-secondary-text">${iPaidThem ? 'Paid back' : 'Repaid'} • ${dStr}</span>
              <span class="balance-amt repaid tabular">₹${parseFloat(s.amount).toFixed(2)}</span>
            `;
            btn.addEventListener('click', () => {
              this.closePersonActionsModal();
              this.openActivityDetailModal('repayment', s.id);
            });
          }
          this.dom.actionPersonHistory.appendChild(btn);
        });
      }
    }

    this.openModalElement(this.dom.personActionsModal);
  }

  sharePersonSummary(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) return;
    const { netBalance, openLent, openBorrowed } = this.getUnsettledEntriesForPerson(personId);
    if (Math.abs(netBalance) <= 0.01) {
      alert(`All entries with ${person.name} are already settled.`);
      return;
    }

    const fmtDate = ts => new Date(ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    const lines = [];

    if (netBalance > 0.01) {
      lines.push(`Pending Summary: ₹${netBalance.toFixed(2)}`);
      if (openLent.length > 0 || openBorrowed.length > 0) lines.push('');
      openLent.forEach(item => {
        lines.push(`• ${fmtDate(item.ts)}: ${item.title}: ₹${item.remaining.toFixed(2)}`);
      });
      openBorrowed.forEach(item => {
        lines.push(`• ${fmtDate(item.ts)}: ${item.title} (Paid by you): (-₹${item.remaining.toFixed(2)})`);
      });
    } else {
      lines.push(`Pending to Pay: ₹${Math.abs(netBalance).toFixed(2)}`);
      if (openBorrowed.length > 0 || openLent.length > 0) lines.push('');
      openBorrowed.forEach(item => {
        lines.push(`• ${fmtDate(item.ts)}: ${item.title}: ₹${item.remaining.toFixed(2)}`);
      });
      openLent.forEach(item => {
        lines.push(`• ${fmtDate(item.ts)}: ${item.title} (Paid by me): (-₹${item.remaining.toFixed(2)})`);
      });
    }

    const summaryText = lines.join('\n');
    if (window.AndroidBridge && window.AndroidBridge.shareText) {
      window.AndroidBridge.shareText(summaryText, 'Pending Summary');
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summaryText);
      alert('Pending summary copied to clipboard.');
    }
  }

  shareAllPendingSummary() {
    const balances = this.calculateNetBalances();
    const owedToMe = [];
    const iOwe = [];
    let totalCollect = 0;
    let totalPay = 0;

    this.ledger.people.forEach(person => {
      const bal = Math.round(((balances[person.id] || 0)) * 100) / 100;
      if (bal > 0.01) {
        totalCollect += bal;
        owedToMe.push({ person, bal });
      } else if (bal < -0.01) {
        totalPay += Math.abs(bal);
        iOwe.push({ person, bal: Math.abs(bal) });
      }
    });

    if (owedToMe.length === 0 && iOwe.length === 0) {
      alert('All balances are settled. Nothing pending to share.');
      return;
    }

    const lines = ['WhoseTab Pending Balances'];
    if (owedToMe.length > 0) {
      lines.push('', `Owed to me (Total ₹${totalCollect.toFixed(2)}):`);
      owedToMe.forEach(row => {
        lines.push(`• ${row.person.name}: ₹${row.bal.toFixed(2)}`);
      });
    }
    if (iOwe.length > 0) {
      lines.push('', `I borrowed / owe (Total ₹${totalPay.toFixed(2)}):`);
      iOwe.forEach(row => {
        lines.push(`• ${row.person.name}: (-₹${row.bal.toFixed(2)})`);
      });
    }

    const text = lines.join('\n');
    if (window.AndroidBridge && window.AndroidBridge.shareText) {
      window.AndroidBridge.shareText(text, 'Pending Balances');
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      alert('Pending summary copied to clipboard.');
    }
  }

  closePersonActionsModal() {
    this.closeModalElement(this.dom.personActionsModal, () => {
      this.activeActionPersonId = null;
    });
  }

  openEditPersonModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person || !this.dom.editPersonModal) return;

    if (this.dom.editPersonId) this.dom.editPersonId.value = person.id;
    if (this.dom.editPersonName) this.dom.editPersonName.value = person.name;
    if (this.dom.editPersonPhone) this.dom.editPersonPhone.value = person.phone || '';
    if (this.dom.editPersonUpi) this.dom.editPersonUpi.value = person.upi || '';

    document.querySelectorAll('input[name="editRelationship"]').forEach(r => {
      r.checked = r.value === person.relationship;
      r.closest('.seg-option')?.classList.toggle('active', r.checked);
    });

    this.renderEditPersonAliases(person);
    this.openModalElement(this.dom.editPersonModal);
  }

  renderEditPersonAliases(person) {
    if (!this.dom.editPersonAliasesWrap || !this.dom.editPersonAliasesList) return;
    const aliases = Array.isArray(person.aliases) ? person.aliases : [];
    if (aliases.length === 0) {
      this.dom.editPersonAliasesWrap.classList.add('hidden');
      this.dom.editPersonAliasesList.innerHTML = '';
      return;
    }
    this.dom.editPersonAliasesWrap.classList.remove('hidden');
    this.dom.editPersonAliasesList.innerHTML = '';
    aliases.forEach(alias => {
      const chip = document.createElement('span');
      chip.className = 'alias-chip';
      chip.innerHTML = `<span>${this.escapeHtml(alias)}</span><button type="button" class="alias-chip-remove" title="Remove">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        person.aliases = person.aliases.filter(a => a !== alias);
        this.saveLedger();
        this.renderEditPersonAliases(person);
      });
      this.dom.editPersonAliasesList.appendChild(chip);
    });
  }

  closeEditPersonModal() {
    this.closeModalElement(this.dom.editPersonModal);
  }

  handleEditPersonSubmit(e) {
    e.preventDefault();
    const id = this.dom.editPersonId?.value;
    const person = this.ledger.people.find(p => p.id === id);
    if (!person) return;

    const name = this.dom.editPersonName?.value.trim() || '';
    if (!name) return;

    person.name = name;
    person.phone = this.normalizePhoneDigits(this.dom.editPersonPhone?.value.trim() || '') || null;
    person.upi = this.dom.editPersonUpi?.value.trim() || null;
    person.relationship = document.querySelector('input[name="editRelationship"]:checked')?.value || person.relationship;

    this.saveLedger();
    this.closeEditPersonModal();
  }

  handleDeletePersonSubmit() {
    const id = this.dom.editPersonId?.value;
    const person = this.ledger.people.find(p => p.id === id);
    if (!person) return;

    if (confirm(`Remove ${person.name} from contacts? Past activity stays preserved.`)) {
      this.ledger.people = this.ledger.people.filter(p => p.id !== id);
      this.selectedPersonIds.delete(id);
      this.saveLedger();
      this.closeEditPersonModal();
    }
  }

  // ================= ACTIVITY DETAIL SHEET & DELETE =================
  openActivityDetailModal(kind, id) {
    if (!this.dom.activityDetailModal) return;
    this.activeDetailItem = { kind, id };

    if (this.dom.detailMetaCard) {
      this.dom.detailMetaCard.classList.add('hidden');
      this.dom.detailMetaCard.innerHTML = '';
    }

    if (kind === 'expense') {
      const exp = this.ledger.expenses.find(e => e.id === id);
      if (!exp) return;

      const isBorrow = exp.entryKind === 'borrowed' || (exp.paidById && exp.paidById !== 'me');
      this.dom.detailTypeBadge.textContent = isBorrow
        ? 'Borrowed'
        : exp.entryKind === 'lent' ? 'Lent' : (exp.category || 'Split');
      this.dom.detailTypeBadge.className = `eyebrow-tag ${isBorrow ? 'text-borrow' : 'text-danger'}`;
      this.dom.detailTitle.textContent = exp.title;
      this.dom.detailAmount.textContent = `${isBorrow ? '-' : ''}₹${parseFloat(exp.totalAmount).toFixed(2)}`;
      this.dom.detailAmount.className = `detail-amount-hero tabular ${isBorrow ? 'text-borrow' : 'text-danger'}`;
      this.dom.detailTimestamp.textContent = new Date(exp.date).toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const metaRows = [];
      if (exp.location && (exp.location.name || exp.location.mapsUrl)) {
        const locLabel = exp.location.name || 'Shop Location';
        const locSub = exp.location.address ? ` (${exp.location.address})` : '';
        metaRows.push(`
          <button type="button" id="detailLocationBtn" class="settings-row interactive-row">
            <span class="row-title">Location</span>
            <span class="row-subtitle text-accent">${this.escapeHtml(locLabel + locSub)} ↗</span>
          </button>
        `);
      }
      if (exp.counterpartyName) {
        metaRows.push(`
          <div class="settings-row">
            <span class="row-title text-muted">Payment Name</span>
            <span class="value-muted">${this.escapeHtml(exp.counterpartyName)}</span>
          </div>
        `);
      }
      if (exp.counterpartyHandle) {
        metaRows.push(`
          <div class="settings-row">
            <span class="row-title text-muted">Handle / UPI</span>
            <span class="value-muted">${this.escapeHtml(exp.counterpartyHandle)}</span>
          </div>
        `);
      }
      if (exp.paymentSource) {
        metaRows.push(`
          <div class="settings-row">
            <span class="row-title text-muted">Source</span>
            <span class="value-muted">${this.escapeHtml(exp.paymentSource)}</span>
          </div>
        `);
      }
      if (metaRows.length > 0 && this.dom.detailMetaCard) {
        this.dom.detailMetaCard.innerHTML = metaRows.join('');
        this.dom.detailMetaCard.classList.remove('hidden');
        document.getElementById('detailLocationBtn')?.addEventListener('click', () => {
          this.openLocationInMaps(exp.location);
        });
      }

      let html = '';
      (exp.splits || []).forEach(s => {
        const person = this.ledger.people.find(p => p.id === s.personId);
        const name = person ? person.name : 'Former Contact';
        html += `
          <div class="settings-row">
            <span class="row-title">${isBorrow ? `You owe ${this.escapeHtml(name)}` : this.escapeHtml(name)}</span>
            <span class="balance-amt ${isBorrow ? 'negative' : 'positive'} tabular">₹${parseFloat(s.amountOwed).toFixed(2)}</span>
          </div>
        `;
      });
      if (!isBorrow && exp.myShare && exp.myShare > 0) {
        html += `
          <div class="settings-row">
            <span class="row-title text-muted">Your share</span>
            <span class="value-muted tabular">₹${parseFloat(exp.myShare).toFixed(2)}</span>
          </div>
        `;
      }
      this.dom.detailSplitsContainer.innerHTML = html;
    } else {
      const s = this.ledger.settlements.find(x => x.id === id);
      if (!s) return;

      const iPaidThem = s.fromPersonId === 'me' || s.direction === 'paid';
      const personId = iPaidThem ? s.toPersonId : s.fromPersonId;
      const person = this.ledger.people.find(p => p.id === personId);
      const name = person ? person.name : 'Contact';

      this.dom.detailTypeBadge.textContent = 'Settlement';
      this.dom.detailTypeBadge.className = 'eyebrow-tag text-success';
      this.dom.detailTitle.textContent = iPaidThem ? `Paid ${name}` : `Repayment from ${name}`;
      this.dom.detailAmount.textContent = `${iPaidThem ? '-' : '+'}₹${parseFloat(s.amount).toFixed(2)}`;
      this.dom.detailAmount.className = 'detail-amount-hero tabular text-success';
      this.dom.detailTimestamp.textContent = new Date(s.date).toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      this.dom.detailSplitsContainer.innerHTML = `
        <div class="settings-row">
          <span class="row-title">Method</span>
          <span class="value-muted">${this.escapeHtml(s.paymentSource || 'UPI')}</span>
        </div>
        <div class="settings-row">
          <span class="row-title">Note</span>
          <span class="value-muted">${this.escapeHtml(s.notes || 'Settlement')}</span>
        </div>
      `;
    }

    this.openModalElement(this.dom.activityDetailModal);
  }

  closeActivityDetailModal() {
    this.closeModalElement(this.dom.activityDetailModal, () => {
      this.activeDetailItem = null;
    });
  }

  deleteActiveDetailEntry() {
    if (!this.activeDetailItem) return;
    if (!confirm('Remove this entry and recalculate balances?')) return;

    if (this.activeDetailItem.kind === 'expense') {
      this.ledger.expenses = this.ledger.expenses.filter(e => e.id !== this.activeDetailItem.id);
    } else {
      this.ledger.settlements = this.ledger.settlements.filter(s => s.id !== this.activeDetailItem.id);
    }
    this.saveLedger();
    this.closeActivityDetailModal();
  }

  // ================= BIDIRECTIONAL BALANCE MATH & SETTLE UP =================
  calculateNetBalances() {
    const balances = {};
    this.ledger.people.forEach(p => { balances[p.id] = 0; });

    this.ledger.expenses.forEach(exp => {
      const isBorrow = exp.entryKind === 'borrowed' || (exp.paidById && exp.paidById !== 'me');
      if (isBorrow) {
        if (Array.isArray(exp.splits) && exp.splits.length > 0) {
          exp.splits.forEach(split => {
            if (split.personId && split.personId !== 'me') {
              balances[split.personId] = (balances[split.personId] || 0) - (parseFloat(split.amountOwed) || 0);
            }
          });
        } else if (exp.paidById && exp.paidById !== 'me') {
          const amt = parseFloat(exp.myShare) > 0 ? parseFloat(exp.myShare) : parseFloat(exp.totalAmount) || 0;
          balances[exp.paidById] = (balances[exp.paidById] || 0) - amt;
        }
      } else {
        (exp.splits || []).forEach(split => {
          if (split.personId && split.personId !== 'me') {
            balances[split.personId] = (balances[split.personId] || 0) + (parseFloat(split.amountOwed) || 0);
          }
        });
      }
    });

    this.ledger.settlements.forEach(s => {
      const amt = parseFloat(s.amount) || 0;
      if (s.toPersonId === 'me' && s.direction !== 'paid') {
        balances[s.fromPersonId] = (balances[s.fromPersonId] || 0) - amt;
      } else if (s.fromPersonId === 'me' || s.direction === 'paid') {
        balances[s.toPersonId] = (balances[s.toPersonId] || 0) + amt;
      }
    });

    Object.keys(balances).forEach(k => {
      balances[k] = Math.round(balances[k] * 100) / 100;
    });
    return balances;
  }

  setSettleDirection(dir) {
    this.settleDirection = dir === 'paid' ? 'paid' : 'received';
    this.dom.settleDirectionBar?.querySelectorAll('[data-dir]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.dir === this.settleDirection);
    });
    if (this.dom.settleAmountLabel) {
      this.dom.settleAmountLabel.textContent = this.settleDirection === 'paid' ? 'Amount paid (₹)' : 'Amount received (₹)';
    }
  }

  openSettleModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) return;
    const bal = this.calculateNetBalances()[personId] || 0;

    this.dom.settlePersonInfo.innerHTML = `
      <div class="settings-row">
        <span class="row-title">${this.escapeHtml(person.name)}</span>
        <span class="balance-amt ${bal > 0.01 ? 'positive' : bal < -0.01 ? 'negative' : 'zero'} tabular">
          ${bal > 0.01 ? `Owes ₹${bal.toFixed(2)}` : bal < -0.01 ? `You owe ₹${Math.abs(bal).toFixed(2)}` : 'Settled'}
        </span>
      </div>
    `;

    this.setSettleDirection(bal < -0.01 ? 'paid' : 'received');
    this.dom.settleAmount.value = Math.abs(bal) > 0.01 ? Math.abs(bal).toFixed(2) : '';
    this.dom.settleForm.dataset.personId = personId;
    this.openModalElement(this.dom.settleModal);
  }

  handleSettleSubmit(e) {
    e.preventDefault();
    const personId = this.dom.settleForm.dataset.personId;
    const amount = parseFloat(this.dom.settleAmount.value);
    const notes = this.dom.settleNotes.value.trim() || 'Settlement';

    if (!amount || amount <= 0) {
      alert('Enter a valid amount.');
      return;
    }

    const isPaidOut = this.settleDirection === 'paid';
    this.ledger.settlements.push({
      id: 's_' + Date.now(),
      direction: this.settleDirection,
      fromPersonId: isPaidOut ? 'me' : personId,
      toPersonId: isPaidOut ? personId : 'me',
      amount,
      date: new Date().toISOString(),
      paymentSource: 'UPI',
      notes
    });

    this.saveLedger();
    this.dom.settleForm.reset();
    this.closeModalElement(this.dom.settleModal);
  }

  // ================= INCOMING REPAYMENT PROMPT & EXACT AMOUNT GUESSING =================
  findRepaymentSuggestion(sender, handle, amount) {
    if (!amount || amount <= 0.01 || !this.ledger.people.length) return null;
    const identityMatch = this.findMatchingContact(sender, handle);
    const balances = this.calculateNetBalances();

    const checkPerson = (p) => {
      const bal = balances[p.id] || 0;
      const { unsettledItems } = this.getUnsettledEntriesForPerson(p.id);
      const exactEntry = unsettledItems.find(item => item.kind === 'lent' && Math.abs(item.remaining - amount) <= 0.01);
      if (exactEntry) {
        const dStr = new Date(exactEntry.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        return {
          person: p,
          reason: `Matches "${exactEntry.title}" (₹${exactEntry.remaining.toFixed(2)} on ${dStr})`
        };
      }
      if (bal > 0.01 && Math.abs(bal - amount) <= 0.01) {
        return {
          person: p,
          reason: `Matches exact balance owed by ${p.name} (₹${bal.toFixed(2)})`
        };
      }
      return null;
    };

    if (identityMatch) {
      return checkPerson(identityMatch);
    }

    const entryHits = [];
    const balanceHits = [];
    this.ledger.people.forEach(p => {
      const { unsettledItems } = this.getUnsettledEntriesForPerson(p.id);
      const exactEntry = unsettledItems.find(item => item.kind === 'lent' && Math.abs(item.remaining - amount) <= 0.01);
      if (exactEntry) {
        const dStr = new Date(exactEntry.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        entryHits.push({
          person: p,
          reason: `Exact match: ₹${exactEntry.remaining.toFixed(2)} lent to ${p.name} (${exactEntry.title}, ${dStr})`
        });
      }
      const bal = balances[p.id] || 0;
      if (bal > 0.01 && Math.abs(bal - amount) <= 0.01) {
        balanceHits.push({
          person: p,
          reason: `Exact match: total owed by ${p.name} (₹${bal.toFixed(2)})`
        });
      }
    });

    if (entryHits.length === 1) return entryHits[0];
    if (balanceHits.length === 1) return balanceHits[0];
    if (entryHits.length > 0) return entryHits[0];
    if (balanceHits.length > 0) return balanceHits[0];
    return null;
  }

  openConfirmRepaymentModal(data) {
    if (!data || !this.dom.confirmRepaymentModal) return;
    this.detectedRepaymentData = data;

    const amt = parseFloat(data.amount) || 0;
    const sender = data.sender || 'Someone';
    const handle = data.counterpartyHandle || '';
    const suggestion = this.findRepaymentSuggestion(sender, handle, amt);

    if (this.dom.repaymentAmountDisplay) this.dom.repaymentAmountDisplay.textContent = `₹${amt.toFixed(2)}`;
    if (this.dom.repaymentAmountInput) this.dom.repaymentAmountInput.value = amt.toFixed(2);
    if (this.dom.repaymentSourceDetail) {
      this.dom.repaymentSourceDetail.textContent = handle && !sender.includes(handle)
        ? `Received from ${sender} (${handle})`
        : `Received from ${sender}`;
    }
    if (this.dom.repaymentNotesInput) this.dom.repaymentNotesInput.value = `Repayment from ${sender}`;

    if (this.dom.repaymentGuessBadge) {
      if (suggestion && suggestion.reason) {
        this.dom.repaymentGuessBadge.textContent = suggestion.reason;
        this.dom.repaymentGuessBadge.classList.remove('hidden');
      } else {
        this.dom.repaymentGuessBadge.classList.add('hidden');
      }
    }

    this.populateRepaymentContactsDropdown(sender, handle, amt, suggestion);
    this.updateRepaymentPreview();
    this.openModalElement(this.dom.confirmRepaymentModal);
  }

  populateRepaymentContactsDropdown(sender, handle, amount = 0, suggestion = null) {
    const select = this.dom.repaymentPersonSelect;
    if (!select) return;
    select.innerHTML = '';

    const identityMatch = this.findMatchingContact(sender, handle);
    const preferredMatch = identityMatch || (suggestion ? suggestion.person : null);
    if (this.ledger.people.length === 0) {
      select.innerHTML = '<option value="">No contacts yet. Save sender above.</option>';
      if (this.dom.repaymentSaveAliasRow) this.dom.repaymentSaveAliasRow.classList.add('hidden');
      return;
    }

    const canSaveAlias = !this.isGenericPaymentLabel(sender) && !this.isCommercialMerchantName(sender);
    if (this.dom.repaymentSaveAliasRow) {
      this.dom.repaymentSaveAliasRow.classList.toggle('hidden', !canSaveAlias);
      if (this.dom.repaymentSaveAliasText && canSaveAlias) {
        this.dom.repaymentSaveAliasText.textContent = `Link "${sender}" to selected contact for future payments`;
      }
      if (this.dom.repaymentSaveAliasCheck) {
        this.dom.repaymentSaveAliasCheck.checked = canSaveAlias && !identityMatch;
      }
    }

    const balances = this.calculateNetBalances();
    this.ledger.people.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const bal = balances[p.id] || 0;
      opt.textContent = `${p.name} (${bal > 0.01 ? `Owes ₹${bal.toFixed(2)}` : bal < -0.01 ? `You owe ₹${Math.abs(bal).toFixed(2)}` : 'Settled'})`;
      if (preferredMatch && p.id === preferredMatch.id) opt.selected = true;
      select.appendChild(opt);
    });

    if (!preferredMatch && select.options.length > 0) {
      const debtor = this.ledger.people.find(p => (balances[p.id] || 0) > 0);
      if (debtor) select.value = debtor.id;
    }
  }

  createContactFromRepayment() {
    if (!this.detectedRepaymentData) return;
    const rawSender = (this.detectedRepaymentData.sender || '').trim() || 'New Contact';
    const rawHandle = (this.detectedRepaymentData.counterpartyHandle || '').trim();
    const phoneDigits = this.normalizePhoneDigits(rawHandle || rawSender);
    const isPhone = phoneDigits.length === 10 && /^[6-9][0-9]{9}$/.test(phoneDigits);
    const isUpi = rawHandle.includes('@') && !rawHandle.startsWith('*');

    const created = {
      id: 'p_' + Date.now(),
      name: rawSender,
      relationship: 'Friend',
      phone: isPhone ? phoneDigits : null,
      upi: isUpi ? rawHandle : null,
      aliases: rawHandle && !isUpi ? [rawHandle] : [],
      createdAt: new Date().toISOString()
    };

    this.ledger.people.push(created);
    this.saveLedger();
    this.populateRepaymentContactsDropdown(rawSender, rawHandle);
    if (this.dom.repaymentPersonSelect) this.dom.repaymentPersonSelect.value = created.id;
    this.updateRepaymentPreview();
  }

  updateRepaymentPreview() {
    const preview = this.dom.repaymentBalancePreview;
    if (!preview) return;

    const personId = this.dom.repaymentPersonSelect?.value;
    const amount = parseFloat(this.dom.repaymentAmountInput?.value || 0) || 0;
    const person = this.ledger.people.find(p => p.id === personId);

    if (!person) {
      preview.innerHTML = '<div class="text-xs text-muted text-center">Select or create a contact above.</div>';
      return;
    }

    const currentDebt = this.calculateNetBalances()[person.id] || 0;
    const newDebt = currentDebt - amount;

    preview.innerHTML = `
      <div class="repayment-calc-row">
        <span>Current balance</span>
        <span class="repayment-calc-val tabular ${currentDebt > 0.01 ? 'owed' : currentDebt < -0.01 ? 'borrowed' : 'repaid'}">
          ${currentDebt > 0.01 ? `Owes ₹${currentDebt.toFixed(2)}` : currentDebt < -0.01 ? `You owe ₹${Math.abs(currentDebt).toFixed(2)}` : '₹0.00'}
        </span>
      </div>
      <div class="repayment-calc-row">
        <span>Incoming credit</span>
        <span class="repayment-calc-val repaid tabular">-₹${amount.toFixed(2)}</span>
      </div>
      <div class="repayment-calc-row total-row">
        <span>Updated balance</span>
        <span class="repayment-calc-val tabular ${Math.abs(newDebt) <= 0.01 ? 'repaid' : newDebt > 0.01 ? 'owed' : 'borrowed'}">
          ${newDebt < -0.01 ? `You owe ₹${Math.abs(newDebt).toFixed(2)}` : newDebt <= 0.01 ? 'Settled (₹0.00)' : `Owes ₹${newDebt.toFixed(2)}`}
        </span>
      </div>
    `;
  }

  handleConfirmRepaymentSubmit(e) {
    e.preventDefault();
    const personId = this.dom.repaymentPersonSelect?.value;
    const amount = parseFloat(this.dom.repaymentAmountInput?.value || 0) || 0;
    const notes = this.dom.repaymentNotesInput?.value.trim() || 'Repayment';

    if (!personId || amount <= 0) return;

    if (this.detectedRepaymentData && this.dom.repaymentSaveAliasCheck?.checked) {
      this.addAliasToPerson(
        personId,
        this.detectedRepaymentData.sender || '',
        this.detectedRepaymentData.counterpartyHandle || ''
      );
    }

    this.ledger.settlements.push({
      id: 's_' + Date.now(),
      direction: 'received',
      fromPersonId: personId,
      toPersonId: 'me',
      amount,
      date: new Date().toISOString(),
      paymentSource: 'Paytm / UPI',
      notes
    });

    this.saveLedger();
    if (this.detectedRepaymentData) this.dismissRepaymentData();
    this.closeConfirmRepaymentModal();
  }

  dismissRepaymentData() {
    if (this.detectedRepaymentData) {
      const sig = this.getRepaymentSignature(this.detectedRepaymentData);
      this.markRepaymentDismissed(sig);
      window.AndroidBridge?.dismissRepayment?.(sig);
      this.detectedRepaymentData = null;
    }
    window.AndroidBridge?.clearPendingRepayment?.();
  }

  closeConfirmRepaymentModal() {
    this.closeModalElement(this.dom.confirmRepaymentModal);
  }

  getRepaymentSignature(data) {
    if (!data) return '';
    const amt = (parseFloat(data.amount) || 0).toFixed(2);
    const sender = data.sender || '';
    const ts = data.postTime || data.timestamp || Math.floor(Date.now() / 2000);
    return `repay_${amt}_${sender}_${ts}`;
  }

  isRepaymentDismissed(data) {
    const sig = this.getRepaymentSignature(data);
    if (!sig) return false;
    try {
      const list = JSON.parse(localStorage.getItem('whosetab_dismissed_repayments_v2') || '[]');
      return list.includes(sig);
    } catch (e) {
      return false;
    }
  }

  markRepaymentDismissed(sig) {
    if (!sig) return;
    try {
      let list = JSON.parse(localStorage.getItem('whosetab_dismissed_repayments_v2') || '[]');
      if (!list.includes(sig)) {
        list.push(sig);
        if (list.length > 60) list = list.slice(-50);
        localStorage.setItem('whosetab_dismissed_repayments_v2', JSON.stringify(list));
      }
    } catch (e) {}
  }

  // ================= HARDWARE BACK BUTTON =================
  handleBackPress() {
    if (this.dom.shopLocationModal && !this.dom.shopLocationModal.classList.contains('hidden')) {
      this.closeShopLocationModal();
      return true;
    }
    if (this.dom.headerOverflowMenu && !this.dom.headerOverflowMenu.classList.contains('hidden')) {
      this.closeHeaderMenu();
      return true;
    }
    if (this.dom.recentDetectionsModal && !this.dom.recentDetectionsModal.classList.contains('hidden')) {
      this.closeRecentDetectionsModal();
      return true;
    }
    if (this.dom.activityDetailModal && !this.dom.activityDetailModal.classList.contains('hidden')) {
      this.closeActivityDetailModal();
      return true;
    }
    if (this.dom.personActionsModal && !this.dom.personActionsModal.classList.contains('hidden')) {
      this.closePersonActionsModal();
      return true;
    }
    if (this.dom.confirmRepaymentModal && !this.dom.confirmRepaymentModal.classList.contains('hidden')) {
      this.closeConfirmRepaymentModal();
      return true;
    }
    if (this.dom.editPersonModal && !this.dom.editPersonModal.classList.contains('hidden')) {
      this.closeEditPersonModal();
      return true;
    }
    if (this.dom.snapExpenseModal && !this.dom.snapExpenseModal.classList.contains('hidden')) {
      this.closeSnapModal();
      return true;
    }
    if (this.dom.addPersonModal && !this.dom.addPersonModal.classList.contains('hidden')) {
      this.closeAddPersonModal();
      return true;
    }
    if (this.dom.settleModal && !this.dom.settleModal.classList.contains('hidden')) {
      this.closeModalElement(this.dom.settleModal);
      return true;
    }
    if (this.dom.updateModal && !this.dom.updateModal.classList.contains('hidden')) {
      this.closeModalElement(this.dom.updateModal);
      return true;
    }
    if (this.dom.setupModal && !this.dom.setupModal.classList.contains('hidden')) {
      this.closeSetupModal();
      return true;
    }
    return false;
  }

  // ================= UPDATES & BACKUPS =================
  showUpdatePrompt(latestVersion, apkUrl, releaseNotes) {
    if (!this.dom.updateModal) return;
    this.dom.updateVersionTitle.textContent = `WhoseTab v${latestVersion}`;
    this.dom.updateReleaseNotes.textContent = releaseNotes || 'Latest updates and improvements.';
    this.dom.downloadUpdateBtn.dataset.apkUrl = apkUrl;
    this.dom.downloadUpdateBtn.disabled = false;
    this.dom.downloadUpdateBtn.textContent = 'Install Update';
    this.dom.updateProgressContainer?.classList.add('hidden');
    if (this.dom.updateProgressBar) this.dom.updateProgressBar.style.width = '0%';
    this.openModalElement(this.dom.updateModal);
  }

  onDownloadProgress(percent, currentMb, totalMb) {
    this.dom.updateProgressContainer?.classList.remove('hidden');
    if (this.dom.updateProgressBar) this.dom.updateProgressBar.style.width = `${percent}%`;
    if (this.dom.updateProgressText) this.dom.updateProgressText.textContent = `Downloading: ${percent}% (${currentMb} / ${totalMb} MB)`;
    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.disabled = true;
      this.dom.downloadUpdateBtn.textContent = `Downloading ${percent}%`;
    }
  }

  onDownloadCompleted() {
    if (this.dom.updateProgressBar) this.dom.updateProgressBar.style.width = '100%';
    if (this.dom.updateProgressText) this.dom.updateProgressText.textContent = 'Opening installer...';
    if (this.dom.downloadUpdateBtn) this.dom.downloadUpdateBtn.textContent = 'Installing...';
    setTimeout(() => this.closeModalElement(this.dom.updateModal), 2500);
  }

  onDownloadError(err) {
    if (this.dom.updateProgressText) this.dom.updateProgressText.textContent = `Failed: ${err}`;
    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.disabled = false;
      this.dom.downloadUpdateBtn.textContent = 'Retry';
    }
  }

  onUpToDate() {
    if (this.dom.updateStatusNotice) this.dom.updateStatusNotice.textContent = 'Up to date';
  }

  onUpdateError(err) {
    if (this.dom.updateStatusNotice) this.dom.updateStatusNotice.textContent = err;
  }

  async checkGitHubReleasesWeb() {
    try {
      const res = await fetch('https://api.github.com/repos/KHILVANSH/WhoseTab/releases/latest');
      if (!res.ok) {
        this.dom.updateStatusNotice.textContent = 'Could not reach update server';
        return;
      }
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace('v', '').trim();
      const apk = (data.assets || []).find(a => a.name.endsWith('.apk'));
      if (latestTag && apk) {
        this.showUpdatePrompt(latestTag, apk.browser_download_url, data.body);
        this.dom.updateStatusNotice.textContent = `Update available: v${latestTag}`;
      } else {
        this.onUpToDate();
      }
    } catch (e) {
      this.dom.updateStatusNotice.textContent = 'Update check failed';
    }
  }

  exportBackup() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.ledger, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whosetab_backup_${new Date().toISOString().slice(0, 10)}.json`);
    dl.click();
  }

  importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported.people) && Array.isArray(imported.expenses)) {
          this.ledger = {
            version: imported.version || 2,
            people: imported.people.map(p => ({ ...p, aliases: Array.isArray(p.aliases) ? p.aliases : [] })),
            expenses: imported.expenses,
            settlements: imported.settlements || [],
            settings: imported.settings || {}
          };
          this.saveLedger();
          alert('Backup restored.');
        } else {
          alert('Invalid backup file.');
        }
      } catch (err) {
        alert('Could not read JSON file.');
      }
    };
    reader.readAsText(file);
  }

  // ================= RENDERING =================
  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  render() {
    this.renderDashboard();
    this.renderPeoplePage();
  }

  renderDashboard() {
    const balances = this.calculateNetBalances();
    let totalCollect = 0;
    let totalOwe = 0;

    Object.values(balances).forEach(b => {
      if (b > 0.01) totalCollect += b;
      else if (b < -0.01) totalOwe += Math.abs(b);
    });
    const netBalance = Math.round((totalCollect - totalOwe) * 100) / 100;

    if (this.dom.heroBalanceLabel) {
      this.dom.heroBalanceLabel.textContent = netBalance > 0.01
        ? 'Net Owed to You'
        : netBalance < -0.01 ? 'Net You Owe' : 'Net Balance';
    }

    if (this.dom.totalOwedToMe) {
      const sign = netBalance < -0.01 ? '-' : '';
      this.dom.totalOwedToMe.textContent = `${sign}₹${Math.abs(netBalance).toFixed(2)}`;
      this.dom.totalOwedToMe.className = `hero-amount tabular ${netBalance > 0.01 ? 'has-owed' : netBalance < -0.01 ? 'has-owe' : ''}`;
    }

    if (this.dom.heroCollectSummary) {
      this.dom.heroCollectSummary.textContent = `Collect ₹${totalCollect.toFixed(2)}`;
    }
    if (this.dom.heroOweSummary) {
      this.dom.heroOweSummary.textContent = `Owe ₹${totalOwe.toFixed(2)}`;
    }

    const totalEntries = this.ledger.expenses.length + this.ledger.settlements.length;
    if (this.dom.heroExpenseCount) {
      this.dom.heroExpenseCount.textContent = `${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'}`;
    }
    if (this.dom.expenseCountBadge) {
      this.dom.expenseCountBadge.textContent = totalEntries;
    }

    // 1. Render Balances List
    this.dom.peopleList.innerHTML = '';
    let visiblePeople = this.ledger.people;
    if (this.dashboardBalanceMode === 'active') {
      const unsettled = this.ledger.people.filter(p => Math.abs(balances[p.id] || 0) > 0.01);
      visiblePeople = unsettled.length > 0 ? unsettled : this.ledger.people.slice(0, 4);
    }

    if (this.ledger.people.length === 0) {
      this.dom.peopleList.innerHTML = '<div class="list-empty-state">No contacts yet. Tap From Phone in People or the menu to add someone.</div>';
    } else if (visiblePeople.length === 0) {
      this.dom.peopleList.innerHTML = '<div class="list-empty-state">All balances settled.</div>';
    } else {
      const moreSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
      visiblePeople.forEach(p => {
        const bal = balances[p.id] || 0;
        const initial = p.name.charAt(0).toUpperCase();
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'person-row';
        row.innerHTML = `
          <div class="person-left">
            <div class="avatar-circle">${this.escapeHtml(initial)}</div>
            <div class="row-text-stack">
              <span class="row-primary-text">${this.escapeHtml(p.name)}</span>
              <span class="row-secondary-text">${this.escapeHtml(p.relationship)}${p.phone ? ` • ${this.escapeHtml(p.phone)}` : ''}</span>
            </div>
          </div>
          <div class="person-right">
            <div class="balance-stack">
              <span class="balance-amt tabular ${bal > 0.01 ? 'positive' : bal < -0.01 ? 'negative' : 'zero'}">
                ${bal > 0.01 ? `₹${bal.toFixed(2)}` : bal < -0.01 ? `-₹${Math.abs(bal).toFixed(2)}` : 'Settled'}
              </span>
              ${Math.abs(bal) > 0.01 ? `<span class="balance-sub">${bal > 0 ? 'Owes you' : 'You owe'}</span>` : ''}
            </div>
            <span class="row-more-icon" aria-hidden="true">${moreSvg}</span>
          </div>
        `;
        row.addEventListener('click', () => this.openPersonActionsModal(p.id));
        this.dom.peopleList.appendChild(row);
      });
    }

    // 2. Render Activity Feed
    this.dom.recentExpensesList.innerHTML = '';
    const combined = [
      ...this.ledger.expenses.map(e => ({ kind: 'expense', item: e, ts: new Date(e.date).getTime() || 0 })),
      ...this.ledger.settlements.map(s => ({ kind: 'repayment', item: s, ts: new Date(s.date).getTime() || 0 }))
    ].filter(entry => {
      if (this.activityFilter === 'all') return true;
      if (this.activityFilter === 'repayment') return entry.kind === 'repayment';
      if (entry.kind !== 'expense') return false;
      const isBorrow = entry.item.entryKind === 'borrowed' || (entry.item.paidById && entry.item.paidById !== 'me');
      return this.activityFilter === 'borrowed' ? isBorrow : !isBorrow;
    }).sort((a, b) => b.ts - a.ts);

    if (combined.length === 0) {
      this.dom.recentExpensesList.innerHTML = '<div class="list-empty-state">No entries recorded yet.</div>';
      return;
    }

    const receiptSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
    const borrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>';
    const checkSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    combined.slice(0, 25).forEach(entry => {
      const dateStr = new Date(entry.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'activity-row';

      if (entry.kind === 'expense') {
        const exp = entry.item;
        const isBorrow = exp.entryKind === 'borrowed' || (exp.paidById && exp.paidById !== 'me');
        const names = (exp.splits || []).map(s => {
          const p = this.ledger.people.find(person => person.id === s.personId);
          return p ? p.name.split(' ')[0] : 'Contact';
        }).join(', ');
        const tabAmt = (exp.splits || []).reduce((acc, s) => acc + (parseFloat(s.amountOwed) || 0), 0);
        const cpMeta = exp.counterpartyName && exp.counterpartyName.toLowerCase() !== (exp.title || '').toLowerCase()
          ? `${exp.counterpartyName} • `
          : '';

        row.innerHTML = `
          <div class="person-left">
            <span class="act-icon ${isBorrow ? 'is-borrowed' : 'is-lent'}">${isBorrow ? borrowSvg : receiptSvg}</span>
            <div class="row-text-stack">
              <span class="row-primary-text">${this.escapeHtml(exp.title)}</span>
              <span class="row-secondary-text">${this.escapeHtml(cpMeta)}${isBorrow ? `From ${this.escapeHtml(names)}` : this.escapeHtml(names)} • ${dateStr}</span>
            </div>
          </div>
          <div class="act-amount-col">
            <span class="act-amt tabular ${isBorrow ? 'borrowed' : 'owed'}">${isBorrow ? '-' : ''}₹${parseFloat(exp.totalAmount).toFixed(2)}</span>
            <span class="act-tag tabular">${isBorrow ? `You owe ₹${tabAmt.toFixed(2)}` : `Tab ₹${tabAmt.toFixed(2)}`}</span>
          </div>
        `;
        row.addEventListener('click', () => this.openActivityDetailModal('expense', exp.id));
      } else {
        const s = entry.item;
        const iPaidThem = s.fromPersonId === 'me' || s.direction === 'paid';
        const personId = iPaidThem ? s.toPersonId : s.fromPersonId;
        const p = this.ledger.people.find(person => person.id === personId);
        const name = p ? p.name : 'Contact';
        row.innerHTML = `
          <div class="person-left">
            <span class="act-icon is-repayment">${checkSvg}</span>
            <div class="row-text-stack">
              <span class="row-primary-text">${iPaidThem ? `You paid ${this.escapeHtml(name)}` : `${this.escapeHtml(name)} repaid`}</span>
              <span class="row-secondary-text">${this.escapeHtml(s.notes || 'Settlement')} • ${dateStr}</span>
            </div>
          </div>
          <div class="act-amount-col">
            <span class="act-amt repaid tabular">${iPaidThem ? '-' : '+'}₹${parseFloat(s.amount).toFixed(2)}</span>
            <span class="act-tag">Settled</span>
          </div>
        `;
        row.addEventListener('click', () => this.openActivityDetailModal('repayment', s.id));
      }

      this.dom.recentExpensesList.appendChild(row);
    });
  }

  renderPeoplePage() {
    if (!this.dom.contactsFullList) return;
    const balances = this.calculateNetBalances();
    this.dom.contactsFullList.innerHTML = '';

    const filtered = this.ledger.people.filter(p => {
      const bal = balances[p.id] || 0;
      if (this.currentFilter === 'unsettled' && Math.abs(bal) <= 0.01) return false;
      if (this.currentFilter !== 'all' && this.currentFilter !== 'unsettled' && p.relationship !== this.currentFilter) return false;
      if (this.peopleSearchQuery) {
        const aliasesText = Array.isArray(p.aliases) ? p.aliases.join(' ') : '';
        const hay = `${p.name} ${p.phone || ''} ${p.upi || ''} ${p.relationship} ${aliasesText}`.toLowerCase();
        if (!hay.includes(this.peopleSearchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      this.dom.contactsFullList.innerHTML = '<div class="list-empty-state">No matching contacts.</div>';
      return;
    }

    const moreSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>';

    filtered.forEach(p => {
      const bal = balances[p.id] || 0;
      const initial = p.name.charAt(0).toUpperCase();
      const aliasesText = Array.isArray(p.aliases) && p.aliases.length > 0 ? p.aliases.join(', ') : '';
      const metaDetails = [p.relationship, p.phone, p.upi, aliasesText].filter(Boolean).join(' • ');

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'person-row';
      row.innerHTML = `
        <div class="person-left">
          <div class="avatar-circle">${this.escapeHtml(initial)}</div>
          <div class="row-text-stack">
            <span class="row-primary-text">${this.escapeHtml(p.name)}</span>
            <span class="row-secondary-text">${this.escapeHtml(metaDetails)}</span>
          </div>
        </div>
        <div class="person-right">
          <div class="balance-stack">
            <span class="balance-amt tabular ${bal > 0.01 ? 'positive' : bal < -0.01 ? 'negative' : 'zero'}">
              ${bal > 0.01 ? `₹${bal.toFixed(2)}` : bal < -0.01 ? `-₹${Math.abs(bal).toFixed(2)}` : 'Settled'}
            </span>
            ${Math.abs(bal) > 0.01 ? `<span class="balance-sub">${bal > 0 ? 'Owes you' : 'You owe'}</span>` : ''}
          </div>
          <span class="row-more-icon" aria-hidden="true">${moreSvg}</span>
        </div>
      `;
      row.addEventListener('click', () => this.openPersonActionsModal(p.id));
      this.dom.contactsFullList.appendChild(row);
    });
  }

  // ================= GOOGLE MAPS SHOP LOCATION PICKER =================
  setSelectedEntryLocation(locObj) {
    if (!locObj || (!locObj.name && !locObj.mapsUrl)) {
      this.currentEntryLocation = null;
      this.dom.selectedLocationChip?.classList.add('hidden');
      this.dom.openLocationPickerBtn?.classList.remove('active');
      return;
    }

    this.currentEntryLocation = {
      name: (locObj.name || 'Shop Location').trim(),
      address: (locObj.address || '').trim(),
      lat: parseFloat(locObj.lat) || 0,
      lng: parseFloat(locObj.lng) || 0,
      mapsUrl: locObj.mapsUrl || this.buildMapsUrl(locObj)
    };

    if (this.dom.selectedLocationText) {
      this.dom.selectedLocationText.textContent = this.currentEntryLocation.address
        ? `${this.currentEntryLocation.name} • ${this.currentEntryLocation.address}`
        : this.currentEntryLocation.name;
    }
    this.dom.selectedLocationChip?.classList.remove('hidden');
    this.dom.openLocationPickerBtn?.classList.add('active');

    if (this.dom.snapTitle && !this.dom.snapTitle.value.trim()) {
      this.dom.snapTitle.value = this.currentEntryLocation.name;
    }
  }

  buildMapsUrl(locObj) {
    const lat = parseFloat(locObj?.lat) || 0;
    const lng = parseFloat(locObj?.lng) || 0;
    if (lat !== 0 || lng !== 0) {
      return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
    }
    const q = encodeURIComponent((locObj?.name || 'Shops near me').trim());
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  saveShopToDirectory(locObj) {
    if (!locObj || !locObj.name) return;
    if (!Array.isArray(this.ledger.savedShops)) this.ledger.savedShops = [];
    const key = locObj.name.trim().toLowerCase();
    this.ledger.savedShops = [
      {
        name: locObj.name.trim(),
        address: locObj.address || '',
        lat: locObj.lat || 0,
        lng: locObj.lng || 0,
        mapsUrl: locObj.mapsUrl || this.buildMapsUrl(locObj)
      },
      ...this.ledger.savedShops.filter(s => (s.name || '').trim().toLowerCase() !== key)
    ].slice(0, 40);
    this.saveLedger();
  }

  openShopLocationModal() {
    if (!this.dom.shopLocationModal) return;
    if (this.dom.shopSearchInput) this.dom.shopSearchInput.value = '';
    this.onlineShopResults = [];
    if (this.dom.shopLocationStatus) this.dom.shopLocationStatus.classList.add('hidden');
    this.renderShopResults();
    this.openModalElement(this.dom.shopLocationModal);
    if (this.nearbyShopsCache.length === 0) {
      this.requestNearbyShops();
    }
  }

  closeShopLocationModal() {
    this.closeModalElement(this.dom.shopLocationModal);
  }

  openSnapModalWithLocation(locObj) {
    this.openSnapModal(true, 'split');
    if (locObj) {
      this.setSelectedEntryLocation(locObj);
      if (this.dom.snapTitle) {
        this.dom.snapTitle.value = locObj.name || 'Shop Purchase';
      }
    }
  }

  requestNearbyShops() {
    if (!window.AndroidBridge?.requestNearbyShops) {
      if (this.dom.shopLocationStatus) {
        this.dom.shopLocationStatus.textContent = 'GPS lookup requires the Android app. Select a saved shop or type a name.';
        this.dom.shopLocationStatus.classList.remove('hidden');
      }
      return;
    }
    if (this.dom.shopLocationStatus) {
      this.dom.shopLocationStatus.textContent = 'Looking up nearby shops from device location...';
      this.dom.shopLocationStatus.classList.remove('hidden');
    }
    try {
      window.AndroidBridge.requestNearbyShops();
    } catch (e) {}
  }

  onNearbyShopsLoaded(lat, lng, shops) {
    this.lastGeoLat = parseFloat(lat) || 0;
    this.lastGeoLng = parseFloat(lng) || 0;
    this.nearbyShopsCache = Array.isArray(shops) ? shops : [];
    if (this.dom.shopLocationStatus) {
      if (this.nearbyShopsCache.length > 0) {
        this.dom.shopLocationStatus.classList.add('hidden');
      } else {
        this.dom.shopLocationStatus.textContent = 'No shops found right nearby. Type a shop name or open Google Maps.';
        this.dom.shopLocationStatus.classList.remove('hidden');
      }
    }
    this.renderShopResults();
  }

  onNearbyShopsError(message) {
    if (this.dom.shopLocationStatus) {
      this.dom.shopLocationStatus.textContent = message || 'Could not get location.';
      this.dom.shopLocationStatus.classList.remove('hidden');
    }
  }

  onShopSearchResults(shops) {
    this.onlineShopResults = Array.isArray(shops) ? shops : [];
    this.renderShopResults();
  }

  renderShopResults() {
    const container = this.dom.shopResultsList;
    if (!container) return;
    const q = (this.dom.shopSearchInput?.value || '').trim();
    const qLower = q.toLowerCase();

    const candidates = [];
    const seen = new Set();
    const pushUnique = (item, badge) => {
      if (!item || !item.name) return;
      const k = item.name.trim().toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      candidates.push({ ...item, badge });
    };

    if (q) {
      this.onlineShopResults.forEach(s => pushUnique(s, 'Maps Search'));
      (this.ledger.savedShops || [])
        .filter(s => `${s.name} ${s.address || ''}`.toLowerCase().includes(qLower))
        .forEach(s => pushUnique(s, 'Saved'));
      this.nearbyShopsCache
        .filter(s => `${s.name} ${s.address || ''}`.toLowerCase().includes(qLower))
        .forEach(s => pushUnique(s, 'Nearby'));
      pushUnique({
        name: q,
        address: 'Attach with Google Maps search link',
        lat: this.lastGeoLat || 0,
        lng: this.lastGeoLng || 0,
        mapsUrl: this.buildMapsUrl({ name: q, lat: this.lastGeoLat, lng: this.lastGeoLng })
      }, 'Use');
    } else {
      (this.ledger.savedShops || []).forEach(s => pushUnique(s, 'Saved'));
      this.nearbyShopsCache.forEach(s => pushUnique(s, 'Nearby'));
      this.ledger.expenses.forEach(exp => {
        if (exp.location && exp.location.name) pushUnique(exp.location, 'Recent');
      });
    }

    container.innerHTML = '';
    if (candidates.length === 0) {
      container.innerHTML = '<div class="list-empty-state">Tap Find Nearby or search above to pick a shop.</div>';
      return;
    }

    candidates.slice(0, 20).forEach(shop => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-result-item';
      btn.innerHTML = `
        <div class="shop-result-meta">
          <span class="shop-result-name">${this.escapeHtml(shop.name)}</span>
          <span class="shop-result-address">${this.escapeHtml(shop.address || 'Google Maps Pin')}</span>
        </div>
        <span class="chip">${this.escapeHtml(shop.badge || 'Select')}</span>
      `;
      btn.addEventListener('click', () => {
        this.setSelectedEntryLocation(shop);
        this.closeShopLocationModal();
      });
      container.appendChild(btn);
    });
  }

  openLocationInMaps(locObj) {
    if (!locObj) return;
    const name = locObj.name || '';
    const lat = parseFloat(locObj.lat) || 0;
    const lng = parseFloat(locObj.lng) || 0;
    if (window.AndroidBridge?.openGoogleMaps) {
      window.AndroidBridge.openGoogleMaps(name, lat, lng);
    } else {
      window.open(locObj.mapsUrl || this.buildMapsUrl(locObj), '_blank');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhoseTabApp();
});
