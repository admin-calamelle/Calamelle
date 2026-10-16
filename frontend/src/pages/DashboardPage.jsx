import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, Flame, RotateCcw, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';
import { localStats } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user, access, refreshAccess } = useAuth();
  const navigate = useNavigate();
  const [daily, setDaily] = useState(null);
  const [dailySession, setDailySession] = useState(null);
  const [dailyComplete, setDailyComplete] = useState(false);
  const [dailyAnswered, setDailyAnswered] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyAdvancing, setDailyAdvancing] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const [stats, setStats] = useState(null);

  const limitedDailyPlan = Boolean(user && access && !access.fullAccess);
  const loadStats = useCallback(() => localStats().then(setStats), []);

  const loadDailyQuestion = useCallback(async ({ advance = false } = {}) => {
    if (user && !access) return;
    if (advance) setDailyAdvancing(true);
    else setDailyLoading(true);
    setDailyError('');
    try {
      const data = await api(limitedDailyPlan ? '/questions/free-daily/next' : '/questions/daily');
      setDaily(data.question || null);
      setDailySession(data.session || null);
      setDailyComplete(Boolean(data.complete));
      setDailyAnswered(false);
      if (data.access) {
        // Keep global locks/counters in sync. This does not reload the card: the
        // next question is requested only after the learner clicks the button.
        refreshAccess?.().catch(() => {});
      }
    } catch (error) {
      setDailyError(error.message || 'Impossible de charger la question.');
    } finally {
      if (advance) setDailyAdvancing(false);
      else setDailyLoading(false);
    }
  }, [user, access, limitedDailyPlan, refreshAccess]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (user && !access) return;
    loadDailyQuestion();
  }, [user?.id, access?.fullAccess, access?.plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const answered = stats?.totalAnswers || 0;
  const stage = Math.min(19, Math.floor(answered / 8) + 1);
  const firstName = user?.first_name || user?.name?.split(' ')?.[0] || '';
  const displayedUsed = dailySession?.used ?? access?.dailyNewQuestions?.used ?? 0;
  const displayedRemaining = dailySession?.remaining ?? access?.dailyNewQuestions?.remaining ?? 0;
  const displayedTotal = dailySession?.total ?? 20;
  const displayedCorrect = dailySession?.correct ?? access?.dailyNewQuestions?.correct ?? 0;
  const displayedIncorrect = dailySession?.incorrect ?? access?.dailyNewQuestions?.incorrect ?? 0;
  const displayedAccuracy = dailySession?.accuracy ?? access?.dailyNewQuestions?.accuracy ?? 0;
  const currentNumber = dailySession?.currentNumber || Math.min(displayedTotal, displayedUsed + 1);

  function handleDailyComplete(result) {
    loadStats();
    setDailyAnswered(true);
    if (result?.access?.dailyNewQuestions) {
      setDailySession(prev => ({
        ...(prev || {}),
        used: result.access.dailyNewQuestions.used,
        remaining: result.access.dailyNewQuestions.remaining,
        total: result.access.dailyNewQuestions.limit || 20,
        correct: result.access.dailyNewQuestions.correct ?? 0,
        incorrect: result.access.dailyNewQuestions.incorrect ?? 0,
        accuracy: result.access.dailyNewQuestions.accuracy ?? 0,
        currentNumber: prev?.currentNumber || currentNumber
      }));
    }
  }

  async function nextDailyQuestion() {
    if (dailyAdvancing) return;
    try { await refreshAccess?.(); } catch {}
    await loadDailyQuestion({ advance: true });
  }

  return (
    <div className="page">
      <PageHeader eyebrow="VOTRE ESPACE" title={user ? `Bonjour, ${firstName}.` : 'Bonjour.'} subtitle="Quelques minutes aujourd’hui suffisent pour entretenir votre progression." />

      {!user && <div className="guest-banner"><div><strong>Vous apprenez en mode local.</strong><span>Votre progression reste sur cet appareil. Créez un compte uniquement si vous souhaitez la synchroniser.</span></div><button type="button" className="btn btn-ghost" onClick={()=>navigate('/register')}>Créer un compte</button></div>}

      {user && access?.plan==='free' && <div className="guest-banner"><div><strong>Offre Découverte.</strong><span>{access.dailyNewQuestions?.remaining ?? 0}/20 questions gratuites restantes aujourd’hui · {access.civicMock?.remaining ?? 0}/1 examen blanc restant.</span></div><button type="button" className="btn btn-ghost" onClick={()=>navigate('/app/pricing')}>Voir les offres</button></div>}

      {user && access?.naturalisationAccess && !access?.fullAccess && <div className="guest-banner"><div><strong>Pass Naturalisation actif.</strong><span>Questions civiques et examens blancs illimités jusqu’au {access.premiumUntil?new Date(access.premiumUntil).toLocaleDateString('fr-FR'):'—'} · 20 questions générales par jour.</span></div><button type="button" className="btn btn-ghost" onClick={()=>navigate('/app/civic-exam')}>Préparation civique</button></div>}

      <section className="stat-grid">
        <div className="stat-card"><Flame/><span>Série locale</span><strong>{answered ? '1 jour' : '—'}</strong><small>Continuez aujourd’hui</small></div>
        <div className="stat-card"><Target/><span>Précision</span><strong>{stats?.accuracy || 0}%</strong><small>{stats?.totalAnswers || 0} réponses enregistrées</small></div>
        <div className="stat-card"><RotateCcw/><span>À réviser</span><strong>{stats?.due || 0}</strong><small>Notions arrivées à échéance</small></div>
        <div className="stat-card"><CalendarDays/><span>Parcours</span><strong>{stage}/19</strong><small>Étape actuelle estimée</small></div>
      </section>

      <section className="dashboard-grid">
        <div>
          <div className="section-row">
            <div>
              <div className="eyebrow">{limitedDailyPlan ? 'SESSION GRATUITE DU JOUR' : 'RITUEL QUOTIDIEN'}</div>
              <h2>{limitedDailyPlan ? 'Vos 20 questions gratuites' : 'Question du jour'}</h2>
              {limitedDailyPlan && <p className="daily-session-subtitle">Les domaines de français et de culture sont mélangés automatiquement, une question à la fois.</p>}
            </div>
            <button type="button" className="text-link" onClick={()=>navigate('/app/learn')}>Explorer les thèmes <ArrowRight size={16}/></button>
          </div>

          {limitedDailyPlan && !dailyComplete && <div className="daily-session-meter paper-card">
            <div className="daily-session-progress-copy">
              <strong>Question {Math.max(1, currentNumber)} sur {displayedTotal}</strong>
              <span>{displayedUsed} terminée{displayedUsed===1?'':'s'} · {displayedRemaining} restante{displayedRemaining===1?'':'s'}</span>
            </div>
            <ProgressBar value={displayedUsed} max={displayedTotal}/>
            <div className="daily-score-live" aria-label={`Score du jour : ${displayedCorrect} bonnes réponses sur ${displayedUsed}`}>
              <span>Score du jour</span>
              <strong>{displayedCorrect}/{displayedUsed}</strong>
              <small>{displayedUsed ? `${displayedAccuracy}% de réussite` : 'Commencez la session'}</small>
            </div>
          </div>}

          {dailyError && <div className="alert error">{dailyError}</div>}

          {limitedDailyPlan && dailyComplete ? (
            <div className="paper-card daily-session-complete">
              <CheckCircle2 size={42}/>
              <div className="eyebrow">20 / 20 TERMINÉES</div>
              <h2>Votre session gratuite est terminée pour aujourd’hui.</h2>
              <div className="daily-final-score">
                <div><span>Score final</span><strong>{displayedCorrect}/{displayedTotal}</strong></div>
                <div><span>Réussite</span><strong>{displayedAccuracy}%</strong></div>
                <div><span>À revoir</span><strong>{displayedIncorrect}</strong></div>
              </div>
              <p>{displayedCorrect} bonne{displayedCorrect===1?'':'s'} réponse{displayedCorrect===1?'':'s'} et {displayedIncorrect} question{displayedIncorrect===1?'':'s'} à revoir. Les domaines « Apprendre » sont maintenant verrouillés jusqu’à demain. Vos révisions déjà étudiées restent disponibles.</p>
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={()=>navigate('/app/review')}>Faire mes révisions</button>
                <button type="button" className="btn btn-ghost" onClick={()=>navigate('/app/pricing')}>Débloquer l’illimité</button>
              </div>
            </div>
          ) : dailyLoading ? (
            <div className="skeleton-card">Chargement de la question…</div>
          ) : daily ? (
            <div className={`assessment-focus-stage ${limitedDailyPlan ? 'dashboard-assessment-stage' : ''}`}>
              <QuestionCard key={daily.id} question={daily} attemptSource={limitedDailyPlan ? 'dashboard' : 'learning'} onComplete={handleDailyComplete}/>
              {limitedDailyPlan && dailyAnswered && <div className="daily-next-row assessment-sticky-nav">
                <button type="button" className="btn btn-primary" onClick={nextDailyQuestion} disabled={dailyAdvancing}>
                  {dailyAdvancing ? 'Chargement…' : displayedRemaining === 0 ? 'Voir mon résultat' : 'Question suivante'} {!dailyAdvancing && <ArrowRight size={17}/>}
                </button>
              </div>}
            </div>
          ) : <div className="skeleton-card">Aucune question disponible.</div>}
        </div>

        <aside className="dashboard-aside">
          <div className="paper-card journey-mini"><div className="eyebrow">PARCOURS GUIDÉ</div><h3>Étape {stage} sur 19</h3><p>Avancez progressivement jusqu’à l’épreuve finale.</p><ProgressBar value={stage} max={19}/><button type="button" className="btn btn-primary btn-block" onClick={()=>navigate('/app/journey')}>Continuer le parcours</button></div>
          <div className="paper-card quick-card"><BookOpen/><div><strong>Envie d’une session libre ?</strong><p>{limitedDailyPlan && displayedRemaining===0 ? 'Votre quota est terminé. Revenez demain ou révisez vos acquis.' : 'Choisissez un domaine et entraînez-vous à votre rythme.'}</p></div><button type="button" className="icon-button" onClick={()=>navigate(limitedDailyPlan && displayedRemaining===0 ? '/app/review' : '/app/learn')}><ArrowRight/></button></div>
        </aside>
      </section>
    </div>
  );
}
