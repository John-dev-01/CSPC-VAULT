const db = require('./db');

function todayPhilippines() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function availableCopies(equipment, borrowDate, dueDate, excludeRequestId = 0) {
  if (!equipment || !validIsoDate(borrowDate) || !validIsoDate(dueDate) || dueDate < borrowDate) return 0;
  const reserved = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM borrow_requests
    WHERE equipment_id=? AND status='approved' AND id<>?
      AND ((borrow_date<=? AND due_date>=?) OR due_date < ?)`)
    .get(equipment.id, excludeRequestId, dueDate, borrowDate, todayPhilippines()).n;
  return Math.max(0, Number(equipment.quantity) - Number(reserved));
}

module.exports = { todayPhilippines, validIsoDate, availableCopies };
