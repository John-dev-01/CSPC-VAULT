const express = require('express');
const db = require('../middleware/db');
const { esc, badge } = require('../middleware/views');
const filterDropdown = require('../middleware/filter-dropdown');
const equipmentImage = require('../middleware/equipment-images');
const { isSystemAdmin, requirePermission } = require('../middleware/auth');
const { notifyDepartmentAdmins } = require('../middleware/notifications');
const { todayPhilippines, validIsoDate, availableCopies } = require('../middleware/availability');
const router = express.Router();
const guard = requirePermission('equipment:read');
const systemAdminOnlyDepartmentAccounts = (req, res, next) => isSystemAdmin(req.session.user)
  ? res.redirect('/admin/department-admins')
  : next();
router.use(['/equipment', '/requests', '/my-requests'], systemAdminOnlyDepartmentAccounts);
const today = todayPhilippines;

router.get('/equipment', guard, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const department = req.session.user.department;
  const categories = db.prepare('SELECT DISTINCT category FROM equipment WHERE department=? AND archived_at IS NULL ORDER BY category').all(department).map(row => row.category);
  const category = typeof req.query.category === 'string' && categories.includes(req.query.category) ? req.query.category : '';
  const conditions = ['Good', 'Fair', 'Needs repair'];
  const condition = typeof req.query.condition === 'string' && conditions.includes(req.query.condition) ? req.query.condition : '';
  const availability = ['available', 'unavailable'].includes(req.query.availability) ? req.query.availability : '';
  const filters = ['department=?','archived_at IS NULL'];
  const params = [department];
  if (q) { filters.push('(name LIKE ? OR category LIKE ?)'); params.push(`%${q}%`,`%${q}%`); }
  if (category) { filters.push('category=?'); params.push(category); }
  if (condition) { filters.push('condition=?'); params.push(condition); }
  const rows = db.prepare(`SELECT * FROM equipment WHERE ${filters.join(' AND ')} ORDER BY name`).all(...params)
    .map(item => ({ ...item, available: item.condition === 'Needs repair' ? 0 : availableCopies(item, today(), today()) }))
    .filter(item => availability === 'available' ? item.available > 0 : availability === 'unavailable' ? item.available === 0 : true);
  const loansByEquipment = new Map();
  for (const loan of db.prepare(`SELECT r.equipment_id,r.due_date,SUM(r.quantity) AS copies
    FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id
    WHERE r.status='approved' AND e.department=? GROUP BY r.equipment_id,r.due_date ORDER BY r.due_date`).all(department)) {
    if (!loansByEquipment.has(loan.equipment_id)) loansByEquipment.set(loan.equipment_id, []);
    loansByEquipment.get(loan.equipment_id).push(loan);
  }
  const sidebarControls = `<section class="sidebar-controls" aria-labelledby="filter-heading"><div class="sidebar-controls-heading"><h2 id="filter-heading">Filters</h2></div>
    <form class="sidebar-filter-form" method="get" action="/equipment"><label>Search<input name="q" aria-label="Search equipment" placeholder="Name or category" value="${esc(q)}"></label>
    ${filterDropdown('category','Category',category,[{value:'',label:'All categories'},...categories.map(value=>({value,label:value}))])}
    ${filterDropdown('condition','Condition',condition,[{value:'',label:'All conditions'},...conditions.map(value=>({value,label:value}))])}
    ${filterDropdown('availability','Availability',availability,[{value:'',label:'All availability'},{value:'available',label:'Available now'},{value:'unavailable',label:'Unavailable now'}])}<button>Apply filters</button><a class="sidebar-filter-clear" href="/equipment">Clear</a></form></section>`;
  const body = `<div class="catalog-heading"><div><span class="catalog-kicker">CSPC / RESOURCE LIBRARY</span><h1>Equipment</h1></div><span class="catalog-count">${rows.length} ${rows.length===1?'item':'items'}</span></div>
    ${rows.length ? `<section class="equipment-grid" aria-label="Equipment items">${rows.map(item=>`<article class="equipment-card"><div class="equipment-card-image"><img src="${esc(equipmentImage(item))}" alt="${esc(item.name)}" loading="lazy"></div><div class="equipment-card-body"><div class="equipment-card-meta"><span>${esc(item.category)}</span><span>${esc(item.condition)}</span></div><h2>${esc(item.name)}</h2><div class="equipment-card-stock"><span>Available now</span><strong>${item.available>0?item.available:'None'}</strong></div>
      ${(loansByEquipment.get(item.id)||[]).length?`<details class="return-dates"><summary>Expected return dates</summary><ul>${loansByEquipment.get(item.id).map(loan=>`<li><time datetime="${esc(loan.due_date)}">${esc(loan.due_date)}</time>${loan.copies>1?` (${loan.copies} copies)`:''}</li>`).join('')}</ul></details>`:''}
      ${item.condition==='Needs repair'?'<span class="equipment-unavailable">Unavailable · Needs repair</span>':item.available>0?`<a class="btn equipment-request" href="/equipment/${item.id}/borrow">Request item</a>`:'<span class="equipment-unavailable">Currently unavailable</span>'}</div></article>`).join('')}</section>`:'<p class="muted">No equipment matches these filters. Try changing or clearing them.</p>'}`;
  res.send(req.app.locals.page(req,'Equipment',body,{sidebarControls}));
});

