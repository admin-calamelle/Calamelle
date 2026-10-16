import React, { useEffect, useState } from 'react';
import { Check, CreditCard, ExternalLink, KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const offers = [
  {
    key: 'free',
    name: 'Découverte',
    price: '0 €',
    note: 'Pour découvrir Calamelle',
    features: ['20 nouvelles questions par jour', 'Révisions illimitées', '1 examen blanc offert']
  },
  {
    key: 'monthly',
    name: 'Illimité mensuel',
    price: '4,99 €',
    suffix: '/ mois',
    note: 'Abonnement Stripe',
    features: ['Toutes les questions sans limite', 'Parcours, défi et Compendium complets', 'Examens blancs à volonté']
  },
  {
    key: 'annual',
    name: 'Illimité annuel',
    price: '34,99 €',
    suffix: '/ an',
    note: 'Offre recommandée',
    featured: true,
    features: ['Tout Calamelle sans limite', '≈ 2,92 € / mois', 'Examens blancs et outils complets']
  },
  {
    key: 'naturalisation',
    name: 'Pass Naturalisation',
    price: '24,99 €',
    note: '6 mois · achat unique',
    features: ['Questions civiques illimitées pendant 6 mois', 'Examens blancs illimités', 'Parcours, défi et Compendium en mode civique']
  },
  {
    key: 'lifetime',
    name: 'Fondateur à vie',
    price: '59 €',
    note: 'Achat unique',
    features: ['Accès illimité à vie', 'Toutes les banques de questions', 'Nouveautés incluses']
  }
];

const planNames = Object.fromEntries(offers.map(o=>[o.key,o.name]));

export default function PricingPage() {
  const { user, access, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState('');
  const [busyPlan, setBusyPlan] = useState('');
  const [paymentInfo, setPaymentInfo] = useState(null);

  useEffect(() => {
    api('/payments/plans').then(setPaymentInfo).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');

    if (checkout === 'cancelled') {
      setMsg('Paiement annulé. Aucun débit n’a été effectué.');
      navigate('/app/pricing', { replace: true });
      return;
    }

    if (checkout === 'success' && sessionId && user) {
      setBusyPlan('confirm');
      api(`/payments/checkout/session/${encodeURIComponent(sessionId)}`)
        .then(async data => {
          await refresh();
          setMsg(data.complete ? 'Paiement confirmé. Votre accès Calamelle est actif.' : 'Paiement reçu. Activation en cours.');
          navigate('/app/pricing', { replace: true });
        })
        .catch(error => setMsg(error.message))
        .finally(() => setBusyPlan(''));
    }
  }, [location.search, navigate, refresh, user]);

  async function buy(plan) {
    if (plan === 'free') return navigate('/app/learn');
    if (!user) return navigate('/login');
    if (access?.plan && access.plan !== 'free') {
      setMsg(`Vous avez déjà une offre active : ${planNames[access.plan] || access.plan}. Gérez-la avant d’en acheter une autre.`);
      return;
    }
    setBusyPlan(plan);
    setMsg('');
    try {
      const data = await api('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan })
      });

      if (data.url) {
        window.location.assign(data.url);
        return;
      }

      if (data.demo) {
        await refresh();
        setMsg(data.message || 'Accès activé en mode démonstration.');
      }
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusyPlan('');
    }
  }

  async function redeem() {
    if (!user) return navigate('/login');
    try {
      const data = await api('/access-codes/redeem', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      await refresh();
      setMsg(data.message);
    } catch (error) {
      setMsg(error.message);
    }
  }

  async function openPortal() {
    setBusyPlan('portal');
    setMsg('');
    try {
      const data = await api('/payments/portal', { method: 'POST', body: '{}' });
      window.location.assign(data.url);
    } catch (error) {
      setMsg(error.message);
      setBusyPlan('');
    }
  }

  const stripeMode = paymentInfo?.mode === 'stripe';
  const activePaidPlan = access?.plan && access.plan !== 'free' ? access.plan : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow="OFFRES"
        title="Commencez gratuitement. Passez à l’Illimité quand vous en avez besoin."
        subtitle="Les limites sont appliquées côté serveur : votre offre Stripe détermine réellement ce que votre compte peut utiliser."
      />

      {user && access && (
        <div className={`alert ${activePaidPlan?'success':'info'} pricing-active-plan`}>
          <div>
            {activePaidPlan ? <>
              Votre accès actif : <strong>{planNames[activePaidPlan] || activePaidPlan}</strong>
              {access.premiumUntil ? ` jusqu’au ${new Date(access.premiumUntil).toLocaleDateString('fr-FR')}` : activePaidPlan==='lifetime' ? ' — à vie' : ''}.
            </> : <>
              <strong>Découverte :</strong> {access.dailyNewQuestions?.remaining ?? 0}/20 nouvelles questions restantes aujourd’hui · {access.civicMock?.remaining ?? 0}/1 examen blanc restant.
            </>}
          </div>
          {stripeMode && ['monthly', 'annual'].includes(activePaidPlan) && (
            <button className="btn btn-ghost" onClick={openPortal} disabled={busyPlan === 'portal'}>
              <ExternalLink size={16}/>{busyPlan === 'portal' ? 'Ouverture…' : 'Gérer mon abonnement'}
            </button>
          )}
        </div>
      )}

      {msg && <div className="alert info">{msg}</div>}
      {busyPlan === 'confirm' && <div className="alert info">Confirmation du paiement Stripe…</div>}

      <div className="pricing-grid">
        {offers.map(offer => {
          const current = activePaidPlan === offer.key;
          const anotherActive = Boolean(activePaidPlan && !current && offer.key !== 'free');
          return <div className={`price-card ${offer.featured ? 'featured' : ''} ${current?'current-plan':''}`} key={offer.key}>
            {current ? <div className="price-badge">OFFRE ACTIVE</div> : offer.featured && <div className="price-badge">RECOMMANDÉ</div>}
            <h3>{offer.name}</h3>
            <div className="price"><strong>{offer.price}</strong>{offer.suffix && <span>{offer.suffix}</span>}</div>
            <p>{offer.note}</p>
            <ul>{offer.features.map(feature => <li key={feature}><Check size={16}/>{feature}</li>)}</ul>
            <button
              className={`btn ${offer.featured ? 'btn-primary' : 'btn-ghost'} btn-block`}
              onClick={() => buy(offer.key)}
              disabled={Boolean(busyPlan) || current || anotherActive}
            >
              {offer.key === 'free'
                ? activePaidPlan ? 'Accès inclus' : 'Continuer gratuitement'
                : current
                  ? 'Offre active'
                  : anotherActive
                    ? 'Une offre est déjà active'
                    : busyPlan === offer.key
                      ? 'Ouverture de Stripe…'
                      : <><CreditCard size={16}/> Choisir cette offre</>}
            </button>
          </div>;
        })}
      </div>

      <div className="paper-card redeem-card">
        <KeyRound/>
        <div>
          <h3>Vous avez un code d’accès ?</h3>
          <p>Les codes institutionnels et promotionnels restent compatibles avec Stripe.</p>
        </div>
        <div className="redeem-form">
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="CALA-XXXX-XXXX"/>
          <button className="btn btn-primary" onClick={redeem} disabled={Boolean(activePaidPlan)}>Activer</button>
        </div>
      </div>

      <div className="content-note stripe-note">
        <strong>Paiement :</strong>{' '}
        {paymentInfo?.mode === 'stripe'
          ? paymentInfo.stripeConfigured
            ? 'Stripe Checkout est activé côté serveur.'
            : 'Le mode Stripe est sélectionné, mais la clé secrète Stripe manque.'
          : 'Le projet est actuellement en mode démonstration. Configurez PAYMENTS_MODE=stripe pour utiliser Stripe.'}
      </div>
    </div>
  );
}
