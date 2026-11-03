const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { passwordPolicyError } = require('../middleware/password-policy');
const { notify } = require('../middleware/notifications');
const { availableCopies } = require('../middleware/availability');
const csrfProtection = require('../middleware/csrf');
const db = require('../middleware/db');
const { esc, badge, stats } = require('../middleware/views');
const filterDropdown = require('../middleware/filter-dropdown');
const equipmentImage = require('../middleware/equipment-images');
const { requirePermission, isSystemAdmin, requireSystemAdmin } = require('../middleware/auth');
const router = express.Router();
const departmentAdminOnly = (req, res, next) => isSystemAdmin(req.session.user) ? res.redirect('/admin/department-admins') : next();
router.use('/admin/requests', departmentAdminOnly, requirePermission('requests:review'));
router.use('/admin/equipment', departmentAdminOnly, requirePermission('equipment:manage'));
router.use('/admin/categories', departmentAdminOnly, requirePermission('equipment:manage'));
router.use('/admin/department-admins', requireSystemAdmin);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const flash = (req, type, msg) => (req.session.flash = { type, msg });
const departments = () => require('../middleware/departments');
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'equipment');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => {
    const ext = ({'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp'})[file.mimetype] || '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
  }}),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype) ? cb(null,true) : cb(new Error('Only JPEG, PNG, GIF, or WebP images are allowed.')),
});

function imageContentMatches(file) {
  if (!file || !file.path) return true;
  let fd;
  const header=Buffer.alloc(16);
  try { fd=fs.openSync(file.path,'r'); fs.readSync(fd,header,0,header.length,0); }
  catch { return false; }
  finally { if(fd!==undefined)fs.closeSync(fd); }
  if (file.mimetype === 'image/jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (file.mimetype === 'image/png') return header.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (file.mimetype === 'image/gif') return ['GIF87a','GIF89a'].includes(header.subarray(0,6).toString('ascii'));
  if (file.mimetype === 'image/webp') return header.subarray(0,4).toString('ascii') === 'RIFF' && header.subarray(8,12).toString('ascii') === 'WEBP';
  return false;
}
function removeUploaded(files) {
  for (const file of files || []) if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
}

const imageUpload = (req, res, next) => upload.single('image')(req, res, err => {
  if (err) { flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : 'Upload a valid image file.'); return res.redirect('/admin/equipment'); }
  if (!csrfProtection.validCsrfToken(req)) { removeUploaded(req.file?[req.file]:[]); return res.status(403).send(req.app.locals.page(req,'Request blocked','<h1>Security check failed</h1><p>Refresh the page and try again.</p>')); }
  if (req.file && !imageContentMatches(req.file)) { removeUploaded([req.file]); flash(req,'error','The uploaded file is not a valid JPEG, PNG, GIF, or WebP image.'); return res.redirect('/admin/equipment'); }
  next();
});
const bulkImageUpload = (req, res, next) => upload.any()(req, res, err => {
  if (err) { flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : 'Upload valid image files.'); return res.redirect('/admin/equipment'); }
  const files=req.files||[];
  if(!csrfProtection.validCsrfToken(req)){removeUploaded(files);return res.status(403).send(req.app.locals.page(req,'Request blocked','<h1>Security check failed</h1><p>Refresh the page and try again.</p>'));}
  if(files.some(file=>!imageContentMatches(file))){removeUploaded(files);flash(req,'error','One or more files are not valid JPEG, PNG, GIF, or WebP images.');return res.redirect('/admin/equipment');}
  next();
});

