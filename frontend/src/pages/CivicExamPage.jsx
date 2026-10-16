import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Flag, LockKeyhole, RotateCcw, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function CivicExamPage() {
  const { user, access, refreshAccess } = useAuth();
  const navigate = useNavigate();
  const [exam,setExam]=useState(null);
  const [index,setIndex]=useState(0);
  const [answers,setAnswers]=useState({});
  const [config,setConfig]=useState({totalQuestions:40,knowledgeCount:28,scenarioCount:12,durationMinutes:45,passPercentage:80,activeSession:false});
  const [remaining,setRemaining]=useState(45*60);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function loadConfig(){
    try{const d=await api('/exams/civic/config');setConfig(d.config)}catch{}
  }
  useEffect(()=>{loadConfig()},[user?.id]);
  useEffect(()=>{
    if(!exam||result)return;
    const t=setInterval(()=>setRemaining(r=>{if(r<=1){clearInterval(t);return 0}return r-1}),1000);
    return()=>clearInterval(t);
  },[exam,result]);
  useEffect(()=>{if(exam && remaining===0 && !result) submitExam()},[remaining]);

  const freeMockUsed = Boolean(user && access && !access.civicMock?.unlimited && (access.civicMock?.remaining ?? 0) <= 0);

  async function start(){
    if(!user){navigate('/login');return}
    setError('');setBusy(true);
    try{
      const d=await api('/exams/civic');
      setExam(d.exam);
      setRemaining(d.exam.durationSeconds);
      setIndex(0);
      setAnswers({});
      setResult(null);
      setConfig(c=>({...c,activeSession:true}));
      refreshAccess?.().catch(()=>{});
    }catch(e){
      setError(e.message);
      if(e.code==='FREE_MOCK_USED')refreshAccess?.().catch(()=>{});
    }finally{setBusy(false)}
  }

  async function submitExam(){
    if(!exam||busy)return;
    setBusy(true);setError('');
    try{
      const payload=exam.questions.map(q=>({questionId:q.id,answerId:answers[q.id]||null}));
      const d=await api('/exams/submit',{method:'POST',body:JSON.stringify({examId:exam.id,answers:payload})});
      setResult(d.result);
      setConfig(c=>({...c,activeSession:false}));
      refreshAccess?.().catch(()=>{});
    }catch(e){
      setError(e.message);
      if(['FREE_MOCK_USED','EXAM_ALREADY_SUBMITTED','EXAM_EXPIRED'].includes(e.code))refreshAccess?.().catch(()=>{});
    }finally{setBusy(false)}
  }

  const answeredCount=Object.values(answers).filter(Boolean).length;
  const current=exam?.questions[index];
  const themeRows=useMemo(()=>result?Object.entries(result.breakdown):[],[result]);
  const canResume=Boolean(config.activeSession);

  if(!exam) return <div className="page"><PageHeader eyebrow="EXAMEN CIVIQUE" title="Entraînez-vous dans les conditions du format cible." subtitle="Une session chronométrée, puis une lecture claire de vos résultats par thème."/>
    {!user && <div className="alert info"><strong>Compte requis :</strong> connectez-vous pour utiliser votre examen blanc gratuit et enregistrer votre résultat.</div>}
    {access?.naturalisationAccess && <div className="alert success"><strong>Pass Naturalisation actif :</strong> examens blancs illimités pendant la durée de votre pass.</div>}
    {freeMockUsed && !canResume && <div className="paper-card access-lock-card"><LockKeyhole/><h2>Votre examen blanc gratuit a déjà été utilisé.</h2><p>Le plan Découverte inclut 1 examen blanc. Passez à une offre payante pour continuer sans limite.</p><button type="button" className="btn btn-primary" onClick={()=>navigate('/app/pricing')}><Sparkles size={17}/> Voir les offres</button></div>}
    {(!freeMockUsed || canResume) && <div className="exam-intro paper-card"><div className="exam-intro-mark"><Flag/></div><div><h2>{canResume?'Examen en cours':'Examen blanc'}</h2><p>{config.totalQuestions} questions · {config.durationMinutes} minutes · objectif {config.passPercentage} %. Chaque examen tire {config.knowledgeCount} questions de connaissance et {config.scenarioCount} mises en situation parmi les QCM civiques publiés.</p>{canResume?<p><strong>Session sauvegardée :</strong> reprenez le même questionnaire, sans générer une nouvelle tentative.</p>:access&&!access.civicMock?.unlimited&&<p><strong>Plan Découverte :</strong> l’ouverture de cet examen utilise votre tentative gratuite incluse.</p>}</div><div className="exam-rule-grid"><div><strong>{config.totalQuestions}</strong><span>questions</span></div><div><strong>{config.durationMinutes}</strong><span>minutes</span></div><div><strong>{config.passPercentage}%</strong><span>seuil</span></div></div>{error&&<div className="alert error">{error}</div>}<button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>{busy?'Préparation…':!user?'Se connecter pour commencer':canResume?'Reprendre mon examen':'Commencer l’examen'}</button></div>}
  </div>;

  if(result) return <div className="page"><PageHeader eyebrow="RÉSULTAT" title={result.passed?'Objectif atteint.':'Encore un effort.'} subtitle="Analysez vos thèmes, puis revenez travailler les points les plus faibles."/>
    <div className={`exam-result-hero ${result.passed?'passed':'failed'}`}><div className="result-status">{result.passed?<CheckCircle2/>:<AlertCircle/>}<span>{result.passed?'EXAMEN RÉUSSI':'OBJECTIF NON ATTEINT'}</span></div><div className="big-score">{result.percentage}%</div><p>{result.score} bonnes réponses sur {result.total}</p></div>
    <div className="paper-card result-breakdown"><h2>Résultats par thème</h2>{themeRows.map(([theme,v])=><div className="breakdown-row" key={theme}><div><span>{theme}</span><strong>{v.percentage}%</strong></div><ProgressBar value={v.percentage}/></div>)}</div>
    <div className="button-row"><button type="button" className="btn btn-primary" onClick={()=>{setExam(null);setResult(null);loadConfig()}}><RotateCcw size={17}/> Nouvel examen</button><button type="button" className="btn btn-ghost" onClick={()=>navigate('/app/learn')}>Revenir à l’entraînement</button></div>
  </div>;

  return <div className="page"><PageHeader eyebrow="EXAMEN EN COURS" title="Restez concentré." subtitle="Répondez dans le même écran, puis passez à la question suivante. Vous pouvez revenir sur une réponse avant la remise finale."/>
    {error&&<div className="alert error">{error}</div>}
    <div className="exam-toolbar"><div><Clock3 size={18}/><strong>{formatTime(remaining)}</strong></div><div>{answeredCount} / {exam.questions.length} répondues</div></div>
    <ProgressBar value={answeredCount} max={exam.questions.length}/>
    <div className="assessment-focus-stage exam-focus-stage" data-assessment-runner="civic-exam">
      {current&&<div className="paper-card exam-question"><div className="question-meta"><span>{current.civicTheme||current.category}</span><span>{current.questionType==='scenario'?'Mise en situation':'Connaissance'}</span></div><h2>{current.prompt}</h2><div className="answer-list">{current.answers.map((a,i)=><button type="button" key={a.id} className={`answer-option ${answers[current.id]===a.id?'selected':''}`} onClick={()=>setAnswers(prev=>({...prev,[current.id]:a.id}))}><span className="answer-letter">{String.fromCharCode(65+i)}</span>{a.text}</button>)}</div></div>}
      <div className="quiz-nav assessment-sticky-nav"><button type="button" className="btn btn-ghost" disabled={index===0} onClick={()=>setIndex(i=>Math.max(0,i-1))}><ChevronLeft size={17}/> Précédent</button>{index+1<exam.questions.length?<button type="button" className="btn btn-primary" disabled={!answers[current?.id]} onClick={()=>setIndex(i=>Math.min(exam.questions.length-1,i+1))}>Suivante <ChevronRight size={17}/></button>:<button type="button" className="btn btn-primary" disabled={busy||answeredCount<exam.questions.length} onClick={submitExam}>{busy?'Correction…':answeredCount<exam.questions.length?`Répondez aux ${exam.questions.length-answeredCount} restante(s)`:'Remettre ma copie'}</button>}</div>
    </div>
  </div>;
}
