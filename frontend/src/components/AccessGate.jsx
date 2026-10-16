import React from 'react';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from './PageHeader';
import { useAuth } from '../context/AuthContext';

const copy = {
  journey: {
    eyebrow: 'PARCOURS GUIDÉ',
    title: 'Le parcours complet fait partie des offres payantes.',
    text: 'Passez à une offre Calamelle pour débloquer les 19 étapes. Le Pass Naturalisation débloque le parcours en version civique.'
  },
  speed: {
    eyebrow: 'DÉFI 60 SECONDES',
    title: 'Le défi express est réservé aux offres payantes.',
    text: 'Les offres Illimitées donnent accès à toute la banque. Le Pass Naturalisation active le défi sur les questions civiques.'
  },
  compendium: {
    eyebrow: 'COMPENDIUM',
    title: 'Le Compendium est réservé aux offres payantes.',
    text: 'Les offres Illimitées ouvrent toute la bibliothèque. Le Pass Naturalisation ouvre la bibliothèque civique.'
  }
};

export default function AccessGate({ feature, children }) {
  const { user, access, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (!user) {
    const info = copy[feature] || copy.journey;
    return <div className="page">
      <PageHeader eyebrow={info.eyebrow} title="Connectez-vous pour continuer." subtitle="Votre offre et vos limites sont liées à votre compte Calamelle."/>
      <div className="paper-card access-lock-card">
        <LockKeyhole size={34}/>
        <h2>Compte requis</h2>
        <p>Créez un compte gratuit ou connectez-vous pour utiliser cette fonctionnalité.</p>
        <div className="button-row"><button className="btn btn-primary" onClick={()=>navigate('/login')}>Se connecter</button><button className="btn btn-ghost" onClick={()=>navigate('/register')}>Créer un compte</button></div>
      </div>
    </div>;
  }
  if (access?.features?.[feature]) return children;
  const info = copy[feature] || copy.journey;
  return <div className="page">
    <PageHeader eyebrow={info.eyebrow} title={info.title} subtitle={info.text}/>
    <div className="paper-card access-lock-card">
      <LockKeyhole size={34}/>
      <h2>Fonctionnalité verrouillée</h2>
      <p>Votre compte reste en accès Découverte : 20 nouvelles questions par jour, révisions illimitées et 1 examen blanc offert.</p>
      <button className="btn btn-primary" onClick={()=>navigate('/app/pricing')}><Sparkles size={17}/> Voir les offres</button>
    </div>
  </div>;
}