router.get('/admin/department-admins', (req, res) => {
  const rows = db.prepare("SELECT department,name,email FROM users WHERE role='admin' AND admin_scope='department' ORDER BY department COLLATE NOCASE").all();
  const createDialog = `<dialog class="department-admin-dialog" data-department-admin-dialog aria-labelledby="department-admin-dialog-title">
    <form class="password-dialog-content" method="post" action="/admin/department-admins">
      <div class="password-dialog-heading"><div><span class="catalog-kicker">DEPARTMENT ACCESS</span><h2 id="department-admin-dialog-title">Create department account</h2></div><button class="password-dialog-close" type="button" data-close-department-admin-dialog aria-label="Close">×</button></div>
      <label>Full name<input name="name" required maxlength="120" autocomplete="name"></label>
      <label>CSPC email<input type="email" name="email" required placeholder="name@my.cspc.edu.ph" autocomplete="email"></label>
      <label>College name<input name="department" required maxlength="120" placeholder="Engineering and Architecture" autocomplete="organization"></label>
      <p class="field-note">The system saves this as “College of …”. Department admins can manage only their assigned college’s equipment, requests, and borrower chats.</p>
      <label>Password<input type="password" name="password" minlength="12" maxlength="72" required autocomplete="new-password"></label>
      <label>Repeat password<input type="password" name="password_confirm" minlength="12" maxlength="72" required autocomplete="new-password"></label>
      <p class="field-note">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</p>
      <div class="password-dialog-actions"><button class="password-dialog-cancel" type="button" data-close-department-admin-dialog>Cancel</button><button type="submit">Create account</button></div>
    </form>
  </dialog>`;
  const body = `<div class="admin-stock-heading"><div><span class="catalog-kicker">DEPARTMENT ACCESS</span><h1>Department accounts</h1></div><span class="catalog-count">${rows.length} accounts</span></div>
    <p class="muted">Create department logins using any college name. Department admins can manage only their assigned college’s equipment, requests, and borrower chats.</p>
    <section class="card department-admin-create-card"><div><h2>Create department admin account</h2><p class="field-note">Open the form in a popup to create a new department account.</p></div><button type="button" data-open-department-admin-dialog>Create department account</button></section>
    <h2>Account status</h2><table><thead><tr><th>College</th><th>Assigned admin account</th><th>Status</th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td>${esc(row.department)}</td><td>${esc(row.name)} · ${esc(row.email)}</td><td>Account created</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No department accounts have been created yet.</td></tr>'}</tbody></table>${createDialog}`;
  res.send(req.app.locals.page(req, 'Department accounts', body));
});

router.post('/admin/department-admins', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.password_confirm || '');
  const rawCollege = String(req.body.department || '').trim().replace(/\s+/g, ' ');
  const department = rawCollege.replace(/^college\s+of\s+/i, '').trim()
    ? `College of ${rawCollege.replace(/^college\s+of\s+/i, '').trim()}` : '';
  if (name.length < 2 || name.length > 120) flash(req, 'error', 'Enter a valid full name.');
  else if (!/^[^\s@]+@my\.cspc\.edu\.ph$/.test(email)) flash(req, 'error', 'Use a @my.cspc.edu.ph email address.');
  else if (passwordPolicyError(password)) flash(req, 'error', passwordPolicyError(password));
  else if (password !== passwordConfirm) flash(req, 'error', 'Passwords do not match.');
  else if (rawCollege.length < 2 || rawCollege.length > 120 || !department) flash(req, 'error', 'Enter a valid college name.');
  else if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) flash(req, 'error', 'That email address is already registered.');
  else if (db.prepare("SELECT 1 FROM users WHERE role='admin' AND admin_scope='department' AND department=?").get(department)) flash(req, 'error', 'That department already has an admin account.');
  else {
    db.prepare('INSERT INTO users (name,email,password_hash,role,department,admin_scope,email_verified,must_change_password) VALUES (?,?,?,?,?,?,1,0)')
      .run(name, email, bcrypt.hashSync(password, 12), 'admin', department, 'department');
    flash(req, 'ok', `Admin account created for ${department}.`);
  }
  res.redirect('/admin/department-admins');
});

function requestScope(req) {
  if (!isSystemAdmin(req.session.user)) return { sql: ' WHERE e.department = ?', params: [req.session.user.department], selected: req.session.user.department };
  const requested = typeof req.query.department === 'string' ? req.query.department : '';
  const selected = departments().includes(requested) ? requested : '';
  return selected ? { sql: ' WHERE e.department = ?', params: [selected], selected } : { sql: '', params: [], selected: '' };
}

