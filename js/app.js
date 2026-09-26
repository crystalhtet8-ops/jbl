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
    state.settings = Object.assign(
      {},
      fallback.settings,
      state.settings || {}
    );

    state.transactions = Array.isArray(state.transactions)
      ? state.transactions
      : [];

    state.loans = Array.isArray(state.loans)
      ? state.loans
      : [];

    state.categories = Array.isArray(state.categories)
      ? state.categories
      : fallback.categories.slice();

    state.budgets = Array.isArray(state.budgets)
      ? state.budgets
      : [];

    state.goals = Array.isArray(state.goals)
      ? state.goals
      : [];

    state.reportMonth =
      state.reportMonth || today.slice(0, 7);

    state.currentType =
      state.currentType || 'expense';

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
    return `${prefix || 'item'}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function money(value) {
    return `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
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

    if (changed) {
      saveState();
    }
  }

  function currentMonth() {
    return state.reportMonth || today.slice(0, 7);
  }

  function monthItems() {
    return state.transactions.filter(transaction =>
      String(transaction.date || '').slice(0, 7) === currentMonth()
    );
  }

  function getTotals(items) {
    return items.reduce(
      (result, transaction) => {
        const amount = Number(transaction.amount) || 0;

        if (transaction.type === 'income') {
          result.income += amount;
        } else if (transaction.type === 'expense') {
          result.expense += amount;
        } else if (transaction.type === 'loan') {
          result.loan += amount;
        } else if (transaction.type === 'credit') {
          result.credit += amount;
        }

        return result;
      },
      {
        income: 0,
        expense: 0,
        loan: 0,
        credit: 0
      }
    );
  }

  function safeClosest(event, selector) {
    let target = event && event.target;

    if (!target) {
      return null;
    }

    if (target.nodeType === 3) {
      target = target.parentElement;
    }

    if (!target || typeof target.closest !== 'function') {
      return null;
    }

    return target.closest(selector);
  }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === pageId);
    });

    document.querySelectorAll('nav [data-page]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.page === pageId
      );
    });

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

    if (title) {
      title.textContent =
        titles[state.currentType] || 'Add Transaction';
    }

    document.querySelectorAll('[data-type]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.type === state.currentType
      );
    });

    populateCategories();
    updateLoanRepaymentField();
  }

  function populateCategories() {
    const select = $('category');

    if (!select) {
      return;
    }

    let categories = state.categories.filter(category => {
      return category.type === state.currentType;
    });

    /*
     * Loan repayments should always have a consistent category,
     * even when the user has not created a custom category.
     */
    if (state.currentType === 'credit') {
      categories = [
        { name: 'Loan Repayment', type: 'credit' }
      ];
    }

    if (!categories.length) {
      categories = [
        {
          name: state.currentType === 'income'
            ? 'General Income'
            : 'General',
          type: state.currentType
        }
      ];
    }

    select.innerHTML = categories
      .map(category =>
        `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`
      )
      .join('');
  }

  function availableLoans() {
    return state.loans.filter(loan => {
      return Number(loan.remaining) > 0;
    });
  }

  function updateLoanRepaymentField() {
    const form = $('form');

    if (!form) {
      return;
    }

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
        <label>
          Loan to repay
          <select id="loanRepaySelect" name="loanRepaySelect" required>
            <option value="">No outstanding loans</option>
          </select>
        </label>
      `;
      return;
    }

    holder.innerHTML = `
      <label>
        Loan to repay
        <select id="loanRepaySelect" name="loanRepaySelect" required>
          <option value="">Choose a loan</option>
          ${loans.map(loan => `
            <option value="${escapeHtml(String(loan.id))}">
              ${escapeHtml(loan.name || 'Loan')} —
              ${money(loan.remaining)}
            </option>
          `).join('')}
        </select>
      </label>
    `;
  }

  function findLoan(loanId) {
    return state.loans.find(loan => {
      return String(loan.id) === String(loanId);
    });
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

  function createRepaymentTransaction(
    amount,
    date,
    note,
    category,
    loanId
  ) {
    const loan = findLoan(loanId);

    if (!loan) {
      throw new Error('Selected loan was not found.');
    }

    const remaining = Number(loan.remaining) || 0;

    if (remaining <= 0) {
      throw new Error('The selected loan has no remaining balance.');
    }

    if (amount > remaining) {
      throw new Error(
        `Repayment cannot exceed the remaining balance of ${money(remaining)}.`
      );
    }

    const transaction = {
      id: uid('tx'),
      type: 'expense',
      amount,
      date,
      category: category || 'Loan Repayment',
      note: note || `Repayment — ${loan.name || 'Loan'}`,
      loanType: 'payback',
      loanId: loan.id,
      createdAt: Date.now()
    };

    loan.remaining = Math.max(0, remaining - amount);
    state.transactions.push(transaction);

    return transaction;
  }

  function createNormalTransaction(
    type,
    amount,
    date,
    category,
    note
  ) {
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
    const date =
      (dateElement && dateElement.value) || today;
    const category =
      (categoryElement && categoryElement.value) || 'General';
    const note =
      (noteElement && noteElement.value.trim()) || '';

    if (!amount || amount <= 0) {
      toast('Enter an amount greater than zero');
      return;
    }

    let transaction;

    try {
      if (state.currentType === 'loan') {
        transaction = createLoanTransaction(
          amount,
          date,
          note,
          category
        );
      } else if (state.currentType === 'credit') {
        const loanSelect = $('loanRepaySelect');
        const loanId = loanSelect && loanSelect.value;

        if (!loanId) {
          toast('Choose a loan to repay');
          return;
        }

        transaction = createRepaymentTransaction(
          amount,
          date,
          note,
          category,
          loanId
        );
      } else {
        transaction = createNormalTransaction(
          state.currentType === 'income'
            ? 'income'
            : 'expense',
          amount,
          date,
          category,
          note
        );
      }
    } catch (error) {
      toast(error.message || 'Unable to save transaction');
      return;
    }

    saveState();
    render();

    /*
     * Exit the transaction screen immediately after a successful save.
     * Sync happens after the local transaction has been committed.
     */
    showPage('home');
    toast('Transaction saved');

    await queueSync(transaction);
  }

  function mergeById(serverItems, localItems) {
    const result = {};
    const withoutId = [];

    (Array.isArray(serverItems) ? serverItems : []).forEach(item => {
      if (!item) return;

      if (item.id) {
        result[String(item.id)] = item;
      } else {
        withoutId.push(item);
      }
    });

    (Array.isArray(localItems) ? localItems : []).forEach(item => {
      if (!item) return;

      if (item.id) {
        /*
         * The local item is added only when it is not already present.
         * This prevents a transaction returned by Google Sheets from
         * being appended a second time.
         */
        if (!result[String(item.id)]) {
          result[String(item.id)] = item;
        }
      } else {
        withoutId.push(item);
      }
    });

    return Object.values(result).concat(withoutId);
  }

  function mergeByKey(serverItems, localItems, key) {
    const result = {};

    (Array.isArray(serverItems) ? serverItems : []).forEach(item => {
      if (item && item[key] !== undefined) {
        result[String(item[key])] = item;
      }
    });

    (Array.isArray(localItems) ? localItems : []).forEach(item => {
      if (item && item[key] !== undefined) {
        if (!result[String(item[key])]) {
          result[String(item[key])] = item;
        }
      }
    });

    return Object.values(result);
  }

  async function api(action, payload) {
    if (!state.settings.syncUrl) {
      throw new Error('Google Sheets sync URL is not configured.');
    }

    const response = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action,
        payload: payload || {}
      })
    });

    if (!response.ok) {
      throw new Error(`Sync request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data && data.ok === false) {
      throw new Error(data.message || 'Google Sheets sync failed.');
    }

    return data;
  }

  async function syncOnce() {
    if (!state.settings.syncUrl) {
      return false;
    }

    let serverData = {
      transactions: [],
      loans: [],
      categories: [],
      budgets: [],
      goals: []
    };

    /*
     * Pull first, then merge. This keeps records created on another
     * browser/device and prevents replacing them with stale local data.
     */
    try {
      const response = await api('getAll');

      if (response && response.data) {
        serverData = response.data;
      }
    } catch (error) {
      console.warn('Google Sheets pull failed:', error);
    }

    const mergedTransactions = mergeById(
      serverData.transactions,
      state.transactions
    );

    const mergedLoans = mergeById(
      serverData.loans,
      state.loans
    );

    const mergedCategories = mergeByKey(
      serverData.categories,
      state.categories,
      'name'
    );

    const mergedBudgets = mergeByKey(
      serverData.budgets,
      state.budgets,
      'category'
    );

    const mergedGoals = mergeByKey(
      serverData.goals,
      state.goals,
      'name'
    );

    const payload = {
      transactions: mergedTransactions,
      loans: mergedLoans,
      categories: mergedCategories,
      budgets: mergedBudgets,
      goals: mergedGoals
    };

    const response = await api('replaceAll', payload);

    if (response && response.ok === false) {
      throw new Error(response.message || 'Replace failed.');
    }

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
    if (!state.settings.syncUrl) {
      return;
    }

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
    } catch (error) {
      console.warn('Google Sheets sync failed:', error);
      toast('Saved locally; sync failed');
    } finally {
      syncing = false;
      render();
    }
  }

  async function pullFromSheets() {
    if (!state.settings.syncUrl || syncing) {
      return;
    }

    syncing = true;

    try {
      const response = await api('getAll');

      if (response && response.data) {
        state.transactions = mergeById(
          response.data.transactions,
          state.transactions
        );

        state.loans = mergeById(
          response.data.loans,
          state.loans
        );

        state.categories = mergeByKey(
          response.data.categories,
          state.categories,
          'name'
        );

        state.budgets = mergeByKey(
          response.data.budgets,
          state.budgets,
          'category'
        );

        state.goals = mergeByKey(
          response.data.goals,
          state.goals,
          'name'
        );

        state.settings.lastSynced = new Date().toISOString();

        saveState();
        render();
        updateLoanRepaymentField();
        toast('Data pulled from Google Sheets');
      }
    } catch (error) {
      console.warn('Google Sheets pull failed:', error);
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

      if (dashboard) {
        dashboard.appendChild(host);
      }
    }

    if (!host) {
      return;
    }

    const rows = monthItems();

    const received = rows
      .filter(transaction =>
        transaction.type === 'income' &&
        transaction.loanId
      )
      .reduce(
        (sum, transaction) =>
          sum + (Number(transaction.amount) || 0),
        0
      );

    const payback = rows
      .filter(transaction =>
        transaction.type === 'expense' &&
        transaction.loanId
      )
      .reduce(
        (sum, transaction) =>
          sum + (Number(transaction.amount) || 0),
        0
      );

    const outstanding = state.loans.reduce(
      (sum, loan) =>
        sum + (Number(loan.remaining) || 0),
      0
    );

    host.innerHTML = `
      <div class="loan-bi-grid">
        <div class="loan-bi-stat">
          <small>Loan received</small>
          <strong>${money(received)}</strong>
        </div>
        <div class="loan-bi-stat">
          <small>Loan repayment</small>
          <strong>${money(payback)}</strong>
        </div>
        <div class="loan-bi-stat">
          <small>Outstanding liability</small>
          <strong>${money(outstanding)}</strong>
        </div>
      </div>
      <div class="loan-bi-list">
        ${
          state.loans.length
            ? state.loans.map(loan => `
              <div class="loan-bi-row">
                <span>
                  ${escapeHtml(loan.name || 'Loan')}
                  <small>
                    Principal: ${money(loan.principal)}
                  </small>
                </span>
                <b>${money(loan.remaining)}</b>
              </div>
            `).join('')
            : '<div class="empty">No loan records yet</div>'
        }
      </div>
    `;
  }

  function renderRecentTransactions() {
    const recent = $('recent');

    if (!recent) {
      return;
    }

    const transactions = state.transactions
      .slice()
      .sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || ''))
      )
      .slice(0, 5);

    recent.innerHTML = transactions.length
      ? transactions.map(transaction => `
        <div class="row">
          <span>
            ${escapeHtml(transaction.category || transaction.type)}
            <small>
              ${escapeHtml(transaction.date || '')}
              ${escapeHtml(transaction.note || '')}
            </small>
          </span>
          <b>
            ${
              transaction.type === 'income'
                ? '+'
                : '-'
            }${money(transaction.amount)}
          </b>
        </div>
      `).join('')
      : '<p class="muted">Your recent activity will appear here.</p>';
  }

  function renderTransactionRows() {
    const rows = $('rows');

    if (!rows) {
      return;
    }

    rows.innerHTML = state.transactions
      .slice()
      .sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || ''))
      )
      .map((transaction, index) => `
        <tr>
          <td>${escapeHtml(transaction.date || '')}</td>
          <td>
            <b>${escapeHtml(transaction.category || transaction.type)}</b>
            <small>${escapeHtml(transaction.note || '')}</small>
          </td>
          <td>
            ${
              transaction.type === 'income'
                ? '+'
                : '-'
            }${money(transaction.amount)}
          </td>
          <td>
            <button type="button" data-remove="${index}">
              Remove
            </button>
          </td>
        </tr>
      `)
      .join('');
  }

  function render() {
    const items = monthItems();
    const totals = getTotals(items);
    const remaining =
      totals.income -
      totals.expense -
      totals.loan -
      totals.credit;

    const values = [
      ['income', totals.income],
      ['expense', totals.expense],
      ['loan', totals.loan],
      ['credit', totals.credit],
      ['remaining', remaining],
      ['cashflow', remaining]
    ];

    values.forEach(([id, value]) => {
      const element = $(id);

      if (element) {
        element.textContent = money(value);
      }
    });

    const monthElement = $('month');

    if (monthElement) {
      monthElement.value = currentMonth();
    }

    const countElement = $('txCount');

    if (countElement) {
      countElement.textContent =
        `Activity (${state.transactions.length})`;
    }

    renderRecentTransactions();
    renderTransactionRows();
    renderLoanSummary();
    updateLoanRepaymentField();
    applyTheme();
  }

  function applyTheme() {
    document.body.classList.toggle(
      'dark',
      state.settings.theme === 'dark'
    );

    const switchElement = $('switch');

    if (switchElement) {
      switchElement.classList.toggle(
        'on',
        state.settings.theme === 'dark'
      );
    }
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
        const transactions = state.transactions
          .slice()
          .sort((a, b) =>
            String(b.date || '').localeCompare(String(a.date || ''))
          );

        const transaction = transactions[index];

        if (transaction) {
          state.transactions = state.transactions.filter(item => {
            return String(item.id) !== String(transaction.id);
          });

          saveState();
          render();
          queueSync();
        }
      }
    }
  }

  function handleSubmit(event) {
    if (event.target && event.target.id === 'form') {
      saveTransaction(event);
    }
  }

  function handleMonthChange(event) {
    if (event.target && event.target.id === 'month') {
      state.reportMonth =
        event.target.value || today.slice(0, 7);

      saveState();
      render();
    }
  }

  function handleThemeClick() {
    state.settings.theme =
      state.settings.theme === 'dark'
        ? 'light'
        : 'dark';

    saveState();
    applyTheme();
  }

  function initialize() {
    document.addEventListener('click', handleClick);
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('change', handleMonthChange);

    const themeButton = $('theme');

    if (themeButton) {
      themeButton.addEventListener('click', handleThemeClick);
    }

    const switchButton = $('switch');

    if (switchButton) {
      switchButton.addEventListener('click', handleThemeClick);
    }

    const pushButton = $('push');

    if (pushButton) {
      pushButton.addEventListener('click', () => {
        queueSync();
      });
    }

    const pullButton = $('pull');

    if (pullButton) {
      pullButton.addEventListener('click', () => {
        pullFromSheets();
      });
    }

    const syncUrl = $('syncUrl');

    if (syncUrl) {
      syncUrl.value = state.settings.syncUrl || '';

      syncUrl.addEventListener('change', event => {
        state.settings.syncUrl =
          event.target.value.trim();

        saveState();
        render();
      });
    }

    const clearButton = $('clear');

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        if (!confirm('Delete all local transactions?')) {
          return;
        }

        state.transactions = [];
        state.loans = [];

        saveState();
        render();
        queueSync();
        toast('Transactions cleared');
      });
    }

    const date = $('date');

    if (date && !date.value) {
      date.value = today;
    }

    const month = $('month');

    if (month) {
      month.value = currentMonth();
    }

    setTransactionType(state.currentType);
    render();
    showPage('home');

    /*
     * Pull existing data after the UI is initialized.
     * This is intentionally not awaited so the app remains clickable
     * while synchronization is in progress.
     */
    if (state.settings.syncUrl) {
      pullFromSheets();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, {
      once: true
    });
  } else {
    initialize();
  }

  /*
   * These hooks allow loan-logic.js or other modules to refresh the UI
   * without accessing private variables.
   */
  window.moneyflow = {
    getState: () => state,
    save: saveState,
    render,
    showPage,
    queueSync,
    pullFromSheets,
    updateLoanRepaymentField
  };
})();
