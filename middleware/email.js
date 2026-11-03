const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user || !pass) return null;
  if (!transporter) transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return { transporter, user };
}

async function sendVerificationLink(email, link) {
  const mail = getTransporter();
  if (!mail) {
    console.info(`[EMAIL VERIFICATION DEMO] To: ${email} | Verify using this link within 10 minutes: ${link}`);
    return { sent: false, fallback: true };
  }
  try {
    await mail.transporter.sendMail({
      from: `CSPC Equipment Desk <${mail.user}>`,
      to: email,
      subject: 'Verify your CSPC Equipment Desk email',
      text: `Open this link to verify your CSPC email and create your borrower account. After verification, you will be redirected to Sign in. The link expires in 10 minutes and works once. If you did not request an account, ignore this email.\n\n${link}`,
      html: `<p>Open the button below to verify your CSPC email and create your borrower account. After verification, you will be redirected to Sign in automatically.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#146c5b;color:#fff;text-decoration:none;border-radius:6px">Verify my email</a></p><p>This link expires in 10 minutes and can be used only once. If you did not request an account, ignore this email.</p><p>If the button does not work, copy and paste this address into your browser:</p><p><a href="${link}">${link}</a></p>`,
    });
    return { sent: true, fallback: false };
  } catch (error) {
    console.error(`Could not send verification email to ${email}: ${error.message}`);
    console.info(`[EMAIL VERIFICATION DEMO] To: ${email} | Verify using this link within 10 minutes: ${link}`);
    return { sent: false, fallback: true };
  }
}

async function sendPasswordResetLink(email, link) {
  const mail = getTransporter();
  if (!mail) {
    console.info(`[PASSWORD RESET DEMO] To: ${email} | Reset using this link within 20 minutes: ${link}`);
    return { sent: false, fallback: true };
  }
  try {
    await mail.transporter.sendMail({
      from: `CSPC Equipment Desk <${mail.user}>`,
      to: email,
      subject: 'Reset your CSPC Equipment Desk password',
      text: `Open this link to choose a new password. The link expires in 20 minutes and works once. If you did not request a password reset, ignore this email.\n\n${link}`,
      html: `<p>We received a request to reset your CSPC Equipment Desk password.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#146c5b;color:#fff;text-decoration:none;border-radius:6px">Reset my password</a></p><p>This link expires in 20 minutes and can be used only once. If you did not request this, ignore this email.</p><p>If the button does not work, copy and paste this address into your browser:</p><p><a href="${link}">${link}</a></p>`,
    });
    return { sent: true, fallback: false };
  } catch (error) {
    console.error(`Could not send password reset email to ${email}: ${error.message}`);
    console.info(`[PASSWORD RESET DEMO] To: ${email} | Reset using this link within 20 minutes: ${link}`);
    return { sent: false, fallback: true };
  }
}

module.exports = { sendVerificationLink, sendPasswordResetLink };
