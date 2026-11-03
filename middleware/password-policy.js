const BLOCKLIST = new Set([
  'password123!', 'password123', 'qwerty123!', 'welcome123!', 'letmein123!',
  'admin123456!', 'changeme123!', 'iloveyou123!', '1234567890Aa!',
]);

function passwordPolicyError(value) {
  if (typeof value !== 'string') return 'Password is required.';
  if (Buffer.byteLength(value, 'utf8') > 72) return 'Password must be no more than 72 UTF-8 bytes.';
  if (value.length < 12) return 'Use at least 12 characters.';
  if (!/[A-Z]/.test(value)) return 'Include at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Include at least one lowercase letter.';
  if (!/[0-9]/.test(value)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Include at least one symbol.';
  const normalized = value.toLowerCase();
  if (BLOCKLIST.has(normalized)) return 'Choose a password that is not a common or default password.';
  if (/^(.)\1+$/.test(value)) return 'Do not use a repeated-character password.';
  return '';
}

module.exports = { passwordPolicyError };
