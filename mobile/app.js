/**
 * WhoseTab — Mobile Application Logic
 * Offline-first, fast peer expense & Paytm logger for roommates & friends.
 */

const STORAGE_KEY = 'whosetab_ledger_v1';
const THEME_KEY = 'whosetab_theme_preference';

// Default Demo Contacts
const DEFAULT_PEOPLE = [
  { id: 'p1', name: 'Aman Verma', relationship: 'Roommate', upi: 'aman@paytm', createdAt: new Date().toISOString() },
  { id: 'p2', name: 'Kabir Mehta', relationship: 'Roommate', upi: 'kabir@upi', createdAt: new Date().toISOString() },
  { id: 'p3', name: 'Sneha Patel', relationship: 'Classmate', upi: '', createdAt: new Date().toISOString() },
  { id: 'p4', name: 'Rohan Gupta', relationship: 'Friend', upi: '', createdAt: new Date().toISOString() }
];

const DEFAULT_EXPENSES = [
  {
    id: 'e1',
    title: 'Monthly Flat Wifi Bill',
    totalAmount: 600,
    paidById: 'me',
    splitType: 'BoughtForPerson',
    splits: [{ personId: 'p1', amountOwed: 300 }, { personId: 'p2', amountOwed: 300 }],
    category: 'RoomRentUtilities',
    paymentSource: 'Paytm',
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
    paytmRef: 'PT928174'
  },
  {
    id: 'e2',
    title: 'Lab Manual & Spiral Binding',
    totalAmount: 180,
    paidById: 'me',
    splitType: 'BoughtForPerson',
    splits: [{ personId: 'p3', amountOwed: 180 }],
    category: 'StationeryBooks',
    paymentSource: 'Paytm',
    date: new Date(Date.now() - 86400000).toISOString(),
    paytmRef: 'PT102948'
  }
];

class WhoseTabApp {
  constructor() {
    this.ledger = this.loadLedger();
    this.selectedPersonId = null;
    this.detectedPaytmData = null;
    this.currentFilter = 'all';

    this.initElements();
    this.initTheme();
    this.bindEvents();
    this.checkUrlParameters();
    this.render();
  }

