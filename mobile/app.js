/**
 * WhoseTab — Application Logic
 * Offline expense ledger, contact settlement tracker, and payment listener bridge.
 */

const STORAGE_KEY = 'whosetab_ledger_v1';
const THEME_KEY = 'whosetab_theme_preference';

class WhoseTabApp {
  constructor() {
    this.ledger = this.loadLedger();
    this.selectedPersonIds = new Set();
    this.manualSplits = new Map();
    this.detectedPaytmData = null;
    this.detectedRepaymentData = null;
    this.toastSelectedIds = new Set();

    this.currentFilter = 'all';
    this.peopleSearchQuery = '';
    this.dashboardBalanceMode = 'active'; // 'active' | 'all'
    this.activityFilter = 'all'; // 'all' | 'expense' | 'repayment'
    this.activeActionPersonId = null;
    this.activeDetailItem = null; // { kind: 'expense' | 'repayment', id: string }

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

  // ================= PERSISTENCE & NATIVE SYNC =================
  loadLedger() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.people)) {
          return {
            version: parsed.version || 1,
            people: parsed.people || [],
            expenses: parsed.expenses || [],
            settlements: parsed.settlements || [],
            settings: parsed.settings || { theme: 'dark' }
          };
        }
      }
    } catch (e) {
      console.warn('Could not read ledger storage', e);
    }
    return {
      version: 1,
      people: [],
      expenses: [],
      settlements: [],
      settings: { theme: 'dark' }
    };
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
          upi: p.upi || ''
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
        title: item.title || 'Purchase',
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
      menuAddContact: document.getElementById('menuAddContact'),
      menuPermissions: document.getElementById('menuPermissions'),
      menuTestOverlay: document.getElementById('menuTestOverlay'),
      menuExportData: document.getElementById('menuExportData'),
      menuImportData: document.getElementById('menuImportData'),
      menuCheckUpdates: document.getElementById('menuCheckUpdates'),

      totalOwedToMe: document.getElementById('totalOwedToMe'),
      activeDebtorsCount: document.getElementById('activeDebtorsCount'),
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

      personActionsModal: document.getElementById('personActionsModal'),
      actionPersonName: document.getElementById('actionPersonName'),
      actionPersonMeta: document.getElementById('actionPersonMeta'),
      actionPersonBalance: document.getElementById('actionPersonBalance'),
      actionSplitBtn: document.getElementById('actionSplitBtn'),
      actionSettleBtn: document.getElementById('actionSettleBtn'),
      actionEditPersonBtn: document.getElementById('actionEditPersonBtn'),
      closePersonActionsBtn: document.getElementById('closePersonActionsBtn'),

      activityDetailModal: document.getElementById('activityDetailModal'),
      closeActivityDetailBtn: document.getElementById('closeActivityDetailBtn'),
      detailTypeBadge: document.getElementById('detailTypeBadge'),
      detailTitle: document.getElementById('detailTitle'),
      detailAmount: document.getElementById('detailAmount'),
      detailTimestamp: document.getElementById('detailTimestamp'),
      detailSplitsContainer: document.getElementById('detailSplitsContainer'),
      deleteActivityEntryBtn: document.getElementById('deleteActivityEntryBtn'),
      doneActivityDetailBtn: document.getElementById('doneActivityDetailBtn'),

      snapExpenseModal: document.getElementById('snapExpenseModal'),
      closeSnapModalBtn: document.getElementById('closeSnapModalBtn'),
      snapExpenseForm: document.getElementById('snapExpenseForm'),
      snapFormError: document.getElementById('snapFormError'),
      snapAmount: document.getElementById('snapAmount'),
      snapTitle: document.getElementById('snapTitle'),
      modalPeopleChips: document.getElementById('modalPeopleChips'),
      selectAllPeopleBtn: document.getElementById('selectAllPeopleBtn'),
      clearAllPeopleBtn: document.getElementById('clearAllPeopleBtn'),
      selectedPeopleSummary: document.getElementById('selectedPeopleSummary'),
      snapMyShare: document.getElementById('snapMyShare'),
      clearMyShareBtn: document.getElementById('clearMyShareBtn'),
      preset100ThemBtn: document.getElementById('preset100ThemBtn'),
      presetSplitEvenBtn: document.getElementById('presetSplitEvenBtn'),
      summaryFriendsTotal: document.getElementById('summaryFriendsTotal'),
      summaryBreakdownList: document.getElementById('summaryBreakdownList'),
      submitSnapBtn: document.getElementById('submitSnapBtn'),

      addPersonModal: document.getElementById('addPersonModal'),
      closeAddPersonModalBtn: document.getElementById('closeAddPersonModalBtn'),
      addPersonForm: document.getElementById('addPersonForm'),
      personPhone: document.getElementById('personPhone'),

      editPersonModal: document.getElementById('editPersonModal'),
      closeEditPersonModalBtn: document.getElementById('closeEditPersonModalBtn'),
      editPersonForm: document.getElementById('editPersonForm'),
      editPersonId: document.getElementById('editPersonId'),
      editPersonName: document.getElementById('editPersonName'),
      editPersonPhone: document.getElementById('editPersonPhone'),
      editPersonUpi: document.getElementById('editPersonUpi'),
      deletePersonBtn: document.getElementById('deletePersonBtn'),

      settleModal: document.getElementById('settleModal'),
      closeSettleModalBtn: document.getElementById('closeSettleModalBtn'),
      settleForm: document.getElementById('settleForm'),
      settlePersonInfo: document.getElementById('settlePersonInfo'),
      settleAmount: document.getElementById('settleAmount'),
      settleNotes: document.getElementById('settleNotes'),

      confirmRepaymentModal: document.getElementById('confirmRepaymentModal'),
      closeConfirmRepaymentModalBtn: document.getElementById('closeConfirmRepaymentModalBtn'),
      confirmRepaymentForm: document.getElementById('confirmRepaymentForm'),
      repaymentAmountDisplay: document.getElementById('repaymentAmountDisplay'),
      repaymentSourceDetail: document.getElementById('repaymentSourceDetail'),
      repaymentPersonSelect: document.getElementById('repaymentPersonSelect'),
      repaymentBalancePreview: document.getElementById('repaymentBalancePreview'),
      repaymentAmountInput: document.getElementById('repaymentAmountInput'),
      repaymentNotesInput: document.getElementById('repaymentNotesInput'),
      dismissRepaymentBtn: document.getElementById('dismissRepaymentBtn'),

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
    this.dom.appVersionDisplay.textContent = 'v1.1.0';
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

  openSetupModal() {
    if (this.dom.setupModal) this.dom.setupModal.classList.remove('hidden');
  }

  closeSetupModal() {
    if (this.dom.setupModal) this.dom.setupModal.classList.add('hidden');
  }

  // ================= EVENT BINDING =================
  bindEvents() {
    // Overflow Menu Toggle
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

    if (this.dom.menuAddContact) {
      this.dom.menuAddContact.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.openAddPersonModal();
      });
    }
    if (this.dom.menuPermissions) {
      this.dom.menuPermissions.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.openSetupModal();
      });
    }
    if (this.dom.menuTestOverlay) {
      this.dom.menuTestOverlay.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.triggerQuickAddPreview();
      });
    }
    if (this.dom.menuExportData) {
      this.dom.menuExportData.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.exportBackup();
      });
    }
    if (this.dom.menuImportData) {
      this.dom.menuImportData.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.dom.importFileInput.click();
      });
    }
    if (this.dom.menuCheckUpdates) {
      this.dom.menuCheckUpdates.addEventListener('click', () => {
        this.closeHeaderMenu();
        this.triggerUpdateCheck();
      });
    }

    // Status Pill -> Opens Setup
    if (this.dom.scannerStatusBadge) {
      this.dom.scannerStatusBadge.addEventListener('click', () => this.openSetupModal());
    }

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

    // Settings Controls
    this.dom.themeDarkBtn?.addEventListener('click', () => this.setTheme('dark'));
    this.dom.themeLightBtn?.addEventListener('click', () => this.setTheme('light'));

    if (this.dom.detectionModeSelector) {
      let currentMode = 'overlay';
      if (window.AndroidBridge?.getDetectionMode) {
        currentMode = window.AndroidBridge.getDetectionMode() || 'overlay';
      } else {
        currentMode = localStorage.getItem('whosetab_detection_mode') || 'overlay';
      }
      this.dom.detectionModeSelector.value = currentMode;
      this.dom.detectionModeSelector.addEventListener('change', (e) => {
        const mode = e.target.value;
        localStorage.setItem('whosetab_detection_mode', mode);
        window.AndroidBridge?.setDetectionMode?.(mode);
      });
    }

    if (this.dom.paytmDelaySelector) {
      let currentDelay = 0;
      if (window.AndroidBridge?.getOpenDelay) {
        currentDelay = window.AndroidBridge.getOpenDelay();
      } else {
        currentDelay = parseInt(localStorage.getItem('whosetab_paytm_delay') || '0', 10);
      }
      this.dom.paytmDelaySelector.value = String(currentDelay);
      this.dom.paytmDelaySelector.addEventListener('change', (e) => {
        const delayMs = parseInt(e.target.value, 10);
        localStorage.setItem('whosetab_paytm_delay', String(delayMs));
        window.AndroidBridge?.setOpenDelay?.(delayMs);
      });
    }

    this.dom.testOverlaySettingsBtn?.addEventListener('click', () => this.triggerQuickAddPreview());
    this.dom.checkForUpdatesBtn?.addEventListener('click', () => this.triggerUpdateCheck());
    this.dom.closeUpdateModalBtn?.addEventListener('click', () => this.dom.updateModal.classList.add('hidden'));

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
        this.dom.updateModal.classList.add('hidden');
      }
    });

    // Bottom Navigation
    this.dom.navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.dom.navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const targetId = item.dataset.target;
        this.dom.tabViews.forEach(view => view.classList.toggle('active', view.id === targetId));
      });
    });

    // Bottom-Right In-App Quick Toast Actions
    this.dom.qtCloseBtn?.addEventListener('click', () => this.hideInAppQuickToast(true));
    this.dom.qtSecondaryBtn?.addEventListener('click', () => {
      if (this.detectedPaytmData) {
        const d = this.detectedPaytmData;
        this.hideInAppQuickToast(false);
        this.openSnapModalWithPaytm(d);
      }
    });
    this.dom.qtPrimaryBtn?.addEventListener('click', () => this.handleQuickToastAdd());

    // Add Expense Trigger & Sheet
    this.dom.openSnapModalBtn?.addEventListener('click', () => this.openSnapModal());
    this.dom.heroAddBtn?.addEventListener('click', () => this.openSnapModal());
    this.dom.closeSnapModalBtn?.addEventListener('click', () => this.closeSnapModal());
    this.dom.snapExpenseModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.snapExpenseModal) this.closeSnapModal();
    });

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
        this.openSnapModal(false);
      }
    });
    this.dom.actionSettleBtn?.addEventListener('click', () => {
      const pid = this.activeActionPersonId;
      this.closePersonActionsModal();
      if (pid) this.openSettleModal(pid);
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

    // Multi-Person Split Controls
    this.dom.selectAllPeopleBtn?.addEventListener('click', () => {
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
        this.showSnapError('Select at least one person first.');
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

    // Relationship segmented bar toggle highlight
    document.querySelectorAll('.segmented-bar').forEach(bar => {
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

    // Settle & Repayment Forms
    this.dom.closeSettleModalBtn?.addEventListener('click', () => this.dom.settleModal.classList.add('hidden'));
    this.dom.closeConfirmRepaymentModalBtn?.addEventListener('click', () => this.closeConfirmRepaymentModal());
    this.dom.dismissRepaymentBtn?.addEventListener('click', () => {
      this.dismissRepaymentData();
      this.closeConfirmRepaymentModal();
    });
    this.dom.confirmRepaymentForm?.addEventListener('submit', (e) => this.handleConfirmRepaymentSubmit(e));
    this.dom.repaymentPersonSelect?.addEventListener('change', () => this.updateRepaymentPreview());
    this.dom.repaymentAmountInput?.addEventListener('input', () => this.updateRepaymentPreview());

    this.dom.snapExpenseForm?.addEventListener('submit', (e) => this.handleSnapSubmit(e));
    this.dom.addPersonForm?.addEventListener('submit', (e) => this.handleAddPersonSubmit(e));
    this.dom.settleForm?.addEventListener('submit', (e) => this.handleSettleSubmit(e));

    // Backup & Reset
    this.dom.exportDataBtn?.addEventListener('click', () => this.exportBackup());
    this.dom.importDataBtn?.addEventListener('click', () => this.dom.importFileInput.click());
    this.dom.importFileInput?.addEventListener('change', (e) => this.importBackup(e));
    this.dom.clearDataBtn?.addEventListener('click', () => {
      if (confirm('Erase all saved expenses, balances, and contacts? This cannot be undone.')) {
        this.ledger = { version: 1, people: [], expenses: [], settlements: [], settings: {} };
        this.saveLedger();
      }
    });

    // Focus Re-checks
    window.addEventListener('focus', () => {
      this.checkScannerStatus();
      this.checkInitialSetup();
      this.drainQueuedNativeExpenses();
      this.checkClipboardForPaytm();
    });
  }

  closeHeaderMenu() {
    if (this.dom.headerOverflowMenu) this.dom.headerOverflowMenu.classList.add('hidden');
    if (this.dom.headerMoreBtn) this.dom.headerMoreBtn.setAttribute('aria-expanded', 'false');
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
    if (/\/(?:g|gm|kg|mo|yr)/i.test(text)) return null;
    const regex = /(?:paid|sent|transfer of|debited|rs\.?|inr|₹)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i;
    const match = text.match(regex);
    if (!match) return null;

    const amt = parseFloat(match[1].replace(/,/g, ''));
    if (!amt || amt <= 0) return null;

    let recipient = 'Merchant';
    const recMatch = text.match(/(?:to|at|for)\s+([A-Za-z0-9\s&'\.]+?)(?:\s+(?:successfully|via|on|ref|upi|txn|is successful|\.|$))/i);
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
    if (this.dom.qtAmountTitle) this.dom.qtAmountTitle.textContent = `Paid ₹${amt.toFixed(2)}`;
    if (this.dom.qtSubtitle) this.dom.qtSubtitle.textContent = data.recipient || 'Merchant';

    if (this.dom.qtContactsRow) {
      this.dom.qtContactsRow.innerHTML = '';
      if (this.ledger.people.length === 0) {
        this.dom.qtContactsRow.classList.add('hidden');
        if (this.dom.qtPrimaryBtn) this.dom.qtPrimaryBtn.textContent = 'Add Expense';
      } else {
        this.dom.qtContactsRow.classList.remove('hidden');
        this.ledger.people.forEach(p => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'qt-chip';
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

    const newExpense = {
      id: 'e_' + Date.now(),
      title: this.detectedPaytmData.recipient || 'Purchase',
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
    if (this.dom.inAppQuickToast) this.dom.inAppQuickToast.classList.add('hidden');
    if (markDismissed && this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }
    this.toastSelectedIds.clear();
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

  // ================= SPLIT MATH =================
  calculateCurrentSplits() {
    const total = parseFloat(this.dom.snapAmount.value) || 0;
    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';
    let myShare = rawMyShare !== '' ? parseFloat(rawMyShare) : 0;
    if (isNaN(myShare) || myShare < 0) myShare = 0;

    const selectedList = Array.from(this.selectedPersonIds)
      .map(id => this.ledger.people.find(p => p.id === id))
      .filter(Boolean);

    const friendsTotalPool = Math.max(0, total - myShare);

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
      total,
      myShare,
      friendsTotalPool,
      manualSum,
      hasManual: manualMap.size > 0,
      splits,
      selectedList
    };
  }

  updateAutoInputsInPlace(activePersonId) {
    const calc = this.calculateCurrentSplits();

    if (this.dom.summaryFriendsTotal) {
      this.dom.summaryFriendsTotal.textContent = `₹${calc.friendsTotalPool.toFixed(2)} to collect`;
    }

    if (!this.dom.summaryBreakdownList) return;

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

    if (this.dom.submitSnapBtn) {
      if (calc.friendsTotalPool > 0) {
        this.dom.submitSnapBtn.textContent = `Save Expense (₹${calc.friendsTotalPool.toFixed(2)})`;
      } else if (calc.total > 0) {
        this.dom.submitSnapBtn.textContent = `Save Expense (₹${calc.total.toFixed(2)})`;
      } else {
        this.dom.submitSnapBtn.textContent = 'Save Expense';
      }
    }
  }

  recalculateSplitBreakdown(rebuildList = true) {
    const calc = this.calculateCurrentSplits();
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
      this.dom.summaryFriendsTotal.textContent = `₹${calc.friendsTotalPool.toFixed(2)} to collect`;
    }

    const numFriends = this.selectedPersonIds.size;
    if (this.dom.selectedPeopleSummary) {
      if (numFriends === 0) {
        this.dom.selectedPeopleSummary.textContent = 'No people selected';
      } else {
        const names = calc.selectedList.map(p => p.name.split(' ')[0]).join(', ');
        this.dom.selectedPeopleSummary.textContent = `${numFriends} selected: ${names}`;
      }
    }

    if (this.dom.submitSnapBtn) {
      if (calc.friendsTotalPool > 0) {
        this.dom.submitSnapBtn.textContent = `Save Expense (₹${calc.friendsTotalPool.toFixed(2)})`;
      } else if (calc.total > 0) {
        this.dom.submitSnapBtn.textContent = `Save Expense (₹${calc.total.toFixed(2)})`;
      } else {
        this.dom.submitSnapBtn.textContent = 'Save Expense';
      }
    }

    if (!rebuildList) {
      this.updateAutoInputsInPlace(null);
      return;
    }

    if (!this.dom.summaryBreakdownList) return;
    if (numFriends === 0) {
      this.dom.summaryBreakdownList.innerHTML = '<div class="text-xs text-muted mt-2">Select contacts above to split amount.</div>';
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

    const resetAllBtn = document.getElementById('resetAllSplitsBtn');
    resetAllBtn?.addEventListener('click', () => {
      this.manualSplits.clear();
      this.recalculateSplitBreakdown(true);
    });
  }

  // ================= MODAL HANDLERS =================
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

  openSnapModal(resetPeople = true) {
    if (resetPeople) this.selectedPersonIds.clear();
    this.manualSplits.clear();
    this.hideSnapError();
    this.dom.snapAmount.value = '';
    this.dom.snapTitle.value = '';
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown(true);
    this.dom.snapExpenseModal.classList.remove('hidden');
    setTimeout(() => this.dom.snapAmount.focus(), 100);
  }

  openSnapModalWithPaytm(data) {
    if (!data) return;
    this.selectedPersonIds.clear();
    this.manualSplits.clear();
    this.hideSnapError();
    this.dom.snapAmount.value = data.amount || '';
    this.dom.snapTitle.value = data.recipient ? data.recipient : 'Purchase';
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';

    if (data.suggestedCategory) {
      const radio = document.querySelector(`input[name="category"][value="${data.suggestedCategory}"]`);
      if (radio) radio.checked = true;
    }

    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown(true);
    this.dom.snapExpenseModal.classList.remove('hidden');
    const sheet = this.dom.snapExpenseModal.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  closeSnapModal() {
    this.dom.snapExpenseModal.classList.add('hidden');
    this.hideSnapError();
    this.manualSplits.clear();
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
        if (this.selectedPersonIds.has(p.id)) {
          this.selectedPersonIds.delete(p.id);
          this.manualSplits.delete(p.id);
          chip.classList.remove('selected');
        } else {
          this.selectedPersonIds.add(p.id);
          chip.classList.add('selected');
        }
        this.hideSnapError();
        this.recalculateSplitBreakdown(true);
      });
      this.dom.modalPeopleChips.appendChild(chip);
    });

    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'person-chip add-chip';
    addChip.textContent = '+ Add Contact';
    addChip.addEventListener('click', () => this.openAddPersonModal());
    this.dom.modalPeopleChips.appendChild(addChip);
  }

  handleSnapSubmit(e) {
    e.preventDefault();
    this.hideSnapError();

    const amount = parseFloat(this.dom.snapAmount.value);
    const title = this.dom.snapTitle.value.trim() || 'Purchase';
    const category = document.querySelector('input[name="category"]:checked')?.value || 'General';

    if (!amount || amount <= 0) {
      this.showSnapError('Enter a valid amount.');
      return;
    }
    if (this.selectedPersonIds.size === 0) {
      this.showSnapError('Select who to split this expense with.');
      return;
    }

    const calc = this.calculateCurrentSplits();
    if (calc.myShare > amount) {
      this.showSnapError(`Your share (₹${calc.myShare.toFixed(2)}) exceeds total (₹${amount.toFixed(2)}).`);
      return;
    }

    const splitsSum = calc.splits.reduce((acc, s) => acc + s.amount, 0);
    if (calc.hasManual && Math.abs((splitsSum + calc.myShare) - amount) > 0.05) {
      this.showSnapError(`Split total (₹${(splitsSum + calc.myShare).toFixed(2)}) does not match ₹${amount.toFixed(2)}.`);
      return;
    }

    const splits = calc.splits.map(s => ({
      personId: s.person.id,
      amountOwed: Math.round(s.amount * 100) / 100
    }));

    const newExpense = {
      id: 'e_' + Date.now(),
      title,
      totalAmount: amount,
      paidById: 'me',
      splitType: calc.myShare > 0 || calc.hasManual ? 'Split' : 'BoughtForPerson',
      splits,
      category,
      paymentSource: 'Paytm',
      date: new Date().toISOString(),
      myShare: calc.myShare
    };

    this.ledger.expenses.unshift(newExpense);
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
    this.dom.addPersonModal?.classList.remove('hidden');
    setTimeout(() => document.getElementById('personName')?.focus(), 100);
  }

  closeAddPersonModal() {
    this.dom.addPersonModal?.classList.add('hidden');
  }

  handleAddPersonSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('personName')?.value.trim() || '';
    const phone = document.getElementById('personPhone')?.value.trim() || '';
    const rel = document.querySelector('input[name="relationship"]:checked')?.value || 'Friend';
    const upi = document.getElementById('personUpi')?.value.trim() || '';

    if (!name) return;

    const newPerson = {
      id: 'p_' + Date.now(),
      name,
      relationship: rel,
      phone: phone || null,
      upi: upi || null,
      createdAt: new Date().toISOString()
    };

    this.ledger.people.push(newPerson);
    this.saveLedger();
    this.dom.addPersonForm.reset();
    document.querySelectorAll('#addPersonModal .seg-option').forEach((opt, i) => opt.classList.toggle('active', i === 0));
    this.closeAddPersonModal();

    if (!this.dom.snapExpenseModal.classList.contains('hidden')) {
      this.selectedPersonIds.add(newPerson.id);
      this.renderModalPeopleChips();
      this.recalculateSplitBreakdown(true);
    }
  }

  openPersonActionsModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person || !this.dom.personActionsModal) return;

    this.activeActionPersonId = personId;
    const balances = this.calculateNetBalances();
    const bal = balances[personId] || 0;

    if (this.dom.actionPersonName) this.dom.actionPersonName.textContent = person.name;
    const meta = [person.relationship, person.phone, person.upi].filter(Boolean).join(' • ');
    if (this.dom.actionPersonMeta) this.dom.actionPersonMeta.textContent = meta || person.relationship;

    if (this.dom.actionPersonBalance) {
      this.dom.actionPersonBalance.textContent = bal > 0.01
        ? `Owes ₹${bal.toFixed(2)}`
        : bal < -0.01 ? `Owe ₹${Math.abs(bal).toFixed(2)}` : 'Settled';
      this.dom.actionPersonBalance.className = `action-person-bal tabular ${bal > 0.01 ? 'text-success' : bal < -0.01 ? 'text-danger' : 'text-muted'}`;
    }

    this.dom.personActionsModal.classList.remove('hidden');
  }

  closePersonActionsModal() {
    this.dom.personActionsModal?.classList.add('hidden');
    this.activeActionPersonId = null;
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

    this.dom.editPersonModal.classList.remove('hidden');
  }

  closeEditPersonModal() {
    this.dom.editPersonModal?.classList.add('hidden');
  }

  handleEditPersonSubmit(e) {
    e.preventDefault();
    const id = this.dom.editPersonId?.value;
    const person = this.ledger.people.find(p => p.id === id);
    if (!person) return;

    const name = this.dom.editPersonName?.value.trim() || '';
    if (!name) return;

    person.name = name;
    person.phone = this.dom.editPersonPhone?.value.trim() || null;
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

    if (kind === 'expense') {
      const exp = this.ledger.expenses.find(e => e.id === id);
      if (!exp) return;

      this.dom.detailTypeBadge.textContent = exp.category || 'Expense';
      this.dom.detailTypeBadge.className = 'eyebrow-tag';
      this.dom.detailTitle.textContent = exp.title;
      this.dom.detailAmount.textContent = `₹${exp.totalAmount.toFixed(2)}`;
      this.dom.detailTimestamp.textContent = new Date(exp.date).toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      let html = '';
      exp.splits.forEach(s => {
        const person = this.ledger.people.find(p => p.id === s.personId);
        const name = person ? person.name : 'Former Contact';
        html += `
          <div class="settings-row">
            <span class="row-title">${this.escapeHtml(name)}</span>
            <span class="balance-amt positive tabular">₹${parseFloat(s.amountOwed).toFixed(2)}</span>
          </div>
        `;
      });
      if (exp.myShare && exp.myShare > 0) {
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

      const person = this.ledger.people.find(p => p.id === s.fromPersonId);
      const name = person ? person.name : 'Contact';
      this.dom.detailTypeBadge.textContent = 'Settlement';
      this.dom.detailTypeBadge.className = 'eyebrow-tag text-success';
      this.dom.detailTitle.textContent = `Repayment from ${name}`;
      this.dom.detailAmount.textContent = `+₹${s.amount.toFixed(2)}`;
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

    this.dom.activityDetailModal.classList.remove('hidden');
  }

  closeActivityDetailModal() {
    this.dom.activityDetailModal?.classList.add('hidden');
    this.activeDetailItem = null;
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

  // ================= SETTLE UP & REPAYMENT MATCHING =================
  calculateNetBalances() {
    const balances = {};
    this.ledger.people.forEach(p => { balances[p.id] = 0; });

    this.ledger.expenses.forEach(exp => {
      if (exp.paidById === 'me') {
        exp.splits.forEach(split => {
          if (split.personId !== 'me') {
            balances[split.personId] = (balances[split.personId] || 0) + split.amountOwed;
          }
        });
      }
    });

    this.ledger.settlements.forEach(s => {
      if (s.toPersonId === 'me') {
        balances[s.fromPersonId] = (balances[s.fromPersonId] || 0) - s.amount;
      }
    });

    Object.keys(balances).forEach(k => {
      balances[k] = Math.round(balances[k] * 100) / 100;
    });
    return balances;
  }

  openSettleModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) return;
    const bal = this.calculateNetBalances()[personId] || 0;

    this.dom.settlePersonInfo.innerHTML = `
      <div class="settings-row">
        <span class="row-title">${this.escapeHtml(person.name)}</span>
        <span class="balance-amt ${bal > 0 ? 'positive' : 'zero'} tabular">Owes ₹${bal.toFixed(2)}</span>
      </div>
    `;

    this.dom.settleAmount.value = bal > 0 ? bal.toFixed(2) : '';
    this.dom.settleForm.dataset.personId = personId;
    this.dom.settleModal.classList.remove('hidden');
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

    this.ledger.settlements.push({
      id: 's_' + Date.now(),
      fromPersonId: personId,
      toPersonId: 'me',
      amount,
      date: new Date().toISOString(),
      paymentSource: 'UPI',
      notes
    });

    this.saveLedger();
    this.dom.settleForm.reset();
    this.dom.settleModal.classList.add('hidden');
  }

  findMatchingContact(sender) {
    if (!sender || !this.ledger.people.length) return null;
    const s = sender.trim().toLowerCase();

    const digits = s.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      const p = this.ledger.people.find(person => person.phone && person.phone.replace(/[^0-9]/g, '').endsWith(digits.slice(-10)));
      if (p) return p;
    }

    const pUpi = this.ledger.people.find(person => {
      if (!person.upi) return false;
      const u = person.upi.toLowerCase();
      return s.includes(u) || u.includes(s);
    });
    if (pUpi) return pUpi;

    const norm = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanS = norm(s);

    let pName = this.ledger.people.find(person => norm(person.name) === cleanS);
    if (pName) return pName;

    pName = this.ledger.people.find(person => {
      const first = norm(person.name.split(' ')[0]);
      return cleanS.includes(first) || first.includes(cleanS.split(' ')[0]);
    });
    if (pName) return pName;

    pName = this.ledger.people.find(person => {
      const na = norm(person.name).replace(/h/g, '');
      const nb = cleanS.replace(/h/g, '');
      return na === nb || na.includes(nb) || nb.includes(na);
    });
    return pName || null;
  }

  openConfirmRepaymentModal(data) {
    if (!data || !this.dom.confirmRepaymentModal) return;
    this.detectedRepaymentData = data;

    const amt = parseFloat(data.amount) || 0;
    const sender = data.sender || 'Someone';

    if (this.dom.repaymentAmountDisplay) this.dom.repaymentAmountDisplay.textContent = `₹${amt.toFixed(2)}`;
    if (this.dom.repaymentAmountInput) this.dom.repaymentAmountInput.value = amt.toFixed(2);
    if (this.dom.repaymentSourceDetail) this.dom.repaymentSourceDetail.textContent = `Received from ${sender}`;
    if (this.dom.repaymentNotesInput) this.dom.repaymentNotesInput.value = `Repayment from ${sender}`;

    const select = this.dom.repaymentPersonSelect;
    if (select) {
      select.innerHTML = '';
      if (this.ledger.people.length === 0) {
        select.innerHTML = '<option value="">No contacts available</option>';
      } else {
        const matched = this.findMatchingContact(sender);
        const balances = this.calculateNetBalances();

        this.ledger.people.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          const bal = balances[p.id] || 0;
          opt.textContent = `${p.name} — ${bal > 0 ? `Owes ₹${bal.toFixed(2)}` : 'Settled'}`;
          if (matched && p.id === matched.id) opt.selected = true;
          select.appendChild(opt);
        });

        if (!matched && select.options.length > 0) {
          const debtor = this.ledger.people.find(p => (balances[p.id] || 0) > 0);
          if (debtor) select.value = debtor.id;
        }
      }
    }

    this.updateRepaymentPreview();
    this.dom.confirmRepaymentModal.classList.remove('hidden');
  }

  updateRepaymentPreview() {
    const preview = this.dom.repaymentBalancePreview;
    if (!preview) return;

    const personId = this.dom.repaymentPersonSelect?.value;
    const amount = parseFloat(this.dom.repaymentAmountInput?.value || 0) || 0;
    const person = this.ledger.people.find(p => p.id === personId);

    if (!person) {
      preview.innerHTML = '<div class="text-xs text-muted text-center">Select a contact to preview balance.</div>';
      return;
    }

    const currentDebt = this.calculateNetBalances()[person.id] || 0;
    const newDebt = currentDebt - amount;

    preview.innerHTML = `
      <div class="repayment-calc-row">
        <span>Current balance</span>
        <span class="repayment-calc-val tabular ${currentDebt > 0 ? 'negative' : 'positive'}">
          ${currentDebt > 0 ? `Owes ₹${currentDebt.toFixed(2)}` : '₹0.00'}
        </span>
      </div>
      <div class="repayment-calc-row">
        <span>Repayment</span>
        <span class="repayment-calc-val positive tabular">-₹${amount.toFixed(2)}</span>
      </div>
      <div class="repayment-calc-row total-row">
        <span>Updated balance</span>
        <span class="repayment-calc-val tabular ${newDebt <= 0 ? 'positive' : 'negative'}">
          ${newDebt <= 0 ? (newDebt < -0.01 ? `Credit ₹${Math.abs(newDebt).toFixed(2)}` : 'Settled (₹0.00)') : `Owes ₹${newDebt.toFixed(2)}`}
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

    this.ledger.settlements.push({
      id: 's_' + Date.now(),
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
    this.dom.confirmRepaymentModal?.classList.add('hidden');
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
    if (this.dom.headerOverflowMenu && !this.dom.headerOverflowMenu.classList.contains('hidden')) {
      this.closeHeaderMenu();
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
      this.dom.settleModal.classList.add('hidden');
      return true;
    }
    if (this.dom.updateModal && !this.dom.updateModal.classList.contains('hidden')) {
      this.dom.updateModal.classList.add('hidden');
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
    this.dom.updateModal.classList.remove('hidden');
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
    setTimeout(() => this.dom.updateModal?.classList.add('hidden'), 2500);
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
            version: imported.version || 1,
            people: imported.people,
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
    let netOwed = 0;
    let activeCount = 0;

    Object.values(balances).forEach(b => {
      netOwed += b;
      if (Math.abs(b) > 0.01) activeCount++;
    });

    if (this.dom.totalOwedToMe) {
      this.dom.totalOwedToMe.textContent = `₹${netOwed.toFixed(2)}`;
      this.dom.totalOwedToMe.className = `hero-amount tabular ${netOwed > 0.01 ? 'has-owed' : ''}`;
    }

    if (this.dom.activeDebtorsCount) {
      this.dom.activeDebtorsCount.textContent = `${activeCount} active ${activeCount === 1 ? 'tab' : 'tabs'}`;
    }

    const totalEntries = this.ledger.expenses.length + this.ledger.settlements.length;
    if (this.dom.heroExpenseCount) {
      this.dom.heroExpenseCount.textContent = `${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'}`;
    }
    if (this.dom.expenseCountBadge) {
      this.dom.expenseCountBadge.textContent = totalEntries;
    }

    // 1. Render Balances List (Unsettled vs All)
    this.dom.peopleList.innerHTML = '';
    let visiblePeople = this.ledger.people;
    if (this.dashboardBalanceMode === 'active') {
      const unsettled = this.ledger.people.filter(p => Math.abs(balances[p.id] || 0) > 0.01);
      visiblePeople = unsettled.length > 0 ? unsettled : this.ledger.people.slice(0, 4);
    }

    if (this.ledger.people.length === 0) {
      this.dom.peopleList.innerHTML = '<div class="list-empty-state">No contacts added yet. Open the menu or People tab to add someone.</div>';
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
              <span class="row-secondary-text">${this.escapeHtml(p.relationship)}</span>
            </div>
          </div>
          <div class="person-right">
            <div class="balance-stack">
              <span class="balance-amt tabular ${bal > 0.01 ? 'positive' : bal < -0.01 ? 'negative' : 'zero'}">
                ${bal > 0.01 ? `₹${bal.toFixed(2)}` : bal < -0.01 ? `-₹${Math.abs(bal).toFixed(2)}` : 'Settled'}
              </span>
              ${Math.abs(bal) > 0.01 ? `<span class="balance-sub">${bal > 0 ? 'Owes you' : 'Overpaid'}</span>` : ''}
            </div>
            <span class="row-more-icon" aria-hidden="true">${moreSvg}</span>
          </div>
        `;
        row.addEventListener('click', () => this.openPersonActionsModal(p.id));
        this.dom.peopleList.appendChild(row);
      });
    }

    // 2. Render Unified Chronological Activity Feed (Expenses + Settlements)
    this.dom.recentExpensesList.innerHTML = '';
    const combined = [
      ...this.ledger.expenses.map(e => ({ kind: 'expense', item: e, ts: new Date(e.date).getTime() || 0 })),
      ...this.ledger.settlements.map(s => ({ kind: 'repayment', item: s, ts: new Date(s.date).getTime() || 0 }))
    ].filter(entry => this.activityFilter === 'all' || entry.kind === this.activityFilter)
     .sort((a, b) => b.ts - a.ts);

    if (combined.length === 0) {
      this.dom.recentExpensesList.innerHTML = '<div class="list-empty-state">No activity recorded yet.</div>';
      return;
    }

    const receiptSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
    const checkSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    combined.slice(0, 20).forEach(entry => {
      const dateStr = new Date(entry.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'activity-row';

      if (entry.kind === 'expense') {
        const exp = entry.item;
        const names = exp.splits.map(s => {
          const p = this.ledger.people.find(person => person.id === s.personId);
          return p ? p.name.split(' ')[0] : 'Contact';
        }).join(', ');
        const collectAmt = exp.splits.reduce((acc, s) => acc + (parseFloat(s.amountOwed) || 0), 0);

        row.innerHTML = `
          <div class="person-left">
            <span class="act-icon">${receiptSvg}</span>
            <div class="row-text-stack">
              <span class="row-primary-text">${this.escapeHtml(exp.title)}</span>
              <span class="row-secondary-text">${this.escapeHtml(names)} • ${dateStr}</span>
            </div>
          </div>
          <div class="act-amount-col">
            <span class="act-amt tabular">₹${parseFloat(exp.totalAmount).toFixed(2)}</span>
            <span class="act-tag tabular">Tab ₹${collectAmt.toFixed(2)}</span>
          </div>
        `;
        row.addEventListener('click', () => this.openActivityDetailModal('expense', exp.id));
      } else {
        const s = entry.item;
        const p = this.ledger.people.find(person => person.id === s.fromPersonId);
        const name = p ? p.name : 'Contact';
        row.innerHTML = `
          <div class="person-left">
            <span class="act-icon is-repayment">${checkSvg}</span>
            <div class="row-text-stack">
              <span class="row-primary-text">${this.escapeHtml(name)} repaid</span>
              <span class="row-secondary-text">${this.escapeHtml(s.notes || 'Settlement')} • ${dateStr}</span>
            </div>
          </div>
          <div class="act-amount-col">
            <span class="act-amt repaid tabular">+₹${parseFloat(s.amount).toFixed(2)}</span>
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
        const hay = `${p.name} ${p.phone || ''} ${p.upi || ''} ${p.relationship}`.toLowerCase();
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
      const metaDetails = [p.relationship, p.phone, p.upi].filter(Boolean).join(' • ');

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
          </div>
          <span class="row-more-icon" aria-hidden="true">${moreSvg}</span>
        </div>
      `;
      row.addEventListener('click', () => this.openPersonActionsModal(p.id));
      this.dom.contactsFullList.appendChild(row);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhoseTabApp();
});