router.get('/admin/requests', (req, res) => {
  const scope = requestScope(req);
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const statuses = ['pending', 'approved', 'rejected', 'returned', 'cancelled'];
  const status = typeof req.query.status === 'string' && statuses.includes(req.query.status) ? req.query.status : '';
  const conditions = [];
  const params = [...scope.params];
  if (search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ? OR e.name LIKE ? OR r.purpose LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (status) { conditions.push('r.status = ?'); params.push(status); }
  const where = scope.sql
    ? `${scope.sql}${conditions.length ? ` AND ${conditions.join(' AND ')}` : ''}`
    : conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT r.*,e.name AS item,e.department,e.condition,u.name AS borrower
    FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id JOIN users u ON u.id=r.user_id${where}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,r.id DESC`).all(...params);
  const act = (id, action, label) => `<form method="post" action="/admin/requests/${id}/${action}"><button class="link">${label}</button></form>`;
  const reject = id => `<button class="link request-reject-trigger" type="button" data-reject-open data-request-id="${id}">Reject</button>`;
  const rejectionDialog = `<dialog class="rejection-reason-dialog" data-rejection-dialog aria-labelledby="rejection-dialog-title">
    <form class="password-dialog-content" method="post" action="/admin/requests/0/reject" data-rejection-form>
      <div class="password-dialog-heading"><div><span class="catalog-kicker">REQUEST ACTION</span><h2 id="rejection-dialog-title">Reject request</h2></div><button class="password-dialog-close" type="button" data-rejection-dialog-close aria-label="Close">×</button></div>
      <p class="field-note">The borrower will see this explanation.</p>
      <label for="rejection-dialog-reason">Reason for rejection<textarea id="rejection-dialog-reason" name="reason" maxlength="300" placeholder="Explain why this request cannot be approved" required></textarea></label>
      <div class="password-dialog-actions"><button class="password-dialog-cancel" type="button" data-rejection-dialog-close>Cancel</button><button type="submit">Reject request</button></div>
    </form>
  </dialog>`;
  const count = predicate => rows.filter(predicate).length;
  const requestFilters = `<section class="sidebar-controls" aria-labelledby="request-filter-heading">
    <div class="sidebar-controls-heading"><h2 id="request-filter-heading">Filters</h2><a href="/admin/requests">Clear</a></div>
    <form class="sidebar-filter-form" method="get" action="/admin/requests">
      <label>Search<input type="search" name="q" placeholder="Borrower, email, item, or purpose" value="${esc(search)}"></label>
      ${filterDropdown('status','Status',status,[{value:'',label:'All statuses'},...statuses.map(name=>({value:name,label:name.charAt(0).toUpperCase()+name.slice(1)}))])}
      ${isSystemAdmin(req.session.user) ? filterDropdown('department','Department',scope.selected,[{value:'',label:'All departments'},...departments().map(name=>({value:name,label:name}))]) : ''}
      <button>Apply filters</button>
    </form>
  </section>`;
  const emptyMessage = search || status || scope.selected ? 'No requests match these filters.' : 'No requests yet.';
  const body = `<div class="admin-stock-heading"><div><span class="catalog-kicker">${scope.selected ? esc(scope.selected) : 'ALL DEPARTMENTS'}</span><h1>Request queue</h1></div><span class="catalog-count">${rows.length} requests</span></div>
    ${stats([['Matching requests',rows.length,true],['Pending',count(r=>r.status==='pending')],['On loan',count(r=>r.status==='approved')],['Overdue',count(r=>r.status==='approved'&&r.due_date<today())]])}
    ${rows.length ? `<div class="request-table-wrap"><table class="request-table"><thead><tr><th>Borrower</th><th>Department</th><th>Item</th><th>Qty</th><th>Dates</th><th>Purpose</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.borrower)}</td><td>${esc(r.department)}</td><td>${esc(r.item)}${r.condition==='Needs repair'?' · Needs repair':''}</td><td>${r.quantity}</td><td>${esc(r.borrow_date)} → ${esc(r.due_date)}</td><td>${esc(r.purpose)}</td><td>${badge(r.status)}${r.status==='approved'&&r.due_date<today()?' <span class="badge rejected">overdue</span>':''}${r.status==='rejected'&&r.rejection_reason?`<small class="rejection-reason">${esc(r.rejection_reason)}</small>`:''}</td><td class="acts">${r.status==='pending'?act(r.id,'approve','Approve')+reject(r.id):''}${r.status==='approved'?act(r.id,'return','Mark returned'):''}</td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${emptyMessage}</p>`}`;
  const dialog = rows.some(r => r.status === 'pending') ? rejectionDialog : '';
  res.send(req.app.locals.page(req, 'Request queue', `${body}${dialog}`, { sidebarControls: requestFilters }));
});

const findRequest = (id, req) => isSystemAdmin(req.session.user)
  ? db.prepare('SELECT r.*,e.department,e.name AS item,u.name AS borrower FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id JOIN users u ON u.id=r.user_id WHERE r.id=?').get(id)
  : db.prepare('SELECT r.*,e.department,e.name AS item,u.name AS borrower FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id JOIN users u ON u.id=r.user_id WHERE r.id=? AND e.department=?').get(id, req.session.user.department);
const approve = db.transaction((id, user) => {
  const request = isSystemAdmin(user)
    ? db.prepare("SELECT r.*,e.name AS item,e.condition,e.quantity AS stock,e.archived_at,e.department FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE r.id=? AND r.status='pending'").get(id)
    : db.prepare("SELECT r.*,e.name AS item,e.condition,e.quantity AS stock,e.archived_at,e.department FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE r.id=? AND r.status='pending' AND e.department=?").get(id,user.department);
  if (!request) return 'This request is no longer pending or is outside your department.';
  if (request.archived_at) return 'Cannot approve: this item has been archived.';
  if (request.condition === 'Needs repair') return 'Cannot approve: this item needs repair.';
  if (request.due_date < today()) return 'Cannot approve: this request’s return date has passed.';
  const remaining = availableCopies({id:request.equipment_id,quantity:request.stock},request.borrow_date,request.due_date,request.id);
  if (remaining < request.quantity) return `Cannot approve: only ${remaining} copies are available for those dates.`;
  db.prepare("UPDATE borrow_requests SET status='approved' WHERE id=? AND status='pending'").run(id);
  notify(request.user_id,'request-approved',`${request.quantity} × ${request.item} approved for ${request.borrow_date} to ${request.due_date}.`,id);
});
const giveBack = db.transaction((id, user) => {
  const request = isSystemAdmin(user)
    ? db.prepare("SELECT r.*,e.name AS item FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE r.id=? AND r.status='approved'").get(id)
    : db.prepare("SELECT r.*,e.name AS item FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE r.id=? AND r.status='approved' AND e.department=?").get(id,user.department);
  if (!request) return 'This request is not currently on loan or is outside your department.';
  db.prepare("UPDATE borrow_requests SET status='returned' WHERE id=? AND status='approved'").run(id);
  notify(request.user_id,'item-returned',`${request.quantity} × ${request.item} was marked returned.`,id);
});
router.post('/admin/requests/:id/approve', (req,res) => {
  const error=approve(req.params.id,req.session.user);
  req.session.flash={type:error?'error':'ok',msg:error||'Request approved. Availability recalculated for the requested dates.'};
  res.redirect('/admin/requests');
});
router.post('/admin/requests/:id/reject', (req,res) => {
  const reason=typeof req.body.reason==='string'?req.body.reason.trim():'';
  const request=findRequest(req.params.id,req);
  if(!reason||reason.length>300){flash(req,'error','Enter a rejection reason of 1 to 300 characters.');return res.redirect('/admin/requests');}
  const changed=request?db.prepare("UPDATE borrow_requests SET status='rejected',rejection_reason=? WHERE id=? AND status='pending'").run(reason,req.params.id):{changes:0};
  if(changed.changes){notify(request.user_id,'request-rejected',`Your request for ${request.item} was rejected: ${reason}`,request.id);flash(req,'ok','Request rejected and borrower notified.');}
  else flash(req,'error','This request is no longer pending or is outside your department.');
  res.redirect('/admin/requests');
});
router.post('/admin/requests/:id/return',(req,res)=>{const error=giveBack(req.params.id,req.session.user);flash(req,error?'error':'ok',error||'Item marked returned. Availability recalculated.');res.redirect('/admin/requests');});

const categoryOptions = (categories, selected) => categories.map(c => `<option value="${esc(c.name)}"${selected === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
const conditionOptions = selected => ['Good', 'Fair', 'Needs repair'].map(c => `<option${selected === c ? ' selected' : ''}>${c}</option>`).join('');
const departmentOptions = (list, selected) => list.map(name => `<option value="${esc(name)}"${selected === name ? ' selected' : ''}>${esc(name)}</option>`).join('');
const equipForm = (e = {}, action = '/admin/equipment', label = 'Add item', categories = [], departmentList = [], className = 'inline', canChooseDepartment = false) => `<form method="post" action="${action}" enctype="multipart/form-data" class="${className}">
<input name="name" placeholder="Name" required value="${esc(e.name)}"><select name="category" required aria-label="Category">${categoryOptions(categories, e.category)}</select>
${canChooseDepartment ? `<select name="department" required aria-label="Department">${departmentOptions(departmentList, e.department)}</select>` : ''}
<input type="number" name="quantity" min="0" required value="${esc(e.quantity ?? 1)}" style="width:5rem"><select name="condition">${conditionOptions(e.condition)}</select>
<label class="image-upload-field">Image<input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp"><small>Upload JPG, PNG, GIF, or WebP images up to 5 MB${e.image_url ? ' or keep the current image below.' : '.'}</small></label>
<input name="image_url" placeholder="Image URL (optional)" aria-label="Image URL" value="${esc(e.image_url)}"><button>${label}</button></form>`;

function adminFilters(categories, query, deptList, isSystem) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const category = typeof query.category === 'string' ? query.category : '';
  const condition = typeof query.condition === 'string' ? query.condition : '';
  const availability = typeof query.availability === 'string' ? query.availability : '';
  const chosenDepartment = typeof query.department === 'string' && deptList.includes(query.department) ? query.department : '';
  return `<section class="sidebar-controls" aria-labelledby="filter-heading"><div class="sidebar-controls-heading"><h2 id="filter-heading">Filters</h2><a href="/admin/equipment">Clear</a></div><form class="sidebar-filter-form" method="get" action="/admin/equipment">
<label>Search<input name="q" aria-label="Search equipment" placeholder="Name or category" value="${esc(q)}"></label>${filterDropdown('category', 'Category', category, [{ value: '', label: 'All categories' }, ...categories.map(({ name }) => ({ value: name, label: name }))])}
${isSystem ? filterDropdown('department', 'Department', chosenDepartment, [{ value: '', label: 'All departments' }, ...deptList.map(name => ({ value: name, label: name }))]) : ''}
${filterDropdown('condition', 'Condition', condition, [{ value: '', label: 'All conditions' }, ...['Good', 'Fair', 'Needs repair'].map(value => ({ value, label: value }))])}${filterDropdown('availability', 'Availability', availability, [{ value: '', label: 'All availability' }, { value: 'available', label: 'Available' }, { value: 'unavailable', label: 'Unavailable' }])}<button>Apply filters</button></form></section>`;
}
function equipmentScope(req, requestedDepartment = '') {
  if (!isSystemAdmin(req.session.user)) return req.session.user.department;
  return departments().includes(requestedDepartment) ? requestedDepartment : '';
}
router.get('/admin/equipment', (req, res) => {
  const deptList = departments();
  const systemAdmin = isSystemAdmin(req.session.user);
  const dept = equipmentScope(req, typeof req.query.department === 'string' ? req.query.department : '');
  const categories = db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = categories.some(c => c.name === req.query.category) ? req.query.category : '';
  const condition = ['Good', 'Fair', 'Needs repair'].includes(req.query.condition) ? req.query.condition : '';
  const availability = ['available', 'unavailable'].includes(req.query.availability) ? req.query.availability : '';
  const filters = [], params = [];
  if (dept) { filters.push('department = ?'); params.push(dept); }
  if (q) { filters.push('(name LIKE ? OR category LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (category) { filters.push('category = ?'); params.push(category); }
  if (condition) { filters.push('condition = ?'); params.push(condition); }
  filters.push('archived_at IS NULL');
  const rows = db.prepare(`SELECT * FROM equipment${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY name`).all(...params)
    .map(item => ({...item, available_now:item.condition==='Needs repair'?0:availableCopies(item,today(),today())}))
    .filter(item => availability==='available'?item.available_now>0:availability==='unavailable'?item.available_now===0:true);
  const cards = rows.map(e => `<article class="admin-equipment-card"><div class="equipment-card-image"><img src="${esc(equipmentImage(e))}" alt="${esc(e.name)}" loading="lazy"></div><div class="admin-equipment-editor"><div class="admin-item-fields">
    <label>Name<input name="item_${e.id}_name" required value="${esc(e.name)}"></label><label>Category<select name="item_${e.id}_category" required>${categoryOptions(categories, e.category)}</select></label>
    <label>Total copies<input type="number" name="item_${e.id}_quantity" min="0" required value="${esc(e.quantity)}"><small>${e.available_now} available today</small></label><label>Condition<select name="item_${e.id}_condition">${conditionOptions(e.condition)}</select></label>
    <label>Department<input value="${esc(e.department)}" disabled></label><label class="image-upload-field">Replace image<input type="file" name="item_${e.id}_image" accept="image/jpeg,image/png,image/gif,image/webp"><small>Leave empty to keep the current image.</small></label>
    <label>Image URL<input name="item_${e.id}_image_url" value="${esc(e.image_url)}"></label></div><button class="link admin-delete-button" type="submit" formmethod="post" formaction="/admin/equipment/${e.id}/delete">Archive item</button></div></article>`).join('');
  const deptLabel = dept || 'All departments';
  const body = `<div class="admin-stock-heading"><div><span class="catalog-kicker">${esc(deptLabel)}</span><h1>Manage stock</h1></div><span class="catalog-count">${rows.length} ${rows.length === 1 ? 'item' : 'items'}</span></div>
    <div class="admin-items-toolbar"><h2>Items</h2><div class="admin-items-actions"><button type="button" data-open-add-item>Add Item</button>${rows.length ? '<button type="submit" form="bulk-equipment-form">Save changes</button>' : ''}</div></div>
    ${rows.length ? `<form id="bulk-equipment-form" method="post" action="/admin/equipment/bulk" enctype="multipart/form-data"><input type="hidden" name="department" value="${esc(dept)}"><section class="admin-equipment-grid" aria-label="Edit equipment">${cards}</section></form>` : '<p class="muted">No equipment matches these filters.</p>'}
    <dialog class="admin-add-dialog" data-add-item-dialog aria-labelledby="add-item-dialog-title"><div class="admin-add-dialog-content"><div class="admin-add-dialog-heading"><div><span class="catalog-kicker">${esc(deptLabel)}</span><h2 id="add-item-dialog-title">Add Item</h2></div><button type="button" class="admin-add-dialog-close" data-close-add-item aria-label="Close add item dialog" title="Close">×</button></div>${equipForm({ department: dept || deptList[0] }, '/admin/equipment', 'Add Item', categories, deptList, 'admin-item-form', systemAdmin)}</div></dialog>`;
  res.send(req.app.locals.page(req, 'Manage stock', body, { sidebarControls: adminFilters(categories, req.query, deptList, systemAdmin) }));
});

function validImageUrl(imageUrl) { return !imageUrl || (imageUrl.length <= 2048 && ((imageUrl.startsWith('/') && !imageUrl.startsWith('//')) || /^https?:\/\//i.test(imageUrl))); }
function clean(body, file, department, existingImage = '') {
  const quantity = Number(body.quantity);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const condition = typeof body.condition === 'string' ? body.condition : '';
  const imageUrl = file ? `/uploads/equipment/${file.filename}` : (typeof body.image_url === 'string' ? body.image_url.trim() : existingImage);
  if (!name || name.length > 120 || !category || category.length > 80 || !db.prepare('SELECT 1 FROM categories WHERE name = ?').get(category) ||
      !Number.isInteger(quantity) || quantity < 0 || !['Good','Fair','Needs repair'].includes(condition) || !departments().includes(department) || !validImageUrl(imageUrl)) return null;
  return [name, category, quantity, condition, imageUrl];
}
const BAD = 'Enter a name (max 120), category, whole-number quantity, valid condition, department, and local path or HTTP(S) image URL.';
router.post('/admin/categories', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 80) flash(req, 'error', 'Enter a category name of 1 to 80 characters.');
  else { const result = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name); flash(req, result.changes ? 'ok' : 'error', result.changes ? 'Category added.' : 'That category already exists.'); }
  res.redirect('/admin/equipment');
});
router.post('/admin/equipment', imageUpload, (req, res) => {
  const systemAdmin = isSystemAdmin(req.session.user);
  const department = systemAdmin ? String(req.body.department || '').trim() : req.session.user.department;
  const values = clean(req.body, req.file, department);
  if (!values) flash(req, 'error', BAD);
  else { db.prepare('INSERT INTO equipment (name,category,quantity,condition,image_url,department) VALUES (?,?,?,?,?,?)').run(...values, department); flash(req, 'ok', `Item added to ${department}.`); }
  res.redirect('/admin/equipment');
});
router.post('/admin/equipment/bulk', bulkImageUpload, (req, res) => {
  const systemAdmin = isSystemAdmin(req.session.user);
  const selectedDepartment = systemAdmin ? equipmentScope(req, String(req.body.department || '')) : req.session.user.department;
  const rows = selectedDepartment
    ? db.prepare('SELECT * FROM equipment WHERE department = ? AND archived_at IS NULL ORDER BY name').all(selectedDepartment)
    : db.prepare('SELECT * FROM equipment WHERE archived_at IS NULL ORDER BY name').all();
  const files = new Map((req.files || []).map(file => [file.fieldname, file]));
  try {
    db.transaction(() => {
      for (const row of rows) {
        const prefix = `item_${row.id}_`;
        const fields = { name: req.body[`${prefix}name`], category: req.body[`${prefix}category`], quantity: req.body[`${prefix}quantity`], condition: req.body[`${prefix}condition`], image_url: req.body[`${prefix}image_url`] };
        const values = clean(fields, files.get(`${prefix}image`), row.department, row.image_url);
        if (!values) throw new Error(`Invalid fields for ${row.name}.`);
        db.prepare('UPDATE equipment SET name=?,category=?,quantity=?,condition=?,image_url=? WHERE id=? AND department=?').run(...values, row.id, row.department);
      }
    })();
    flash(req, 'ok', 'Equipment changes saved.');
  } catch (error) { removeUploaded(req.files||[]); flash(req, 'error', error.message || BAD); }
  res.redirect('/admin/equipment');
});
router.post('/admin/equipment/:id/delete', bulkImageUpload, (req,res)=>{
  removeUploaded(req.files||[]);
  const result=isSystemAdmin(req.session.user)
    ?db.prepare('UPDATE equipment SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND archived_at IS NULL').run(req.params.id)
    :db.prepare('UPDATE equipment SET archived_at=CURRENT_TIMESTAMP WHERE id=? AND department=? AND archived_at IS NULL').run(req.params.id,req.session.user.department);
  if(result.changes)flash(req,'ok','Item archived. Existing borrowing history is preserved.');
  else flash(req,'error','Active item not found in your department.');
  res.redirect('/admin/equipment');
});
module.exports = router;
