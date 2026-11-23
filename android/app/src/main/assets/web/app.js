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

      settleModal: document.getElementById('settleModal'),
      closeSettleModalBtn: document.getElementById('closeSettleModalBtn'),
      settleForm: document.getElementById('settleForm'),
      settlePersonInfo: document.getElementById('settlePersonInfo'),
      settleAmount: document.getElementById('settleAmount'),
      settleNotes: document.getElementById('settleNotes'),

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
      this.dom.appVersionDisplay.textContent = 'v1.0.5';
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
        this.dom.scannerStatusText.textContent = 'SCANNING FOR PAYMENTS';
      } else {
        this.dom.scannerStatusBadge.className = 'scanner-badge inactive';
        this.dom.scannerStatusText.textContent = '⚠️ SCANNER PAUSED - TAP TO SETUP';
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
        this.dom.completeSetupBtn.textContent = '🎉 All Set — Let\'s Go!';
        this.dom.completeSetupBtn.className = 'btn btn-success btn-block btn-lg';
      } else {
        this.dom.completeSetupBtn.textContent = 'Continue to WhoseTab';
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
        sBtn.textContent = '✅ Granted';
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
        setBtn.textContent = '✅ Granted';
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
        this.hideSnapError();
        this.renderModalPeopleChips();
        this.recalculateSplitBreakdown();
      });
    }

    if (this.dom.clearAllPeopleBtn) {
      this.dom.clearAllPeopleBtn.addEventListener('click', () => {
        this.selectedPersonIds.clear();
        this.renderModalPeopleChips();
        this.recalculateSplitBreakdown();
      });
    }

    // Real-Time Split Calculation Listeners
    if (this.dom.snapAmount) {
      this.dom.snapAmount.addEventListener('input', () => {
        this.hideSnapError();
        this.recalculateSplitBreakdown();
      });
    }

    if (this.dom.snapMyShare) {
      this.dom.snapMyShare.addEventListener('input', () => {
        this.hideSnapError();
        this.recalculateSplitBreakdown();
      });
    }

    if (this.dom.clearMyShareBtn) {
      this.dom.clearMyShareBtn.addEventListener('click', () => {
        if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
        this.recalculateSplitBreakdown();
      });
    }

    if (this.dom.preset100ThemBtn) {
      this.dom.preset100ThemBtn.addEventListener('click', () => {
        if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
        this.recalculateSplitBreakdown();
      });
    }

    if (this.dom.presetSplitEvenBtn) {
      this.dom.presetSplitEvenBtn.addEventListener('click', () => {
        const total = parseFloat(this.dom.snapAmount.value) || 0;
        const numFriends = this.selectedPersonIds.size;
        if (numFriends === 0) {
          this.showSnapError('⚠️ Please select at least one friend above first to split evenly.');
          return;
        }
        if (total > 0) {
          const splitShare = Math.round((total / (numFriends + 1)) * 100) / 100;
          if (this.dom.snapMyShare) this.dom.snapMyShare.value = splitShare.toFixed(2);
        }
        this.recalculateSplitBreakdown();
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

  handleIncomingPayment(data) {
    if (!data || !data.amount || data.amount <= 0) return;
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

  recalculateSplitBreakdown() {
    const total = parseFloat(this.dom.snapAmount.value) || 0;
    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';
    let myShare = rawMyShare !== '' ? parseFloat(rawMyShare) : 0;
    if (isNaN(myShare) || myShare < 0) myShare = 0;

    // Preset pills highlight
    if (this.dom.preset100ThemBtn && this.dom.presetSplitEvenBtn) {
      if (rawMyShare === '' || myShare === 0) {
        this.dom.preset100ThemBtn.classList.add('active');
        this.dom.presetSplitEvenBtn.classList.remove('active');
      } else {
        this.dom.preset100ThemBtn.classList.remove('active');
      }
    }

    const friendsTotal = Math.max(0, total - myShare);
    const numFriends = this.selectedPersonIds.size;

    // Update total friends label
    if (this.dom.summaryFriendsTotal) {
      this.dom.summaryFriendsTotal.textContent = `₹${friendsTotal.toFixed(2)} to collect`;
    }

    // Update summary text under chips
    if (this.dom.selectedPeopleSummary) {
      if (numFriends === 0) {
        this.dom.selectedPeopleSummary.innerHTML = '<span class="text-warning">⚠️ Tap friends to include in split (select 1, 2, 4-5 or more)</span>';
      } else {
        const names = Array.from(this.selectedPersonIds)
          .map(id => this.ledger.people.find(p => p.id === id)?.name)
          .filter(Boolean)
          .join(', ');
        this.dom.selectedPeopleSummary.innerHTML = `<strong>${numFriends} friend${numFriends > 1 ? 's' : ''}</strong> selected: ${names}`;
      }
    }

    // Render Breakdown list
    if (this.dom.summaryBreakdownList) {
      if (numFriends === 0) {
        this.dom.summaryBreakdownList.innerHTML = `
          <div class="text-xs text-muted py-2 text-center">
            Tap friend names above to calculate their share
          </div>
        `;
      } else {
        const selectedList = Array.from(this.selectedPersonIds)
          .map(id => this.ledger.people.find(p => p.id === id))
          .filter(Boolean);

        const totalCents = Math.round(friendsTotal * 100);
        const baseCents = Math.floor(totalCents / selectedList.length);
        const remainder = totalCents - (baseCents * selectedList.length);

        let rowsHtml = '';
        selectedList.forEach((person, idx) => {
          const personShare = (baseCents + (idx < remainder ? 1 : 0)) / 100;
          rowsHtml += `
            <div class="summary-item-row">
              <span class="item-name">${person.name} <small class="text-xs text-muted">(${person.relationship})</small></span>
              <span class="item-amount positive">+₹${personShare.toFixed(2)}</span>
            </div>
          `;
        });

        if (myShare > 0) {
          rowsHtml += `
            <div class="summary-item-row my-share-row">
              <span class="item-name">You <small class="text-xs text-muted">(Paid by you)</small></span>
              <span class="item-amount text-muted">₹${myShare.toFixed(2)}</span>
            </div>
          `;
        }

        this.dom.summaryBreakdownList.innerHTML = rowsHtml;
      }
    }

    // Update Submit button text
    if (this.dom.submitSnapBtn) {
      if (numFriends > 0 && friendsTotal > 0) {
        this.dom.submitSnapBtn.textContent = `⚡ Save Tab (Collect ₹${friendsTotal.toFixed(2)} from ${numFriends} friend${numFriends > 1 ? 's' : ''})`;
      } else if (total > 0) {
        this.dom.submitSnapBtn.textContent = `Save Tab (₹${total.toFixed(2)})`;
      } else {
        this.dom.submitSnapBtn.textContent = 'Save Tab';
      }
    }
  }

  openSnapModal(resetPeople = true) {
    if (resetPeople) {
      this.selectedPersonIds.clear();
    }
    this.hideSnapError();
    this.dom.snapAmount.value = '';
    this.dom.snapTitle.value = '';
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown();
    this.dom.snapExpenseModal.classList.remove('hidden');
    setTimeout(() => this.dom.snapAmount.focus(), 100);
  }

  openSnapModalWithPaytm(data) {
    if (!data) return;
    this.selectedPersonIds.clear();
    this.hideSnapError();
    this.dom.snapAmount.value = data.amount || '';
    this.dom.snapTitle.value = data.recipient ? `${data.recipient}` : 'Paytm Expense';
    if (this.dom.snapMyShare) this.dom.snapMyShare.value = '';
    
    if (data.suggestedCategory) {
      const radio = document.querySelector(`input[name="category"][value="${data.suggestedCategory}"]`);
      if (radio) radio.checked = true;
    }

    this.renderModalPeopleChips();
    this.recalculateSplitBreakdown();
    this.dom.snapExpenseModal.classList.remove('hidden');
    const sheet = this.dom.snapExpenseModal.querySelector('.modal-sheet');
    if (sheet) sheet.scrollTop = 0;
  }

  closeSnapModal() {
    this.dom.snapExpenseModal.classList.add('hidden');
    this.hideSnapError();

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
        this.recalculateSplitBreakdown();
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
      this.showSnapError('⚠️ Please enter a valid amount paid.');
      return;
    }

    if (this.selectedPersonIds.size === 0) {
      this.showSnapError('⚠️ Please choose whose stuff you bought! Tap one or more friends above.');
      return;
    }

    const rawMyShare = this.dom.snapMyShare ? this.dom.snapMyShare.value.trim() : '';
    let myShare = rawMyShare !== '' ? parseFloat(rawMyShare) : 0;
    if (isNaN(myShare) || myShare < 0) myShare = 0;

    if (myShare > amount) {
      this.showSnapError(`⚠️ Your share (₹${myShare.toFixed(2)}) cannot be greater than the total bill (₹${amount.toFixed(2)}).`);
      return;
    }

    const friendsTotal = Math.max(0, amount - myShare);
    const selectedList = Array.from(this.selectedPersonIds)
      .map(id => this.ledger.people.find(p => p.id === id))
      .filter(Boolean);

    if (selectedList.length === 0) {
      this.showSnapError('⚠️ Selected contacts could not be found.');
      return;
    }

    const totalCents = Math.round(friendsTotal * 100);
    const baseCents = Math.floor(totalCents / selectedList.length);
    const remainder = totalCents - (baseCents * selectedList.length);

    const splits = selectedList.map((p, idx) => {
      const personCents = baseCents + (idx < remainder ? 1 : 0);
      return {
        personId: p.id,
        amountOwed: personCents / 100
      };
    });

    const newExpense = {
      id: 'e_' + Date.now(),
      title,
      totalAmount: amount,
      paidById: 'me',
      splitType: myShare > 0 ? 'CustomSplit' : 'BoughtForPerson',
      splits,
      category,
      paymentSource: 'Paytm',
      date: new Date().toISOString(),
      paytmRef: this.detectedPaytmData?.rawText ? 'Paytm Payment' : null,
      myShare: myShare
    };

    this.ledger.expenses.unshift(newExpense);
    this.saveLedger();
    if (this.detectedPaytmData) {
      this.markPaymentDismissed(this.detectedPaytmData);
      this.detectedPaytmData = null;
    }
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
    const rel = document.querySelector('input[name="relationship"]:checked')?.value || 'Friend';
    const upiInput = document.getElementById('personUpi');
    const upi = upiInput ? upiInput.value.trim() : '';

    if (!name) return;

    const newPerson = {
      id: 'p_' + Date.now(),
      name,
      relationship: rel,
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
      this.dom.recentExpensesList.innerHTML = '<div class="text-sm text-muted text-center py-3">No purchases logged yet. Make a payment on Paytm or tap + Snap Expense below!</div>';
    } else {
      this.ledger.expenses.slice(0, 10).forEach(exp => {
        const catIcons = {
          Groceries: '🥦', FoodDining: '🍛', SnacksChai: '☕',
          StationeryBooks: '📚', RoomRentUtilities: '💡', General: '📦'
        };
        const icon = catIcons[exp.category] || '📦';
        const dateStr = new Date(exp.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        
        const participantNames = exp.splits.map(s => {
          const p = this.ledger.people.find(person => person.id === s.personId);
          return p ? p.name.split(' ')[0] : 'Someone';
        }).join(', ');

        const row = document.createElement('div');
        row.className = 'expense-row';
        row.innerHTML = `
          <span class="exp-category-icon">${icon}</span>
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

      const card = document.createElement('div');
      card.className = 'card person-row';
      card.innerHTML = `
        <div class="person-left">
          <div class="avatar-badge">${initial}</div>
          <div class="person-info">
            <span class="person-name">${p.name}</span>
            <span class="person-relation">${p.relationship} ${p.upi ? `• ${p.upi}` : ''}</span>
          </div>
        </div>
        <div class="person-right">
          <div class="person-balance-tag">
            <span class="balance-amount ${bal > 0 ? 'positive' : 'zero'}">
              ₹${bal.toFixed(2)}
            </span>
            <span class="balance-label">${bal > 0 ? 'Owes you' : 'Settled'}</span>
          </div>
          <button type="button" class="btn btn-sm btn-secondary snap-for-person-btn" data-id="${p.id}">Snap</button>
        </div>
      `;

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