const borrowForm = (item, error = '', values = {}, available = null) => `<h1>Request ${esc(item.name)}</h1>
  ${error?`<p class="flash error">${esc(error)}</p>`:''}
  <form method="post" action="/requests" class="card borrow-request-form" data-availability-url="/equipment/${item.id}/availability">
    <input type="hidden" name="equipment_id" value="${item.id}">
    <label>Borrow date<input type="date" name="borrow_date" data-availability-date min="${today()}" required value="${esc(values.borrow_date||today())}"></label>
    <label>Return by<input type="date" name="due_date" data-availability-date min="${today()}" required value="${esc(values.due_date||values.borrow_date||today())}"></label>
    <p class="field-note" data-availability-message role="status">${available===null?'Checking availability for these dates…':`${available} copies available for these dates.`}</p>
    <label>Quantity<input type="number" name="quantity" min="1" max="${available===null?item.quantity:Math.max(1,available)}" value="${esc(values.quantity||1)}" required></label>
    <label>Purpose<textarea name="purpose" required maxlength="300">${esc(values.purpose)}</textarea><small>Maximum 300 characters.</small></label>
    <button ${available===0?'disabled':''}>Send request</button></form>`;

router.get('/equipment/:id/availability', guard, (req,res)=>{
  const item=db.prepare('SELECT id,quantity,condition FROM equipment WHERE id=? AND department=? AND archived_at IS NULL').get(req.params.id,req.session.user.department);
  if(!item)return res.status(404).json({error:'Item not found.'});
  const borrowDate=req.query.borrow_date,dueDate=req.query.due_date;
  if(!validIsoDate(borrowDate)||!validIsoDate(dueDate)||dueDate<borrowDate)return res.status(400).json({error:'Enter a valid date range.'});
  const available=item.condition==='Needs repair'?0:availableCopies(item,borrowDate,dueDate);
  res.set('Cache-Control','no-store').json({available,unavailableReason:item.condition==='Needs repair'?'This item needs repair.':''});
});

router.get('/equipment/:id/borrow',guard,(req,res)=>{
  const item=db.prepare('SELECT * FROM equipment WHERE id=? AND department=? AND archived_at IS NULL').get(req.params.id,req.session.user.department);
  if(!item)return res.status(404).send(req.app.locals.page(req,'Not found','<h1>Item not found</h1>'));
  const available=item.condition==='Needs repair'?0:availableCopies(item,today(),today());
  if(!available||item.condition==='Needs repair')return res.status(409).send(req.app.locals.page(req,'Unavailable',`<h1>${esc(item.name)} is not available to request right now.</h1><p><a href="/equipment">Back to equipment</a></p>`));
  res.send(req.app.locals.page(req,'Request',borrowForm(item,'',{},available)));
});

