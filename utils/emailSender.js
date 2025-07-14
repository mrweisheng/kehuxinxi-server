const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true, // 465端口通常为SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * 发送邮件
 * @param {string|string[]} to 收件人（支持逗号分隔或数组）
 * @param {string} subject 邮件主题
 * @param {string} text 邮件正文（纯文本）
 * @param {string} html 邮件正文（HTML，可选）
 */
async function sendMail({ to, subject, text, html }) {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html
  };
  return transporter.sendMail(mailOptions);
}

module.exports = { sendMail }; 