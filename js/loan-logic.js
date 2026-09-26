(() => {
  'use strict';
  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const money = value => `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); s.transactions = Array.isArray(s.transactions) ? s.transactions : []; s.loans = Array.isArray(s.loans) ? s.loans : []; s.reportMonth = s.reportMonth || new Date().toISOString().slice(0, 7); return s; } catch (_) { return {transactions:[],loans:[],reportMonth:new Date().toISOString().slice(0,7)}; } };
  const save = state => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

  // Repair and backfill loan records from transactions
  function repairLoanRecords() {
    const state = read();
    let changed = false;

    // Normalize transaction types and create loanId for receipts
    state.transactions.forEach(tx => {
      const category = String(tx.category || '').toLowerCase();
      const isLoanReceipt = category === 'loan' || category === 'loan received' || tx.loanType === 'loan' || tx.type === 'loan';
      const isPayback = category === 'loan repayment' || category === 'loan payback' || tx.loanType === 'payback';
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });

    // Ensure loan records exist for income transactions with loanId
    state.transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      let loan = state.loans.find(item => String(item.id) === String(tx.loanId));
      if (!loan) {
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

  // Apply repayments to loan.remaining (idempotent: only apply once per transaction)
  function applyRepayments() {
    const state = read();
    let changed = false;
    // Ensure loans exist index
    const loansById = {};
    state.loans.forEach(l => { loansById[String(l.id)] = l; });

    // Sort transactions by createdAt to apply in order
    const txs = state.transactions.slice().sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    txs.forEach(tx => {
      if (tx.type === 'expense' && tx.loanId && !tx._loanApplied) {
        const loan = loansById[String(tx.loanId)];
        if (loan) {
          const amt = Number(tx.amount) || 0;
          // Deduct from remaining but never go below zero
          loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - amt);
          tx._loanApplied = true;
          changed = true;
        }
      }
    });

    if (changed) save(state);
    return state;
  }

  // Render Loan Analysis summary into dashboard
  function renderLoanSummary() {
    const state = read();
    const month = state.reportMonth;
    const rows = state.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    const outstanding = state.loans.reduce((sum, loan) => sum + (Number(loan.remaining) || 0), 0);

    // Try to reuse an existing host or create one
    let host = $('loanBI') || q('#dashboard .bi');
    if (!host) return;

    // If we have a dedicated container id, prefer rendering there, otherwise append a small block
    if (!$('loanBI')) {
      const container = document.createElement('div');
      container.id = 'loanBI';
      container.className = 'loan-bi panel';
      // append at end of BI area
      const biArea = q('#dashboard .bi') || q('#dashboard');
      if (biArea) biArea.appendChild(container);
      host = container;
    }

    host.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div><div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div></div><div class="loan-bi-list">${state.loans.length ? state.loans.map(loan => `<div class="loan-bi-row"><span>${esc(loan.name || 'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`).join('') : '<div class="empty">No loan records yet</div>'}</div>`;
  }

  // Build and inject a repayment dropdown inside the Add form when Loan Repayment tab is active
  function ensureRepaymentDropdown() {
    const addPage = q('#add');
    if (!addPage) return;
    // Find the place to inject: try to find existing element with id 'loanSelectHolder' or an element near the submit button
    let holder = q('#loanSelectHolder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'loanSelectHolder';
      holder.className = 'field';
      // Try to insert before the submit button within the add page
      const submit = addPage.querySelector('button[type="submit"], input[type="submit"], .save, .add-action');
      if (submit && submit.parentNode) submit.parentNode.insertBefore(holder, submit);
      else addPage.appendChild(holder);
    }

    // Populate options
    const state = read();
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!holder.querySelector('select')) {
      const label = document.createElement('label');
      label.textContent = 'Select loan to repay';
      const select = document.createElement('select');
      select.id = 'loanRepaySelect';
      select.name = 'loanRepaySelect';
      select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name || 'Loan')} — ${money(l.remaining)}</option>`).join('');
      holder.innerHTML = '';
      holder.appendChild(label);
      holder.appendChild(select);
    } else {
      const select = holder.querySelector('select');
      select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name || 'Loan')} — ${money(l.remaining)}</option>`).join('');
    }
  }

  // Hook into submit: after other handlers run, detect if a repayment was selected and mark / apply appropriately
  function onFormSubmitHook() {
    document.addEventListener('submit', event => {
      // let existing handlers run, then process
      setTimeout(() => {
        const state = read();
        // Attempt to find the most-recent transaction (assumes app appends new tx as last element)
        const tx = (state.transactions && state.transactions.length) ? state.transactions[state.transactions.length - 1] : null;
        if (!tx) return;
        // If loan repayment select exists and a loan was chosen, set tx.loanId and tx.type='expense' and apply repayment
        const loanSelect = document.getElementById('loanRepaySelect');
        if (loanSelect && loanSelect.value) {
          tx.loanId = loanSelect.value;
          tx.type = 'expense';
          // mark to be applied by applyRepayments()
          // ensure createdAt exists
          if (!tx.createdAt) tx.createdAt = Date.now();
          save(state);
          // apply repayments and re-render
          applyRepayments();
          renderLoanSummary();
          // trigger existing sync hooks if available
          try { if (typeof window.syncToSheet === 'function') window.syncToSheet(tx); else if (typeof window.sync === 'function') window.sync(tx); } catch (e){}
        } else {
          // If added a loan (type income + loanId) we let repairLoanRecords pick it up on refresh
        }
      }, 0);
    }, true);
  }

  // Hook into tab clicks to show/hide dropdown when user chooses the repayment tab
  function onTabClickHook() {
    document.addEventListener('click', event => {
      const tab = event.target.closest('[data-type]');
      if (!tab) return;
      const type = tab.dataset.type;
      // If user chose the credit tab (label changed to Loan Repayment), ensure dropdown is present; for other tabs, hide it
      if (type === 'credit' || type === 'loan-repayment' || (tab.textContent || '').toLowerCase().includes('repay')) {
        setTimeout(ensureRepaymentDropdown, 0);
      } else {
        const holder = document.getElementById('loanSelectHolder');
        if (holder) holder.style.display = 'block'; // keep visible only when appropriate; don't remove by default to avoid UI shifts
      }
    });
  }

  function refreshAll() {
    repairLoanRecords();
    applyRepayments();
    renderLoanSummary();
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { refreshAll(); onFormSubmitHook(); onTabClickHook(); }, {once:true});
  } else {
    refreshAll(); onFormSubmitHook(); onTabClickHook();
  }

  // Also refresh on mutation changes to the month filter if present
  document.addEventListener('change', event => { if (event.target && event.target.id === 'month') setTimeout(refreshAll, 0); });

})();
