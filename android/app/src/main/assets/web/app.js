/**
 * WhoseTab — Mobile Application Logic
 * Offline-first peer expense manager & background Paytm payment sniffer.
 */

const STORAGE_KEY = 'whosetab_ledger_v1';
const THEME_KEY = 'whosetab_theme_preference';

class WhoseTabApp {
  constructor() {
    this.ledger = this.loadLedger();
    this.selectedPersonIds = new Set();
    this.manualSplits = new Map();
    this.detectedPaytmData = null;
    this.currentFilter = 'all';

    this.initElements();
    this.initTheme();
    this.initAppVersion();
    this.bindEvents();
    this.checkScannerStatus();
    this.checkInitialSetup();
    this.checkUrlParameters();
    this.checkPendingPayment();
    this.render();
  }

  loadLedger() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.people)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not read from localStorage', e);
    }
    // Clean initial ledger without dummy data
    return {
      version: 1,
      people: [],
      expenses: [],
      settlements: [],
      settings: {
        theme: 'dark'
      }
    };
  }

  saveLedger() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ledger));
    } catch (e) {
      console.error('Error saving to localStorage', e);
    }
    this.render();
  }

  initElements() {
    this.dom = {
      themeQuickToggleBtn: document.getElementById('themeQuickToggleBtn'),
      themeSelector: document.getElementById('themeSelector'),
      paytmDelaySelector: document.getElementById('paytmDelaySelector'),
      
      scannerStatusBadge: document.getElementById('scannerStatusBadge'),
      scannerStatusText: document.getElementById('scannerStatusText'),

      paytmNotificationBanner: document.getElementById('paytmNotificationBanner'),
      paytmBannerBody: document.getElementById('paytmBannerBody'),
      paytmBannerDetail: document.getElementById('paytmBannerDetail'),
      paytmSnapBtn: document.getElementById('paytmSnapBtn'),
      paytmDismissBtn: document.getElementById('paytmDismissBtn'),

      repaymentNotificationBanner: document.getElementById('repaymentNotificationBanner'),
      repaymentBannerBody: document.getElementById('repaymentBannerBody'),
      repaymentBannerDetail: document.getElementById('repaymentBannerDetail'),
      repaymentConfirmActionBtn: document.getElementById('repaymentConfirmActionBtn'),
      repaymentDismissBannerBtn: document.getElementById('repaymentDismissBannerBtn'),

      totalOwedToMe: document.getElementById('totalOwedToMe'),
      totalIOwe: document.getElementById('totalIOwe'),
      activeDebtorsCount: document.getElementById('activeDebtorsCount'),
      expenseCountBadge: document.getElementById('expenseCountBadge'),
      peopleList: document.getElementById('peopleList'),
      recentExpensesList: document.getElementById('recentExpensesList'),
      contactsFullList: document.getElementById('contactsFullList'),

      navItems: document.querySelectorAll('.bottom-nav .nav-item'),
      tabViews: document.querySelectorAll('.tab-view'),
      filterChips: document.querySelectorAll('.filter-chips .chip'),

      openSnapModalBtn: document.getElementById('openSnapModalBtn'),
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
      splitBreakdownCard: document.getElementById('splitBreakdownCard'),
      summaryFriendsTotal: document.getElementById('summaryFriendsTotal'),
      summaryBreakdownList: document.getElementById('summaryBreakdownList'),
      submitSnapBtn: document.getElementById('submitSnapBtn'),

      quickAddPersonBtn: document.getElementById('quickAddPersonBtn'),
      addPersonPageBtn: document.getElementById('addPersonPageBtn'),
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
      confirmRepaymentBtn: document.getElementById('confirmRepaymentBtn'),
      dismissRepaymentBtn: document.getElementById('dismissRepaymentBtn'),

      grantNotificationAccessBtn: document.getElementById('grantNotificationAccessBtn'),
      grantOverlayAccessBtn: document.getElementById('grantOverlayAccessBtn'),

      setupModal: document.getElementById('setupModal'),
      closeSetupModalBtn: document.getElementById('closeSetupModalBtn'),
      setupStepNotif: document.getElementById('setupStepNotif'),
      setupGrantNotifBtn: document.getElementById('setupGrantNotifBtn'),
      setupStepOverlay: document.getElementById('setupStepOverlay'),
      setupGrantOverlayBtn: document.getElementById('setupGrantOverlayBtn'),
      completeSetupBtn: document.getElementById('completeSetupBtn'),
      skipSetupBtn: document.getElementById('skipSetupBtn'),

      checkForUpdatesBtn: document.getElementById('checkForUpdatesBtn'),
      appVersionDisplay: document.getElementById('appVersionDisplay'),
      updateStatusNotice: document.getElementById('updateStatusNotice'),
      updateModal: document.getElementById('updateModal'),
      closeUpdateModalBtn: document.getElementById('closeUpdateModalBtn'),
      updateVersionTitle: document.getElementById('updateVersionTitle'),
      updateReleaseNotes: document.getElementById('updateReleaseNotes'),
      updateProgressContainer: document.getElementById('updateProgressContainer'),
      updateProgressBar: document.getElementById('updateProgressBar'),
      updateProgressText: document.getElementById('updateProgressText'),
      downloadUpdateBtn: document.getElementById('downloadUpdateBtn'),

      exportDataBtn: document.getElementById('exportDataBtn'),
      importDataBtn: document.getElementById('importDataBtn'),
      importFileInput: document.getElementById('importFileInput'),
      clearDataBtn: document.getElementById('clearDataBtn'),
    };
  }

  // ================= THEME CONTROLLER (DARK & LIGHT ONLY) =================
  initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    this.setTheme(savedTheme, false);
    if (this.dom.themeSelector) {
      this.dom.themeSelector.value = savedTheme;
    }
  }

  setTheme(theme, save = true) {
    const activeTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
    if (save) {
      localStorage.setItem(THEME_KEY, activeTheme);
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
    if (this.dom.themeSelector) {
      this.dom.themeSelector.value = next;
    }
  }

  // ================= VERSION VIEWER =================
  initAppVersion() {
    if (this.dom.appVersionDisplay) {
      if (window.AndroidBridge && window.AndroidBridge.getAppVersion) {
        try {
          const ver = window.AndroidBridge.getAppVersion();
          if (ver) {
            this.dom.appVersionDisplay.textContent = 'v' + ver;
            return;
          }
        } catch (e) {}
      }
      this.dom.appVersionDisplay.textContent = 'v1.0.9';
    }
  }

  // ================= SCANNER STATUS IN NAVBAR =================
  checkScannerStatus() {
    let isRunning = false;
    let notifGranted = false;
    let overlayGranted = false;

    if (window.AndroidBridge) {
      if (window.AndroidBridge.isScannerRunning) {
        isRunning = window.AndroidBridge.isScannerRunning();
      }
      if (window.AndroidBridge.isNotificationAccessGranted) {
        notifGranted = window.AndroidBridge.isNotificationAccessGranted();
      }
      if (window.AndroidBridge.isOverlayPermissionGranted) {
        overlayGranted = window.AndroidBridge.isOverlayPermissionGranted();
      }
    } else {
      isRunning = true;
      notifGranted = true;
      overlayGranted = true;
    }

    if (this.dom.scannerStatusBadge && this.dom.scannerStatusText) {
      if (isRunning && notifGranted && overlayGranted) {
        this.dom.scannerStatusBadge.className = 'scanner-badge active';
        this.dom.scannerStatusText.textContent = 'Scanner active';
      } else {
        this.dom.scannerStatusBadge.className = 'scanner-badge inactive';
        this.dom.scannerStatusText.textContent = 'Scanner inactive — Tap to setup';
      }
    }
  }

  // ================= FIRST-START SETUP & LIVE PERMISSIONS =================
  checkInitialSetup() {
    let notifGranted = false;
    let overlayGranted = false;

    if (window.AndroidBridge) {
      if (window.AndroidBridge.isNotificationAccessGranted) {
        notifGranted = window.AndroidBridge.isNotificationAccessGranted();
      }
      if (window.AndroidBridge.isOverlayPermissionGranted) {
        overlayGranted = window.AndroidBridge.isOverlayPermissionGranted();
      }
    } else {
      notifGranted = true;
      overlayGranted = true;
    }

    this.updatePermissionUI('setupGrantNotifBtn', 'grantNotificationAccessBtn', notifGranted);
    this.updatePermissionUI('setupGrantOverlayBtn', 'grantOverlayAccessBtn', overlayGranted);

    if (this.dom.completeSetupBtn) {
      if (notifGranted && overlayGranted) {
        this.dom.completeSetupBtn.textContent = 'Get Started';
        this.dom.completeSetupBtn.className = 'btn btn-success btn-block btn-lg';
      } else {
        this.dom.completeSetupBtn.textContent = 'Continue';
        this.dom.completeSetupBtn.className = 'btn btn-primary btn-block btn-lg';
      }
    }

    // Auto-prompt on first launch if setup not yet dismissed and permissions are missing
    const dismissed = localStorage.getItem('whosetab_setup_dismissed');
    if (!dismissed && (!notifGranted || !overlayGranted)) {
      this.openSetupModal();
    }
  }

  updatePermissionUI(setupBtnId, settingsBtnId, isGranted) {
    const sBtn = document.getElementById(setupBtnId);
    const setBtn = document.getElementById(settingsBtnId);
    
    if (sBtn) {
      if (isGranted) {
        sBtn.textContent = 'Granted';
        sBtn.className = 'btn btn-sm btn-success setup-action-btn granted';
        sBtn.disabled = true;
      } else {
        sBtn.textContent = 'Enable';
        sBtn.className = 'btn btn-sm btn-primary setup-action-btn';
        sBtn.disabled = false;
      }
    }

    if (setBtn) {
      if (isGranted) {
        setBtn.textContent = 'Granted';
        setBtn.className = 'btn btn-sm btn-success granted';
        setBtn.disabled = true;
      } else {
        setBtn.textContent = 'Enable';
        setBtn.className = 'btn btn-sm btn-primary';
        setBtn.disabled = false;
      }
    }
  }

  openSetupModal() {
    if (this.dom.setupModal) {
      this.dom.setupModal.classList.remove('hidden');
    }
  }

  closeSetupModal() {
    if (this.dom.setupModal) {
      this.dom.setupModal.classList.add('hidden');
    }
  }

  // ================= EVENT LISTENERS =================
  bindEvents() {
    // Theme selector (only in settings)
    if (this.dom.themeQuickToggleBtn) {
      this.dom.themeQuickToggleBtn.addEventListener('click', () => this.toggleTheme());
    }
    if (this.dom.themeSelector) {
      this.dom.themeSelector.addEventListener('change', (e) => this.setTheme(e.target.value));
    }

    // Scanner status badge click: opens setup modal
    if (this.dom.scannerStatusBadge) {
      this.dom.scannerStatusBadge.addEventListener('click', () => {
        this.openSetupModal();
      });
    }

    // First Start Setup Modal buttons
    if (this.dom.setupGrantNotifBtn) {
      this.dom.setupGrantNotifBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.openNotificationAccessSettings) {
          window.AndroidBridge.openNotificationAccessSettings();
        }
      });
    }

    if (this.dom.setupGrantOverlayBtn) {
      this.dom.setupGrantOverlayBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.openOverlayPermissionSettings) {
          window.AndroidBridge.openOverlayPermissionSettings();
        }
      });
    }

    if (this.dom.completeSetupBtn) {
      this.dom.completeSetupBtn.addEventListener('click', () => {
        localStorage.setItem('whosetab_setup_dismissed', 'true');
        this.closeSetupModal();
      });
    }

    if (this.dom.skipSetupBtn) {
      this.dom.skipSetupBtn.addEventListener('click', () => {
        localStorage.setItem('whosetab_setup_dismissed', 'true');
        this.closeSetupModal();
      });
    }

    if (this.dom.closeSetupModalBtn) {
      this.dom.closeSetupModalBtn.addEventListener('click', () => {
        localStorage.setItem('whosetab_setup_dismissed', 'true');
        this.closeSetupModal();
      });
    }

    // Live refresh when returning from Android System Settings
    window.addEventListener('focus', () => {
      this.checkScannerStatus();
      this.checkInitialSetup();
    });

    // Paytm Open Delay Setting
    if (this.dom.paytmDelaySelector) {
      let currentDelay = 0;
      if (window.AndroidBridge && window.AndroidBridge.getOpenDelay) {
        currentDelay = window.AndroidBridge.getOpenDelay();
      } else {
        currentDelay = parseInt(localStorage.getItem('whosetab_paytm_delay') || '0', 10);
      }
      this.dom.paytmDelaySelector.value = currentDelay.toString();

      this.dom.paytmDelaySelector.addEventListener('change', (e) => {
        const delayMs = parseInt(e.target.value, 10);
        localStorage.setItem('whosetab_paytm_delay', delayMs.toString());
        if (window.AndroidBridge && window.AndroidBridge.setOpenDelay) {
          window.AndroidBridge.setOpenDelay(delayMs);
        }
      });
    }

    // Android Permissions Triggers
    if (this.dom.grantNotificationAccessBtn) {
      this.dom.grantNotificationAccessBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.openNotificationAccessSettings) {
          window.AndroidBridge.openNotificationAccessSettings();
        }
      });
    }

    if (this.dom.grantOverlayAccessBtn) {
      this.dom.grantOverlayAccessBtn.addEventListener('click', () => {
        if (window.AndroidBridge && window.AndroidBridge.openOverlayPermissionSettings) {
          window.AndroidBridge.openOverlayPermissionSettings();
        }
      });
    }

    // Fixed Paytm Banner & Snap & Dismiss Buttons
    if (this.dom.paytmBannerBody) {
      this.dom.paytmBannerBody.addEventListener('click', () => {
        if (this.detectedPaytmData) {
          const data = this.detectedPaytmData;
          this.dom.paytmNotificationBanner.classList.add('hidden');
          this.openSnapModalWithPaytm(data);
        }
      });
    }

    if (this.dom.paytmSnapBtn) {
      this.dom.paytmSnapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.detectedPaytmData) {
          const data = this.detectedPaytmData;
          this.dom.paytmNotificationBanner.classList.add('hidden');
          this.openSnapModalWithPaytm(data);
        }
      });
    }

    if (this.dom.paytmDismissBtn) {
      this.dom.paytmDismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.detectedPaytmData) {
          this.markPaymentDismissed(this.detectedPaytmData);
          this.detectedPaytmData = null;
        }
        this.dom.paytmNotificationBanner.classList.add('hidden');
        if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
          window.AndroidBridge.clearPendingPayment();
        }
      });
    }

    // Repayment Banner Actions
    if (this.dom.repaymentBannerBody) {
      this.dom.repaymentBannerBody.addEventListener('click', () => {
        if (this.detectedRepaymentData) {
          this.dom.repaymentNotificationBanner.classList.add('hidden');
          this.openConfirmRepaymentModal(this.detectedRepaymentData);
        }
      });
    }

    if (this.dom.repaymentConfirmActionBtn) {
      this.dom.repaymentConfirmActionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.detectedRepaymentData) {
          this.dom.repaymentNotificationBanner.classList.add('hidden');
          this.openConfirmRepaymentModal(this.detectedRepaymentData);
        }
      });
    }

    if (this.dom.repaymentDismissBannerBtn) {
      this.dom.repaymentDismissBannerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissRepaymentData();
      });
    }

    // Repayment Modal Events
    if (this.dom.closeConfirmRepaymentModalBtn) {
      this.dom.closeConfirmRepaymentModalBtn.addEventListener('click', () => this.closeConfirmRepaymentModal());
    }
    if (this.dom.dismissRepaymentBtn) {
      this.dom.dismissRepaymentBtn.addEventListener('click', () => {
        this.dismissRepaymentData();
        this.closeConfirmRepaymentModal();
      });
    }
    if (this.dom.confirmRepaymentForm) {
      this.dom.confirmRepaymentForm.addEventListener('submit', (e) => this.handleConfirmRepaymentSubmit(e));
    }
    if (this.dom.repaymentPersonSelect) {
      this.dom.repaymentPersonSelect.addEventListener('change', () => this.updateRepaymentPreview());
    }
    if (this.dom.repaymentAmountInput) {
      this.dom.repaymentAmountInput.addEventListener('input', () => this.updateRepaymentPreview());
    }

    // Edit Person Modal Events
    if (this.dom.closeEditPersonModalBtn) {
      this.dom.closeEditPersonModalBtn.addEventListener('click', () => this.closeEditPersonModal());
    }
    if (this.dom.editPersonForm) {
      this.dom.editPersonForm.addEventListener('submit', (e) => this.handleEditPersonSubmit(e));
    }
    if (this.dom.deletePersonBtn) {
      this.dom.deletePersonBtn.addEventListener('click', () => this.handleDeletePersonSubmit());
    }

    // Check for Updates (Direct GitHub Releases, no tokens needed)
    if (this.dom.checkForUpdatesBtn) {
      this.dom.checkForUpdatesBtn.addEventListener('click', () => {
        this.dom.updateStatusNotice.textContent = 'Checking for updates...';
        if (window.AndroidBridge && window.AndroidBridge.checkForUpdates) {
          window.AndroidBridge.checkForUpdates();
        } else {
          this.checkGitHubReleasesWeb();
        }
      });
    }

    if (this.dom.closeUpdateModalBtn) {
      this.dom.closeUpdateModalBtn.addEventListener('click', () => {
        this.dom.updateModal.classList.add('hidden');
      });
    }

    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.addEventListener('click', () => {
        const apkUrl = this.dom.downloadUpdateBtn.dataset.apkUrl;
        if (window.AndroidBridge && window.AndroidBridge.downloadAndInstallUpdate) {
          this.dom.downloadUpdateBtn.disabled = true;
          this.dom.downloadUpdateBtn.textContent = 'Connecting...';
          if (this.dom.updateProgressContainer) {
            this.dom.updateProgressContainer.classList.remove('hidden');
          }
          if (this.dom.updateProgressText) {
            this.dom.updateProgressText.textContent = 'Starting download...';
          }
          window.AndroidBridge.downloadAndInstallUpdate(apkUrl);
        } else {
          window.open(apkUrl, '_blank');
          this.dom.updateModal.classList.add('hidden');
        }
      });
    }

    // Bottom Navigation
    this.dom.navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.dom.navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const targetViewId = item.dataset.target;
        this.dom.tabViews.forEach(view => {
          view.classList.toggle('active', view.id === targetViewId);
        });
      });
    });

    // People Filter Chips
    this.dom.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        this.dom.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.dataset.filter;
        this.renderPeoplePage();
      });
    });

    // Snap Modal Open / Close
    this.dom.openSnapModalBtn.addEventListener('click', () => this.openSnapModal());
    this.dom.closeSnapModalBtn.addEventListener('click', () => this.closeSnapModal());
    this.dom.snapExpenseModal.addEventListener('click', (e) => {
      if (e.target === this.dom.snapExpenseModal) this.closeSnapModal();
    });

    // Multi-Person Selection Buttons
    if (this.dom.selectAllPeopleBtn) {
      this.dom.selectAllPeopleBtn.addEventListener('click', () => {
        this.ledger.people.forEach(p => this.selectedPersonIds.add(p.id));
        this.manualSplits.clear();
        this.hideSnapError();
        this.renderModalPeopleChips();
        this.recalculateSplitBreakdown(true);
      });
    }

    if (this.dom.clearAllPeopleBtn) {
      this.dom.clearAllPeopleBtn.addEventListener('click', () => {
        this.selectedPersonIds.clear();
        this.manualSplits.clear();
        this.renderModalPeopleChips();
        this.recalculateSplitBreakdown(true);
      });
    }

    // Real-Time Split Calculation Listeners
    if (this.dom.snapAmount) {
      this.dom.snapAmount.addEventListener('input', () => {
        this.hideSnapError();
        this.recalculateSplitBreakdown(false);
      });
    }

    if (this.dom.snapMyShare) {
      this.dom.snapMyShare.addEventListener('input', () => {
        this.hideSnapError();
        this.recalculateSplitBreakdown(false);
      });
    }

    if (this.dom.clearMyShareBtn) {
      this.dom.clearMyShareBtn.addEventListener('click', () => {
        if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
        this.recalculateSplitBreakdown(false);
      });
    }

    if (this.dom.preset100ThemBtn) {
      this.dom.preset100ThemBtn.addEventListener('click', () => {
        if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
        this.manualSplits.clear();
        this.recalculateSplitBreakdown(true);
      });
    }

    if (this.dom.presetSplitEvenBtn) {
      this.dom.presetSplitEvenBtn.addEventListener('click', () => {
        const total = parseFloat(this.dom.snapAmount.value) || 0;
        const numFriends = this.selectedPersonIds.size;
        if (numFriends === 0) {
          this.showSnapError('Please select at least one friend above first to split equally.');
          return;
        }
        this.manualSplits.clear();
        if (total > 0) {
          const splitShare = Math.round((total / (numFriends + 1)) * 100) / 100;
          if (this.dom.snapMyShare) this.dom.snapMyShare.value = splitShare.toFixed(2);
        }
        this.recalculateSplitBreakdown(true);
      });
    }

    // Add Person Modal Open / Close
    this.dom.quickAddPersonBtn.addEventListener('click', () => this.openAddPersonModal());
    this.dom.addPersonPageBtn.addEventListener('click', () => this.openAddPersonModal());
    this.dom.closeAddPersonModalBtn.addEventListener('click', () => this.closeAddPersonModal());
    this.dom.addPersonModal.addEventListener('click', (e) => {
      if (e.target === this.dom.addPersonModal) this.closeAddPersonModal();
    });

    // Settle Modal Close
    this.dom.closeSettleModalBtn.addEventListener('click', () => {
      this.dom.settleModal.classList.add('hidden');
    });

    // Forms
    this.dom.snapExpenseForm.addEventListener('submit', (e) => this.handleSnapSubmit(e));
    this.dom.addPersonForm.addEventListener('submit', (e) => this.handleAddPersonSubmit(e));
    this.dom.settleForm.addEventListener('submit', (e) => this.handleSettleSubmit(e));

    // Window focus: check clipboard and re-check scanner status
    window.addEventListener('focus', () => {
      this.checkScannerStatus();
      this.checkClipboardForPaytm();
    });

    // Backup & Restore
    this.dom.exportDataBtn.addEventListener('click', () => this.exportBackup());
    this.dom.importDataBtn.addEventListener('click', () => this.dom.importFileInput.click());
    this.dom.importFileInput.addEventListener('change', (e) => this.importBackup(e));
    this.dom.clearDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all data? This cannot be undone.')) {
        this.ledger = { version: 1, people: [], expenses: [], settlements: [], settings: {} };
        this.saveLedger();
      }
    });
  }

  // ================= PAYMENT DISMISSAL & SIGNATURE TRACKING =================
  getPaymentSignature(data) {
    if (!data) return '';
    if (data.txnId && data.txnId.trim().length > 0) return data.txnId.trim();
    const amt = (data.amount || 0).toFixed(2);
    const rec = (data.recipient || '').trim().toLowerCase();
    const note = (data.note || data.rawText || '').slice(0, 30);
    return `${amt}_${rec}_${note}`;
  }

  isPaymentDismissed(data) {
    const sig = this.getPaymentSignature(data);
    if (!sig) return false;
    try {
      const list = JSON.parse(localStorage.getItem('whosetab_dismissed_payments') || '[]');
      return list.includes(sig);
    } catch (e) {
      return false;
    }
  }

  markPaymentDismissed(data) {
    const sig = this.getPaymentSignature(data);
    if (!sig) return;
    try {
      let list = JSON.parse(localStorage.getItem('whosetab_dismissed_payments') || '[]');
      if (!list.includes(sig)) {
        list.push(sig);
        if (list.length > 60) list = list.slice(list.length - 50);
        localStorage.setItem('whosetab_dismissed_payments', JSON.stringify(list));
      }
    } catch (e) {}

    // Synchronize dismissal with Android native storage
    if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
      window.AndroidBridge.clearPendingPayment();
    }
  }

  // ================= PAYTM DEEP LINK & CLIPBOARD =================
  checkUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const amount = params.get('amount') || params.get('amt');
    const to = params.get('to') || params.get('recipient') || params.get('name');
    const note = params.get('note') || params.get('title') || params.get('desc');

    if (amount) {
      setTimeout(() => {
        const item = {
          amount: parseFloat(amount),
          recipient: to || 'Paytm Purchase',
          note: note || '',
          suggestedCategory: 'Groceries'
        };
        if (!this.isPaymentDismissed(item)) {
          this.openSnapModalWithPaytm(item);
        }
      }, 250);
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
        this.showPaytmDetectedBanner(parsed);
      }
    } catch (e) {}
  }

  parsePaytmString(text) {
    if (!text || text.length < 5 || text.length > 300) return null;
    const regex = /(?:paid|sent|transfer of|rs\.?|inr|₹)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i;
    const match = text.match(regex);
    if (!match) return null;

    const amt = parseFloat(match[1].replace(/,/g, ''));
    if (!amt || amt <= 0) return null;

    let recipient = 'Merchant';
    const recMatch = text.match(/(?:to|at|for)\s+([A-Za-z0-9\s&'\.]+?)(?:\s+(?:successfully|via|on|ref|upi|txn|is successful|\.|$))/i);
    if (recMatch && recMatch[1]) {
      recipient = recMatch[1].trim();
    }

    return {
      amount: amt,
      recipient: recipient,
      rawText: text
    };
  }

  showPaytmDetectedBanner(data) {
    if (this.isPaymentDismissed(data)) return;
    this.detectedPaytmData = data;
    const recipient = data.recipient || 'Merchant';
    this.dom.paytmBannerDetail.textContent = `Paid ₹${data.amount.toFixed(2)} to ${recipient}`;
    this.dom.paytmNotificationBanner.classList.remove('hidden');
  }

  // ================= PENDING PAYMENT & AUTO-POPUP CONTROLLER =================
  checkPendingPayment() {
    // 0. Check pending repayment (incoming settlement)
    if (window._pendingRepayment) {
      const rData = window._pendingRepayment;
      window._pendingRepayment = null;
      if (!this.isRepaymentDismissed(rData)) {
        this.handleRepaymentDetected(rData);
        return;
      } else {
        if (window.AndroidBridge && window.AndroidBridge.clearPendingRepayment) {
          window.AndroidBridge.clearPendingRepayment();
        }
      }
    } else if (window.AndroidBridge && window.AndroidBridge.getPendingRepayment) {
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
      } catch (e) {
        console.error('Error fetching pending repayment from bridge', e);
      }
    }

    // 1. Check window._pendingPayment set by native script
    if (window._pendingPayment) {
      const data = window._pendingPayment;
      window._pendingPayment = null;
      if (!this.isPaymentDismissed(data)) {
        this.handleIncomingPayment(data);
      } else {
        if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
          window.AndroidBridge.clearPendingPayment();
        }
      }
      return;
    }

    // 2. Query AndroidBridge
    if (window.AndroidBridge && window.AndroidBridge.getPendingPayment) {
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
      } catch (e) {
        console.error('Error fetching pending payment from bridge', e);
      }
    }
  }

  handleRepaymentDetected(data) {
    if (!data || !data.amount || data.amount <= 0) return;
    if (this.isRepaymentDismissed(data)) {
      if (window.AndroidBridge && window.AndroidBridge.clearPendingRepayment) {
        window.AndroidBridge.clearPendingRepayment();
      }
      return;
    }

    this.detectedRepaymentData = data;

    // Show floating banner in header
    if (this.dom.repaymentNotificationBanner) {
      if (this.dom.repaymentBannerDetail) {
        this.dom.repaymentBannerDetail.textContent = `₹${parseFloat(data.amount).toFixed(2)} from ${data.sender || 'Sender'}`;
      }
      this.dom.repaymentNotificationBanner.classList.remove('hidden');
    }

    // Open confirmation popup
    this.openConfirmRepaymentModal(data);
  }

  handleIncomingPayment(data) {
    if (!data || !data.amount || data.amount <= 0) return;

    // Defensive check against marketing/spam payloads
    const raw = ((data.note || '') + ' ' + (data.rawText || '')).toLowerCase();
    if (raw) {
      const spamKeywords = [
        'buy gold', 'paytm gold', 'gold price', 'drop in gold', 'per gram',
        'cashback', 'scratch card', 'win up to', 'pre-approved', 'credit card',
        'cibil', 'loan', 'mutual fund', 'sip', 'buy now', 'invest now',
        'massive drop', 'rate drop'
      ];
      if (spamKeywords.some(kw => raw.includes(kw)) || /\/\s*(?:g|gm|kg|mo)/i.test(raw)) {
        console.warn('Blocked promotional payload from opening expense modal:', raw);
        if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
          window.AndroidBridge.clearPendingPayment();
        }
        return;
      }
    }

    if (this.isPaymentDismissed(data)) {
      if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
        window.AndroidBridge.clearPendingPayment();
      }
      return;
    }

    this.detectedPaytmData = data;

    // 1. Show the banner prompt in header
    this.showPaytmDetectedBanner(data);

    // 2. Automatically open the Snap Expense Modal popup
    this.openSnapModalWithPaytm(data);
  }

  // ================= MODAL CONTROLLER =================
  openAddPersonModal() {
    if (this.dom.addPersonModal) {
      this.dom.addPersonModal.classList.remove('hidden');
      setTimeout(() => {
        const input = document.getElementById('personName');
        if (input) input.focus();
      }, 100);
    }
  }

  closeAddPersonModal() {
    if (this.dom.addPersonModal) {
      this.dom.addPersonModal.classList.add('hidden');
    }
  }

  showSnapError(msg) {
    if (this.dom.snapFormError) {
      this.dom.snapFormError.textContent = msg;
      this.dom.snapFormError.classList.remove('hidden');
      this.dom.snapFormError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  hideSnapError() {
    if (this.dom.snapFormError) {
      this.dom.snapFormError.textContent = '';
      this.dom.snapFormError.classList.add('hidden');
    }
  }

  calculateCurrentSplits() {
    const total = parseFloat(this.dom.snapAmount.value) || 0;
    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';
    let myShare = rawMyShare !== '' ? parseFloat(rawMyShare) : 0;
    if (isNaN(myShare) || myShare < 0) myShare = 0;

    const selectedList = Array.from(this.selectedPersonIds)
      .map(id => this.ledger.people.find(p => p.id === id))
      .filter(Boolean);

    const friendsTotalPool = Math.max(0, total - myShare);

    // Filter manual splits to only people currently selected
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
        return {
          person: p,
          amount: manualMap.get(p.id),
          isManual: true
        };
      } else {
        return {
          person: p,
          amount: autoMap.get(p.id) || 0,
          isManual: false
        };
      }
    });

    return {
      total,
      myShare,
      friendsTotalPool,
      manualSum,
      remainingForAuto,
      hasManual: manualMap.size > 0,
      splits,
      numAuto,
      numManual: manualMap.size,
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
          if (inputWrap) inputWrap.classList.add('is-custom');
          if (!resetBtn && inputWrap) {
            resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'btn-reset-single-split';
            resetBtn.dataset.id = pid;
            resetBtn.title = 'Reset to equal';
            resetBtn.textContent = '↺';
            resetBtn.addEventListener('click', () => {
              this.manualSplits.delete(pid);
              this.recalculateSplitBreakdown(true);
            });
            inputWrap.appendChild(resetBtn);
          }
        } else {
          if (inputWrap) inputWrap.classList.remove('is-custom');
          if (resetBtn) resetBtn.remove();
        }
      } else {
        if (!s.isManual) {
          if (input) input.value = s.amount.toFixed(2);
          if (inputWrap) inputWrap.classList.remove('is-custom');
          if (resetBtn) resetBtn.remove();
        }
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
      warnRow.textContent = `Total amounts exceed bill by ₹${diff.toFixed(2)}`;
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

    // Preset pills highlight
    if (this.dom.preset100ThemBtn && this.dom.presetSplitEvenBtn) {
      if (rawMyShare === '' || calc.myShare === 0) {
        this.dom.preset100ThemBtn.classList.add('active');
        this.dom.presetSplitEvenBtn.classList.remove('active');
      } else {
        this.dom.preset100ThemBtn.classList.remove('active');
      }
    }

    // Update total friends label
    if (this.dom.summaryFriendsTotal) {
      this.dom.summaryFriendsTotal.textContent = `₹${calc.friendsTotalPool.toFixed(2)} to collect`;
    }

    // Update summary text under chips
    const numFriends = this.selectedPersonIds.size;
    if (this.dom.selectedPeopleSummary) {
      if (numFriends === 0) {
        this.dom.selectedPeopleSummary.innerHTML = '<span class="text-warning">Select people to split with</span>';
      } else {
        const names = calc.selectedList.map(p => p.name).join(', ');
        this.dom.selectedPeopleSummary.innerHTML = `<strong>${numFriends} friend${numFriends > 1 ? 's' : ''}</strong>: ${names}`;
      }
    }

    // Update Submit button text
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

    // Rebuild Breakdown list DOM
    if (!this.dom.summaryBreakdownList) return;
    if (numFriends === 0) {
      this.dom.summaryBreakdownList.innerHTML = `
        <div class="text-xs text-muted py-2 text-center">
          Select people above to split this expense
        </div>
      `;
      return;
    }

    let rowsHtml = '';
    calc.splits.forEach(s => {
      const p = s.person;
      const isManual = s.isManual;
      const valStr = isManual ? (this.manualSplits.get(p.id) !== undefined ? this.manualSplits.get(p.id) : s.amount.toFixed(2)) : s.amount.toFixed(2);
      rowsHtml += `
        <div class="split-person-row" data-id="${p.id}">
          <div class="split-person-info">
            <span class="split-person-name">${p.name} <small class="text-xs text-muted">(${p.relationship})</small></span>
          </div>
          <div class="split-person-input-wrap ${isManual ? 'is-custom' : ''}">
            <span class="currency-prefix-xs">₹</span>
            <input type="number" 
                   step="any" 
                   inputmode="decimal" 
                   class="split-person-input ${isManual ? 'is-manual' : ''}" 
                   data-id="${p.id}" 
                   value="${valStr}" 
                   placeholder="0.00">
            ${isManual ? `<button type="button" class="btn-reset-single-split" data-id="${p.id}" title="Reset to equal">↺</button>` : ''}
          </div>
        </div>
      `;
    });

    if (calc.myShare > 0) {
      rowsHtml += `
        <div class="summary-item-row my-share-row">
          <span class="item-name">You <small class="text-xs text-muted">(Paid by you)</small></span>
          <span class="item-amount text-muted">₹${calc.myShare.toFixed(2)}</span>
        </div>
      `;
    }

    if (calc.manualSum > calc.friendsTotalPool && calc.friendsTotalPool > 0) {
      const diff = calc.manualSum - calc.friendsTotalPool;
      rowsHtml += `
        <div class="split-warning-row">
          Total amounts exceed bill by ₹${diff.toFixed(2)}
        </div>
      `;
    }

    if (calc.hasManual && numFriends > 1) {
      rowsHtml += `
        <div class="split-reset-all-row">
          <span></span>
          <button type="button" class="btn-reset-all-splits" id="resetAllSplitsBtn">Split equally</button>
        </div>
      `;
    }

    this.dom.summaryBreakdownList.innerHTML = rowsHtml;

    // Attach listeners to per-person inputs
    const inputs = this.dom.summaryBreakdownList.querySelectorAll('.split-person-input');
    inputs.forEach(inp => {
      inp.addEventListener('input', (e) => {
        const pid = e.target.dataset.id;
        const raw = e.target.value.trim();
        if (raw === '') {
          this.manualSplits.delete(pid);
        } else {
          const val = parseFloat(raw);
          if (!isNaN(val) && val >= 0) {
            this.manualSplits.set(pid, val);
          }
        }
        this.updateAutoInputsInPlace(pid);
      });

      inp.addEventListener('blur', () => {
        this.recalculateSplitBreakdown(true);
      });
    });

    // Reset single split buttons
    const resetBtns = this.dom.summaryBreakdownList.querySelectorAll('.btn-reset-single-split');
    resetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.dataset.id;
        this.manualSplits.delete(pid);
        this.recalculateSplitBreakdown(true);
      });
    });

    // Reset all splits button
    const resetAllBtn = document.getElementById('resetAllSplitsBtn');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', () => {
        this.manualSplits.clear();
        this.recalculateSplitBreakdown(true);
      });
    }
  }

  openSnapModal(resetPeople = true) {
    if (resetPeople) {
      this.selectedPersonIds.clear();
    }
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
    this.dom.snapTitle.value = data.recipient ? `${data.recipient}` : 'Paytm Expense';
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

    // If closing while a payment was detected, mark it as dismissed so it NEVER pops up again
    if (this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }

    if (this.dom.paytmNotificationBanner) {
      this.dom.paytmNotificationBanner.classList.add('hidden');
    }

    if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
      window.AndroidBridge.clearPendingPayment();
    }
  }

  renderModalPeopleChips() {
    if (!this.dom.modalPeopleChips) return;
    this.dom.modalPeopleChips.innerHTML = '';
    if (this.ledger.people.length === 0) {
      this.dom.modalPeopleChips.innerHTML = `
        <div class="empty-contacts-inline">
          <span class="text-xs text-muted">No contacts saved yet.</span>
          <button type="button" class="btn btn-sm btn-secondary mt-1" id="inlineAddPersonBtn">+ Add Contact</button>
        </div>
      `;
      const addBtn = document.getElementById('inlineAddPersonBtn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          this.openAddPersonModal();
        });
      }
      return;
    }

    this.ledger.people.forEach(p => {
      const isSelected = this.selectedPersonIds.has(p.id);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `person-chip ${isSelected ? 'selected' : ''}`;
      chip.innerHTML = `${isSelected ? '<span class="chip-check">✓</span> ' : ''}<span>${p.name}</span> <small class="text-xs">(${p.relationship})</small>`;
      chip.addEventListener('click', () => {
        if (this.selectedPersonIds.has(p.id)) {
          this.selectedPersonIds.delete(p.id);
          this.manualSplits.delete(p.id);
          chip.classList.remove('selected');
          const check = chip.querySelector('.chip-check');
          if (check) check.remove();
        } else {
          this.selectedPersonIds.add(p.id);
          chip.classList.add('selected');
          if (!chip.querySelector('.chip-check')) {
            const check = document.createElement('span');
            check.className = 'chip-check';
            check.textContent = '✓ ';
            chip.prepend(check);
          }
        }
        this.hideSnapError();
        this.recalculateSplitBreakdown(true);
      });
      this.dom.modalPeopleChips.appendChild(chip);
    });

    // Add "+ Add Contact" chip at end of list
    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'person-chip add-chip';
    addChip.innerHTML = `<span>+ Add Contact</span>`;
    addChip.addEventListener('click', () => {
      this.openAddPersonModal();
    });
    this.dom.modalPeopleChips.appendChild(addChip);
  }

  // ================= DATA LOGIC & CALCULATIONS =================
  calculateNetBalances() {
    const balances = {};
    this.ledger.people.forEach(p => balances[p.id] = 0);

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

  handleSnapSubmit(e) {
    e.preventDefault();
    this.hideSnapError();

    const amount = parseFloat(this.dom.snapAmount.value);
    const title = this.dom.snapTitle.value.trim() || 'Purchase';
    const category = document.querySelector('input[name="category"]:checked')?.value || 'General';

    if (!amount || amount <= 0) {
      this.showSnapError('Please enter a valid amount.');
      return;
    }

    if (this.selectedPersonIds.size === 0) {
      this.showSnapError('Please select who to split this with.');
      return;
    }

    const calc = this.calculateCurrentSplits();

    if (calc.myShare > amount) {
      this.showSnapError(`Your share (₹${calc.myShare.toFixed(2)}) cannot exceed total (₹${amount.toFixed(2)}).`);
      return;
    }

    const splitsSum = calc.splits.reduce((acc, s) => acc + s.amount, 0);
    if (calc.hasManual && Math.abs((splitsSum + calc.myShare) - amount) > 0.05) {
      this.showSnapError(`Split amounts (₹${(splitsSum + calc.myShare).toFixed(2)}) do not match total paid (₹${amount.toFixed(2)}).`);
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
      splitType: calc.myShare > 0 || calc.hasManual ? 'CustomSplit' : 'BoughtForPerson',
      splits,
      category,
      paymentSource: 'Paytm',
      date: new Date().toISOString(),
      paytmRef: this.detectedPaytmData?.rawText ? 'Paytm Payment' : null,
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
    if (this.dom.paytmNotificationBanner) {
      this.dom.paytmNotificationBanner.classList.add('hidden');
    }
    if (window.AndroidBridge && window.AndroidBridge.clearPendingPayment) {
      window.AndroidBridge.clearPendingPayment();
    }

    this.render();
  }

  // ================= HARDWARE BACK BUTTON HANDLER =================
  handleBackPress() {
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

  handleAddPersonSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('personName');
    const name = nameInput ? nameInput.value.trim() : '';
    const phoneInput = document.getElementById('personPhone');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const rel = document.querySelector('input[name="relationship"]:checked')?.value || 'Friend';
    const upiInput = document.getElementById('personUpi');
    const upi = upiInput ? upiInput.value.trim() : '';

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
    this.closeAddPersonModal();

    // Auto-select this newly added contact for convenience
    this.selectedPersonIds.add(newPerson.id);
    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown();
    this.render();
  }

  openSettleModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) return;
    const balances = this.calculateNetBalances();
    const currentBalance = balances[personId] || 0;

    this.dom.settlePersonInfo.innerHTML = `
      <div class="person-row">
        <div class="person-name">${person.name} (${person.relationship})</div>
        <div class="balance-amount positive">Owes: ₹${currentBalance.toFixed(2)}</div>
      </div>
    `;

    this.dom.settleAmount.value = currentBalance > 0 ? currentBalance : '';
    this.dom.settleForm.dataset.personId = personId;
    this.dom.settleModal.classList.remove('hidden');
  }

  handleSettleSubmit(e) {
    e.preventDefault();
    const personId = this.dom.settleForm.dataset.personId;
    const amount = parseFloat(this.dom.settleAmount.value);
    const notes = this.dom.settleNotes.value.trim() || 'Settlement';

    if (!amount || amount <= 0) {
      alert('Enter a valid settlement amount.');
      return;
    }

    const settlement = {
      id: 's_' + Date.now(),
      fromPersonId: personId,
      toPersonId: 'me',
      amount,
      date: new Date().toISOString(),
      paymentSource: 'Paytm',
      notes
    };

    this.ledger.settlements.push(settlement);
    this.saveLedger();
    this.dom.settleForm.reset();
    this.dom.settleModal.classList.add('hidden');
    this.render();
  }

  // ================= EDIT / DELETE CONTACT =================
  openEditPersonModal(personId) {
    const person = this.ledger.people.find(p => p.id === personId);
    if (!person || !this.dom.editPersonModal) return;

    if (this.dom.editPersonId) this.dom.editPersonId.value = person.id;
    if (this.dom.editPersonName) this.dom.editPersonName.value = person.name;
    if (this.dom.editPersonPhone) this.dom.editPersonPhone.value = person.phone || '';
    if (this.dom.editPersonUpi) this.dom.editPersonUpi.value = person.upi || '';

    const radios = document.querySelectorAll('input[name="editRelationship"]');
    radios.forEach(r => {
      r.checked = (r.value === person.relationship);
      const parentLabel = r.closest('.split-btn');
      if (parentLabel) {
        if (r.checked) parentLabel.classList.add('active');
        else parentLabel.classList.remove('active');
      }
    });

    this.dom.editPersonModal.classList.remove('hidden');
  }

  closeEditPersonModal() {
    if (this.dom.editPersonModal) {
      this.dom.editPersonModal.classList.add('hidden');
    }
  }

  handleEditPersonSubmit(e) {
    e.preventDefault();
    const id = this.dom.editPersonId ? this.dom.editPersonId.value : null;
    const person = this.ledger.people.find(p => p.id === id);
    if (!person) return;

    const name = this.dom.editPersonName ? this.dom.editPersonName.value.trim() : '';
    if (!name) return;

    const phone = (this.dom.editPersonPhone ? this.dom.editPersonPhone.value.trim() : '') || null;
    const upi = (this.dom.editPersonUpi ? this.dom.editPersonUpi.value.trim() : '') || null;
    const relRadio = document.querySelector('input[name="editRelationship"]:checked');
    const rel = relRadio ? relRadio.value : person.relationship;

    person.name = name;
    person.phone = phone;
    person.upi = upi;
    person.relationship = rel;

    this.saveLedger();
    this.closeEditPersonModal();
    this.render();
  }

  handleDeletePersonSubmit() {
    const id = this.dom.editPersonId ? this.dom.editPersonId.value : null;
    const person = this.ledger.people.find(p => p.id === id);
    if (!person) return;

    if (confirm(`Remove ${person.name} from contacts? Past expenses and settlements will remain preserved.`)) {
      this.ledger.people = this.ledger.people.filter(p => p.id !== id);
      this.selectedPersonIds.delete(id);
      this.saveLedger();
      this.closeEditPersonModal();
      this.render();
    }
  }

  // ================= REPAYMENT SETTLEMENT & POPUP =================
  findMatchingContact(sender) {
    if (!sender || !this.ledger.people.length) return null;
    const s = sender.trim().toLowerCase();

    // 1. Phone number match
    const digits = s.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      const p = this.ledger.people.find(person => person.phone && person.phone.replace(/[^0-9]/g, '').endsWith(digits.slice(-10)));
      if (p) return p;
    }

    // 2. UPI / VPA match
    const pUpi = this.ledger.people.find(person => {
      if (!person.upi) return false;
      const u = person.upi.toLowerCase();
      return s.includes(u) || u.includes(s);
    });
    if (pUpi) return pUpi;

    // 3. Name normalization
    const norm = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanS = norm(s);

    // Exact name match
    let pName = this.ledger.people.find(person => norm(person.name) === cleanS);
    if (pName) return pName;

    // First name match
    pName = this.ledger.people.find(person => {
      const first = norm(person.name.split(' ')[0]);
      return cleanS.includes(first) || first.includes(cleanS.split(' ')[0]);
    });
    if (pName) return pName;

    // Phonetic / 'h' spelling tolerance (e.g. Bhuvnesh vs Buvnesh)
    pName = this.ledger.people.find(person => {
      const na = norm(person.name).replace(/h/g, '');
      const nb = cleanS.replace(/h/g, '');
      return na === nb || na.includes(nb) || nb.includes(na);
    });
    if (pName) return pName;

    return null;
  }

  openConfirmRepaymentModal(data) {
    if (!data || !this.dom.confirmRepaymentModal) return;
    this.detectedRepaymentData = data;

    const amt = parseFloat(data.amount) || 0;
    const sender = data.sender || 'Someone';

    if (this.dom.repaymentAmountDisplay) {
      this.dom.repaymentAmountDisplay.textContent = `₹${amt.toFixed(2)}`;
    }
    if (this.dom.repaymentAmountInput) {
      this.dom.repaymentAmountInput.value = amt.toFixed(2);
    }
    if (this.dom.repaymentSourceDetail) {
      this.dom.repaymentSourceDetail.textContent = `Received from ${sender}`;
    }
    if (this.dom.repaymentNotesInput) {
      this.dom.repaymentNotesInput.value = `Repayment from ${sender}`;
    }

    const select = this.dom.repaymentPersonSelect;
    if (select) {
      select.innerHTML = '';
      if (this.ledger.people.length === 0) {
        select.innerHTML = '<option value="">No contacts in tab yet</option>';
      } else {
        const matched = this.findMatchingContact(sender);
        const balances = this.calculateNetBalances();

        this.ledger.people.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          const bal = balances[p.id] || 0;
          opt.textContent = `${p.name} (${p.relationship}) — ${bal > 0 ? `Owes ₹${bal.toFixed(2)}` : 'Settled'}`;
          if (matched && p.id === matched.id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });

        if (!matched && select.options.length > 0) {
          const debtorPerson = this.ledger.people.find(p => (balances[p.id] || 0) > 0);
          if (debtorPerson) select.value = debtorPerson.id;
        }
      }
    }

    this.updateRepaymentPreview();
    this.dom.confirmRepaymentModal.classList.remove('hidden');
  }

  updateRepaymentPreview() {
    const preview = this.dom.repaymentBalancePreview;
    if (!preview) return;

    const personId = this.dom.repaymentPersonSelect ? this.dom.repaymentPersonSelect.value : null;
    const amount = parseFloat(this.dom.repaymentAmountInput ? this.dom.repaymentAmountInput.value : 0) || 0;

    const person = this.ledger.people.find(p => p.id === personId);
    if (!person) {
      preview.innerHTML = '<div class="text-sm text-muted text-center">Select a contact to preview updated balance.</div>';
      return;
    }

    const balances = this.calculateNetBalances();
    const currentDebt = balances[person.id] || 0;
    const newDebt = currentDebt - amount;

    preview.innerHTML = `
      <div class="repayment-calc-row">
        <span>${person.name}'s Current Balance</span>
        <span class="repayment-calc-val ${currentDebt > 0 ? 'negative' : 'positive'}">
          ${currentDebt > 0 ? `Owes ₹${currentDebt.toFixed(2)}` : 'Settled (₹0.00)'}
        </span>
      </div>
      <div class="repayment-calc-row">
        <span>Repayment to Apply</span>
        <span class="repayment-calc-val positive">-₹${amount.toFixed(2)}</span>
      </div>
      <div class="repayment-calc-row total-row">
        <span>Balance After Settle</span>
        <span class="repayment-calc-val ${newDebt <= 0 ? 'positive' : 'negative'}">
          ${newDebt <= 0 ? (newDebt < 0 ? `Overpaid by ₹${Math.abs(newDebt).toFixed(2)}` : 'Fully Settled (₹0.00)') : `Still Owes ₹${newDebt.toFixed(2)}`}
        </span>
      </div>
    `;
  }

  handleConfirmRepaymentSubmit(e) {
    e.preventDefault();
    const personId = this.dom.repaymentPersonSelect ? this.dom.repaymentPersonSelect.value : null;
    const amount = parseFloat(this.dom.repaymentAmountInput ? this.dom.repaymentAmountInput.value : 0) || 0;
    const notes = (this.dom.repaymentNotesInput ? this.dom.repaymentNotesInput.value.trim() : '') || 'Repayment';

    if (!personId) {
      alert('Please choose which contact sent this repayment.');
      return;
    }
    if (amount <= 0) {
      alert('Please enter a valid settlement amount.');
      return;
    }

    const person = this.ledger.people.find(p => p.id === personId);
    const settlement = {
      id: 's_' + Date.now(),
      fromPersonId: personId,
      toPersonId: 'me',
      amount,
      date: new Date().toISOString(),
      paymentSource: 'Paytm / UPI Repayment',
      notes
    };

    this.ledger.settlements.push(settlement);
    this.saveLedger();

    if (this.detectedRepaymentData) {
      this.dismissRepaymentData();
    }

    this.closeConfirmRepaymentModal();
    this.render();
  }

  dismissRepaymentData() {
    if (this.detectedRepaymentData) {
      const sig = this.getRepaymentSignature(this.detectedRepaymentData);
      this.markRepaymentDismissed(sig);
      if (window.AndroidBridge && window.AndroidBridge.dismissRepayment) {
        window.AndroidBridge.dismissRepayment(sig);
      }
      this.detectedRepaymentData = null;
    }
    if (this.dom.repaymentNotificationBanner) {
      this.dom.repaymentNotificationBanner.classList.add('hidden');
    }
    if (window.AndroidBridge && window.AndroidBridge.clearPendingRepayment) {
      window.AndroidBridge.clearPendingRepayment();
    }
  }

  closeConfirmRepaymentModal() {
    if (this.dom.confirmRepaymentModal) {
      this.dom.confirmRepaymentModal.classList.add('hidden');
    }
  }

  getRepaymentSignature(data) {
    if (!data) return '';
    const amt = parseFloat(data.amount) || 0;
    const sender = data.sender || '';
    const note = data.rawText || data.note || '';
    return `repay_${amt.toFixed(2)}_${sender}_${note.length}`;
  }

  isRepaymentDismissed(data) {
    const sig = this.getRepaymentSignature(data);
    if (!sig) return false;
    try {
      const dismissed = JSON.parse(localStorage.getItem('whosetab_dismissed_repayments') || '[]');
      return dismissed.includes(sig);
    } catch (e) {
      return false;
    }
  }

  markRepaymentDismissed(sig) {
    if (!sig) return;
    try {
      let dismissed = JSON.parse(localStorage.getItem('whosetab_dismissed_repayments') || '[]');
      if (!dismissed.includes(sig)) {
        dismissed.push(sig);
        if (dismissed.length > 50) dismissed = dismissed.slice(-40);
        localStorage.setItem('whosetab_dismissed_repayments', JSON.stringify(dismissed));
      }
    } catch (e) {}
  }

  // ================= AUTO-UPDATE (GITHUB PUBLIC RELEASES) =================
  showUpdatePrompt(latestVersion, apkUrl, releaseNotes) {
    if (this.dom.updateModal) {
      this.dom.updateVersionTitle.textContent = `WhoseTab v${latestVersion}`;
      this.dom.updateReleaseNotes.textContent = releaseNotes || 'Latest features & optimizations.';
      this.dom.downloadUpdateBtn.dataset.apkUrl = apkUrl;
      this.dom.downloadUpdateBtn.disabled = false;
      this.dom.downloadUpdateBtn.textContent = 'Download & Install Now';
      if (this.dom.updateProgressContainer) {
        this.dom.updateProgressContainer.classList.add('hidden');
      }
      if (this.dom.updateProgressBar) {
        this.dom.updateProgressBar.style.width = '0%';
      }
      if (this.dom.updateProgressText) {
        this.dom.updateProgressText.textContent = 'Ready to download.';
      }
      this.dom.updateModal.classList.remove('hidden');
    }
  }

  onDownloadProgress(percent, currentMb, totalMb) {
    if (this.dom.updateProgressContainer) {
      this.dom.updateProgressContainer.classList.remove('hidden');
    }
    if (this.dom.updateProgressBar) {
      this.dom.updateProgressBar.style.width = `${percent}%`;
    }
    if (this.dom.updateProgressText) {
      this.dom.updateProgressText.textContent = `Downloading update: ${percent}% (${currentMb} MB / ${totalMb} MB)`;
    }
    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.disabled = true;
      this.dom.downloadUpdateBtn.textContent = `Downloading ${percent}%...`;
    }
  }

  onDownloadCompleted() {
    if (this.dom.updateProgressBar) {
      this.dom.updateProgressBar.style.width = '100%';
    }
    if (this.dom.updateProgressText) {
      this.dom.updateProgressText.textContent = 'Download complete! Opening installation prompt...';
    }
    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.textContent = 'Installing...';
    }
    setTimeout(() => {
      if (this.dom.updateModal) this.dom.updateModal.classList.add('hidden');
    }, 3000);
  }

  onDownloadError(err) {
    if (this.dom.updateProgressText) {
      this.dom.updateProgressText.textContent = `Download failed: ${err}`;
    }
    if (this.dom.downloadUpdateBtn) {
      this.dom.downloadUpdateBtn.disabled = false;
      this.dom.downloadUpdateBtn.textContent = 'Retry Download';
    }
  }

  onUpToDate() {
    if (this.dom.updateStatusNotice) {
      this.dom.updateStatusNotice.textContent = '✓ App is up to date';
    }
  }

  onUpdateError(err) {
    if (this.dom.updateStatusNotice) {
      this.dom.updateStatusNotice.textContent = 'Update check: ' + err;
    }
  }

  async checkGitHubReleasesWeb() {
    try {
      const res = await fetch('https://api.github.com/repos/KHILVANSH/WhoseTab/releases/latest');
      if (!res.ok) {
        this.dom.updateStatusNotice.textContent = 'Could not reach updates server.';
        return;
      }
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace('v', '').trim();
      const assets = data.assets || [];
      const apk = assets.find(a => a.name.endsWith('.apk'));

      if (latestTag && apk) {
        this.showUpdatePrompt(latestTag, apk.browser_download_url, data.body);
        this.dom.updateStatusNotice.textContent = `New update found: v${latestTag}`;
      } else {
        this.onUpToDate();
      }
    } catch (e) {
      this.dom.updateStatusNotice.textContent = 'Error checking for updates.';
    }
  }

  // ================= BACKUP & EXPORT =================
  exportBackup() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.ledger, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `whosetab_backup_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
  }

  importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.people && imported.expenses) {
          this.ledger = imported;
          this.saveLedger();
          alert('Ledger backup restored successfully!');
        } else {
          alert('Invalid backup file structure.');
        }
      } catch (err) {
        alert('Could not parse JSON file.');
      }
    };
    reader.readAsText(file);
  }

  // ================= RENDER UI =================
  render() {
    this.renderDashboard();
    this.renderPeoplePage();
  }

  renderDashboard() {
    const balances = this.calculateNetBalances();
    let totalOwed = 0;
    let debtors = 0;

    Object.values(balances).forEach(b => {
      if (b > 0.01) {
        totalOwed += b;
        debtors += 1;
      }
    });

    this.dom.totalOwedToMe.textContent = `₹${totalOwed.toFixed(2)}`;
    this.dom.activeDebtorsCount.textContent = `${debtors} people owe you`;
    this.dom.expenseCountBadge.textContent = this.ledger.expenses.length;

    // Render People List
    this.dom.peopleList.innerHTML = '';
    if (this.ledger.people.length === 0) {
      this.dom.peopleList.innerHTML = '<div class="text-sm text-muted text-center py-3">No contacts saved yet. Tap "+ Add Person" to get started!</div>';
    } else {
      this.ledger.people.forEach(p => {
        const bal = balances[p.id] || 0;
        const initial = p.name.charAt(0).toUpperCase();

        const row = document.createElement('div');
        row.className = 'person-row';
        row.innerHTML = `
          <div class="person-left">
            <div class="avatar-badge">${initial}</div>
            <div class="person-info">
              <span class="person-name">${p.name}</span>
              <span class="person-relation">${p.relationship}</span>
            </div>
          </div>
          <div class="person-right">
            <div class="person-balance-tag">
              <span class="balance-amount ${bal > 0 ? 'positive' : bal < 0 ? 'negative' : 'zero'}">
                ${bal > 0 ? '+' : ''}₹${bal.toFixed(2)}
              </span>
              <span class="balance-label">${bal > 0 ? 'Owes You' : bal < 0 ? 'You Owe' : 'Settled'}</span>
            </div>
            ${bal > 0 ? `<button type="button" class="btn-settle" data-id="${p.id}">Settle</button>` : ''}
          </div>
        `;

        const settleBtn = row.querySelector('.btn-settle');
        if (settleBtn) {
          settleBtn.addEventListener('click', () => this.openSettleModal(p.id));
        }

        this.dom.peopleList.appendChild(row);
      });
    }

    // Render Recent Expenses
    this.dom.recentExpensesList.innerHTML = '';
    if (this.ledger.expenses.length === 0) {
      this.dom.recentExpensesList.innerHTML = '<div class="text-sm text-muted text-center py-3">No expenses logged yet.</div>';
    } else {
      const receiptIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
      this.ledger.expenses.slice(0, 10).forEach(exp => {
        const dateStr = new Date(exp.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        
        const participantNames = exp.splits.map(s => {
          const p = this.ledger.people.find(person => person.id === s.personId);
          return p ? p.name.split(' ')[0] : 'Someone';
        }).join(', ');

        const row = document.createElement('div');
        row.className = 'expense-row';
        row.innerHTML = `
          <span class="exp-category-icon">${receiptIcon}</span>
          <div class="exp-details">
            <span class="exp-title">${exp.title}</span>
            <div class="exp-meta">
              <span>For: <strong>${participantNames}</strong></span>
              <span>•</span>
              <span>${dateStr}</span>
            </div>
          </div>
          <div class="exp-amount">₹${exp.totalAmount.toFixed(2)}</div>
        `;
        this.dom.recentExpensesList.appendChild(row);
      });
    }
  }

  renderPeoplePage() {
    const balances = this.calculateNetBalances();
    this.dom.contactsFullList.innerHTML = '';

    const filtered = this.currentFilter === 'all'
      ? this.ledger.people
      : this.ledger.people.filter(p => p.relationship === this.currentFilter);

    if (filtered.length === 0) {
      this.dom.contactsFullList.innerHTML = '<div class="text-sm text-muted text-center py-4">No contacts found in this list.</div>';
      return;
    }

    filtered.forEach(p => {
      const bal = balances[p.id] || 0;
      const initial = p.name.charAt(0).toUpperCase();
      const metaDetails = [
        p.relationship,
        p.phone ? p.phone : null,
        p.upi ? p.upi : null
      ].filter(Boolean).join(' • ');

      const card = document.createElement('div');
      card.className = 'card person-row';
      card.innerHTML = `
        <div class="person-left">
          <div class="avatar-badge">${initial}</div>
          <div class="person-info">
            <span class="person-name">${p.name}</span>
            <span class="person-relation">${metaDetails}</span>
          </div>
        </div>
        <div class="person-right">
          <div class="person-balance-tag">
            <span class="balance-amount ${bal > 0 ? 'positive' : 'zero'}">
              ₹${bal.toFixed(2)}
            </span>
            <span class="balance-label">${bal > 0 ? 'Owes you' : 'Settled'}</span>
          </div>
          <button type="button" class="btn btn-sm btn-secondary edit-person-btn" data-id="${p.id}" title="Edit contact">Edit</button>
          <button type="button" class="btn btn-sm btn-secondary snap-for-person-btn" data-id="${p.id}">Split</button>
        </div>
      `;

      card.querySelector('.edit-person-btn').addEventListener('click', () => {
        this.openEditPersonModal(p.id);
      });

      card.querySelector('.snap-for-person-btn').addEventListener('click', () => {
        this.selectedPersonIds = new Set([p.id]);
        this.openSnapModal(false);
      });

      this.dom.contactsFullList.appendChild(card);
    });
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhoseTabApp();
});
