/* Full app.js - replacement
   - Daily Budget = Remaining Money / Remaining Days of month (no budgets involved)
   - Sync URL input persists to localStorage and is loaded on app start
   - Quick-action buttons alignment preserved via CSS (ui-polish)
   - Loan repair and repayment logic preserved
*/

(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const today = new Date().toISOString().slice(0, 10);

  const money = n => `${Math.round(Number(n) || 0).toLocaleString()} MMK`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Defaults
  const defaults = [
    ['Food & Drinks', 'expense'],
    ['Transportation', 'expense'],
    ['Family', 'expense'],
    ['Housing', 'expense'],
    ['Utilities', 'expense'],
    ['Shopping', 'expense'],
    ['Health', 'expense'],
    ['Education', 'expense'],
    ['Salary', 'income'],
    ['Loan', 'income']
  ];

  const fallback = {
    transactions: [],
    categories: defaults.map(([name, type]) => ({ name, type })),
    budgets: [],
    goals: [],
    loans: [],
    settings: { theme: 'light', syncUrl: '', syncRevision: '', lastSynced: '' },
    reportMonth: today.slice(0,7),
    currentType: 'expense'
  };

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      return Object.assign({}, fallback, s);
    } catch (e) {
      return Object.assign({}, fallback);
    }
  }
  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  let state = loadState();

  // UI helpers
  function toast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = 'none', 2200);
  }

  function month() { return state.reportMonth || today.slice(0,7); }
  function items() { return state.transactions.filter(t => String(t.date || '').slice(0,7) === month()); }

  function totals(xs) {
    return xs.reduce((r, t) => {
      const n = Number(t.amount) || 0;
      if (t.type === 'income') r.income += n;
      else if (t.type === 'expense') r.expense += n;
      else if (t.type === 'loan') r.loan += n;
      else if (t.type === 'credit') r.credit += n;
      else {
        if (t.type === 'income') r.income += n; else r.expense += n;
      }
      return r;
    }, { income:0, expense:0, loan:0, credit:0 });
  }

  function daysRemainingInMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const m = now.getMonth();
    const last = new Date(year, m+1, 0).getDate();
    return Math.max(1, last - now.getDate() + 1);
  }

  // DAILY BUDGET: Remaining Money / Remaining Days (no budgets)
  function computeDailyBudgetTotal() {
    const xs = items();
    const t = totals(xs);
    // Remaining Money = income - expense - loan - credit
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    const daysLeft = daysRemainingInMonth() || 1;
    const daily = remainingMoney > 0 ? Math.floor(remainingMoney / daysLeft) : 0;
    return daily;
  }

  // Loan logic (repair + apply repayments)
  function repairLoanRecords() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    state.transactions.forEach(tx => {
      const cat = String(tx.category || '').toLowerCase();
      const isLoanReceipt = cat === 'loan' || cat === 'loan received' || tx.loanType === 'loan';
      const isPayback = cat === 'loan repayment' || cat === 'loan payback' || tx.loanType === 'payback';
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });

    state.transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      const found = state.loans.find(l => String(l.id) === String(tx.loanId));
      if (!found) {
        state.loans.push({
          id: tx.loanId,
          name: tx.note || 'Loan',
          principal: Number(tx.amount) || 0,
          remaining: Number(tx.amount) || 0,
          date: tx.date,
          note: tx.note || '',
          createdAt: tx.createdAt || Date.now()
        });
        changed = true;
      }
    });

    if (changed) saveState();
    return state;
  }

  function applyRepayments() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    const loansById = {};
    state.loans.forEach(l => { loansById[String(l.id)] = l; });

    const txs = (state.transactions || []).slice().sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
    txs.forEach(tx => {
      if (tx.type === 'expense' && tx.loanId && !tx._loanApplied) {
        const loan = loansById[String(tx.loanId)];
        if (loan) {
          const amt = Number(tx.amount) || 0;
          loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - amt);
          tx._loanApplied = true;
          changed = true;
        }
      }
    });

    if (changed) saveState();
    return state;
  }

  function renderLoanSummary() {
    repairLoanRecords();
    applyRepayments();

    const host = $('loanBI');
    if (!host) return;
    const monthKey = month();
    const rows = state.transactions.filter(tx => String(tx.date || '').slice(0,7) === monthKey);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const outstanding = (state.loans || []).reduce((s, l) => s + (Number(l.remaining) || 0), 0);

    const loanRows = (state.loans || []).map(loan => {
      return `<div class="loan-bi-row"><span>${esc(loan.name||'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`;
    }).join('') || `<div class="empty muted">No loan records yet</div>`;

    host.innerHTML = `
      <div class="loan-bi-grid">
        <div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div>
        <div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div>
        <div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div>
      </div>
      <div class="loan-bi-list">${loanRows}</div>
    `;
  }

  function ensureRepaymentDropdown() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!loans.length) { holder.style.display = 'none'; holder.innerHTML = ''; return; }
    holder.style.display = 'block';
    // ensure label + select
    if (!holder.querySelector('select')) {
      const label = document.createElement('label'); label.textContent = 'Select loan to repay';
      const select = document.createElement('select'); select.id = 'loanRepaySelect';
      holder.appendChild(label); holder.appendChild(select);
    }
    const select = holder.querySelector('select');
    select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name||'Loan')} — ${money(l.remaining)}</option>`).join('');
  }

  function populateCategories() {
    const s = $('category');
    if (!s) return;
    const list = state.categories.filter(c => c.type === state.currentType);
    s.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
  }

  function renderBudgets() {
    const container = $('budgetReport');
    if (!container) return;
    const rows = Array.isArray(state.budgets) ? state.budgets : [];
    if (!rows.length) { container.innerHTML = `<div class="muted">No budgets set</div>`; return; }
    const html = rows.map(b => {
      const spent = state.transactions.filter(t => t.type === 'expense' && (t.category||'General') === b.category)
                        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const pct = b.amount ? Math.round((spent / b.amount) * 100) : 0;
      return `<div class="budget-report-row">
                <div class="label"><span>${esc(b.category)}</span><small>${money(spent)} / ${money(b.amount)}</small></div>
                <div class="bar"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div>
              </div>`;
    }).join('');
    container.innerHTML = html;
  }

  function renderTransactions() {
    const host = $('txList');
    if (!host) return;
    const xs = (state.transactions || []).slice().reverse().slice(0, 50);
    if (!xs.length) { host.innerHTML = `<div class="muted">No transactions</div>`; return; }
    host.innerHTML = xs.map(tx => {
      const right = tx.type === 'income' ? `<b style="color:green">${money(tx.amount)}</b>` : `<b>${money(tx.amount)}</b>`;
      return `<div class="row" style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--card)">
                <div>
                  <div style="font-weight:700">${esc(tx.category || tx.note || tx.type)}</div>
                  <small class="muted">${esc(tx.note || '')} ${tx.loanId ? ' • ' + esc(tx.loanId) : ''}</small>
                </div>
                <div>${right}</div>
              </div>`;
    }).join('');
  }

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
    if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`;
  }

  function renderHeaderStats() {
    const xs = items();
    const t = totals(xs);
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    const daily = computeDailyBudgetTotal(); // remainingMoney / daysRemaining
    const mapping = [
      ['income', t.income],
      ['expense', t.expense],
      ['loan', t.loan],
      ['daily', daily],
      ['remaining', remainingMoney]
    ];
    mapping.forEach(([id, val]) => {
      const el = $(id);
      if (!el) return;
      const strong = el.querySelector('strong');
      if (strong) strong.textContent = money(val);
      else el.textContent = money(val);
    });
  }

  function renderAll() {
    greeting();
    populateCategories();
    renderHeaderStats();
    renderBudgets();
    renderTransactions();
    renderLoanSummary();
  }

  // form wiring
  function wireForm() {
    const form = $('form');
    if (!form) return;
    const dateInput = $('date'), amountInput = $('amount'), noteInput = $('note'), typeSelect = $('type'), categorySelect = $('category');
    if (dateInput && !dateInput.value) dateInput.value = today;

    form.addEventListener('submit', e => {
      e.preventDefault();
      const type = typeSelect?.value || 'expense';
      const amount = Number(amountInput?.value || 0);
      if (!amount || amount <= 0) { toast('Enter an amount greater than 0'); return; }
      const tx = {
        id: `tx-${Date.now()}`,
        type,
        amount,
        category: categorySelect?.value || '',
        note: noteInput?.value || '',
        date: dateInput?.value || today,
        createdAt: Date.now()
      };

      if (type === 'loan') {
        tx.type = 'income';
        tx.loanId = `loan-${tx.id}`;
      }

      const loanSelect = $('loanRepaySelect');
      if (loanSelect && loanSelect.value) {
        tx.loanId = loanSelect.value;
        tx.type = 'expense';
      }

      state.transactions = state.transactions || [];
      state.transactions.push(tx);

      if (tx.type === 'income' && tx.loanId) {
        const found = (state.loans || []).find(l => String(l.id) === String(tx.loanId));
        if (!found) {
          state.loans = state.loans || [];
          state.loans.push({
            id: tx.loanId,
            name: tx.note || 'Loan',
            principal: Number(tx.amount) || 0,
            remaining: Number(tx.amount) || 0,
            date: tx.date,
            note: tx.note || '',
            createdAt: tx.createdAt
          });
        }
      }

      saveState();
      applyRepayments();
      renderAll();

      if (state.settings && state.settings.syncUrl) {
        pushChanges().catch(() => {});
      }

      showPage('home');
      form.reset();
      if (dateInput) dateInput.value = today;
      toast('Saved');
    });

    $('cancelAdd')?.addEventListener('click', () => {
      form.reset();
      if (dateInput) dateInput.value = today;
      showPage('home');
    });
  }

  // NAV and quick-actions
  function wireNav() {
    document.addEventListener('click', e => {
      const p = e.target.closest('[data-page]');
      if (p) { showPage(p.dataset.page); return; }
      const a = e.target.closest('[data-add]');
      if (a) {
        const type = a.dataset.add;
        if (type === 'payback') {
          state.currentType = 'expense';
          showPage('add');
          setTimeout(() => {
            $('type').value = 'expense';
            ensureRepaymentDropdown();
            const holder = $('loanSelectHolder'); if (holder) holder.style.display = 'block';
            populateCategories();
          }, 50);
        } else {
          state.currentType = type;
          showPage('add');
          setTimeout(() => {
            $('type').value = type === 'loan' ? 'loan' : type;
            populateCategories();
            ensureRepaymentDropdown();
          }, 50);
        }
      }
    });

    document.querySelectorAll('nav [data-page]').forEach(b => {
      b.addEventListener('click', () => showPage(b.dataset.page));
    });
  }

  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    if (id === 'home') renderAll();
    if (id === 'settings') {
      const inp = $('syncUrlInput'); if (inp) inp.value = state.settings?.syncUrl || '';
    }
  }

  // Sync helpers
  async function api(action, payload = {}) {
    if (!state.settings || !state.settings.syncUrl) throw new Error('Add the Apps Script URL first.');
    const body = { action, payload };
    const r = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.ok ? r.json() : Promise.reject(new Error('Sync failed'));
  }

  async function pushChanges() {
    if (!state.settings || !state.settings.syncUrl) return;
    try {
      await api('replaceAll', {
        transactions: state.transactions || [],
        categories: state.categories || [],
        budgets: state.budgets || [],
        loans: state.loans || []
      });
      toast('Pushed changes to sheet');
    } catch (e) {
      console.error(e);
      toast('Push failed');
    }
  }

  async function pullChanges() {
    if (!state.settings || !state.settings.syncUrl) return;
    try {
      const res = await api('getAll');
      if (res && res.data) {
        state.transactions = res.data.transactions || state.transactions || [];
        state.categories = res.data.categories || state.categories || [];
        state.budgets = res.data.budgets || state.budgets || [];
        state.loans = res.data.loans || state.loans || [];
        saveState();
        renderAll();
        toast('Pulled from sheet');
      } else {
        toast('No data from sheet');
      }
    } catch (e) {
      console.error(e);
      toast('Pull failed');
    }
  }

  // Settings wiring and persistence for sync URL
  function wireSettings() {
    const syncInput = $('syncUrlInput');
    const saveBtn = $('saveSyncUrl');
    const testBtn = $('testSync');
    const status = $('syncStatus');

    // load into input on init
    if (syncInput) syncInput.value = state.settings?.syncUrl || '';

    // immediate save on change (debounced)
    let _deb;
    if (syncInput) {
      syncInput.addEventListener('input', () => {
        clearTimeout(_deb);
        _deb = setTimeout(() => {
          const url = (syncInput.value || '').trim();
          state.settings = state.settings || {};
          state.settings.syncUrl = url;
          saveState();
          if (status) status.textContent = url ? 'Saved' : 'Cleared';
        }, 450);
      });
      // also persist on blur immediately
      syncInput.addEventListener('blur', () => {
        const url = (syncInput.value || '').trim();
        state.settings = state.settings || {};
        state.settings.syncUrl = url;
        saveState();
        if (status) status.textContent = url ? 'Saved' : 'Cleared';
        toast(url ? 'Sync URL saved' : 'Sync URL cleared');
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const url = (syncInput?.value || '').trim();
        state.settings = state.settings || {};
        state.settings.syncUrl = url;
        saveState();
        if (status) status.textContent = url ? 'Saved' : 'Cleared';
        toast(url ? 'Sync URL saved' : 'Sync URL cleared');
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const url = (syncInput?.value || '').trim();
        if (!url) { toast('Enter Apps Script URL first'); return; }
        state.settings = state.settings || {};
        state.settings.syncUrl = url;
        saveState();
        try { await pullChanges(); } catch (e) { toast('Test sync failed'); }
      });
    }

    // theme switch
    $('switch')?.addEventListener('click', () => {
      state.settings.theme = (state.settings.theme === 'dark') ? 'light' : 'dark';
      applyTheme();
      saveState();
    });
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.settings?.theme === 'dark');
    $('currentTheme') && ($('currentTheme').textContent = state.settings?.theme || 'light');
  }

  function wireTypeChange() {
    $('type')?.addEventListener('change', e => {
      state.currentType = e.target.value;
      populateCategories();
      if (e.target.value === 'expense') {
        const hasLoans = (state.loans || []).some(l => Number(l.remaining) > 0);
        const holder = $('loanSelectHolder');
        if (holder) holder.style.display = hasLoans ? 'block' : 'none';
        ensureRepaymentDropdown();
      } else {
        const holder = $('loanSelectHolder'); if (holder) holder.style.display = 'none';
      }
    });
  }

  function prepareLoanSelectHolder() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    holder.innerHTML = '';
    holder.style.display = 'none';
  }

  function init() {
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.categories = Array.isArray(state.categories) ? state.categories : fallback.categories.slice();
    state.budgets = Array.isArray(state.budgets) ? state.budgets : [];
    state.loans = Array.isArray(state.loans) ? state.loans : [];

    applyTheme();
    wireNav();
    wireForm();
    wireSettings();
    wireTypeChange();
    prepareLoanSelectHolder();

    // ensure sync input loaded
    const syncInput = $('syncUrlInput');
    if (syncInput) syncInput.value = state.settings?.syncUrl || '';

    showPage('home');

    repairLoanRecords();
    applyRepayments();
    renderAll();

    document.addEventListener('click', e => {
      const a = e.target.closest('[data-add]');
      if (a) setTimeout(() => ensureRepaymentDropdown(), 60);
    });

    $('month')?.addEventListener('change', e => {
      state.reportMonth = e.target.value || today.slice(0,7);
      saveState(); renderAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else init();

  // small API
  window.moneyflow = {
    state,
    save: saveState,
    pull: pullChanges,
    push: pushChanges,
    repairLoanRecords,
    applyRepayments,
    renderAll
  };

})();
