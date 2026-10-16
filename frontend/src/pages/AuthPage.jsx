import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Mail, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const EMPTY_OTP = ['', '', '', '', '', ''];

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [step, setStep] = useState('form');
  const [verification, setVerification] = useState(null);
  const [otp, setOtp] = useState(EMPTY_OTP);
  const [error, setError] = useState(() => searchParams.get('status') === 'suspended' ? 'Ce compte a été suspendu par un administrateur. Contactez votre administrateur pour demander une réactivation.' : '');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const inputRefs = useRef([]);
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.loading && auth.user) navigate('/app', { replace: true });
  }, [auth.loading, auth.user, navigate]);

  useEffect(() => {
    if (step !== 'verify') return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const resendSeconds = useMemo(() => {
    if (!verification?.resendAt) return 0;
    return Math.max(0, Math.ceil((verification.resendAt - tick) / 1000));
  }, [verification, tick]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) {
        const data = await auth.startRegistration(form.firstName, form.lastName, form.email, form.password);
        setVerification({
          email: data.email,
          resendAt: Date.now() + Number(data.resendAfterSeconds || 60) * 1000,
          expiresAt: Date.now() + Number(data.expiresInSeconds || 600) * 1000,
          devOtp: data.devOtp || '',
          mailMode: data.mailMode
        });
        setOtp(EMPTY_OTP);
        setStep('verify');
        window.setTimeout(() => inputRefs.current[0]?.focus(), 40);
      } else {
        await auth.login(form.email, form.password);
        navigate('/app');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function updateOtp(index, raw) {
    const digit = String(raw).replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function otpKeyDown(index, event) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function otpPaste(event) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('');
    if (!digits.length) return;
    event.preventDefault();
    const next = EMPTY_OTP.map((_, i) => digits[i] || '');
    setOtp(next);
    inputRefs.current[Math.min(digits.length, 6) - 1]?.focus();
  }

  async function verifyOtp(e) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Saisissez les 6 chiffres du code reçu par e-mail.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await auth.verifyRegistration(verification.email, code);
      navigate('/app');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resendSeconds > 0 || busy) return;
    setError('');
    setBusy(true);
    try {
      const data = await auth.resendRegistration(verification.email);
      setVerification(prev => ({
        ...prev,
        resendAt: Date.now() + Number(data.resendAfterSeconds || 60) * 1000,
        expiresAt: Date.now() + Number(data.expiresInSeconds || 600) * 1000,
        devOtp: data.devOtp || '',
        mailMode: data.mailMode
      }));
      setOtp(EMPTY_OTP);
      inputRefs.current[0]?.focus();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (isRegister && step === 'verify') {
    return (
      <div className="auth-page auth-page-verification">
        <Link to="/" className="auth-brand"><img src="/assets/calamelle-logo.png" alt="Calamelle"/></Link>
        <div className="auth-card otp-card paper-card">
          <button className="otp-back" type="button" onClick={() => { setStep('form'); setError(''); }}><ArrowLeft size={16}/> Modifier mes informations</button>
          <div className="otp-seal"><Mail size={25}/></div>
          <div className="eyebrow">VÉRIFICATION DE L’E-MAIL</div>
          <h1>Un dernier geste.</h1>
          <p>Nous avons envoyé un code à 6 chiffres à <strong>{verification.email}</strong>. Entrez-le pour créer votre compte.</p>

          <form onSubmit={verifyOtp}>
            <div className="otp-inputs" onPaste={otpPaste}>
              {otp.map((value, index) => (
                <input
                  key={index}
                  ref={el => { inputRefs.current[index] = el; }}
                  value={value}
                  onChange={e => updateOtp(index, e.target.value)}
                  onKeyDown={e => otpKeyDown(index, e)}
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  aria-label={`Chiffre ${index + 1} du code`}
                />
              ))}
            </div>

            {verification.devOtp && (
              <div className="dev-otp-note">
                <ShieldCheck size={17}/>
                <span><strong>Mode local :</strong> votre code de test est <code>{verification.devOtp}</code>. En production il sera uniquement envoyé par e-mail.</span>
              </div>
            )}

            {error && <div className="alert error">{error}</div>}
            <button className="btn btn-primary btn-block otp-verify" disabled={busy || otp.join('').length !== 6}>
              {busy ? 'Vérification…' : <><CheckCircle2 size={18}/> Vérifier et créer mon compte</>}
            </button>
          </form>

          <div className="otp-resend">
            <span>Vous n’avez rien reçu ?</span>
            <button type="button" onClick={resend} disabled={busy || resendSeconds > 0}>
              <RefreshCcw size={14}/>
              {resendSeconds > 0 ? `Renvoyer dans ${resendSeconds}s` : 'Renvoyer le code'}
            </button>
          </div>
          <div className="otp-security"><ShieldCheck size={15}/> Le compte n’est créé qu’après validation du code.</div>
        </div>
      </div>
    );
  }

  if (auth.loading || auth.user) return <div className="center-screen">Chargement…</div>;

  return (
    <div className="auth-page">
      <Link to="/" className="auth-brand"><img src="/assets/calamelle-logo.png" alt="Calamelle"/></Link>
      <div className="auth-card paper-card">
        <div className="eyebrow">{isRegister ? 'CRÉER VOTRE ESPACE' : 'HEUREUX DE VOUS REVOIR'}</div>
        <h1>{isRegister ? 'Commencez votre parcours.' : 'Reprendre votre progression.'}</h1>
        <p>{isRegister ? 'Créez votre compte. Votre adresse e-mail sera vérifiée avant l’ouverture de votre espace.' : 'Connectez-vous pour retrouver vos progrès sur tous vos appareils.'}</p>
        <form onSubmit={submit} className="form-stack">
          {isRegister && <div className="auth-name-grid">
            <label>Prénom<input value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})} required placeholder="Votre prénom" autoComplete="given-name"/></label>
            <label>Nom<input value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})} required placeholder="Votre nom" autoComplete="family-name"/></label>
          </div>}
          <label>Adresse e-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required placeholder="vous@exemple.fr" autoComplete="email"/></label>
          <label>Mot de passe<input type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required placeholder="8 caractères minimum" autoComplete={isRegister ? 'new-password' : 'current-password'}/></label>{!isRegister && <div className="forgot-password-row"><Link to="/forgot-password">Mot de passe oublié ?</Link></div>}
          {error && <div className="alert error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Un instant…' : isRegister ? 'Recevoir mon code' : 'Se connecter'}</button>
        </form>
        {isRegister && <div className="auth-email-note"><Mail size={15}/> Aucun compte ne sera créé avant la validation du code reçu par e-mail.</div>}
        <div className="auth-switch">{isRegister ? <>Déjà inscrit ? <Link to="/login">Se connecter</Link></> : <>Pas encore de compte ? <Link to="/register">Créer un compte</Link></>}</div>
      </div>
    </div>
  );
}
