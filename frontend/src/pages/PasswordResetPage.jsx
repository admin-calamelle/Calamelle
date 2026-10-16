import React, { useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Mail } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PasswordResetPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') || '', [params]);
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [devResetUrl, setDevResetUrl] = useState('');

  async function requestLink(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await auth.requestPasswordReset(email);
      setMessage(data.message);
      setDevResetUrl(data.devResetUrl || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      const data = await auth.resetPassword(token, password);
      setMessage(data.message);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page password-reset-page">
      <Link to="/" className="auth-brand"><img src="/assets/calamelle-logo.png" alt="Calamelle"/></Link>
      <div className="auth-card paper-card">
        <div className="otp-seal">{token ? <KeyRound size={25}/> : <Mail size={25}/>}</div>
        <div className="eyebrow">MOT DE PASSE</div>
        <h1>{token ? 'Choisissez un nouveau mot de passe.' : 'Retrouvez votre accès.'}</h1>
        <p>{token
          ? 'Créez un nouveau mot de passe pour reprendre votre progression Calamelle.'
          : 'Saisissez l’adresse e-mail de votre compte. Nous vous enverrons un lien sécurisé.'}</p>

        {!token ? (
          <form onSubmit={requestLink} className="form-stack">
            <label>Adresse e-mail
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="vous@exemple.fr"
              />
            </label>
            {error && <div className="alert error">{error}</div>}
            {message && <div className="alert success">{message}</div>}
            {devResetUrl && (
              <div className="dev-otp-note">
                <KeyRound size={17}/>
                <span><strong>Mode local :</strong> <a href={devResetUrl}>ouvrir le lien de réinitialisation</a>.</span>
              </div>
            )}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </form>
        ) : (
          <form onSubmit={setNewPassword} className="form-stack">
            <label>Nouveau mot de passe
              <input
                type="password"
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="8 caractères minimum"
              />
            </label>
            <label>Confirmer le mot de passe
              <input
                type="password"
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Répétez le mot de passe"
              />
            </label>
            {error && <div className="alert error">{error}</div>}
            {message && <div className="alert success"><CheckCircle2 size={18}/>{message}</div>}
            <button className="btn btn-primary btn-block" disabled={busy || Boolean(message)}>
              {busy ? 'Mise à jour…' : 'Modifier mon mot de passe'}
            </button>
          </form>
        )}

        <div className="auth-switch">
          <Link to="/login">Retour à la connexion</Link>
        </div>
      </div>
    </div>
  );
}
