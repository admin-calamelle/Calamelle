import React, { useEffect, useState } from 'react';
import { ArrowRight, BookA, BookMarked, Landmark, LockKeyhole, MessageSquareQuote, Puzzle, ScrollText, ShieldCheck, Sparkles, WholeWord } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const icons = [WholeWord, BookA, Landmark, BookMarked, MessageSquareQuote, ScrollText, Sparkles, Puzzle];

export default function LearnPage() {
  const [categories, setCategories] = useState([]);
  const navigate = useNavigate();
  const { user, access } = useAuth();

  useEffect(()=>{
    api('/questions/categories')
      .then(d=>setCategories(d.categories.filter(c=>c.category!=='Citoyenneté')))
      .catch(()=>setCategories([]));
  },[]);

  const limited = Boolean(user && access && !access.fullAccess);
  const remaining = access?.dailyNewQuestions?.remaining;
  const learnLocked = limited && remaining === 0;

  return <div className="page">
    <PageHeader eyebrow="APPRENDRE" title="Choisissez votre terrain de jeu." subtitle="Huit domaines, trois niveaux et toujours une explication après chaque réponse."/>

    {limited && <div className={`alert ${learnLocked?'error':'info'} learning-quota`}>
      <div>
        <strong>{learnLocked ? 'Session gratuite terminée :' : 'Accès Découverte :'}</strong>{' '}
        {learnLocked
          ? 'vos 20 questions gratuites du jour sont terminées. Les domaines ci-dessous sont verrouillés jusqu’à demain ; vos révisions restent accessibles.'
          : `${remaining ?? 0} question${remaining===1?'':'s'} gratuite${remaining===1?'':'s'} restante${remaining===1?'':'s'} aujourd’hui. Votre session mélangée est disponible directement sur le tableau de bord.`}
      </div>
      <button type="button" className={`btn ${learnLocked?'btn-ghost':'btn-primary'}`} onClick={()=>navigate(learnLocked?'/app/pricing':'/app')}>
        {learnLocked ? 'Débloquer l’illimité' : 'Continuer mes 20 questions'}
      </button>
    </div>}

    {access?.naturalisationAccess && <div className="naturalisation-study-card paper-card">
      <div className="category-icon"><ShieldCheck/></div>
      <div><div className="eyebrow">PASS NATURALISATION</div><h3>Entraînement civique illimité</h3><p>Votre pass ouvre les questions civiques sans utiliser votre quota quotidien de français général.</p></div>
      <button type="button" className="btn btn-primary" onClick={()=>navigate('/app/quiz?civic=true')}>S’entraîner <ArrowRight size={16}/></button>
    </div>}

    {learnLocked && <div className="learn-lock-overview paper-card">
      <LockKeyhole size={30}/>
      <div><strong>Les domaines d’apprentissage sont verrouillés pour aujourd’hui.</strong><p>Ils se rouvriront automatiquement avec un nouveau quota de 20 questions demain (heure de Paris).</p></div>
    </div>}

    <div className={`category-grid ${learnLocked?'is-locked':''}`}>{categories.map((c,i)=>{
      const Icon=icons[i%icons.length];
      return <button
        type="button"
        key={c.category}
        className={`category-card ${learnLocked?'locked':''}`}
        disabled={learnLocked}
        aria-disabled={learnLocked}
        onClick={()=>!learnLocked && navigate(`/app/quiz?category=${encodeURIComponent(c.category)}`)}
      >
        <div className="category-icon"><Icon/></div>
        <div><h3>{c.category}</h3><p>{learnLocked ? 'Revenez demain pour de nouvelles questions' : `${c.count} questions disponibles`}</p></div>
        {learnLocked ? <LockKeyhole className="category-arrow"/> : <ArrowRight className="category-arrow"/>}
      </button>;
    })}</div>
    <div className="content-note"><strong>Banque Calamelle complète :</strong> 2 441 questions d’apprentissage réparties dans huit domaines, auxquelles s’ajoutent 300 questions dédiées à l’examen civique.</div>
  </div>;
}