  loadLedger() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Could not read from localStorage', e);
    }
    // Return initial default ledger
    return {
      version: 1,
      people: DEFAULT_PEOPLE,
      expenses: DEFAULT_EXPENSES,
      settlements: [],
      settings: {
        theme: 'dark',
        autoDetectClipboard: true
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
      autoDetectClipboardToggle: document.getElementById('autoDetectClipboardToggle'),
      
      paytmNotificationBanner: document.getElementById('paytmNotificationBanner'),
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
      snapAmount: document.getElementById('snapAmount'),
      snapTitle: document.getElementById('snapTitle'),
      modalPeopleChips: document.getElementById('modalPeopleChips'),
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

      exportDataBtn: document.getElementById('exportDataBtn'),
      importDataBtn: document.getElementById('importDataBtn'),
      importFileInput: document.getElementById('importFileInput'),
      loadDemoDataBtn: document.getElementById('loadDemoDataBtn'),
      clearDataBtn: document.getElementById('clearDataBtn'),
    };
  }

  // ================= THEME CONTROLLER =================
  initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    this.setTheme(savedTheme, false);
    if (this.dom.themeSelector) {
      this.dom.themeSelector.value = savedTheme;
    }
  }

  setTheme(theme, save = true) {
    let activeTheme = theme;
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeTheme = isDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', activeTheme);
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
      themeIcon.textContent = activeTheme === 'dark' ? '🌙' : '☀️';
    }
    if (save) {
      localStorage.setItem(THEME_KEY, theme);
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

  // ================= EVENT LISTENERS =================
  bindEvents() {
    // Theme toggle
    this.dom.themeQuickToggleBtn.addEventListener('click', () => this.toggleTheme());
    this.dom.themeSelector.addEventListener('change', (e) => this.setTheme(e.target.value));

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

    // Add Person Modal Open / Close
    const openAddPerson = () => {
      this.dom.addPersonModal.classList.remove('hidden');
    };
    this.dom.quickAddPersonBtn.addEventListener('click', openAddPerson);
    this.dom.addPersonPageBtn.addEventListener('click', openAddPerson);
    this.dom.closeAddPersonModalBtn.addEventListener('click', () => {
      this.dom.addPersonModal.classList.add('hidden');
    });

    // Settle Modal Close
    this.dom.closeSettleModalBtn.addEventListener('click', () => {
      this.dom.settleModal.classList.add('hidden');
    });

    // Forms
    this.dom.snapExpenseForm.addEventListener('submit', (e) => this.handleSnapSubmit(e));
    this.dom.addPersonForm.addEventListener('submit', (e) => this.handleAddPersonSubmit(e));
    this.dom.settleForm.addEventListener('submit', (e) => this.handleSettleSubmit(e));

    // Paytm Simulation Chips
    document.querySelectorAll('.chip-test').forEach(btn => {
      btn.addEventListener('click', () => {
        const amt = btn.dataset.amount;
        const to = btn.dataset.to;
        const cat = btn.dataset.category;
        this.showPaytmDetectedBanner({
          amount: parseFloat(amt),
          recipient: to,
          suggestedCategory: cat,
          rawText: `Paid ₹${amt} to ${to} successfully via Paytm`
        });
      });
    });

    // Paytm Banner actions
    this.dom.paytmSnapBtn.addEventListener('click', () => {
      if (this.detectedPaytmData) {
        this.openSnapModalWithPaytm(this.detectedPaytmData);
        this.dom.paytmNotificationBanner.classList.add('hidden');
      }
    });
    this.dom.paytmDismissBtn.addEventListener('click', () => {
      this.dom.paytmNotificationBanner.classList.add('hidden');
    });

    // Window focus / clipboard listener
    window.addEventListener('focus', () => this.checkClipboardForPaytm());

    // Backup & Restore
    this.dom.exportDataBtn.addEventListener('click', () => this.exportBackup());
    this.dom.importDataBtn.addEventListener('click', () => this.dom.importFileInput.click());
    this.dom.importFileInput.addEventListener('change', (e) => this.importBackup(e));
    this.dom.loadDemoDataBtn.addEventListener('click', () => {
      if (confirm('Load demo roommates, classmates, and expenses?')) {
        this.ledger.people = DEFAULT_PEOPLE;
        this.ledger.expenses = DEFAULT_EXPENSES;
        this.ledger.settlements = [];
        this.saveLedger();
      }
    });
    this.dom.clearDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all data? This cannot be undone.')) {
        this.ledger = { version: 1, people: [], expenses: [], settlements: [], settings: {} };
        this.saveLedger();
      }
    });
  }

  // ================= PAYTM DEEP LINK & CLIPBOARD =================
  checkUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const amount = params.get('amount') || params.get('amt');
    const to = params.get('to') || params.get('recipient') || params.get('name');
    const note = params.get('note') || params.get('title') || params.get('desc');

    if (amount) {
      setTimeout(() => {
        this.openSnapModalWithPaytm({
          amount: parseFloat(amount),
          recipient: to || 'Paytm Purchase',
          note: note || '',
          suggestedCategory: 'Groceries'
        });
      }, 250);
    }
  }

  async checkClipboardForPaytm() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      const parsed = this.parsePaytmString(text);
      if (parsed) {
        this.showPaytmDetectedBanner(parsed);
      }
    } catch (e) {
      // Clipboard access not granted or not available
    }
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
    this.detectedPaytmData = data;
    this.dom.paytmBannerDetail.textContent = `Paid ₹${data.amount.toFixed(2)} to ${data.recipient || 'Merchant'}`;
    this.dom.paytmNotificationBanner.classList.remove('hidden');
  }

  // ================= MODAL CONTROLLER =================
  openSnapModal() {
    this.selectedPersonId = null;
    this.dom.snapAmount.value = '';
    this.dom.snapTitle.value = '';
    this.renderModalPeopleChips();
    this.dom.snapExpenseModal.classList.remove('hidden');
    setTimeout(() => this.dom.snapAmount.focus(), 100);
  }

  openSnapModalWithPaytm(data) {
    this.selectedPersonId = null;
    this.dom.snapAmount.value = data.amount || '';
    this.dom.snapTitle.value = data.recipient ? `${data.recipient}` : 'Paytm Expense';
    
    // Auto-select category
    if (data.suggestedCategory) {
      const radio = document.querySelector(`input[name="category"][value="${data.suggestedCategory}"]`);
      if (radio) radio.checked = true;
    }

    this.renderModalPeopleChips();
    this.dom.snapExpenseModal.classList.remove('hidden');
  }

  closeSnapModal() {
    this.dom.snapExpenseModal.classList.add('hidden');
  }

  renderModalPeopleChips() {
    this.dom.modalPeopleChips.innerHTML = '';
    if (this.ledger.people.length === 0) {
      this.dom.modalPeopleChips.innerHTML = '<span class="text-xs text-muted">No contacts yet. Tap "+ Add Person" first!</span>';
      return;
    }

    this.ledger.people.forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `person-chip ${this.selectedPersonId === p.id ? 'selected' : ''}`;
      chip.innerHTML = `<span>${p.name}</span> <small class="text-xs">(${p.relationship})</small>`;
      chip.addEventListener('click', () => {
        this.selectedPersonId = p.id;
        document.querySelectorAll('.person-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
      this.dom.modalPeopleChips.appendChild(chip);
    });
  }

  // ================= DATA LOGIC & CALCULATIONS =================
  calculateNetBalances() {
    const balances = {};
    this.ledger.people.forEach(p => balances[p.id] = 0);

    // Process Expenses (User paid)
    this.ledger.expenses.forEach(exp => {
      if (exp.paidById === 'me') {
        exp.splits.forEach(split => {
          if (split.personId !== 'me') {
            balances[split.personId] = (balances[split.personId] || 0) + split.amountOwed;
          }
        });
      }
    });

    // Process Settlements (Person paid user)
    this.ledger.settlements.forEach(s => {
      if (s.toPersonId === 'me') {
        balances[s.fromPersonId] = (balances[s.fromPersonId] || 0) - s.amount;
      }
    });

    // Rounding
    Object.keys(balances).forEach(k => {
      balances[k] = Math.round(balances[k] * 100) / 100;
    });

    return balances;
  }

  handleSnapSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(this.dom.snapAmount.value);
    const title = this.dom.snapTitle.value.trim() || 'Purchase';
    const category = document.querySelector('input[name="category"]:checked')?.value || 'General';
    const splitMode = document.querySelector('input[name="splitMode"]:checked')?.value || 'BoughtForPerson';

    if (!amount || amount <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    if (!this.selectedPersonId) {
      alert('Please choose whose stuff you bought!');
      return;
    }

    const splitAmount = splitMode === 'Equal' ? (amount / 2) : amount;

    const newExpense = {
      id: 'e_' + Date.now(),
      title,
      totalAmount: amount,
      paidById: 'me',
      splitType: splitMode,
      splits: [{ personId: this.selectedPersonId, amountOwed: splitAmount }],
      category,
      paymentSource: 'Paytm',
      date: new Date().toISOString(),
      paytmRef: this.detectedPaytmData?.rawText ? 'Paytm Intent' : null
    };

    this.ledger.expenses.unshift(newExpense);
    this.saveLedger();
    this.closeSnapModal();

    const targetPerson = this.ledger.people.find(p => p.id === this.selectedPersonId);
    alert(`⚡ Snapped ₹${amount.toFixed(2)} for ${targetPerson?.name}!`);
  }

  handleAddPersonSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('personName').value.trim();
    const rel = document.querySelector('input[name="relationship"]:checked')?.value || 'Friend';
    const upi = document.getElementById('personUpi').value.trim();

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
    this.dom.addPersonModal.classList.add('hidden');
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

    // Render People List with Net Balances
    this.dom.peopleList.innerHTML = '';
    if (this.ledger.people.length === 0) {
      this.dom.peopleList.innerHTML = '<div class="text-sm text-muted text-center py-3">No contacts added yet. Tap "+ Add Person" to get started!</div>';
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
            ${bal > 0 ? `<button class="btn-settle" data-id="${p.id}">Settle</button>` : ''}
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
      this.dom.recentExpensesList.innerHTML = '<div class="text-sm text-muted text-center py-3">No purchases logged yet. Tap "Snap Expense" below!</div>';
    } else {
      this.ledger.expenses.slice(0, 8).forEach(exp => {
        const catIcons = {
          Groceries: '🥦', FoodDining: '🍛', SnacksChai: '☕',
          StationeryBooks: '📚', RoomRentUtilities: '💡', General: '📦'
        };
        const icon = catIcons[exp.category] || '📦';
        const dateStr = new Date(exp.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
        
        // Find participant name
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
              ${exp.paymentSource === 'Paytm' ? '<span class="badge-paytm-tag">Paytm</span>' : ''}
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
      this.dom.contactsFullList.innerHTML = '<div class="text-sm text-muted text-center py-4">No contacts found in this filter.</div>';
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
          <button class="btn btn-sm btn-secondary snap-for-person-btn" data-id="${p.id}">Snap</button>
        </div>
      `;

      card.querySelector('.snap-for-person-btn').addEventListener('click', () => {
        this.selectedPersonId = p.id;
        this.openSnapModal();
        this.renderModalPeopleChips();
      });

      this.dom.contactsFullList.appendChild(card);
    });
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhoseTabApp();
});
