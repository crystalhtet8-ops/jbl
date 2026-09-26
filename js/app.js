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
  function money(n){return `${Math.round(Number(n)||0).toLocaleString()} MMK`}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function toast(m){const e=$('toast');if(!e)return;e.textContent=m;e.classList.add('on');clearTimeout(e._timer);e._timer=setTimeout(()=>e.classList.remove('on'),2200)}
  function month(){return state.reportMonth||today.slice(0,7)}
  function items(){return state.transactions.filter(t=>String(t.date||'').slice(0,7)===month())}
  function totals(xs){return xs.reduce((r,t)=>{const n=Number(t.amount)||0;if(t.type==='income')r.income+=n;else if(t.type==='expense')r.expense+=n;else if(t.type==='loan')r.loan+=n;else if(t.type==='credit')r.credit+=n;return r},{income:0,expense:0,loan:0,credit:0})}
  function greeting(){const h=new Date().getHours(),part=h<12?'Morning':h<17?'Afternoon':h<21?'Evening':'Night';if($('greet'))$('greet').textContent=`GOOD ${part.toUpperCase()}`;if($('greetTitle'))$('greetTitle').textContent=`Welcome back 👋`}
  function setType(type){state.currentType=type;const titles={expense:'Add Expense',income:'Add Income',loan:'Add Loan Payment',credit:'Add Credit Payment'};if($('formTitle'))$('formTitle').textContent=titles[type]||titles.expense;populateCategories()}
  function populateCategories(){const s=$('category');if(!s)return;const list=state.categories.filter(c=>c.type===state.currentType);s.innerHTML=list.map(c=>`<option>${esc(c.name)}</option>`).join('')}
  function show(id){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id))}
  function budgetRows(){const spent={};items().filter(t=>t.type==='expense').forEach(t=>spent[t.category||'General']=(spent[t.category||'General']||0)+Number(t.amount||0));return state.budgets.map(b=>{const used=spent[b.category]||0;const pct=b.limit?Math.round(used/b.limit*100):0;return Object.assign({},b,{used,pct})})}
  function renderBudgets(){/* omitted for brevity - keep existing UI rendering in place if present */}
  function renderGoals(){/* omitted for brevity */}
  function renderReports(){/* omitted for brevity */}

  function render(){greeting();const xs=items(),t=totals(xs),net=t.income-t.expense-t.loan-t.credit;[['income',t.income],['expense',t.expense],['loan',t.loan],['credit',t.credit],['remaining',net]].forEach(([id,val])=>{$(id)?.textContent=money(val)});$('txCount')&&($('#txCount');) }

  function injectPlanningUI(){if($('planningStyles'))return;const st=document.createElement('style');st.id='planningStyles';st.textContent='.planning-grid{display:grid}';document.head.appendChild(st)}
  function theme(){document.body.classList.toggle('dark',state.settings.theme==='dark');if($('switch'))$('switch').classList.toggle('on',state.settings.theme==='dark')}

  async function api(action,payload={}){if(!state.settings.syncUrl)throw Error('Add the Apps Script URL first.');const r=await fetch(state.settings.syncUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});return r.json();}
  async function pushChanges(){if(syncing||!state.settings.syncUrl)return;syncing=true;try{await api('replaceAll',{transactions:state.transactions,categories:state.categories,budgets:state.budgets,goals:state.goals,loans:state.loans});state.settings.lastSynced=new Date().toISOString()}catch(e){}finally{syncing=false}}
  // expose pushChanges so other modules (loan-logic) can trigger a sync after modifications
  window.pushChanges = pushChanges;

  async function pull(){if(syncing||!state.settings.syncUrl)return;syncing=true;try{const r=await api('getAll');if(r.data){state.transactions=r.data.transactions||[];state.categories=r.data.categories||fallback.categories;state.budgets=r.data.budgets||[];state.goals=r.data.goals||[];state.loans=r.data.loans||[]}save();}catch(e){}finally{syncing=false}}

  document.addEventListener('click',e=>{const p=e.target.closest('[data-page]');if(p)return show(p.dataset.page);const a=e.target.closest('[data-add]');if(a){setType(a.dataset.add);show('add');return}const tab=e.target.closest('[data-type]');if(tab){setType(tab.dataset.type);return}});

  // Form submit handler - enhanced to support loan recording and repayment selection
  const formEl = $('form');
  formEl?.addEventListener('submit',e=>{
    if(e.target.id!=='form')return;e.preventDefault();
    const amount=Number($('amount').value);if(!amount||amount<=0)return toast('Enter an amount greater than zero');
    let txType = state.currentType;
    // If repayment select is present, prefer that and mark as expense
    const loanSelect = document.getElementById('loanRepaySelect');
    const selectedLoanId = loanSelect && loanSelect.value ? loanSelect.value : null;
    if(selectedLoanId){ txType = 'expense'; }
    // If user used 'loan' tab, record as income with loanId
    const isLoanTab = state.currentType === 'loan';

    const tx = {
      id: Date.now().toString(),
      type: txType,
      amount: amount,
      date: ($('date')?.value) || today,
      category: ($('category')?.value) || 'General',
      note: $('note')?.value || '',
      createdAt: Date.now()
    };

    // If repayment selected, attach loanId (applicable for Loan Repayment flow)
    if(selectedLoanId){ tx.loanId = selectedLoanId; }

    // If user is recording a new loan (loan tab), create loan record and mark tx.loanId
    if(isLoanTab){
      const loanId = `loan-${tx.id}`;
      tx.loanId = loanId;
      // create loan record
      state.loans = state.loans||[];
      state.loans.push({id:loanId,name:tx.note||'Loan',principal:Number(tx.amount)||0,remaining:Number(tx.amount)||0,date:tx.date,note:tx.note||'',createdAt:tx.createdAt});
    }

    // push transaction
    state.transactions = state.transactions||[];
    state.transactions.push(tx);
    save();
    // trigger sync if configured
    try{ window.pushChanges && window.pushChanges(); }catch(e){}
    render();
    show('home');
    toast('Saved');
  });

  document.addEventListener('submit',e=>{if(e.target.id==='budgetForm'){e.preventDefault();const category=$('budgetCategory').value,amount=Number($('budgetAmount').value);if(!category||amount<=0)return toast('Invalid budget');state.budgets=state.budgets||[];state.budgets.push({category,limit:amount});save();render();pushChanges();}});

  $('month')?.addEventListener('change',e=>{state.reportMonth=e.target.value||today.slice(0,7);save();render()});['theme','switch'].forEach(id=>$(id)?.addEventListener('click',()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';save();theme();}));

  injectPlanningUI();if($('date'))$('date').value=today;setType(state.currentType);render();show('home');

})();
