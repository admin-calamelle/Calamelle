import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CheckCircle2, ChevronLeft, ChevronRight, Target } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import QuestionCard from '../components/QuestionCard';
import ProgressBar from '../components/ProgressBar';
import { api } from '../lib/api';

function buildSummaryFromAttempts(attempts=[], total=0){
  const correct=attempts.filter(a=>Boolean(a.correct)).length;
  const attempted=attempts.length;
  return {
    total,
    attempted,
    correct,
    incorrect:Math.max(0,attempted-correct),
    percentage:attempted?Math.round((correct/attempted)*100):0
  };
}

export default function LearnerCoursesPage(){
  const [courses,setCourses]=useState([]);
  const [selected,setSelected]=useState(null);
  const [index,setIndex]=useState(0);
  const [attemptsByQuestion,setAttemptsByQuestion]=useState({});
  const [currentDone,setCurrentDone]=useState(false);
  const [completed,setCompleted]=useState(false);
  const [courseResult,setCourseResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');

  async function loadCourses(){
    try{const d=await api('/learner/courses');setCourses(d.courses)}catch(e){setMsg(e.message)}
  }
  useEffect(()=>{loadCourses()},[]);

  async function open(id){
    setMsg('');
    try{
      const d=await api(`/learner/courses/${id}`);
      const attemptMap=Object.fromEntries((d.attempts||[]).map(a=>[a.question_id,{correct:Boolean(a.correct),answerId:a.answer_id,answeredAt:a.answered_at}]));
      const doneIds=new Set(Object.keys(attemptMap));
      const firstUnanswered=(d.questions||[]).findIndex(q=>!doneIds.has(q.id));
      const startIndex=firstUnanswered===-1?Math.max(0,(d.questions||[]).length-1):firstUnanswered;
      const localSummary=d.result||buildSummaryFromAttempts(d.attempts||[],(d.questions||[]).length);
      setSelected(d);
      setAttemptsByQuestion(attemptMap);
      setIndex(startIndex);
      setCurrentDone(doneIds.has(d.questions?.[startIndex]?.id));
      setCompleted(Boolean(d.completed));
      setCourseResult(Boolean(d.completed)?localSummary:null);
    }catch(e){setMsg(e.message)}
  }

  const q=selected?.questions?.[index];
  const total=selected?.questions?.length||0;
  const attemptedCount=Object.keys(attemptsByQuestion).length;
  const allAnswered=total>0 && attemptedCount>=total;
  const liveCorrect=useMemo(()=>Object.values(attemptsByQuestion).filter(a=>a.correct).length,[attemptsByQuestion]);

  function markComplete(result){
    if(!q)return;
    setAttemptsByQuestion(prev=>({...prev,[q.id]:{correct:Boolean(result.correct),answerId:result.selectedAnswerId||null,answeredAt:new Date().toISOString()}}));
    setCurrentDone(true);
  }

  function next(){
    if(!currentDone || index>=total-1)return;
    const nextIndex=index+1;
    setIndex(nextIndex);
    setCurrentDone(Boolean(attemptsByQuestion[selected.questions[nextIndex]?.id]));
  }

  async function finish(){
    if(!selected||busy)return;
    setBusy(true);setMsg('');
    try{
      const d=await api(`/learner/courses/${selected.course.id}/complete`,{method:'POST',body:'{}'});
      setCompleted(true);
      setCourseResult(d.result||buildSummaryFromAttempts(Object.entries(attemptsByQuestion).map(([question_id,v])=>({question_id,correct:v.correct})),total));
      await loadCourses();
    }catch(e){setMsg(e.message)}finally{setBusy(false)}
  }

  if(selected){
    if(completed){
      const result=courseResult||buildSummaryFromAttempts(Object.entries(attemptsByQuestion).map(([question_id,v])=>({question_id,correct:v.correct})),total);
      return <div className="page">
        <button type="button" className="text-link course-back" onClick={()=>{setSelected(null);setCompleted(false);setCourseResult(null)}}><ChevronLeft size={16}/> Mes cours</button>
        <PageHeader eyebrow="RÉSULTAT DU COURS" title={selected.course.title} subtitle="Toutes les questions ont été traitées. Voici votre résultat pour ce cours."/>
        <section className="paper-card course-result-card">
          <div className="course-result-mark"><Target/></div>
          <div className="course-result-copy"><div className="eyebrow">COURS TERMINÉ</div><h2>{result.correct} / {result.total}</h2><p>{result.percentage}% de réussite · {result.incorrect} question{result.incorrect!==1?'s':''} à revoir.</p></div>
          <div className="session-result-metrics"><div><span>Réussite</span><strong>{result.percentage}%</strong></div><div><span>Bonnes réponses</span><strong>{result.correct}</strong></div><div><span>À revoir</span><strong>{result.incorrect}</strong></div></div>
          <button type="button" className="btn btn-primary" onClick={()=>{setSelected(null);setCompleted(false);setCourseResult(null)}}>Retour à mes cours</button>
        </section>
      </div>;
    }

    return <div className="page">
      <button type="button" className="text-link course-back" onClick={()=>setSelected(null)}><ChevronLeft size={16}/> Mes cours</button>
      <PageHeader eyebrow="COURS" title={selected.course.title} subtitle={selected.course.description||'Suivez les questions préparées par votre formateur.'}/>
      {msg&&<div className="alert error">{msg}</div>}
      <div className="course-learning-head"><div><strong>{Math.min(index+1,total||1)}</strong><span>/ {total}</span></div><div className="course-progress-wrap"><ProgressBar value={attemptedCount} max={total||1}/><small>{attemptedCount} / {total} question{total!==1?'s':''} traitée{attemptedCount!==1?'s':''} · score {liveCorrect}/{attemptedCount}</small></div></div>
      {q?<div className="assessment-focus-stage quiz-stage course-quiz-stage" data-assessment-runner="course">
        <QuestionCard key={`${selected.course.id}-${q.id}`} question={q} courseId={selected.course.id} attemptSource="learning" onComplete={markComplete}/>
        {currentDone&&<div className="quiz-nav course-linear-nav assessment-sticky-nav">
          <span className="course-linear-note">Réponse enregistrée. Le parcours est volontairement linéaire : aucune question précédente à refaire ici.</span>
          {index<total-1
            ? <button type="button" className="btn btn-primary" onClick={next}>Question suivante <ChevronRight size={17}/></button>
            : <button type="button" className="btn btn-primary" disabled={!allAnswered||busy} onClick={finish}>{busy?'Calcul du résultat…':'Voir mon résultat'} <CheckCircle2 size={17}/></button>}
        </div>}
      </div>:<div className="empty-state paper-card">Ce cours ne contient pas encore de questions publiées.</div>}
    </div>;
  }

  return <div className="page"><PageHeader eyebrow="MES COURS" title="Retrouvez les cours préparés par votre formateur." subtitle="Les contenus affectés à vos groupes sont regroupés ici."/>
    {msg&&<div className="alert info">{msg}</div>}
    <div className="learner-course-grid">{courses.map(c=><button type="button" className="paper-card learner-course-card" key={c.id} onClick={()=>open(c.id)}><BookOpenCheck/><div><span>{c.cohort_name}</span><h3>{c.title}</h3><p>{c.description||'Cours Calamelle'}</p><small>{c.question_count||0} questions · {c.attempted_count||0} traitées · {c.completed?'Terminé':c.level||'Tous niveaux'}</small></div></button>)}{!courses.length&&<div className="empty-state paper-card">Aucun cours ne vous a encore été affecté.</div>}</div>
  </div>;
}