router.post('/requests',guard,(req,res)=>{
  const equipmentId=typeof req.body.equipment_id==='string'?req.body.equipment_id:'';
  const borrowDate=typeof req.body.borrow_date==='string'?req.body.borrow_date:'';
  const dueDate=typeof req.body.due_date==='string'?req.body.due_date:'';
  const quantity=Number(req.body.quantity);
  const purpose=typeof req.body.purpose==='string'?req.body.purpose.trim():'';
  const item=db.prepare('SELECT * FROM equipment WHERE id=? AND department=? AND archived_at IS NULL').get(equipmentId,req.session.user.department);
  if(!item)return res.status(404).send(req.app.locals.page(req,'Not found','<h1>Item not found</h1>'));
  const values={borrow_date:borrowDate,due_date:dueDate,quantity:req.body.quantity,purpose};
  const fail=message=>res.status(400).send(req.app.locals.page(req,'Request',borrowForm(item,message,values,availableCopies(item,validIsoDate(borrowDate)?borrowDate:today(),validIsoDate(dueDate)?dueDate:(validIsoDate(borrowDate)?borrowDate:today())))));
  if(!validIsoDate(borrowDate)||!validIsoDate(dueDate))return fail('Enter valid borrow and return dates.');
  if(borrowDate<today())return fail('Borrow date cannot be in the past in Philippine time.');
  if(dueDate<borrowDate)return fail('Return date must be on or after the borrow date.');
  if(!Number.isSafeInteger(quantity)||quantity<1)return fail('Quantity must be a whole number of at least one.');
  if(!purpose||purpose.length>300)return fail('Purpose is required and must be 300 characters or fewer.');
  if(item.condition==='Needs repair')return fail('This item cannot be requested because it needs repair.');
  const available=availableCopies(item,borrowDate,dueDate);
  if(available<quantity)return fail(`Only ${available} copies are available for those dates.`);
  const result=db.prepare('INSERT INTO borrow_requests (user_id,equipment_id,borrow_date,due_date,purpose,quantity) VALUES (?,?,?,?,?,?)')
    .run(req.session.user.id,item.id,borrowDate,dueDate,purpose,quantity);
  notifyDepartmentAdmins(item.department,'new-request',`${req.session.user.name} requested ${quantity} × ${item.name} for ${borrowDate} to ${dueDate}.`,result.lastInsertRowid);
  req.session.flash={type:'ok',msg:'Request sent. The department admin will review it.'};
  res.redirect('/my-requests');
});

router.get('/my-requests',guard,(req,res)=>{
  const rows=db.prepare(`SELECT r.*,e.name FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE r.user_id=? ORDER BY r.id DESC`).all(req.session.user.id);
  const body=`<h1>My requests</h1>${rows.length?`<table><thead><tr><th>Item</th><th>Qty</th><th>Borrow</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}</td><td>${row.quantity}</td><td>${esc(row.borrow_date)}</td><td>${esc(row.due_date)}</td><td>${badge(row.status)}${row.status==='approved'&&row.due_date<today()?' <span class="badge rejected">overdue</span>':''}${row.status==='rejected'&&row.rejection_reason?`<small class="rejection-reason">Reason: ${esc(row.rejection_reason)}</small>`:''}</td><td>${row.status==='pending'?`<form method="post" action="/requests/${row.id}/cancel"><button class="link">Cancel</button></form>`:''}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">You have no requests yet. <a href="/equipment">Browse equipment</a> to start one.</p>'}`;
  res.send(req.app.locals.page(req,'My requests',body));
});
router.post('/requests/:id/cancel',guard,(req,res)=>{
  const result=db.prepare("UPDATE borrow_requests SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'").run(req.params.id,req.session.user.id);
  req.session.flash=result.changes?{type:'ok',msg:'Request cancelled.'}:{type:'error',msg:'That request cannot be cancelled.'};
  res.redirect('/my-requests');
});
module.exports=router;
