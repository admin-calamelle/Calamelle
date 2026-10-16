import React, { useEffect, useRef, useState } from 'react';
import { Clock3, Play, RotateCcw, Zap } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';
import { recordLocalAnswer } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';

export default function SpeedChallengePage(){
  const { user, access, refreshAccess } = useAuth();
  const [questions,setQuestions]=useState([]);
  const [index,setIndex]=useState(0);
  const [running,setRunning]=useState(false);
  const [time,setTime]=useState(60);
  const [score,setScore]=useState(0);
  const [wrong,setWrong]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const timer=useRef(null);

  useEffect(()=>()=>clearInterval(timer.current),[]);

  const civicOnly=Boolean(access?.naturalisationAccess&&!access?.fullAccess);
  const attempted=score+wrong;
  const percentage=attempted?Math.round((score/attempted)*100):0;

  async function start(){
    setError('');
    try{
      const d=await api(`/questions?limit=80${civicOnly?'&civic=true':''}`);
      if(!d.questions?.length)throw new Error('Aucune question disponible pour ce défi.');
      setQuestions(d.questions);
      setIndex(0);
      setScore(0);
      setWrong(0);
      setTime(60);
      setRunning(true);
      clearInterval(timer.current);
      timer.current=setInterval(()=>setTime(t=>{
        if(t<=1){clearInterval(timer.current);setRunning(false);return 0}
        return t-1;
      }),1000);
      refreshAccess?.().catch(()=>{});
    }catch(e){setError(e.message)}
  }

  async function answer(answerId){
    if(!running||busy)return;
    setBusy(true);
    setError('');
    const q=questions[index%questions.length];
    try{
      const d=await api(`/questions/${q.id}/answer`,{method:'POST',body:JSON.stringify({answerId})});
      d.correct?setScore(s=>s+1):setWrong(s=>s+1);
      await recordLocalAnswer(q,d.correct);
      if(user)api('/progress/answer',{method:'POST',body:JSON.stringify({questionId:q.id,answerId})}).catch(()=>{});
      // Speed challenge intentionally advances instantly after an answer, but it
      // stays inside this same React view: there is no route or page reload.
      setIndex(i=>i+1);
      refreshAccess?.().catch(()=>{});
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }

  const q=questions.length?questions[index%questions.length]:null;

  return <div className="page">
    <PageHeader eyebrow="DÉFI EXPRESS" title="Soixante secondes. À vous de jouer." subtitle={civicOnly?'Votre Pass Naturalisation active le défi sur les questions civiques.':'Un exercice rapide pour créer un réflexe quotidien sans transformer l’apprentissage en course permanente.'}/>
    {error&&<div className="alert error">{error}</div>}

    {!running&&time===60 ? <div className="speed-intro paper-card">
      <Zap/>
      <h2>Combien de réponses justes en une minute ?</h2>
      <p>{civicOnly?'Le défi utilise uniquement votre banque civique illimitée.':'Chaque question compte. Les réponses alimentent aussi votre système de révision.'}</p>
      <button type="button" className="btn btn-primary btn-lg" onClick={start}><Play size={18}/> Lancer le défi</button>
    </div> : running&&q ? <div className="speed-stage assessment-focus-stage speed-focus-stage" data-assessment-runner="speed">
      <div className="speed-scorebar">
        <div><Clock3/>{time}s</div>
        <div><span>Justes</span><strong>{score}</strong></div>
        <div><span>À revoir</span><strong>{wrong}</strong></div>
      </div>
      <div className="paper-card speed-question">
        <div className="question-meta"><span>{q.category}</span></div>
        <h2>{q.prompt}</h2>
        <div className="answer-list">
          {q.answers.map((a,i)=><button type="button" disabled={busy} key={a.id} className="answer-option" onClick={()=>answer(a.id)}><span className="answer-letter">{String.fromCharCode(65+i)}</span>{a.text}</button>)}
        </div>
      </div>
    </div> : <div className="result-card paper-card session-result-card">
      <div className="result-ring"><strong>{score}</strong><span>/ {attempted}</span></div>
      <h2>Minute terminée.</h2>
      <div className="session-result-metrics">
        <div><span>Réussite</span><strong>{percentage}%</strong></div>
        <div><span>Bonnes réponses</span><strong>{score}</strong></div>
        <div><span>À revoir</span><strong>{wrong}</strong></div>
      </div>
      <p>{wrong} réponse{wrong!==1?'s':''} à revoir. Revenez demain pour comparer.</p>
      <button type="button" className="btn btn-primary" onClick={start}><RotateCcw size={17}/> Rejouer</button>
    </div>}
  </div>
}
