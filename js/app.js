(() => {
  'use strict';
  const KEY='moneyflow-v3', $=id=>document.getElementById(id), today=new Date().toISOString().slice(0,10);
  const defaults=[['Food & Drinks','expense'],['Transportation','expense'],['Family','expense'],['Housing','expense'],['Utilities','expense'],['Shopping','expense'],['Health','expense'],['Education','expense']];
  const fallback={transactions:[],loans:[],categories:defaults.map(([name,type])=>({name,type})),budgets:[],goals:[],settings:{theme:'light',syncUrl:'',syncRevision:'',lastSynced:''},reportMonth:today.slice(0,7),currentType:'expense'};
  let state=load(), syncing=false;
  state.settings=Object.assign({},fallback.settings,state.settings||{});
  state.budgets=Array.isArray(state.budgets)?state.budgets:[];
  state.goals=Array.isArray(state.goals)?state.goals:[];
  state.categories=Array.isArray(state.categories)?state.categories:fallback.categories;
  state.loans=Array.isArray(state.loans)?state.loans:[];
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];

  function load(){try{return Object.assign({},fallback,JSON.parse(localStorage.getItem(KEY)||'null')||{})}catch(e){return Object.assign({},fallback)}}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
  function uid(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`}
  function money(n){return `${Math.round(Number(n)||0).toLocaleString()} MMK`}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function toast(m){const e=$('toast');if(!e)return;e.textContent=m;e.classList.add('on');clearTimeout(e._timer);e._timer=setTimeout(()=>e.classList.remove('on'),2200)}
  function month(){return state.reportMonth||today.slice(0,7)}
  function items(){return state.transactions.filter(t=>String(t.date||'').slice(0,7)===month())}
  function totals(xs){return xs.reduce((r,t)=>{const n=Number(t.amount)||0;if(t.type==='income')r.income+=n;else if(t.type==='expense')r.expense+=n;else if(t.type==='loan')r.loan+=n;else if(t.type==='credit')r.credit+=n;return r},{income:0,expense:0,loan:0,credit:0})}
  function greeting(){const h=new Date().getHours(),part=h<12?'Morning':h<17?'Afternoon':h<21?'Evening':'Night';if($('greet'))$('greet').textContent=`GOOD ${part.toUpperCase()}`;if($('greetTitle'))$('greetTitle').textContent=`Welcome back 👋`}
  function setType(type){state.currentType=type;const titles={expense:'Add Expense',income:'Add Income',loan:'Add Loan',credit:'Add Credit Payment'};if($('formTitle'))$('formTitle').textContent=titles[type]||titles.expense;populateCategories()}
  function populateCategories(){const s=$('category');if(!s)return;const list=state.categories.filter(c=>c.type===state.currentType);s.innerHTML=list.map(c=>`<option>${esc(c.name)}</option>`).join('')}
  function show(id){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id))}
  function budgetRows(){const spent={};items().filter(t=>t.type==='expense').forEach(t=>spent[t.category||'General']=(spent[t.category||'General']||0)+Number(t.amount||0));return state.budgets.map(b=>{const used=spent[b.category]||0;const pct=b.limit?Math.round(used/b.limit*100):0;return Object.assign({},b,{used,pct})})}

  function render(){greeting();const xs=items(),t=totals(xs),net=t.income-t.expense-t.loan-t.credit;[['income',t.income],['expense',t.expense],['loan',t.loan],['credit',t.credit],['remaining',net]].forEach(([id,val])=>{$(id)?.textContent=money(val)});$('txCount')&&($('txCount').textContent=`Activity (${state.transactions.length})`);} 

  function injectPlanningUI(){if($('planningStyles'))return;const st=document.createElement('style');st.id='planningStyles';st.textContent='.planning-grid{display:grid}';document.head.appendChild(st)}
  function theme(){document.body.classList.toggle('dark',state.settings.theme==='dark');if($('switch'))$('switch').classList.toggle('on',state.settings.theme==='dark')}

  async function api(action,payload={}){if(!state.settings.syncUrl)throw Error('Add the Apps Script URL first.');const r=await fetch(state.settings.syncUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});return r.json();}

  // Merge server and local transactions by id (server wins for existing ids, local new ones appended)
  function mergeTransactions(serverTx = [], localTx = []){
    const byId = {};
    serverTx.forEach(t=>{ if(t && t.id) byId[t.id]=t; });
    localTx.forEach(t=>{ if(t && t.id){ if(!byId[t.id]) byId[t.id]=t; } });
    return Object.values(byId).sort((a,b)=> (a.createdAt||0)-(b.createdAt||0));
  }

  // pushChanges: fetch server data, merge, then replaceAll to avoid duplicates (prevents double-sync)
  async function pushChanges(){
    if(syncing||!state.settings.syncUrl) return;
    syncing = true;
    try{
      // get server state
      let server = {transactions:[],categories:[],budgets:[],goals:[],loans:[]};
      try{const r = await api('getAll'); if(r && r.data) server = r.data;}catch(e){/* ignore fetch error, will attempt replaceAll */}
      const mergedTx = mergeTransactions(server.transactions||[], state.transactions||[]);
      // merge loans similarly (server preferred)
      const loansById = {};
      (server.loans||[]).forEach(l=>{ if(l&&l.id) loansById[l.id]=l; });
      (state.loans||[]).forEach(l=>{ if(l&&l.id && !loansById[l.id]) loansById[l.id]=l; });
      const mergedLoans = Object.values(loansById);

      // Build merged payload using server categories/budgets/goals where available
      const payload = {transactions:mergedTx,categories: server.categories&&server.categories.length?server.categories:state.categories,budgets: server.budgets&&server.budgets.length?server.budgets:state.budgets,goals: server.goals&&server.goals.length?server.goals:state.goals,loans: mergedLoans};
      const res = await api('replaceAll', payload);
      // on success, update local state to merged payload
      if(res && (res.ok || res.status==='ok' || res.result==='ok' || res.data)){
        state.transactions = mergedTx;
        state.loans = mergedLoans;
        state.categories = payload.categories;
        state.budgets = payload.budgets;
        state.goals = payload.goals;
        state.settings.lastSynced = new Date().toISOString();
        save();
      }
    }catch(e){console.warn('pushChanges failed',e);}finally{syncing=false;render();}
  }

  // expose pushChanges for loan logic
  window.pushChanges = pushChanges;

  async function pull(){ if(syncing||!state.settings.syncUrl) return; syncing=true; try{ const r = await api('getAll'); if(r && r.data){ // merge server into local but keep local-only items
        state.transactions = mergeTransactions(r.data.transactions||[], state.transactions||[]);
        // merge loans similarly
        const loansById = {}; (r.data.loans||[]).forEach(l=>{ if(l&&l.id) loansById[l.id]=l; }); (state.loans||[]).forEach(l=>{ if(l&&l.id && !loansById[l.id]) loansById[l.id]=l; }); state.loans = Object.values(loansById);
        state.categories = r.data.categories && r.data.categories.length? r.data.categories : state.categories;
        state.budgets = r.data.budgets && r.data.budgets.length? r.data.budgets : state.budgets;
        state.goals = r.data.goals && r.data.goals.length? r.data.goals : state.goals;
        state.settings.lastSynced = new Date().toISOString(); save(); render(); }
    }catch(e){console.warn('pull failed',e);} finally{syncing=false;} }

  function closestSafe(e, selector){
    let t = e && e.target;
    if(!t) return null;
    if(t.nodeType === 3) t = t.parentElement; // text node
    return (t && typeof t.closest === 'function') ? t.closest(selector) : null;
  }

  document.addEventListener('click',e=>{
    const p = closestSafe(e,'[data-page]'); if(p) { show(p.dataset.page); return; }
    const a = closestSafe(e,'[data-add]'); if(a) { setType(a.dataset.add); show('add'); return; }
    const tab = closestSafe(e,'[data-type]'); if(tab) { setType(tab.dataset.type); return; }
  });

  // Form submit handler - enhanced to support loan recording and repayment selection; ensures exit add form and immediate sync
  const formEl = $('form');
  formEl?.addEventListener('submit',async e=>{
    if(e.target.id!=='form')return;e.preventDefault();
    const amount=Number($('amount').value);if(!amount||amount<=0){toast('Enter an amount greater than zero');return}
    let txType = state.currentType;
    const loanSelect = document.getElementById('loanRepaySelect');
    const selectedLoanId = loanSelect && loanSelect.value ? loanSelect.value : null;
    if(selectedLoanId){ txType = 'expense'; }
    const isLoanTab = state.currentType === 'loan';

    const tx = {
      id: uid(),
      type: txType,
      amount: amount,
      date: ($('date')?.value) || today,
      category: ($('category')?.value) || 'General',
      note: $('note')?.value || '',
      createdAt: Date.now()
    };

    if(selectedLoanId){ tx.loanId = selectedLoanId; }

    if(isLoanTab){
      const loanId = `loan-${tx.id}`;
      tx.loanId = loanId;
      state.loans = state.loans||[];
      state.loans.push({id:loanId,name:tx.note||'Loan',principal:Number(tx.amount)||0,remaining:Number(tx.amount)||0,date:tx.date,note:tx.note||'',createdAt:tx.createdAt});
    }

    state.transactions = state.transactions||[];
    state.transactions.push(tx);
    save();

    // Apply loan repayments locally (if any) immediately to keep UI consistent
    try{ if(window.applyRepayments) window.applyRepayments(); }catch(e){}

    // Exit add form immediately
    show('home');
    render();
    toast('Saved');

    // Trigger robust sync: pull->merge->push to avoid duplicates
    try{ await pushChanges(); }catch(e){console.warn(e);}  
  });

  document.addEventListener('submit',e=>{if(e.target.id==='budgetForm'){e.preventDefault();const category=$('budgetCategory').value,amount=Number($('budgetAmount').value);if(!category||amount<=0)return toast('Invalid budget');state.budgets=state.budgets||[];state.budgets.push({category,limit:amount});save();render();pushChanges();}});

  $('month')?.addEventListener('change',e=>{state.reportMonth=e.target.value||today.slice(0,7);save();render()});['theme','switch'].forEach(id=>$(id)?.addEventListener('click',()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';save();theme();}));

  injectPlanningUI();if($('date'))$('date').value=today;setType(state.currentType);render();show('home');

})();
