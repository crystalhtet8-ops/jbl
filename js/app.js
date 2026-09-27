(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const today = new Date().toISOString().slice(0, 10);

  const defaultCategories = [
    ['Food & Drinks', 'expense'],
    ['Transportation', 'expense'],
    ['Family', 'expense'],
    ['Housing', 'expense'],
    ['Utilities', 'expense'],
    ['Shopping', 'expense'],
    ['Health', 'expense'],
    ['Education', 'expense']
  ];

  const fallback = {
    transactions: [],
    loans: [],
    categories: defaultCategories.map(([name, type]) => ({ name, type })),
    budgets: [],
    goals: [],
    settings: {
      theme: 'light',
      syncUrl: '',
      syncRevision: '',
      lastSynced: ''
    },
    reportMonth: today.slice(0, 7),
    currentType: 'expense'
  };

  let state = loadState();
  let syncing = false;
  let syncQueued = false;

  normalizeState();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({}, fallback, saved || {});
    } catch (_) {
      return Object.assign({}, fallback);
    }
  }

  function normalizeState() {
    state.settings = Object.assign({}, fallback.settings, state.settings || {});
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    state.categories = Array.isArray(state.categories) ? state.categories : fallback.categories.slice();
    state.budgets = Array.isArray(state.budgets) ? state.budgets : [];
    state.goals = Array.isArray(state.goals) ? state.goals : [];
    state.reportMonth = state.reportMonth || today.slice(0, 7);
    state.currentType = state.currentType || 'expense';
    repairTransactionIds();
  }

  function saveState() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) {
      toast('Unable to save local data');
    }
  }

  function uid(prefix) {
    return `${prefix || 'item'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function money(value) {
    return `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function toast(message) {
    const element = $('toast');
    if (!element) return;

    element.textContent = message;
    element.classList.add('on');

    clearTimeout(element._timer);
    element._timer = setTimeout(() => {
      element.classList.remove('on');
    }, 2200);
  }

  function repairTransactionIds() {
    let changed = false;

    state.transactions.forEach(transaction => {
      if (!transaction.id) {
        transaction.id = uid('tx');
        changed = true;
      }
      if (!transaction.createdAt) {
        transaction.createdAt = Date.now();
        changed = true;
      }
      if (!transaction.date) {
        transaction.date = today;
        changed = true;
      }
    });

    if (changed) saveState();
  }

  function currentMonth() {
    return state.reportMonth || today.slice(0, 7);
  }

  function monthItems(includeIncome = true) {
    return state.transactions.filter(transaction =>
      String(transaction.date || '').slice(0, 7) === currentMonth()
      && (includeIncome ? true : transaction.type !== 'income')
    );
  }

  function getTotals(items) {
    return items.reduce((result, transaction) => {
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === 'income') result.income += amount;
      else if (transaction.type === 'expense') result.expense += amount;
      else if (transaction.type === 'loan') result.loan += amount;
      else if (transaction.type === 'credit') result.credit += amount;
      return result;
    }, { income: 0, expense: 0, loan: 0, credit: 0 });
  }

  function safeClosest(event, selector) {
    if (!event || !event.target) return null;
    let target = event.target;
    if (target.nodeType === 3) target = target.parentElement;
    if (target && typeof target.closest === 'function') return target.closest(selector);
    return null;
  }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === pageId));
    document.querySelectorAll('nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
    window.scrollTo(0, 0);
  }

  function setTransactionType(type) {
    state.currentType = type || 'expense';
    const titles = {
      expense: 'Add Expense',
      income: 'Add Income',
      loan: 'Add Loan',
      credit: 'Add Loan Repayment'
    };
    const title = $('formTitle');
    if (title) title.textContent = titles[state.currentType] || 'Add Transaction';

    document.querySelectorAll('[data-type]').forEach(button => {
      button.classList.toggle('active', button.dataset.type === state.currentType);
    });

    populateCategories();
    updateLoanRepaymentField();
  }

  function populateCategories() {
    const select = $('category');
    if (!select) return;

    let categories = state.categories.filter(c => c.type === state.currentType);

    if (state.currentType === 'credit') {
      categories = [{ name: 'Loan Repayment', type: 'credit' }];
    }

    if (!categories.length) {
      categories = [{
        name: state.currentType === 'income' ? 'General Income' : 'General',
        type: state.currentType
      }];
    }

    select.innerHTML = categories.map(c => `
      <option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>
    `).join('');
  }

  function availableLoans() {
    return (state.loans || []).filter(l => Number(l.remaining) > 0);
  }

  function updateLoanRepaymentField() {
    const form = $('form');
    if (!form) return;

    let holder = $('loanSelectHolder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'loanSelectHolder';
      holder.className = 'loan-select-holder';
      const note = $('note');
      if (note && note.parentElement) {
        note.parentElement.insertAdjacentElement('afterend', holder);
      } else {
        form.appendChild(holder);
      }
    }

    if (state.currentType !== 'credit') {
      holder.style.display = 'none';
      holder.innerHTML = '';
      return;
    }

    holder.style.display = '';
    const loans = availableLoans();
    if (!loans.length) {
      holder.innerHTML = `
        <label>Loan to repay
          <select id="loanRepaySelect" name="loanRepaySelect">
            <option value="">No outstanding loans</option>
          </select>
        </label>
      `;
      return;
    }

    holder.innerHTML = `
      <label>Loan to repay
        <select id="loanRepaySelect" name="loanRepaySelect">
          <option value="">Choose a loan</option>
          ${loans.map(loan => `
            <option value="${escapeHtml(String(loan.id))}">
              ${escapeHtml(loan.name || 'Loan')} — ${money(loan.remaining)}
            </option>
          `).join('')}
        </select>
      </label>
    `;
  }

  function findLoan(id) {
    return (state.loans || []).find(l => String(l.id) === String(id));
  }

  function createLoanTransaction(amount, date, note, category) {
    const transactionId = uid('tx');
    const loanId = uid('loan');

    const transaction = {
      id: transactionId,
      type: 'income',
      amount,
      date,
      category: category || 'Loan',
      note: note || '',
      loanType: 'loan',
      loanId,
      createdAt: Date.now()
    };

    const loan = {
      id: loanId,
      name: note || 'Loan',
      principal: amount,
      remaining: amount,
      date,
      note: note || '',
      createdAt: transaction.createdAt
    };

    state.loans.push(loan);
    state.transactions.push(transaction);
    return transaction;
  }

  function createRepaymentTransaction(amount, date, note, category, loanId) {
    const loan = findLoan(loanId);
    if (!loan) throw new Error('Selected loan was not found.');

    const remaining = Number(loan.remaining) || 0;
    if (remaining <= 0) throw new Error('The selected loan has no remaining balance.');

    const transaction = {
      id: uid('tx'),
      type: 'expense',
      amount,
      date,
      category: category || 'Loan Repayment',
      note: note || `Repayment — ${loan.name || 'Loan'}`,
      loanType: 'payback',
      loanId,
      createdAt: Date.now()
    };

    loan.remaining = Math.max(0, remaining - amount);
    state.transactions.push(transaction);
    return transaction;
  }

  function createNormalTransaction(type, amount, date, category, note) {
    const transaction = {
      id: uid('tx'),
      type,
      amount,
      date,
      category: category || 'General',
      note: note || '',
      createdAt: Date.now()
    };
    state.transactions.push(transaction);
    return transaction;
  }

  async function saveTransaction(event) {
    event.preventDefault();

    const amountElement = $('amount');
    const dateElement = $('date');
    const categoryElement = $('category');
    const noteElement = $('note');

    const amount = Number(amountElement && amountElement.value);
    const date = (dateElement && dateElement.value) || today;
    const category = (categoryElement && categoryElement.value) || 'General';
    const note = (noteElement && noteElement.value.trim()) || '';

    if (!amount || amount <= 0) {
      toast('Enter an amount greater than zero');
      return;
    }

    let transaction;

    try {
      if (state.currentType === 'loan') {
        transaction = createLoanTransaction(amount, date, note, category);
      } else if (state.currentType === 'credit') {
        const loanSelect = $('loanRepaySelect');
        const loanId = loanSelect && loanSelect.value;
        if (!loanId) {
          toast('Choose a loan to repay');
          return;
        }
        transaction = createRepaymentTransaction(amount, date, note, category, loanId);
      } else {
        transaction = createNormalTransaction(
          state.currentType === 'income' ? 'income' : 'expense',
          amount,
          date,
          category,
          note
        );
      }
    } catch (err) {
      toast(err.message || 'Unable to save transaction');
      return;
    }

    saveState();
    render();

    showPage('home');
    toast('Transaction saved');

    await queueSync();
  }

  function mergeById(serverItems, localItems) {
    const result = {};
    const noId = [];

    (Array.isArray(serverItems) ? serverItems : []).forEach(item => {
      if (!item) return;
      if (item.id) result[String(item.id)] = item;
      else noId.push(item);
    });

    (Array.isArray(localItems) ? localItems : []).forEach(item => {
      if (!item) return;
      if (item.id) {
        if (!result[String(item.id)]) result[String(item.id)] = item;
      } else {
        noId.push(item);
      }
    });

    return Object.values(result).concat(noId);
  }

  function mergeByKey(serverItems, localItems, key) {
    const result = {};

    (Array.isArray(serverItems) ? serverItems : []).forEach(item => {
      if (item && item[key] !== undefined) result[String(item[key])] = item;
    });

    (Array.isArray(localItems) ? localItems : []).forEach(item => {
      if (item && item[key] !== undefined) {
        if (!result[String(item[key])]) result[String(item[key])] = item;
      }
    });

    return Object.values(result);
  }

  async function api(action, payload) {
    if (!state.settings.syncUrl) throw new Error('Google Sheets sync URL is not configured.');
    const response = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload: payload || {} })
    });

    if (!response.ok) throw new Error(`Sync request failed: ${response.status}`);
    const data = await response.json();
    if (data && data.ok === false) throw new Error(data.message || 'Google Sheets sync failed.');
    return data;
  }

  async function syncOnce() {
    if (!state.settings.syncUrl) return false;

    let serverData = { transactions: [], loans: [], categories: [], budgets: [], goals: [] };

    try {
      const response = await api('getAll');
      if (response && response.data) serverData = response.data;
    } catch (e) {
      console.warn('pull failed', e);
    }

    const mergedTransactions = mergeById(serverData.transactions, state.transactions);
    const mergedLoans = mergeById(serverData.loans, state.loans);
    const mergedCategories = mergeByKey(serverData.categories, state.categories, 'name');
    const mergedBudgets = mergeByKey(serverData.budgets, state.budgets, 'category');
    const mergedGoals = mergeByKey(serverData.goals, state.goals, 'name');

    const payload = {
      transactions: mergedTransactions,
      loans: mergedLoans,
      categories: mergedCategories,
      budgets: mergedBudgets,
      goals: mergedGoals
    };

    const response = await api('replaceAll', payload);
    if (response && response.ok === false) throw new Error(response.message || 'Replace failed.');

    state.transactions = mergedTransactions;
    state.loans = mergedLoans;
    state.categories = mergedCategories;
    state.budgets = mergedBudgets;
    state.goals = mergedGoals;
    state.settings.lastSynced = new Date().toISOString();
    saveState();
    return true;
  }

  async function queueSync() {
    if (!state.settings.syncUrl) return;

    if (syncing) {
      syncQueued = true;
      return;
    }

    syncing = true;
    try {
      do {
        syncQueued = false;
        await syncOnce();
      } while (syncQueued);
    } catch (e) {
      console.warn('sync failed', e);
      toast('Saved locally; sync failed');
    } finally {
      syncing = false;
      render();
    }
  }

  async function pullFromSheets() {
    if (!state.settings.syncUrl || syncing) return;

    syncing = true;
    try {
      const response = await api('getAll');
      if (response && response.data) {
        state.transactions = mergeById(response.data.transactions, state.transactions);
        state.loans = mergeById(response.data.loans, state.loans);
        state.categories = mergeByKey(response.data.categories, state.categories, 'name');
        state.budgets = mergeByKey(response.data.budgets, state.budgets, 'category');
        state.goals = mergeByKey(response.data.goals, state.goals, 'name');
        state.settings.lastSynced = new Date().toISOString();
        saveState();
        render();
        updateLoanRepaymentField();
        toast('Data pulled from Google Sheets');
      }
    } catch (e) {
      console.warn('pull failed', e);
      toast('Unable to pull from Google Sheets');
    } finally {
      syncing = false;
    }
  }

  function renderLoanSummary() {
    let host = $('loanBI');
    if (!host) {
      host = document.createElement('div');
      host.id = 'loanBI';
      host.className = 'panel';
      const dashboard = $('dashboard');
      if (dashboard) dashboard.appendChild(host);
    }

    if (!host) return;

    const rows = monthItems(false);
    const received = rows.filter(t => t.type === 'income' && t.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const payback = rows.filter(t => t.type === 'expense' && t.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const outstanding = (state.loans || []).reduce((s, l) => s + (Number(l.remaining) || 0), 0);

    host.innerHTML = `
      <div class="loan-bi-grid">
        <div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div>
        <div class="loan-bi-stat"><small>Loan repayment</small><strong>${money(payback)}</strong></div>
        <div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div>
      </div>
      <div class="loan-bi-list">
        ${state.loans.length ? state.loans.map(loan => `
          <div class="loan-bi-row">
            <span>${escapeHtml(loan.name || 'Loan')}<small>Principal: ${money(loan.principal)}</small></span>
            <b>${money(loan.remaining)}</b>
          </div>
        `).join('') : '<div class="empty">No loan records yet</div>'}
      </div>
    `;
  }

  function renderRecentTransactions() {
    const recent = $('recent');
    if (!recent) return;

    const transactions = state.transactions.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 5);
    recent.innerHTML = transactions.length ? transactions.map(t => `
      <div class="row">
        <span>${escapeHtml(t.category || t.type)}<small>${escapeHtml(t.date || '')} ${escapeHtml(t.note || '')}</small></span>
        <b>${t.type === 'income' ? '+' : '-'}${money(t.amount)}</b>
      </div>
    `).join('') : '<p class="muted">Your recent activity will appear here.</p>';
  }

  function renderTransactionRows() {
    const rows = $('rows');
    if (!rows) return;

    rows.innerHTML = state.transactions.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((t, i) => `
      <tr>
        <td>${escapeHtml(t.date || '')}</td>
        <td><b>${escapeHtml(t.category || t.type)}</b><small>${escapeHtml(t.note || '')}</small></td>
        <td>${t.type === 'income' ? '+' : '-'}${money(t.amount)}</td>
        <td><button type="button" data-remove="${i}">Remove</button></td>
      </tr>
    `).join('');
  }

  function daysRemainingInMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const nextMonth = new Date(year, month + 1, 1);
    const lastDay = new Date(nextMonth - 1);
    const todayDay = now.getDate();
    return Math.max(1, lastDay.getDate() - todayDay);
  }

  function renderDailyBudgets() {
    const host = $('dailyBudgets');
    if (!host) return;

    const budgets = state.budgets || [];
    if (!budgets.length) {
      host.innerHTML = '<div class="muted">No budgets set</div>';
      return;
    }

    const remainingDays = daysRemainingInMonth();
    const items = monthItems(false);

    host.innerHTML = budgets.map(b => {
      const spent = items.filter(t => t.type === 'expense' && (t.category || 'General') === b.category).reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const remaining = Math.max(0, (Number(b.limit) || 0) - spent);
      const daily = remainingDays ? Math.round(remaining / remainingDays) : remaining;

      return `
        <div class="daily-row">
          <div class="left">
            <b>${escapeHtml(b.category)}</b>
            <small>Remaining ${money(remaining)}</small>
          </div>
          <div class="right">
            <b>${money(daily)}</b>
            <small>/day</small>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderBudgetReport() {
    const host = $('budgetReport');
    if (!host) return;

    const budgets = state.budgets || [];
    if (!budgets.length) {
      host.innerHTML = '<div class="muted">No budgets set</div>';
      return;
    }

    const items = monthItems(false);
    host.innerHTML = budgets.map(b => {
      const spent = items.filter(t => t.type === 'expense' && (t.category || 'General') === b.category).reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const limit = Number(b.limit) || 0;
      const pct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;

      return `
        <div class="budget-report-row">
          <div class="label">
            ${escapeHtml(b.category)}
            <small>${money(spent)} / ${money(limit)}</small>
          </div>
          <div class="bar">
            <div class="fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function render() {
    const items = monthItems(false);
    const totals = getTotals(items);

    const remaining = totals.income - totals.expense - totals.loan - totals.credit;

    const values = [
      ['income', totals.income],
      ['expense', totals.expense],
      ['loan', totals.loan],
      ['credit', totals.credit],
      ['remaining', remaining],
      ['cashflow', remaining]
    ];

    values.forEach(([id, value]) => {
      const el = $(id);
      if (el) el.textContent = money(value);
    });

    const monthEl = $('month');
    if (monthEl) monthEl.value = currentMonth();

    const countEl = $('txCount');
    if (countEl) countEl.textContent = `Activity (${state.transactions.length})`;

    renderRecentTransactions();
    renderTransactionRows();
    renderLoanSummary();
    renderDailyBudgets();
    renderBudgetReport();
    updateLoanRepaymentField();
    applyTheme();
    renderSettingsLists();
  }

  function applyTheme() {
    const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
    document.body.classList.toggle('dark', theme === 'dark');

    const themeButtons = document.querySelectorAll('#theme, #switch, [data-theme-toggle], .toggle-theme');
    themeButtons.forEach(btn => {
      btn.classList.toggle('on', theme === 'dark');
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      if (btn.tagName === 'BUTTON') btn.textContent = theme === 'dark' ? '☾' : '☼';
    });

    const status = $('currentTheme');
    if (status) status.textContent = theme;

    document.querySelectorAll('input, select, textarea, button, nav, .page, .panel').forEach(el => {
      if (theme === 'dark') el.classList.add('dark');
      else el.classList.remove('dark');
    });
  }

  function handleClick(event) {
    const pageButton = safeClosest(event, '[data-page]');
    if (pageButton) {
      showPage(pageButton.dataset.page);
      return;
    }

    const addButton = safeClosest(event, '[data-add]');
    if (addButton) {
      setTransactionType(addButton.dataset.add);
      showPage('add');
      return;
    }

    const typeButton = safeClosest(event, '[data-type]');
    if (typeButton) {
      setTransactionType(typeButton.dataset.type);
      return;
    }

    const removeButton = safeClosest(event, '[data-remove]');
    if (removeButton) {
      const index = Number(removeButton.dataset.remove);
      if (!Number.isNaN(index)) {
        const transactions = state.transactions.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        const transaction = transactions[index];
        if (transaction) {
          state.transactions = state.transactions.filter(item => String(item.id) !== String(transaction.id));
          saveState();
          render();
          queueSync();
        }
      }
      return;
    }

    const editCat = safeClosest(event, '[data-edit-cat]');
    if (editCat) {
      openEditCategory(editCat.dataset.editCat);
      return;
    }

    const deleteCat = safeClosest(event, '[data-delete-cat]');
    if (deleteCat) {
      const name = deleteCat.dataset.deleteCat;
      if (confirm(`Delete category "${name}"? This will not remove existing transactions.`)) {
        state.categories = state.categories.filter(c => c.name !== name);
        saveState();
        render();
        queueSync();
      }
      return;
    }

    const editBud = safeClosest(event, '[data-edit-bud]');
    if (editBud) {
      openEditBudget(editBud.dataset.editBud);
      return;
    }

    const deleteBud = safeClosest(event, '[data-delete-bud]');
    if (deleteBud) {
      const cat = deleteBud.dataset.deleteBud;
      if (confirm(`Delete budget for "${cat}"?`)) {
        state.budgets = state.budgets.filter(b => b.category !== cat);
        saveState();
        render();
        queueSync();
      }
      return;
    }
  }

  function handleSubmit(event) {
    if (event.target && event.target.id === 'form') {
      saveTransaction(event);
      return;
    }

    if (event.target && event.target.id === 'categoryForm') {
      event.preventDefault();
      const name = $('newCategoryName').value.trim();
      const type = $('newCategoryType').value;

      if (!name) {
        toast('Enter category name');
        return;
      }

      state.categories = state.categories || [];
      state.categories.push({ name, type });
      $('newCategoryName').value = '';
      saveState();
      render();
      queueSync();
      return;
    }

    if (event.target && event.target.id === 'budgetForm') {
      event.preventDefault();
      const cat = $('budgetCategory').value.trim();
      const amount = Number($('budgetAmount').value);

      if (!cat || !amount || amount <= 0) {
        toast('Invalid budget');
        return;
      }

      state.budgets = state.budgets || [];
      const idx = state.budgets.findIndex(b => b.category === cat);
      if (idx >= 0) state.budgets[idx].limit = amount;
      else state.budgets.push({ category: cat, limit: amount });

      $('budgetAmount').value = '';
      saveState();
      render();
      queueSync();
      return;
    }
  }

  function handleMonthChange(event) {
    if (event.target && event.target.id === 'month') {
      state.reportMonth = event.target.value || today.slice(0, 7);
      saveState();
      render();
    }
  }

  function handleThemeClick() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveState();
    applyTheme();
  }

  function openEditCategory(name) {
    const existing = state.categories.find(c => c.name === name);
    if (!existing) return;

    const newName = prompt('Edit category name', existing.name);
    if (!newName) return;

    const newType = prompt('Edit category type (expense/income/loan/credit)', existing.type) || existing.type;
    existing.name = newName;
    existing.type = newType;

    saveState();
    render();
    queueSync();
  }

  function openEditBudget(category) {
    const existing = state.budgets.find(b => b.category === category);
    if (!existing) return;

    const val = prompt(`Edit budget amount for ${category}`, String(existing.limit));
    const n = Number(val);
    if (!n || n <= 0) return;

    existing.limit = n;
    saveState();
    render();
    queueSync();
  }

  function renderSettingsLists() {
    const settings = $('settings');
    if (!settings) return;

    const catsHtml = `
      <div class="settings-section">
        <h3>Categories</h3>
        <form id="categoryForm">
          <input id="newCategoryName" placeholder="Name" required />
          <select id="newCategoryType">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="loan">Loan</option>
            <option value="credit">Repayment</option>
          </select>
          <button type="submit">Add</button>
        </form>
        <div class="list">
          ${(state.categories || []).map(c => `
            <div class="row">
              <span>${escapeHtml(c.name)} <small>${escapeHtml(c.type)}</small></span>
              <div class="actions">
                <button type="button" data-edit-cat="${escapeHtml(c.name)}">Edit</button>
                <button type="button" data-delete-cat="${escapeHtml(c.name)}">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const budsHtml = `
      <div class="settings-section">
        <h3>Budgets</h3>
        <form id="budgetForm">
          <select id="budgetCategory">
            ${(state.categories || []).filter(c => c.type !== 'income').map(c => `
              <option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>
            `).join('')}
          </select>
          <input id="budgetAmount" type="number" placeholder="Amount" required />
          <button type="submit">Save</button>
        </form>
        <div class="list">
          ${(state.budgets || []).map(b => `
            <div class="row">
              <span>${escapeHtml(b.category)} <small>${money(b.limit)}</small></span>
              <div class="actions">
                <button type="button" data-edit-bud="${escapeHtml(b.category)}">Edit</button>
                <button type="button" data-delete-bud="${escapeHtml(b.category)}">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    settings.innerHTML = `<div class="settings-grid">${catsHtml}${budsHtml}</div>`;
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('change', handleMonthChange);

    const themeButtons = document.querySelectorAll('#theme, #switch, [data-theme-toggle], .toggle-theme');
    themeButtons.forEach(button => {
      button.addEventListener('click', handleThemeClick);
    });

    const pushButton = $('push');
    if (pushButton) pushButton.addEventListener('click', () => queueSync());

    const pullButton = $('pull');
    if (pullButton) pullButton.addEventListener('click', () => pullFromSheets());

    const saveSync = $('saveSyncUrl');
    if (saveSync) saveSync.addEventListener('click', () => {
      const syncInput = $('syncUrlInput') || $('syncUrl');
      const value = syncInput ? syncInput.value.trim() : '';
      state.settings.syncUrl = value;
      saveState();
      render();
    });

    const testSync = $('testSync');
    if (testSync) testSync.addEventListener('click', async () => {
      try {
        await pullFromSheets();
      } catch (e) {
        console.warn('sync test failed', e);
      }
    });

    const syncInput = $('syncUrlInput') || $('syncUrl');
    if (syncInput) {
      syncInput.value = state.settings.syncUrl || '';
      syncInput.addEventListener('change', e => {
        state.settings.syncUrl = e.target.value.trim();
        saveState();
        render();
      });
    }

    const clearButton = $('clear');
    if (clearButton) clearButton.addEventListener('click', () => {
      if (!confirm('Delete all local transactions?')) return;
      state.transactions = [];
      state.loans = [];
      saveState();
      render();
      queueSync();
      toast('Transactions cleared');
    });

    const dateInput = $('date');
    if (dateInput && !dateInput.value) dateInput.value = today;

    const monthInput = $('month');
    if (monthInput) monthInput.value = currentMonth();

    if (state.currentType) setTransactionType(state.currentType);
    render();
    showPage('home');
    if (state.settings.syncUrl) pullFromSheets();
  }

  function initializeUI() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUI, { once: true });
  } else {
    initializeUI();
  }

  window.moneyflow = {
    getState: () => state,
    save: saveState,
    render,
    showPage,
    queueSync,
    pullFromSheets,
    updateLoanRepaymentField,
    applyTheme
  };

  window.setAppTheme = applyTheme;
  window.getAppTheme = () => (document.body.classList.contains('dark') ? 'dark' : 'light');
})();
