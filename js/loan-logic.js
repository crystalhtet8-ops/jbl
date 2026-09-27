(() => {
  'use strict';
  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const money = value => `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const read = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      s.transactions = Array.isArray(s.transactions) ? s.transactions : [];
      s.loans = Array.isArray(s.loans) ? s.loans : [];
      s.categories = Array.isArray(s.categories) ? s.categories : [];
      s.budgets = Array.isArray(s.budgets) ? s.budgets : [];
      s.reportMonth = s.reportMonth || new Date().toISOString().slice(0,7);
      return s;
    } catch (e) {
      return { transactions: [], loans: [], categories: [], budgets: [], reportMonth: new Date().toISOString().slice(0,7) };
    }
  };
  const save = state => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

  function repairLoanRecords() {
    const state = read();
    let changed = false;

    state.transactions.forEach(tx => {
      const category = String(tx.category || '').toLowerCase();
      const isLoanReceipt = category === 'loan' || category === 'loan received' || tx.loanType === 'loan' || tx.type === 'loan';
      const isPayback = category === 'loan repayment' || category === 'loan payback' || tx.loanType === 'payback' || (category.includes('loan') && category.includes('repay'));
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });

    state.transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      let loan = (state.loans || []).find(item => String(item.id) === String(tx.loanId));
      if (!loan) {
        state.loans = state.loans || [];
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

    if (changed) save(state);
    return state;
  }

  function applyRepayments() {
    const state = read();
    let changed = false;
    const loansById = {};
    (state.loans || []).forEach(l => { loansById[String(l.id)] = l; });

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

    if (changed) save(state);
    return state;
  }

  function updateDailyBudget() {
    try {
      const state = read();
      const month = state.reportMonth || new Date().toISOString().slice(0,7);
      const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === month);
      const income = rows.filter(tx => tx.type === 'income').reduce((s,tx)=>s+(Number(tx.amount)||0),0);
      const expense = rows.filter(tx => tx.type === 'expense').reduce((s,tx)=>s+(Number(tx.amount)||0),0);
      const net = Math.max(0, income - expense);
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const now = new Date();
      const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
      const perDay = Math.floor(net / daysLeft);
      const pill = $('pill');
      if (pill) {
        const base = String(pill.getAttribute('data-base') || pill.textContent || 'On track');
        pill.setAttribute('data-base', base);
        pill.textContent = `${base} • Daily ${money(perDay)}`;
      }
    } catch (e) {}
  }

  function renderLoanSummary() {
    const state = read();
    const month = state.reportMonth || new Date().toISOString().slice(0,7);
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0, 7) === month);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    const outstanding = (state.loans || []).reduce((sum, loan) => sum + (Number(loan.remaining) || 0), 0);
    let host = $('loanBI') || q('#dashboard .bi');
    if (!host) return;
    if (!$('loanBI')) {
      const container = document.createElement('div');
      container.id = 'loanBI';
      container.className = 'loan-bi panel';
      const biArea = q('#dashboard .bi') || q('#dashboard');
      if (biArea) biArea.appendChild(container);
      host = container;
    }
    const loanRows = (state.loans || []).map(loan => {
      return `<div class="loan-bi-row"><span>${esc(loan.name||'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`;
    }).join('') || `<div class="empty muted">No loan records yet</div>`;
    host.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div><div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div></div><div class="loan-bi-list">${loanRows}</div>`;
  }

  function ensureRepaymentDropdown() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    const state = read();
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!loans.length) { holder.style.display='none'; holder.innerHTML=''; return; }
    holder.style.display = 'block';
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

  function alignQuickActions() {
    try {
      const container = document.querySelector('.action-buttons');
      if (container) {
        container.style.display = 'flex';
        container.style.gap = '10px';
        container.style.justifyContent = 'center';
        container.style.flexWrap = 'wrap';
        Array.from(container.querySelectorAll('button')).forEach(btn => {
          btn.style.minWidth = btn.style.minWidth || '140px';
        });
      }
    } catch (_) {}
  }

  window.setSyncUrl = function(url) {
    try {
      const state = read();
      state.settings = state.settings || {};
      state.settings.syncUrl = String(url || '');
      save(state);
    } catch (_) {}
  };
  window.getSyncUrl = function() { try { return (read().settings || {}).syncUrl || ''; } catch (_) { return ''; } };

  function onFormSubmitHook() {
    document.addEventListener('submit', event => {
      setTimeout(() => {
        const state = read();
        const tx = (state.transactions && state.transactions.length) ? state.transactions[state.transactions.length - 1] : null;
        if (!tx) return;
        const loanSelect = document.getElementById('loanRepaySelect');
        if (loanSelect && loanSelect.value) {
          tx.loanId = loanSelect.value;
          tx.type = 'expense';
          if (!tx.createdAt) tx.createdAt = Date.now();
          save(state);
          applyRepayments();
          renderLoanSummary();
          updateDailyBudget();
          alignQuickActions();
        } else if (tx.type === 'income' && (String(tx.category || '').toLowerCase().includes('loan') || String(tx.note || '').toLowerCase().includes('loan'))) {
          if (!tx.loanId) tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`;
          save(state);
          repairLoanRecords();
          renderLoanSummary();
          updateDailyBudget();
          alignQuickActions();
        }
      }, 0);
    }, true);
  }

  function onTabClickHook() {
    document.addEventListener('click', event => {
      const tab = event.target.closest('[data-type]');
      if (!tab) return;
      const type = tab.dataset.type;
      if (type === 'credit' || type === 'loan-repayment' || (tab.textContent || '').toLowerCase().includes('repay')) {
        setTimeout(ensureRepaymentDropdown, 0);
      } else {
        const holder = document.getElementById('loanSelectHolder');
        if (holder) holder.style.display = 'none';
      }
    });
  }

  function refreshAll() {
    repairLoanRecords();
    applyRepayments();
    renderLoanSummary();
    updateDailyBudget();
    alignQuickActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { refreshAll(); onFormSubmitHook(); onTabClickHook(); }, {once:true});
  } else {
    refreshAll(); onFormSubmitHook(); onTabClickHook();
  }

  document.addEventListener('change', event => { if (event.target && event.target.id === 'month') setTimeout(refreshAll, 0); });
})();
