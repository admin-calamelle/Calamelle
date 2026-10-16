import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { config } from './config.js';


const smtpDnsCache = new Map();

async function resolveSmtpAddress(hostname) {
  const cached = smtpDnsCache.get(hostname);
  if (cached) return cached;

  try {
    const result = await dns.promises.lookup(hostname, { family: 4 });
    const resolved = { address: result.address, family: result.family || 4, source: 'system' };
    smtpDnsCache.set(hostname, resolved);
    return resolved;
  } catch (systemError) {
    if (!config.smtpDnsFallback) {
      const error = new Error(`Impossible de résoudre ${hostname} avec le DNS système.`);
      error.code = 'SMTP_DNS_LOOKUP_FAILED';
      error.cause = systemError;
      throw error;
    }

    const resolver = new dns.promises.Resolver();
    resolver.setServers(config.smtpDnsServers);

    try {
      const addresses = await resolver.resolve4(hostname);
      if (!addresses?.length) throw new Error('Aucune adresse IPv4 retournée.');
      const resolved = { address: addresses[0], family: 4, source: `fallback:${config.smtpDnsServers.join(',')}` };
      smtpDnsCache.set(hostname, resolved);
      console.warn(`[SMTP] DNS système indisponible pour ${hostname}; résolution de secours utilisée (${resolved.address}).`);
      return resolved;
    } catch (fallbackError) {
      const error = new Error(`Impossible de résoudre le serveur SMTP ${hostname}. Vérifiez votre connexion, VPN/proxy ou DNS Windows.`);
      error.code = 'SMTP_DNS_LOOKUP_FAILED';
      error.cause = fallbackError;
      error.systemCause = systemError;
      throw error;
    }
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function verificationHtml({ name, otp, expiresMinutes }) {
  const safeName = escapeHtml(name || '');
  const digits = String(otp)
    .split('')
    .map(
      digit => `<span style="display:inline-block;min-width:38px;padding:10px 8px;margin:0 3px;border:1px solid #d8c294;border-radius:10px;background:#fffdf8;color:#5c0e14;font:700 24px Georgia,serif;text-align:center">${digit}</span>`
    )
    .join('');

  return `
  <!doctype html>
  <html lang="fr">
    <body style="margin:0;background:#f7f1e7;font-family:Arial,sans-serif;color:#2c2421">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f7f1e7">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdf8;border:1px solid #e3d8c7;border-radius:22px;overflow:hidden">
            <tr><td style="padding:34px 34px 10px;text-align:center">
              <div style="font:600 34px Georgia,serif;color:#5c0e14;letter-spacing:.02em">Calamelle</div>
              <div style="margin-top:5px;color:#bc9750;font-size:12px;letter-spacing:.18em;text-transform:uppercase">Le français, un mot à la fois</div>
            </td></tr>
            <tr><td style="padding:22px 34px 34px">
              <h1 style="font:600 28px Georgia,serif;color:#3e090e;margin:0 0 14px">Vérifiez votre adresse e-mail</h1>
              <p style="font-size:15px;line-height:1.65;color:#685b53;margin:0 0 22px">${safeName ? `Bonjour ${safeName}, ` : ''}utilisez le code ci-dessous pour terminer la création de votre compte Calamelle.</p>
              <div style="text-align:center;margin:28px 0">${digits}</div>
              <p style="font-size:13px;line-height:1.6;color:#7c7068;margin:0">Ce code expire dans ${expiresMinutes} minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.</p>
            </td></tr>
            <tr><td style="padding:18px 34px;border-top:1px solid #eadfce;color:#8a7a70;font-size:12px;text-align:center">Petit roseau deviendra plume.</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}


function passwordResetHtml({ name, resetUrl, expiresMinutes }) {
  const safeName = escapeHtml(name || '');
  const safeUrl = escapeHtml(resetUrl);
  return `
  <!doctype html>
  <html lang="fr">
    <body style="margin:0;background:#f7f1e7;font-family:Arial,sans-serif;color:#2c2421">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f7f1e7">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdf8;border:1px solid #e3d8c7;border-radius:22px;overflow:hidden">
            <tr><td style="padding:34px 34px 10px;text-align:center">
              <div style="font:600 34px Georgia,serif;color:#5c0e14;letter-spacing:.02em">Calamelle</div>
              <div style="margin-top:5px;color:#bc9750;font-size:12px;letter-spacing:.18em;text-transform:uppercase">Retrouvez votre parcours</div>
            </td></tr>
            <tr><td style="padding:22px 34px 34px">
              <h1 style="font:600 28px Georgia,serif;color:#3e090e;margin:0 0 14px">Réinitialisez votre mot de passe</h1>
              <p style="font-size:15px;line-height:1.65;color:#685b53;margin:0 0 22px">${safeName ? `Bonjour ${safeName}, ` : ''}vous avez demandé un nouveau mot de passe pour votre compte Calamelle.</p>
              <div style="text-align:center;margin:28px 0">
                <a href="${safeUrl}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#6f0f18;color:#fffdf8;text-decoration:none;font-weight:700">Choisir un nouveau mot de passe</a>
              </div>
              <p style="font-size:13px;line-height:1.6;color:#7c7068;margin:0">Ce lien expire dans ${expiresMinutes} minutes. Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.</p>
            </td></tr>
            <tr><td style="padding:18px 34px;border-top:1px solid #eadfce;color:#8a7a70;font-size:12px;text-align:center">Petit roseau deviendra plume.</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function emailChangeVerificationHtml({ name, newEmail, otp, expiresMinutes }) {
  const safeName = escapeHtml(name || '');
  const safeEmail = escapeHtml(newEmail || '');
  const digits = String(otp).split('').map(d => `<span style="display:inline-block;width:42px;height:50px;line-height:50px;margin:0 3px;border:1px solid #d8c6a9;border-radius:11px;background:#fffaf1;color:#5c0e14;font:700 26px Georgia,serif;text-align:center">${escapeHtml(d)}</span>`).join('');
  return `
  <!doctype html>
  <html lang="fr">
    <body style="margin:0;background:#f7f1e7;font-family:Arial,sans-serif;color:#2c2421">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f7f1e7">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdf8;border:1px solid #e3d8c7;border-radius:22px;overflow:hidden">
            <tr><td style="padding:34px 34px 10px;text-align:center">
              <div style="font:600 34px Georgia,serif;color:#5c0e14;letter-spacing:.02em">Calamelle</div>
              <div style="margin-top:5px;color:#bc9750;font-size:12px;letter-spacing:.18em;text-transform:uppercase">Sécurité du compte</div>
            </td></tr>
            <tr><td style="padding:22px 34px 34px">
              <h1 style="font:600 28px Georgia,serif;color:#3e090e;margin:0 0 14px">Confirmez votre nouvelle adresse</h1>
              <p style="font-size:15px;line-height:1.65;color:#685b53;margin:0 0 14px">${safeName ? `Bonjour ${safeName}, ` : ''}vous avez demandé à utiliser <strong>${safeEmail}</strong> comme nouvelle adresse e-mail Calamelle.</p>
              <p style="font-size:14px;line-height:1.6;color:#685b53;margin:0 0 22px">Saisissez ce code dans votre espace personnel pour confirmer le changement.</p>
              <div style="text-align:center;margin:28px 0">${digits}</div>
              <p style="font-size:13px;line-height:1.6;color:#7c7068;margin:0">Ce code expire dans ${expiresMinutes} minutes. Si vous n’êtes pas à l’origine de cette demande, ne validez pas le code.</p>
            </td></tr>
            <tr><td style="padding:18px 34px;border-top:1px solid #eadfce;color:#8a7a70;font-size:12px;text-align:center">Petit roseau deviendra plume.</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function parseMailbox(from) {
  const value = String(from || '').trim();
  const angle = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) return angle[1];
  const plain = value.match(/[^\s<>]+@[^\s<>]+/);
  return plain?.[0] || value;
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function wrapBase64(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') || '';
}

class SmtpSession {
  constructor({ host, port, timeoutMs }) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
  }

  attach(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs);
    socket.on('timeout', () => {
      const error = new Error('SMTP connection timed out.');
      this.rejectPending(error);
      socket.destroy(error);
    });
    socket.on('data', chunk => this.onData(chunk));
    socket.on('error', error => this.rejectPending(error));
    socket.on('close', () => {
      if (this.pending) this.rejectPending(new Error('SMTP connection closed unexpectedly.'));
    });
  }

  rejectPending(error) {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    reject(error);
  }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      if (!this.pending) continue;
      this.pending.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0, 3));
        const response = { code, lines: [...this.pending.lines], text: this.pending.lines.join('\n') };
        const { resolve } = this.pending;
        this.pending = null;
        resolve(response);
      }
    }
  }

  nextResponse() {
    if (this.pending) throw new Error('SMTP protocol error: another response is already pending.');
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, lines: [] };
    });
  }

  assert(response, expected) {
    if (!expected.includes(response.code)) {
      throw new Error(`SMTP ${response.code}: ${response.text}`);
    }
    return response;
  }

  async command(command, expected = [250]) {
    const responsePromise = this.nextResponse();
    this.socket.write(`${command}\r\n`);
    return this.assert(await responsePromise, expected);
  }

  async connect({ secure = false }) {
    const resolved = await resolveSmtpAddress(this.host);

    if (secure) {
      const socket = tls.connect({
        host: resolved.address,
        port: this.port,
        servername: this.host,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      });
      this.attach(socket);
      const greeting = this.nextResponse();
      await once(socket, 'secureConnect');
      return this.assert(await greeting, [220]);
    }

    const socket = net.createConnection({ host: resolved.address, port: this.port });
    this.attach(socket);
    const greeting = this.nextResponse();
    await once(socket, 'connect');
    return this.assert(await greeting, [220]);
  }

  async startTls() {
    await this.command('STARTTLS', [220]);
    const rawSocket = this.socket;
    rawSocket.removeAllListeners('data');
    rawSocket.removeAllListeners('timeout');
    rawSocket.removeAllListeners('error');
    rawSocket.removeAllListeners('close');

    const secureSocket = tls.connect({
      socket: rawSocket,
      servername: this.host,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    });
    await once(secureSocket, 'secureConnect');
    this.buffer = '';
    this.pending = null;
    this.attach(secureSocket);
  }

  async sendMessage(message) {
    const safe = String(message)
      .replace(/\r?\n/g, '\r\n')
      .replace(/(^|\r\n)\./g, '$1..');
    const responsePromise = this.nextResponse();
    this.socket.write(`${safe}\r\n.\r\n`);
    return this.assert(await responsePromise, [250]);
  }

  close() {
    try {
      this.socket?.end();
    } catch {
      this.socket?.destroy();
    }
  }
}

function buildMessage({ to, subject, html }) {
  const fromAddress = parseMailbox(config.emailFrom);
  const domain = fromAddress.split('@')[1] || 'calamelle.fr';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;

  return [
    `From: ${config.emailFrom}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(html)
  ].join('\r\n');
}

async function sendViaBrevoSmtp({ to, subject, html }) {
  const client = new SmtpSession({
    host: config.smtpHost,
    port: config.smtpPort,
    timeoutMs: config.smtpTimeoutMs
  });

  try {
    await client.connect({ secure: config.smtpSecure });
    await client.command('EHLO calamelle.fr', [250]);

    if (!config.smtpSecure && config.smtpStartTls) {
      await client.startTls();
      await client.command('EHLO calamelle.fr', [250]);
    }

    await client.command('AUTH LOGIN', [334]);
    await client.command(Buffer.from(config.smtpUser).toString('base64'), [334]);
    await client.command(Buffer.from(config.smtpPass).toString('base64'), [235]);

    const fromAddress = parseMailbox(config.emailFrom);
    await client.command(`MAIL FROM:<${fromAddress}>`, [250]);
    await client.command(`RCPT TO:<${to}>`, [250, 251]);
    await client.command('DATA', [354]);
    await client.sendMessage(buildMessage({ to, subject, html }));

    try {
      await client.command('QUIT', [221]);
    } catch {
      // The message has already been accepted; a QUIT failure is not fatal.
    }

    return { ok: true, mode: 'brevo-smtp' };
  } finally {
    client.close();
  }
}

export async function sendVerificationEmail({ email, name, otp }) {
  if (!config.smtpUser || !config.smtpPass) {
    console.log(`[Calamelle OTP] ${email}: ${otp}`);
    return { ok: true, mode: 'console' };
  }

  try {
    const html = verificationHtml({
      name,
      otp,
      expiresMinutes: config.otpExpiryMinutes
    });

    return await sendViaBrevoSmtp({
      to: email,
      subject: 'Votre code de vérification Calamelle',
      html
    });
  } catch (error) {
    console.error('Brevo SMTP verification email error:', error);
    const dnsFailure = error?.code === 'SMTP_DNS_LOOKUP_FAILED' || error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN';
    return {
      ok: false,
      mode: 'brevo-smtp',
      error: dnsFailure
        ? 'Le serveur e-mail Brevo est momentanément introuvable depuis ce PC (problème DNS/réseau). Calamelle reste démarré : vérifiez le VPN/DNS puis réessayez.'
        : 'Impossible d’envoyer l’e-mail de vérification. Vérifiez la configuration Brevo SMTP, le sender vérifié et les IP autorisées.'
    };
  }
}


export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  if (!config.smtpUser || !config.smtpPass) {
    console.log(`[Calamelle password reset] ${email}: ${resetUrl}`);
    return { ok: true, mode: 'console', resetUrl };
  }

  try {
    return await sendViaBrevoSmtp({
      to: email,
      subject: 'Réinitialisez votre mot de passe Calamelle',
      html: passwordResetHtml({
        name,
        resetUrl,
        expiresMinutes: config.passwordResetMinutes
      })
    });
  } catch (error) {
    console.error('Brevo SMTP password reset email error:', error);
    const dnsFailure = error?.code === 'SMTP_DNS_LOOKUP_FAILED' || error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN';
    return {
      ok: false,
      mode: 'brevo-smtp',
      error: dnsFailure
        ? 'Le serveur e-mail est momentanément indisponible depuis ce PC. Vérifiez le réseau/DNS puis réessayez.'
        : 'Impossible d’envoyer l’e-mail de réinitialisation. Vérifiez la configuration Brevo SMTP.'
    };
  }
}


export async function sendEmailChangeVerificationEmail({ email, name, otp }) {
  if (!config.smtpUser || !config.smtpPass) {
    console.log(`[Calamelle email change OTP] ${email}: ${otp}`);
    return { ok: true, mode: 'console' };
  }
  try {
    return await sendViaBrevoSmtp({
      to: email,
      subject: 'Confirmez votre nouvelle adresse e-mail Calamelle',
      html: emailChangeVerificationHtml({ name, newEmail: email, otp, expiresMinutes: config.otpExpiryMinutes })
    });
  } catch (error) {
    console.error('Brevo SMTP email-change verification error:', error);
    const dnsFailure = error?.code === 'SMTP_DNS_LOOKUP_FAILED' || error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN';
    return {
      ok: false,
      mode: 'brevo-smtp',
      error: dnsFailure
        ? 'Le serveur e-mail est momentanément indisponible depuis ce PC. Vérifiez le réseau/DNS puis réessayez.'
        : 'Impossible d’envoyer le code de vérification. Vérifiez la configuration Brevo SMTP.'
    };
  }
}
