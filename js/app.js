(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const today = new Date().toISOString().slice(0, 10);

  const money = n => `${Math.round(Number(n) || 0).toLocaleString()} MMK`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const defaultCategories = [
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
    categories: defaultCategories.map(([name, type]) => ({ name, type })),
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

  function toast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('on'), 2200);
  }

  function uid(prefix) {
    return `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  }

  function repairTransactionIds() {
    let changed = false;
    (state.transactions || []).forEach(tx => {
      if (!tx.id) { tx.id = uid('tx'); changed = true; }
      if (!tx.createdAt) { tx.createdAt = Date.now(); changed = true; }
      if (!tx.date) { tx.date = today; changed = true; }
    });
    if (changed) saveState();
  }

  function currentMonth() { return state.reportMonth || today.slice(0,7); }

  function monthItems(includeIncome = true) {
    return (state.transactions || []).filter(t => String(t.date || '').slice(0,7) === currentMonth() && (includeIncome ? true : t.type !== 'income'));
  }

  function totals(xs) {
    return xs.reduce((r, t) => {
      const n = Number(t.amount) || 0;
      if (t.type === 'income') r.income += n;
      else if (t.type === 'expense') r.expense += n;
      else if (t.type === 'loan') r.loan += n;
      else if (t.type === 'credit') r.credit += n;
      return r;
    }, { income:0, expense:0, loan:0, credit:0 });
  }

  function updateLoanRepaymentField() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!loans.length) { holder.style.display = 'none'; holder.innerHTML = ''; return; }
    holder.style.display = '';
    if (!holder.querySelector('select')) {
      const label = document.createElement('label');
      label.textContent = 'Select loan to repay';
      const select = document.createElement('select');
      select.id = 'loanRepaySelect';
      select.name = 'loanRepaySelect';
      holder.appendChild(label);
      holder.appendChild(select);
    }
    const select = holder.querySelector('select');
    select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name || 'Loan')} — ${money(l.remaining)}</option>`).join('');
  }

  function populateCategories() {
    const s = $('category');
    if (!s) return;
    const list = (state.categories || []).filter(c => c.type === state.currentType);
    s.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
  }

  function repairLoanRecords() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    (state.transactions || []).forEach(tx => {
      const cat = String(tx.category || '').toLowerCase();
      const isLoanReceipt = cat === 'loan' || cat === 'loan received' || tx.loanType === 'loan' || tx.type === 'loan';
      const isPayback = cat === 'loan repayment' || cat === 'loan payback' || tx.loanType === 'payback';
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });
    (state.transactions || []).filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
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
    const txs = (state.transactions || []).slice().sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
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
    const monthKey = currentMonth();
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey);
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

  function renderTransactions() {
    const xs = (state.transactions || []).slice().reverse();
    // recent panel (simple card list) - element #recent (div) and #recentRows (tbody)
    const recentDiv = $('recent');
    const recentTbody = $('recentRows');
    const txTbody = $('txRows');

    if (!xs.length) {
      if (recentDiv) recentDiv.innerHTML = `<div class="muted">No transactions</div>`;
      if (recentTbody) recentTbody.innerHTML = `<tr><td colspan="4" class="muted">No transactions</td></tr>`;
      if (txTbody) txTbody.innerHTML = `<tr><td colspan="4" class="muted">No transactions</td></tr>`;
      return;
    }

    // Render compact cards into recentDiv
    if (recentDiv) {
      recentDiv.innerHTML = xs.slice(0,5).map(tx => {
        const right = tx.type === 'income' ? `<b style="color:green">${money(tx.amount)}</b>` : `<b>${money(tx.amount)}</b>`;
        return `<div class="row" style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px;border-radius:10px;border:1px solid var(--line);background:var(--card);margin-bottom:6px">
                  <div>
                    <div style="font-weight:700">${esc(tx.category || tx.note || tx.type)}</div>
                    <small class="muted">${esc(tx.note || '')} ${tx.loanId ? ' • ' + esc(tx.loanId) : ''}</small>
                  </div>
                  <div>${right}</div>
                </div>`;
      }).join('');
    }

    // Render recentRows (table)
    if (recentTbody) {
      recentTbody.innerHTML = xs.slice(0,8).map(tx => {
        const right = tx.type === 'income' ? `<b style="color:green">${money(tx.amount)}</b>` : `<b>${money(tx.amount)}</b>`;
        return `<tr>
          <td>${esc(tx.date || '')}</td>
          <td><div style="font-weight:700">${esc(tx.category || tx.note || tx.type)}</div><small class="muted">${esc(tx.note || '')} ${tx.loanId ? ' • ' + esc(tx.loanId) : ''}</small></td>
          <td>${right}</td>
          <td><button data-remove="${tx.id}">Delete</button></td>
        </tr>`;
      }).join('');
    }

    // Render full transactions table (txRows)
    if (txTbody) {
      txTbody.innerHTML = xs.map(tx => {
        const right = tx.type === 'income' ? `<b style="color:green">${money(tx.amount)}</b>` : `<b>${money(tx.amount)}</b>`;
        return `<tr>
          <td>${esc(tx.date || '')}</td>
          <td><div style="font-weight:700">${esc(tx.category || tx.note || tx.type)}</div><small class="muted">${esc(tx.note || '')} ${tx.loanId ? ' • ' + esc(tx.loanId) : ''}</small></td>
          <td>${right}</td>
          <td><button data-remove="${tx.id}">Delete</button></td>
        </tr>`;
      }).join('');
    }
  }

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
    if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`;
  }

  function renderHeaderStats() {
    const xs = (state.transactions || []).filter(t => String(t.date || '').slice(0,7) === currentMonth());
    const t = totals(xs);
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    const [y, m] = (currentMonth()).split('-').map(n => Number(n));
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayDate = new Date();
    const daysLeft = Math.max(1, daysInMonth - todayDate.getDate() + 1);
    const daily = Math.max(0, Math.floor(remainingMoney / daysLeft));
    const map = [
      ['income', t.income],
      ['expense', t.expense],
      ['loan', t.loan],
      ['daily', daily],
      ['remaining', remainingMoney]
    ];
    map.forEach(([id, val]) => {
      const el = $(id);
      if (!el) return;
      const strong = el.querySelector('strong');
      if (strong) strong.textContent = money(val);
      else el.textContent = money(val);
    });
  }

  async function saveTransactionForm(e) {
    e.preventDefault();
    const amountInput = $('amount');
    const dateInput = $('date');
    const noteInput = $('note');
    const categorySelect = $('category');
    const type = (() => {
      // prefer tabs if present
      const activeTab = document.querySelector('.tabs button.active');
      if (activeTab && activeTab.dataset && activeTab.dataset.type) return activeTab.dataset.type;
      // fallback to state.currentType
      return state.currentType || 'expense';
    })();

    const amount = Number(amountInput?.value || 0);
    if (!amount || amount <= 0) { toast('Enter an amount greater than 0'); return; }
    const date = dateInput?.value || today;
    const note = noteInput?.value || '';
    const category = categorySelect?.value || '';

    // Create transaction
    let tx;
    if (type === 'loan') {
      // create loan (income + loan record)
      const loanId = uid('loan');
      tx = { id: uid('tx'), type: 'income', amount, category: category || 'Loan', note, date, loanId, loanType: 'loan', createdAt: Date.now() };
      state.transactions = state.transactions || [];
      state.transactions.push(tx);
      state.loans = state.loans || [];
      state.loans.push({
        id: loanId,
        name: note || 'Loan',
        principal: Number(amount) || 0,
        remaining: Number(amount) || 0,
        date,
        note,
        createdAt: tx.createdAt
      });
    } else if (type === 'credit') {
      // repayment
      const loanSelect = $('loanRepaySelect');
      const loanId = loanSelect && loanSelect.value;
      if (!loanId) { toast('Choose a loan to repay'); return; }
      tx = { id: uid('tx'), type: 'expense', amount, category: category || 'Loan Repayment', note, date, loanId, loanType: 'payback', createdAt: Date.now() };
      state.transactions = state.transactions || [];
      state.transactions.push(tx);
      // apply repayment immediately
      const loan = state.loans.find(l => String(l.id) === String(loanId));
      if (loan) loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - Number(amount));
    } else {
      tx = { id: uid('tx'), type: type === 'income' ? 'income' : 'expense', amount, category, note, date, createdAt: Date.now() };
      state.transactions = state.transactions || [];
      state.transactions.push(tx);
    }

    saveState();
    // ensure loan dropdown updates immediately when a loan is created
    try { updateLoanRepaymentField(); } catch (_) {}
    renderAll();
    toast('Saved');
    // optional: queue sync if configured
    try { if (state.settings && state.settings.syncUrl) queueSync().catch(()=>{}); } catch(_){}
    // go home
    showPage('home');
    // reset form
    const form = $('form');
    if (form) form.reset();
    if ($('date')) $('date').value = today;
  }

  function wireTabsIfNeeded() {
    try {
      const tabs = document.querySelectorAll('.tabs [data-type]');
      if (!tabs || !tabs.length) return;
      tabs.forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.dataset.type;
          // set visual active class
          document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === t));
          // set state and UI
          state.currentType = t;
          populateCategories();
          if (t === 'credit') updateLoanRepaymentField();
          else {
            const holder = $('loanSelectHolder'); if (holder) { holder.style.display = 'none'; holder.innerHTML = ''; }
          }
          const title = $('formTitle');
          if (title) {
            const titles = { expense: 'Add Expense', income: 'Add Income', loan: 'Record Loan', credit: 'Loan Repayment' };
            title.textContent = titles[t] || 'Add Transaction';
          }
        });
      });
      // ensure current tab reflected
      if (state.currentType) {
        document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === state.currentType));
      }
    } catch (e) { console.warn('wireTabsIfNeeded error', e); }
  }

  function handleGlobalClicks(e) {
    // nav/page
    const page = e.target.closest && e.target.closest('[data-page]');
    if (page) { showPage(page.dataset.page); return; }
    // quick actions
    const add = e.target.closest && e.target.closest('[data-add]');
    if (add) {
      const type = add.dataset.add;
      // set tab active
      const tab = document.querySelector(`.tabs [data-type="${type}"]`);
      if (tab) tab.click();
      else {
        state.currentType = type;
        populateCategories();
      }
      showPage('add');
      return;
    }
    // remove tx (by id)
    const rem = e.target.closest && e.target.closest('[data-remove]');
    if (rem) {
      const id = rem.dataset.remove;
      if (id) {
        state.transactions = (state.transactions || []).filter(t => String(t.id) !== String(id));
        saveState();
        renderAll();
        try { if (state.settings && state.settings.syncUrl) queueSync().catch(()=>{}); } catch(_){}
      }
      return;
    }
  }

  // Sync helpers (lightweight; safe no-op if syncUrl not provided)
  async function api(action, payload = {}) {
    if (!state.settings || !state.settings.syncUrl) throw new Error('Add the Apps Script URL first.');
    const r = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });
    if (!r.ok) throw new Error('Sync failed');
    return r.json();
  }

  async function queueSync() {
    if (!state.settings || !state.settings.syncUrl) return;
    try {
      await api('replaceAll', { transactions: state.transactions || [], loans: state.loans || [], categories: state.categories || [], budgets: state.budgets || [] });
      toast('Pushed changes to sheet');
    } catch (e) {
      console.warn('sync failed', e);
      toast('Push failed');
    }
  }

  function renderAll() {
    greeting();
    populateCategories();
    renderHeaderStats();
    renderTransactions();
    renderLoanSummary();
    updateLoanRepaymentField();
    // other panels: budgets etc. left as-is
    if ($('month')) $('month').value = currentMonth();
    if ($('txCount')) $('txCount').textContent = `Activity (${(state.transactions||[]).length})`;
    if ($('txCountList')) $('txCountList').textContent = `Transactions (${(state.transactions||[]).length})`;
  }

  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    if (id === 'home') renderAll();
    if (id === 'settings') {
      const inp = $('syncUrlInput'); if (inp) inp.value = state.settings?.syncUrl || '';
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.settings?.theme === 'dark');
    $('currentTheme') && ($('currentTheme').textContent = state.settings?.theme || 'light');
    // update switch text
    const themeBtns = document.querySelectorAll('.theme-toggle');
    themeBtns.forEach(btn => {
      if (btn.tagName === 'BUTTON') btn.textContent = state.settings?.theme === 'dark' ? '☾' : '☼';
    });
  }

  function wireEvents() {
    document.addEventListener('click', handleGlobalClicks);
    document.getElementById('form')?.addEventListener('submit', saveTransactionForm);
    document.querySelectorAll('nav [data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    // theme toggles (any element with class .theme-toggle)
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        state.settings = state.settings || {};
        state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
        saveState();
        applyTheme();
      });
    });
    document.getElementById('saveSyncUrl')?.addEventListener('click', () => {
      const url = ($('syncUrlInput')?.value || '').trim();
      state.settings = state.settings || {};
      state.settings.syncUrl = url;
      saveState();
      toast(url ? 'Sync URL saved' : 'Sync URL cleared');
    });
    document.getElementById('testSync')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim();
      if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {};
      state.settings.syncUrl = url;
      saveState();
      try { await queueSync(); toast('Test sync done'); } catch (e) { toast('Test sync failed'); }
    });
    document.getElementById('pullFromSheets')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim();
      if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {};
      state.settings.syncUrl = url;
      saveState();
      try {
        const res = await api('getAll');
        if (res && res.data) {
          state.transactions = res.data.transactions || state.transactions || [];
          state.loans = res.data.loans || state.loans || [];
          state.categories = res.data.categories || state.categories || [];
          saveState();
          renderAll();
          toast('Pulled from sheet');
        } else {
          toast('No data from sheet');
        }
      } catch (e) {
        console.warn('pull failed', e);
        toast('Pull failed');
      }
    });
    document.getElementById('clear')?.addEventListener('click', () => {
      if (!confirm('Clear all transactions?')) return;
      state.transactions = [];
      state.loans = [];
      saveState();
      renderAll();
      toast('Cleared');
    });
  }

  function init() {
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.categories = Array.isArray(state.categories) ? state.categories : fallback.categories.slice();
    state.budgets = Array.isArray(state.budgets) ? state.budgets : [];
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    repairTransactionIds();
    applyTheme();
    wireEvents();
    wireTabsIfNeeded();
    renderAll();
    // show initial page
    showPage('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else init();

  window.moneyflow = {
    state,
    save: saveState,
    renderAll,
    applyTheme,
    updateLoanRepaymentField
  };

})();
