import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, RotateCcw, Target, XCircle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import QuestionCard from '../components/QuestionCard';
import { localDb } from '../lib/localDb';
import { api } from '../lib/api';

export default function ReviewPage() {
  const [questions,setQuestions]=useState([]);
  const [index,setIndex]=useState(0);
  const [loading,setLoading]=useState(true);
  const [results,setResults]=useState({});
  const [completed,setCompleted]=useState(false);

  useEffect(()=>{(async()=>{
    const due=await localDb.progress.where('nextReviewAt').belowOrEqual(new Date().toISOString()).toArray();
    const ids=due.map(x=>x.questionId);
    const qs=[];
    for(const qid of ids.slice(0,50)){try{const d=await api(`/questions/${qid}`);qs.push(d.question)}catch{}}
    setQuestions(qs);setLoading(false);
  })()},[]);

  const q=questions[index];
  const currentDone=Boolean(q&&Object.prototype.hasOwnProperty.call(results,q.id));
  const attempted=Object.keys(results).length;
  const score=Object.values(results).filter(Boolean).length;
  const percentage=attempted?Math.round((score/attempted)*100):0;

  function recordResult(result){
    if(!q)return;
    setResults(prev=>Object.prototype.hasOwnProperty.call(prev,q.id)?prev:{...prev,[q.id]:Boolean(result.correct)});
  }

  function next(){
    if(!currentDone)return;
    if(index+1>=questions.length){setCompleted(true);return;}
    setIndex(i=>i+1);
  }

  function restart(){
    setIndex(0);setResults({});setCompleted(false);
  }

  if(completed) return <div className="page">
    <PageHeader eyebrow="RÉSULTAT DES RÉVISIONS" title="Révisions terminées." subtitle="Votre score vous aide à voir ce qui est acquis et ce qui mérite de revenir."/>
    <div className="result-card paper-card session-result-card">
      <div className={`session-result-icon ${percentage>=80?'success':'neutral'}`}>{percentage>=80?<CheckCircle2/>:<Target/>}</div>
      <div className="result-ring"><strong>{score}</strong><span>/ {questions.length}</span></div>
      <h2>{percentage>=80?'Vos acquis tiennent bien.':'Quelques notions méritent encore un passage.'}</h2>
      <div className="session-result-metrics"><div><span>Réussite</span><strong>{percentage}%</strong></div><div><span>Bonnes réponses</span><strong>{score}</strong></div><div><span>À revoir</span><strong>{questions.length-score}</strong></div></div>
      <div className="button-row center"><button type="button" className="btn btn-primary" onClick={restart}><RotateCcw size={17}/> Revoir la série</button></div>
    </div>
  </div>;

  return <div className="page"><PageHeader eyebrow="RÉPÉTITION ESPACÉE" title="Révisions du jour" subtitle="Les notions qui méritent de revenir maintenant sont placées en priorité. Les révisions déjà étudiées ne consomment jamais votre quota quotidien."/>
    {loading?<div className="skeleton-card">Préparation de vos révisions…</div>:q?<div className="assessment-focus-stage quiz-stage" data-assessment-runner="review"><div className="review-counter">{index+1} / {questions.length}</div><QuestionCard key={q.id} question={q} attemptSource="review" onComplete={recordResult}/>{currentDone&&<div className="quiz-nav assessment-sticky-nav forward-only-nav"><div className="assessment-mini-score">{results[q.id]?<CheckCircle2 size={17}/>:<XCircle size={17}/>}<span>Score {score}/{attempted}</span></div><button type="button" className="btn btn-primary" onClick={next}>{index+1>=questions.length?'Voir mon résultat':'Question suivante'} <ChevronRight size={17}/></button></div>}</div>:<div className="empty-state">Aucune révision arrivée à échéance pour le moment.</div>}
  </div>;
}
