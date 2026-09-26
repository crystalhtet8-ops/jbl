const SPREADSHEET_ID='';
const TRANSACTION_HEADERS=['id','type','amount','date','category','note','createdAt'];
const CATEGORY_HEADERS=['name','type','createdAt'];
const BUDGET_HEADERS=['category','amount'];
const GOAL_HEADERS=['name','target','saved'];
function ss(){return SPREADSHEET_ID?SpreadsheetApp.openById(SPREADSHEET_ID):SpreadsheetApp.getActiveSpreadsheet()}
function out(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON)}
function doGet(e){try{const a=e?.parameter?.action;if(a==='getAll')return out({ok:true,data:readAll()});if(a==='status')return out({ok:true,data:status()});return out({ok:true,message:'MoneyFlow Apps Script is online'})}catch(x){return out({ok:false,message:x.message})}}
function doPost(e){try{const r=JSON.parse(e?.postData?.contents||'{}');if(r.action==='getAll')return out({ok:true,data:readAll()});if(r.action==='status')return out({ok:true,data:status()});if(r.action==='replaceAll'){writeAll(r);return out({ok:true,data:status()})}return out({ok:false,message:'Unknown action'})}catch(x){return out({ok:false,message:x.message})}}
function sheet(name,headers){const s=ss().getSheetByName(name)||ss().insertSheet(name);if(s.getLastRow()===0)s.getRange(1,1,1,headers.length).setValues([headers]);s.setFrozenRows(1);return s}
function rows(name,headers){const v=sheet(name,headers).getDataRange().getValues();if(v.length<2)return[];return v.slice(1).filter(r=>r.some(x=>x!=='')).map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o})}
function normalizeTransaction(x){return {id:String(x.id||''),type:String(x.type||'expense'),amount:Number(x.amount||0),date:formatDate(x.date),category:String(x.category||'General'),note:String(x.note||''),createdAt:x.createdAt?new Date(x.createdAt).toISOString():new Date().toISOString()}}
function normalizeCategory(x){return {name:String(x.name||'').trim(),type:String(x.type||'expense'),createdAt:x.createdAt?new Date(x.createdAt).toISOString():new Date().toISOString()}}
function uniqueCategories(xs){const r=[];xs.forEach(x=>{const c=normalizeCategory(x);if(c.name&&!r.some(y=>y.name.toLowerCase()===c.name.toLowerCase()&&y.type===c.type))r.push(c)});return r}
function fingerprint(d){return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,JSON.stringify(d),Utilities.Charset.UTF_8))}
function readAll(){const transactions=rows('Transactions',TRANSACTION_HEADERS).map(normalizeTransaction),categories=uniqueCategories(rows('Categories',CATEGORY_HEADERS)),budgets=rows('Budgets',BUDGET_HEADERS).map(x=>({category:String(x.category||''),amount:Number(x.amount||0)})),goals=rows('Goals',GOAL_HEADERS).map(x=>({name:String(x.name||''),target:Number(x.target||0),saved:Number(x.saved||0)}));return {transactions,categories,budgets,goals,revision:fingerprint({transactions,categories,budgets,goals})}}
function status(){const d=readAll();return {revision:d.revision,count:d.transactions.length,categoryCount:d.categories.length,budgetCount:d.budgets.length,goalCount:d.goals.length}}
function writeAll(p){const t=(p.transactions||[]).map(normalizeTransaction),c=uniqueCategories(p.categories||[]),b=(p.budgets||[]).map(x=>[String(x.category||''),Number(x.amount||0)]),g=(p.goals||[]).map(x=>[String(x.name||''),Number(x.target||0),Number(x.saved||0)]);writeTable('Transactions',TRANSACTION_HEADERS,t.map(x=>[x.id,x.type,x.amount,x.date,x.category,x.note,x.createdAt]));writeTable('Categories',CATEGORY_HEADERS,c.map(x=>[x.name,x.type,x.createdAt]));writeTable('Budgets',BUDGET_HEADERS,b);writeTable('Goals',GOAL_HEADERS,g)}
function writeTable(n,h,v){const s=sheet(n,h);s.clearContents();s.getRange(1,1,1,h.length).setValues([h]);if(v.length)s.getRange(2,1,v.length,h.length).setValues(v);s.setFrozenRows(1)}
function formatDate(v){if(!v)return'';if(Object.prototype.toString.call(v)==='[object Date]')return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');return String(v).slice(0,10)}
