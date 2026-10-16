import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Target, XCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function QuizPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { access, refreshAccess, loading: authLoading } = useAuth();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const civic = query.get('civic') === 'true';
  const category = query.get('category') || (civic ? 'Examen civique' : 'Langue française');
  const difficulty = query.get('difficulty') || '';

  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [results, setResults] = useState({});
  const [quotaReached, setQuotaReached] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const generalLimited = !civic && access && !access.fullAccess;
  const remaining = access?.dailyNewQuestions?.remaining;

  useEffect(() => {
    let alive = true;

    // Protected routes wait for auth, but keeping this guard makes direct route
    // transitions deterministic while access rights are still being hydrated.
    if (authLoading) return () => { alive = false; };

    if (!civic && access && !access.fullAccess && access?.dailyNewQuestions?.remaining === 0) {
      setQuestions([]);
      setIndex(0);
      setCompleted(false);
      setResults({});
      setQuotaReached(true);
      setError('');
      setLoading(false);
      return () => { alive = false; };
    }

    setIndex(0);
    setCompleted(false);
    setResults({});
    setQuotaReached(false);
    setError('');
    setLoading(true);

    const params = new URLSearchParams();
    if (civic) params.set('civic', 'true');
    else params.set('category', category);
    params.set('limit', '10');
    if (difficulty) params.set('difficulty', difficulty);

    api(`/questions?${params.toString()}`)
      .then(async data => {
        if (!alive) return;
        setQuestions(data.questions || []);
        // Synchronise the header/locks once when the session is created.
        // IMPORTANT: remaining quota is deliberately NOT an effect dependency;
        // answering a question must never reload or replace the current card.
        try { await refreshAccess?.(); } catch {}
      })
      .catch(e => {
        if (alive) {
          setQuestions([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [category, difficulty, civic, access?.fullAccess, access?.plan, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = questions[index];
  const currentDone = Boolean(q && Object.prototype.hasOwnProperty.call(results, q.id));
  const score = Object.values(results).filter(Boolean).length;
  const attempted = Object.keys(results).length;
  const incorrect = Math.max(0, attempted - score);
  const percentage = attempted ? Math.round((score / attempted) * 100) : 0;
  const generalBlocked = Boolean(generalLimited && remaining === 0 && !completed && attempted === 0);
  const isLastQuestion = index + 1 >= questions.length;
  const shouldFinishNow = Boolean(quotaReached || isLastQuestion);

  function recordResult(result) {
    if (!q) return;

    setResults(prev => (
      Object.prototype.hasOwnProperty.call(prev, q.id)
        ? prev
        : { ...prev, [q.id]: Boolean(result.correct) }
    ));

    const newRemaining = result?.access?.dailyNewQuestions?.remaining;
    if (generalLimited && newRemaining === 0) setQuotaReached(true);

    // Refresh locks/counters, but this no longer participates in the question
    // loading effect. The current question therefore stays visible until the
    // learner explicitly presses Question suivante / Voir mon résultat.
    refreshAccess?.().catch(() => {});
  }

  function goNext() {
    if (!currentDone) return;
    if (shouldFinishNow) {
      setCompleted(true);
      return;
    }
    setIndex(i => i + 1);
  }

  function restart() {
    // A free learner who has consumed the daily quota cannot restart a new
    // learning session. Reviews remain available separately.
    if (generalLimited && (quotaReached || remaining === 0)) {
      navigate('/app/learn');
      return;
    }
    setIndex(0);
    setCompleted(false);
    setResults({});
    setQuotaReached(false);
  }

  if (generalBlocked) {
    return <div className="page">
      <PageHeader eyebrow="SESSION GRATUITE TERMINÉE" title="Vos 20 questions du jour sont terminées." subtitle="Les domaines d’apprentissage se rouvriront demain. Vos révisions restent disponibles sans consommer de nouveau quota."/>
      <div className="paper-card access-lock-card">
        <Sparkles/>
        <h2>Apprendre est verrouillé pour aujourd’hui.</h2>
        <p>Revenez demain pour 20 nouvelles questions mélangées, ou choisissez une offre pour un accès illimité.</p>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/app/review')}>Faire mes révisions</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/app/pricing')}>Voir les offres</button>
        </div>
      </div>
    </div>;
  }

  if (completed) {
    return <div className="page">
      <PageHeader eyebrow="RÉSULTAT DE LA SESSION" title="Session terminée." subtitle="Votre score est calculé uniquement sur les réponses validées pendant cette session."/>
      <div className="result-card paper-card session-result-card">
        <div className={`session-result-icon ${percentage >= 80 ? 'success' : 'neutral'}`}>{percentage >= 80 ? <CheckCircle2/> : <Target/>}</div>
        <div className="result-ring"><strong>{score}</strong><span>/ {attempted}</span></div>
        <h2>{percentage >= 80 ? 'Très bon travail.' : 'Continuez à consolider vos acquis.'}</h2>
        <div className="session-result-metrics">
          <div><span>Réussite</span><strong>{percentage}%</strong></div>
          <div><span>Bonnes réponses</span><strong>{score}</strong></div>
          <div><span>À revoir</span><strong>{incorrect}</strong></div>
        </div>
        <p>Les réponses ont été enregistrées et pourront revenir dans vos révisions selon votre progression.</p>
        <div className="button-row center">
          {!(generalLimited && (quotaReached || remaining === 0)) && <button type="button" className="btn btn-primary" onClick={restart}><RotateCcw size={17}/> Recommencer</button>}
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/app/learn')}>Changer de domaine</button>
          {generalLimited && (quotaReached || remaining === 0) && <button type="button" className="btn btn-primary" onClick={() => navigate('/app/review')}>Faire mes révisions</button>}
        </div>
      </div>
    </div>;
  }

  return <div className="page">
    <PageHeader eyebrow={(civic ? 'PRÉPARATION CIVIQUE' : category).toUpperCase()} title="Session d’entraînement" subtitle="Répondez, consultez la correction, puis cliquez vous-même sur Question suivante. Le questionnaire reste sur le même écran."/>

    {generalLimited && <div className={`alert ${remaining === 0 ? 'error' : 'info'}`}><strong>Quota Découverte :</strong> {remaining ?? 0} / 20 nouvelles questions encore disponibles aujourd’hui.</div>}
    {error && <div className="alert error">{error}</div>}

    {!loading && !questions.length && <div className="paper-card access-lock-card">
      <Sparkles/>
      <h2>Aucune nouvelle question disponible dans cette session.</h2>
      <p>{remaining === 0 ? 'Votre quota de 20 nouvelles questions est atteint. Les révisions restent illimitées.' : 'Essayez un autre domaine ou revenez plus tard.'}</p>
      {remaining === 0 && <button type="button" className="btn btn-primary" onClick={() => navigate('/app/pricing')}>Voir les offres illimitées</button>}
    </div>}

    {questions.length > 0 && <>
      <div className="quiz-top">
        <button type="button" className="text-link" onClick={() => navigate('/app/learn')}><ChevronLeft size={16}/> Domaines</button>
        <div className="quiz-count">{Math.min(index + 1, questions.length)} / {questions.length}</div>
      </div>
      <ProgressBar value={attempted} max={questions.length || 1}/>

      <div className="assessment-focus-stage quiz-stage" data-assessment-runner="quiz">
        {q ? <QuestionCard key={q.id} question={q} attemptSource="learning" onComplete={recordResult}/> : <div className="skeleton-card">Chargement…</div>}

        {q && currentDone && <div className="quiz-nav assessment-sticky-nav forward-only-nav">
          <div className="assessment-mini-score">
            {results[q.id] ? <CheckCircle2 size={17}/> : <XCircle size={17}/>}<span>Score {score}/{attempted}</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={goNext}>
            {shouldFinishNow ? 'Voir mon résultat' : 'Question suivante'} <ChevronRight size={17}/>
          </button>
        </div>}
      </div>
    </>}

    {loading && <div className="skeleton-card">Chargement…</div>}
  </div>;
}
