import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudUpload, Download, KeyRound, LogOut, Mail, Pencil, RefreshCcw, Save, ShieldCheck, Upload, UserRound } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { exportLocalProgress, importLocalProgress } from '../lib/localDb';
import { api } from '../lib/api';

const EMPTY_OTP = ['', '', '', '', '', ''];

export default function ProfilePage() {
  const auth = useAuth();
  const { user, logout } = auth;
  const fileRef = useRef(null);
  const otpRefs = useRef([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameForm, setNameForm] = useState({ firstName: '', lastName: '' });
  const [emailForm, setEmailForm] = useState({ email: '', password: '' });
  const [emailStep, setEmailStep] = useState('form');
  const [emailPending, setEmailPending] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [otp, setOtp] = useState(EMPTY_OTP);

  useEffect(() => {
    if (!user) return;
    const fallback = String(user.name || '').trim().split(/\s+/).filter(Boolean);
    setNameForm({
      firstName: user.first_name || fallback[0] || '',
      lastName: user.last_name || fallback.slice(1).join(' ') || ''
    });
  }, [user]);

  async function download() {
    const data = await exportLocalProgress();
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), progress: data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calamelle-progress.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      await importLocalProgress(json.progress || json);
      setMsg('Progression locale importée.');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function sync() {
    if (!user) return setError('Connectez-vous pour synchroniser.');
    const entries = await exportLocalProgress();
    try {
      const d = await api('/progress/import', { method: 'POST', body: JSON.stringify({ entries }) });
      setMsg(`${d.imported} éléments synchronisés vers votre compte.`);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveName(e) {
    e.preventDefault();
    setMsg(''); setError(''); setSavingName(true);
    try {
      await api('/profile/name', {
        method: 'PATCH',
        body: JSON.stringify(nameForm)
      });
      await auth.refresh();
      setMsg('Votre prénom et votre nom ont été mis à jour.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingName(false);
    }
  }

  async function startEmailChange(e) {
    e.preventDefault();
    setMsg(''); setError(''); setEmailBusy(true);
    try {
      const data = await api('/profile/email-change/start', {
        method: 'POST',
        body: JSON.stringify(emailForm)
      });
      setEmailPending(data);
      setOtp(EMPTY_OTP);
      setEmailStep('verify');
      setMsg(`Code envoyé à ${data.email}.`);
      window.setTimeout(() => otpRefs.current[0]?.focus(), 30);
    } catch (e) {
      setError(e.message);
    } finally {
      setEmailBusy(false);
    }
  }

  function updateOtp(index, raw) {
    const digit = String(raw).replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function otpKeyDown(index, event) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function otpPaste(event) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('');
    if (!digits.length) return;
    event.preventDefault();
    setOtp(EMPTY_OTP.map((_, i) => digits[i] || ''));
    otpRefs.current[Math.min(digits.length, 6) - 1]?.focus();
  }

  async function verifyEmailChange(e) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) return setError('Saisissez les 6 chiffres du code reçu par e-mail.');
    setMsg(''); setError(''); setEmailBusy(true);
    try {
      await api('/profile/email-change/verify', {
        method: 'POST',
        body: JSON.stringify({ otp: code })
      });
      await auth.refresh();
      setEmailForm({ email: '', password: '' });
      setEmailPending(null);
      setEmailStep('form');
      setOtp(EMPTY_OTP);
      setMsg('Votre nouvelle adresse e-mail est maintenant vérifiée et active. Les autres sessions ont été déconnectées par sécurité.');
    } catch (e) {
      setError(e.message);
    } finally {
      setEmailBusy(false);
    }
  }

  function cancelEmailChange() {
    setEmailStep('form');
    setEmailPending(null);
    setOtp(EMPTY_OTP);
    setError('');
    setMsg('');
  }

  return <div className="page">
    <PageHeader
      eyebrow="PROFIL & DONNÉES"
      title={user ? 'Votre espace personnel.' : 'Votre progression reste locale.'}
      subtitle="Gérez votre identité, votre adresse e-mail et vos données d’apprentissage."
    />

    <div className="profile-grid">
      <div className="paper-card profile-card">
        <div className="profile-avatar"><UserRound /></div>
        <div>
          <h2>{user?.name || 'Mode invité'}</h2>
          <p>{user?.email || 'Aucun compte requis pour apprendre.'}</p>
          {user && <div className="profile-tags"><span>{user.role}</span>{user.premium_plan && <span>{user.premium_plan}</span>}</div>}
        </div>
        {user && <button className="btn btn-ghost" onClick={logout}><LogOut size={17}/> Se déconnecter</button>}
      </div>

      {user && <div className="paper-card data-card account-settings-card">
        <div className="account-card-heading"><Pencil size={19}/><div><h2>Nom et prénom</h2><p>Ces informations sont visibles dans votre espace Calamelle.</p></div></div>
        <form className="form-stack" onSubmit={saveName}>
          <div className="profile-form-grid">
            <label>Prénom<input value={nameForm.firstName} onChange={e => setNameForm(v => ({ ...v, firstName: e.target.value }))} required autoComplete="given-name"/></label>
            <label>Nom<input value={nameForm.lastName} onChange={e => setNameForm(v => ({ ...v, lastName: e.target.value }))} required autoComplete="family-name"/></label>
          </div>
          <button className="btn btn-primary account-action" disabled={savingName}><Save size={16}/>{savingName ? 'Enregistrement…' : 'Enregistrer le nom'}</button>
        </form>
      </div>}

      {user && <div className="paper-card data-card account-settings-card">
        <div className="account-card-heading"><Mail size={19}/><div><h2>Adresse e-mail</h2><p>Adresse actuelle : <strong>{user.email}</strong></p></div></div>
        {emailStep === 'form' ? <form className="form-stack" onSubmit={startEmailChange}>
          <label>Nouvelle adresse e-mail<input type="email" value={emailForm.email} onChange={e => setEmailForm(v => ({ ...v, email: e.target.value }))} required placeholder="nouvelle@exemple.fr" autoComplete="email"/></label>
          <label>Mot de passe actuel<input type="password" value={emailForm.password} onChange={e => setEmailForm(v => ({ ...v, password: e.target.value }))} required placeholder="Confirmez votre identité" autoComplete="current-password"/></label>
          <button className="btn btn-primary account-action" disabled={emailBusy}><Mail size={16}/>{emailBusy ? 'Envoi…' : 'Envoyer le code de vérification'}</button>
          <div className="account-security-note"><ShieldCheck size={15}/> L’adresse ne change qu’après validation du code reçu sur la nouvelle adresse.</div>
        </form> : <form className="email-verify-box" onSubmit={verifyEmailChange}>
          <div className="email-verify-title"><CheckCircle2 size={18}/><div><strong>Vérifiez {emailPending?.email}</strong><span>Entrez le code à 6 chiffres envoyé par e-mail.</span></div></div>
          <div className="profile-otp-inputs" onPaste={otpPaste}>
            {otp.map((value, index) => <input key={index} ref={el => { otpRefs.current[index] = el; }} value={value} onChange={e => updateOtp(index, e.target.value)} onKeyDown={e => otpKeyDown(index, e)} inputMode="numeric" maxLength={1} aria-label={`Chiffre ${index + 1} du code`}/>)}
          </div>
          {emailPending?.devOtp && <div className="dev-otp-note"><ShieldCheck size={17}/><span><strong>Mode local :</strong> code de test <code>{emailPending.devOtp}</code>.</span></div>}
          <div className="button-row">
            <button className="btn btn-primary" disabled={emailBusy || otp.join('').length !== 6}><CheckCircle2 size={16}/>{emailBusy ? 'Vérification…' : 'Confirmer le nouvel e-mail'}</button>
            <button type="button" className="btn btn-ghost" onClick={cancelEmailChange}><RefreshCcw size={16}/> Modifier l’adresse</button>
          </div>
        </form>}
      </div>}

      <div className="paper-card data-card"><h2>Données locales</h2><p>Votre progression peut être sauvegardée dans un fichier JSON puis restaurée sur un autre navigateur.</p><div className="button-row"><button className="btn btn-primary" onClick={download}><Download size={17}/> Exporter</button><button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={17}/> Importer</button><input ref={fileRef} onChange={importFile} type="file" accept="application/json" hidden/></div></div>
      <div className="paper-card data-card"><h2>Synchronisation</h2><p>Lorsque vous êtes connecté, envoyez votre progression locale vers le serveur afin qu’un espace formateur puisse la suivre si vous rejoignez un groupe.</p><button className="btn btn-primary" onClick={sync}><CloudUpload size={17}/> Synchroniser maintenant</button></div>
      <div className="paper-card data-card"><h2>Accès premium</h2><p>{user?.premium_plan ? `Offre active : ${user.premium_plan}` : 'Aucune offre premium active.'}</p><button className="btn btn-ghost" onClick={() => location.href='/app/pricing'}><KeyRound size={17}/> Gérer l’accès</button></div>
    </div>
    {error && <div className="alert error profile-feedback">{error}</div>}
    {msg && <div className="alert info profile-feedback">{msg}</div>}
  </div>;
}
