import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, BookPlus, CalendarDays, CheckCircle2, ChevronRight, GraduationCap, Pencil, Plus, Search, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ProgressBar from '../components/ProgressBar';
import QuestionManagement from '../components/QuestionManagement';
import { api } from '../lib/api';

const tabs=[['overview','Vue d’ensemble'],['groups','Groupes'],['learners','Apprenants'],['courses','Cours'],['questions','Banque de questions'],['validation','Validation']];

export default function TrainerPage(){
  const {tab='overview'}=useParams();
  const navigate=useNavigate();
  const [msg,setMsg]=useState('');
  const [cohorts,setCohorts]=useState([]);
  const [selected,setSelected]=useState(null);
  const [learners,setLearners]=useState([]);
  const [courses,setCourses]=useState([]);
  const [pending,setPending]=useState([]);
  const [groupForm,setGroupForm]=useState({name:'',description:'',startDate:'',endDate:''});
  const [email,setEmail]=useState('');
  const [courseForm,setCourseForm]=useState({title:'',description:'',moduleCode:'',level:'Apprenti',status:'draft'});
  const [mdm,setMdm]=useState({modules:[],levels:[]});
  const [managedCourse,setManagedCourse]=useState(null);
  const [courseCatalog,setCourseCatalog]=useState([]);
  const [courseSearch,setCourseSearch]=useState('');
  const [courseBusy,setCourseBusy]=useState(false);

  async function loadCommon(){
    const [c,l,cr,m]=await Promise.all([api('/trainer/cohorts'),api('/trainer/learners'),api('/trainer/courses'),api('/mdm')]);
    setCohorts(c.cohorts);setLearners(l.learners);setCourses(cr.courses);setMdm(m);
    if(!selected&&c.cohorts[0])await open(c.cohorts[0].id);
  }
  async function open(id){const d=await api(`/trainer/cohorts/${id}`);setSelected(d)}
  async function loadPending(){const d=await api('/manage/questions?status=pending&limit=200');setPending(d.questions)}
  useEffect(()=>{loadCommon().catch(e=>setMsg(e.message));if(tab==='validation')loadPending().catch(e=>setMsg(e.message))},[tab]);
  const reviewed=useMemo(()=>learners.reduce((s,m)=>s+Number(m.questions_reviewed||0),0),[learners]);
  const avgBox=learners.length?learners.reduce((s,m)=>s+Number(m.avg_box||0),0)/learners.length:0;

  async function createGroup(e){
    e.preventDefault();if(!groupForm.name.trim())return;
    try{
      const d=await api('/trainer/cohorts',{method:'POST',body:JSON.stringify({name:groupForm.name})});
      await api(`/trainer/cohorts/${d.cohort.id}`,{method:'PUT',body:JSON.stringify(groupForm)});
      setGroupForm({name:'',description:'',startDate:'',endDate:''});setMsg('Groupe créé.');await loadCommon();await open(d.cohort.id);
    }catch(e){setMsg(e.message)}
  }
  async function updateGroup(){
    if(!selected)return;
    try{
      await api(`/trainer/cohorts/${selected.cohort.id}`,{method:'PUT',body:JSON.stringify({name:selected.cohort.name,description:selected.cohort.description||'',startDate:selected.cohort.start_date||'',endDate:selected.cohort.end_date||''})});
      setMsg('Groupe mis à jour.');await loadCommon();await open(selected.cohort.id);
    }catch(e){setMsg(e.message)}
  }
  async function deleteGroup(id){if(!confirm('Supprimer ce groupe ?'))return;try{await api(`/trainer/cohorts/${id}`,{method:'DELETE'});setSelected(null);await loadCommon();setMsg('Groupe supprimé.')}catch(e){setMsg(e.message)}}
  async function addLearner(){if(!selected||!email)return;try{await api(`/trainer/cohorts/${selected.cohort.id}/members`,{method:'POST',body:JSON.stringify({email})});setEmail('');await open(selected.cohort.id);await loadCommon();setMsg('Apprenant ajouté.')}catch(e){setMsg(e.message)}}
  async function removeLearner(userId){if(!selected)return;try{await api(`/trainer/cohorts/${selected.cohort.id}/members/${userId}`,{method:'DELETE'});await open(selected.cohort.id);await loadCommon()}catch(e){setMsg(e.message)}}
  async function createCourse(e){e.preventDefault();if(!courseForm.title.trim())return;try{await api('/trainer/courses',{method:'POST',body:JSON.stringify(courseForm)});setCourseForm({title:'',description:'',moduleCode:'',level:'Apprenti',status:'draft'});await loadCommon();setMsg('Cours créé.')}catch(e){setMsg(e.message)}}
  async function updateCourse(c,patch){try{await api(`/trainer/courses/${c.id}`,{method:'PUT',body:JSON.stringify({...c,...patch,moduleCode:patch.moduleCode??c.module_code})});await loadCommon();if(managedCourse?.course?.id===c.id)await openCourse(c.id)}catch(e){setMsg(e.message)}}
  async function deleteCourse(id){if(!confirm('Supprimer ce cours ?'))return;try{await api(`/trainer/courses/${id}`,{method:'DELETE'});if(managedCourse?.course?.id===id)setManagedCourse(null);await loadCommon()}catch(e){setMsg(e.message)}}
  async function assignCourse(courseId,cohortId){if(!cohortId)return;try{await api(`/trainer/courses/${courseId}/cohorts`,{method:'POST',body:JSON.stringify({cohortId})});setMsg('Cours affecté au groupe.');await loadCommon();if(managedCourse?.course?.id===courseId)await openCourse(courseId)}catch(e){setMsg(e.message)}}
  async function validate(id){try{await api(`/manage/questions/${id}/status`,{method:'POST',body:JSON.stringify({status:'validated'})});await loadPending();setMsg('Question validée.')}catch(e){setMsg(e.message)}}

  async function loadCatalog(search=courseSearch){
    const qs=new URLSearchParams({status:'published',limit:'200'});if(search.trim())qs.set('search',search.trim());
    const d=await api(`/manage/questions?${qs}`);setCourseCatalog(d.questions);
  }
  async function openCourse(id){
    setCourseBusy(true);setMsg('');
    try{const [detail]=await Promise.all([api(`/trainer/courses/${id}`),loadCatalog()]);setManagedCourse(detail)}catch(e){setMsg(e.message)}finally{setCourseBusy(false)}
  }
  async function addQuestionToCourse(questionId){
    if(!managedCourse||courseBusy)return;
    setCourseBusy(true);
    try{
      const courseId=managedCourse.course.id;
      const d=await api(`/trainer/courses/${courseId}/questions`,{method:'POST',body:JSON.stringify({questionId})});
      setMsg(d.alreadyPresent?'Cette question est déjà dans le cours.':'Question ajoutée au cours.');
      const detail=await api(`/trainer/courses/${courseId}`);
      setManagedCourse(detail);
      await loadCommon();
    }catch(e){setMsg(e.message)}finally{setCourseBusy(false)}
  }
  async function removeQuestionFromCourse(questionId){
    if(!managedCourse||courseBusy)return;
    setCourseBusy(true);
    try{
      const courseId=managedCourse.course.id;
      await api(`/trainer/courses/${courseId}/questions/${questionId}`,{method:'DELETE'});
      setMsg('Question retirée du cours.');
      const detail=await api(`/trainer/courses/${courseId}`);
      setManagedCourse(detail);
      await loadCommon();
    }catch(e){setMsg(e.message)}finally{setCourseBusy(false)}
  }
  const attachedIds=new Set((managedCourse?.questions||[]).map(q=>q.id));

  return <div className="page"><PageHeader eyebrow="ESPACE FORMATEUR" title="Gérez vos groupes, vos cours et la progression de vos apprenants." subtitle="Un espace opérationnel pour organiser les séances, créer du contenu et valider les questions avant publication."/>
    <div className="role-tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>navigate(`/app/trainer/${key}`)}>{label}</button>)}</div>
    {msg&&<div className="alert info">{msg}</div>}

    {tab==='overview'&&<><section className="stat-grid trainer-overview-stats"><div className="stat-card"><Users/><span>Apprenants</span><strong>{learners.length}</strong></div><div className="stat-card"><GraduationCap/><span>Groupes</span><strong>{cohorts.length}</strong></div><div className="stat-card"><BookOpenCheck/><span>Cours</span><strong>{courses.length}</strong></div><div className="stat-card"><CheckCircle2/><span>Questions revues</span><strong>{reviewed}</strong></div></section><div className="trainer-overview-grid"><section className="paper-card"><div className="section-row"><div><div className="eyebrow">À FAIRE</div><h2>Workflow simple</h2></div></div><div className="workflow-lanes"><button onClick={()=>navigate('/app/trainer/groups')}><strong>1. Créer un groupe</strong><span>Organisez les apprenants par session.</span></button><button onClick={()=>navigate('/app/trainer/courses')}><strong>2. Préparer un cours</strong><span>Associez modules, questions et groupes.</span></button><button onClick={()=>navigate('/app/trainer/questions')}><strong>3. Créer des questions</strong><span>Classez-les avant de les soumettre.</span></button><button onClick={()=>navigate('/app/trainer/validation')}><strong>4. Valider</strong><span>Contrôlez les contenus avant publication admin.</span></button></div></section><section className="paper-card"><div className="eyebrow">SYNTHÈSE</div><h2>Maîtrise moyenne</h2><div className="big-metric">{Math.round(avgBox/5*100)}%</div><ProgressBar value={Math.round(avgBox/5*100)}/><p className="muted">Basée sur les boîtes de révision des apprenants suivis.</p></section></div></>}

    {tab==='groups'&&<div className="trainer-layout expanded"><aside className="trainer-sidebar paper-card"><div className="trainer-sidebar-head"><h3>Groupes</h3><span>{cohorts.length}</span></div><div className="cohort-list">{cohorts.map(c=><button key={c.id} className={selected?.cohort?.id===c.id?'active':''} onClick={()=>open(c.id)}><div><strong>{c.name}</strong><span>{c.learner_count} apprenant{c.learner_count!==1?'s':''}</span></div><ChevronRight size={16}/></button>)}</div><form className="stack-form" onSubmit={createGroup}><input value={groupForm.name} onChange={e=>setGroupForm({...groupForm,name:e.target.value})} placeholder="Nom du nouveau groupe"/><textarea rows="2" value={groupForm.description} onChange={e=>setGroupForm({...groupForm,description:e.target.value})} placeholder="Description"/><div className="group-date-grid"><label><CalendarDays size={14}/> Début<input type="date" value={groupForm.startDate} onChange={e=>setGroupForm({...groupForm,startDate:e.target.value})}/></label><label><CalendarDays size={14}/> Fin<input type="date" value={groupForm.endDate} onChange={e=>setGroupForm({...groupForm,endDate:e.target.value})}/></label></div><button className="btn btn-primary"><Plus size={16}/> Créer le groupe</button></form></aside><section className="trainer-main">{selected?<div className="paper-card group-editor"><div className="section-row"><div><div className="eyebrow">GESTION DU GROUPE</div><h2>{selected.cohort.name}</h2></div><button className="icon-button danger" onClick={()=>deleteGroup(selected.cohort.id)}><Trash2/></button></div><div className="form-grid"><label>Nom<input value={selected.cohort.name} onChange={e=>setSelected({...selected,cohort:{...selected.cohort,name:e.target.value}})}/></label><label>Description<input value={selected.cohort.description||''} onChange={e=>setSelected({...selected,cohort:{...selected.cohort,description:e.target.value}})}/></label></div><div className="group-date-grid editor"><label><CalendarDays size={14}/> Date de début<input type="date" value={selected.cohort.start_date||''} onChange={e=>setSelected({...selected,cohort:{...selected.cohort,start_date:e.target.value}})}/></label><label><CalendarDays size={14}/> Date de fin<input type="date" value={selected.cohort.end_date||''} onChange={e=>setSelected({...selected,cohort:{...selected.cohort,end_date:e.target.value}})}/></label></div><button className="btn btn-ghost" onClick={updateGroup}><Pencil size={16}/> Enregistrer</button><div className="section-row learner-add-row"><div><h3>Apprenants</h3><span>{selected.members.length} dans ce groupe</span></div><div className="add-member"><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@exemple.fr"/><button className="btn btn-primary" onClick={addLearner}><UserPlus size={16}/> Ajouter</button></div></div><div className="learner-table"><div className="learner-row header"><span>Apprenant</span><span>Questions</span><span>Précision</span><span>Maîtrise</span><span></span></div>{selected.members.map(m=>{const total=Number(m.correct_count)+Number(m.wrong_count),acc=total?Math.round(Number(m.correct_count)/total*100):0,mastery=Math.round(Number(m.avg_box||0)/5*100);return <div className="learner-row" key={m.id}><span><strong>{m.name}</strong><small>{m.email}</small></span><span>{m.questions_reviewed}</span><span>{acc}%</span><span><ProgressBar value={mastery}/></span><button className="icon-button danger" onClick={()=>removeLearner(m.id)}><UserMinus size={15}/></button></div>})}</div></div>:<div className="empty-state paper-card">Créez ou sélectionnez un groupe.</div>}</section></div>}

    {tab==='learners'&&<section className="paper-card trainer-data-card"><div className="section-row"><div><div className="eyebrow">APPRENANTS</div><h2>Vue consolidée</h2></div></div><div className="learner-table wide"><div className="learner-row header"><span>Apprenant</span><span>Groupe</span><span>Questions</span><span>Précision</span><span>Maîtrise</span></div>{learners.map(m=>{const total=Number(m.correct_count)+Number(m.wrong_count),acc=total?Math.round(Number(m.correct_count)/total*100):0,mastery=Math.round(Number(m.avg_box||0)/5*100);return <div className="learner-row" key={`${m.id}-${m.cohort_id}`}><span><strong>{m.name}</strong><small>{m.email}</small></span><span>{m.cohort_name}</span><span>{m.questions_reviewed}</span><span>{acc}%</span><span><ProgressBar value={mastery}/></span></div>})}</div></section>}

    {tab==='courses'&&<><div className="course-management"><form className="paper-card course-form" onSubmit={createCourse}><div className="eyebrow">NOUVEAU COURS</div><h2>Créer un cours</h2><label>Nom *<input value={courseForm.title} onChange={e=>setCourseForm({...courseForm,title:e.target.value})}/></label><label>Description<textarea rows="3" value={courseForm.description} onChange={e=>setCourseForm({...courseForm,description:e.target.value})}/></label><div className="form-grid"><label>Module<select value={courseForm.moduleCode} onChange={e=>setCourseForm({...courseForm,moduleCode:e.target.value})}><option value="">Tous</option>{mdm.modules.filter(m=>m.code!=='civic-official').map(m=><option key={m.code} value={m.code}>{m.name}</option>)}</select></label><label>Niveau<select value={courseForm.level} onChange={e=>setCourseForm({...courseForm,level:e.target.value})}>{mdm.levels.map(l=><option key={l.code}>{l.name}</option>)}</select></label></div><button className="btn btn-primary"><Plus size={16}/> Créer</button></form><section className="course-cards">{courses.map(c=><article className={`paper-card course-card ${managedCourse?.course?.id===c.id?'selected':''}`} key={c.id}><div className="section-row"><div><span className={`status-pill ${c.status}`}>{c.status}</span><h3>{c.title}</h3></div><button className="icon-button danger" onClick={()=>deleteCourse(c.id)}><Trash2 size={16}/></button></div><p>{c.description||'Aucune description.'}</p><div className="course-meta"><span>{c.question_count||0} questions publiées</span><span>{c.cohort_count||0} groupes</span><span>{c.level||'Tous niveaux'}</span></div><div className="course-actions"><select defaultValue="" onChange={e=>assignCourse(c.id,e.target.value)}><option value="">Affecter à un groupe…</option>{cohorts.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select><select value={c.status} onChange={e=>updateCourse(c,{status:e.target.value})}><option value="draft">Brouillon</option><option value="published">Publié</option><option value="archived">Archivé</option></select></div><button className="btn btn-ghost btn-block course-manage-btn" onClick={()=>openCourse(c.id)}><BookPlus size={16}/> Gérer les questions</button></article>)}</section></div>
      {managedCourse&&<section className="paper-card course-question-manager"><div className="section-row"><div><div className="eyebrow">CONTENU DU COURS</div><h2>{managedCourse.course.title}</h2><p className="muted">Seules les questions publiées peuvent être distribuées aux apprenants.</p></div><button className="icon-button" onClick={()=>setManagedCourse(null)}><X/></button></div><div className="course-manager-grid"><div><h3>Questions du cours <span className="count-badge">{managedCourse.questions.length}</span></h3><div className="course-attached-list">{managedCourse.questions.map((q,i)=><article key={q.id}><span>{i+1}</span><div><strong>{q.prompt}</strong><small>{q.category} · {q.difficulty}</small></div><button className="icon-button danger" title="Retirer" onClick={()=>removeQuestionFromCourse(q.id)}><Trash2 size={15}/></button></article>)}{!managedCourse.questions.length&&<div className="empty-state">Aucune question. Ajoutez des questions publiées depuis la colonne de droite.</div>}</div></div><div><div className="course-catalog-head"><h3>Banque publiée</h3><div className="course-search"><Search size={16}/><input value={courseSearch} onChange={e=>setCourseSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')loadCatalog(courseSearch).catch(err=>setMsg(err.message))}} placeholder="Rechercher une question…"/><button className="btn btn-ghost" onClick={()=>loadCatalog(courseSearch).catch(e=>setMsg(e.message))}>Rechercher</button></div></div><div className="course-catalog-list">{courseCatalog.map(q=><article key={q.id} className={attachedIds.has(q.id)?'attached':''}><div><strong>{q.prompt}</strong><small>{q.category} · {q.difficulty}</small></div><button className="btn btn-mini" disabled={attachedIds.has(q.id)||courseBusy} onClick={()=>addQuestionToCourse(q.id)}>{attachedIds.has(q.id)?'Ajoutée':'+ Ajouter'}</button></article>)}</div></div></div></section>}
    </>}

    {tab==='questions'&&<QuestionManagement role="trainer" courses={courses} onCourseChanged={loadCommon}/>}

    {tab==='validation'&&<section className="paper-card validation-panel"><div className="section-row"><div><div className="eyebrow">VALIDATION</div><h2>Questions à contrôler</h2></div><span className="count-badge">{pending.length}</span></div><p className="muted">Le formateur valide le fond pédagogique. L’administrateur garde le contrôle de la publication finale.</p><div className="validation-list">{pending.map(q=><article key={q.id}><div className="validation-copy"><span>{q.category} · {q.difficulty}{q.isCivic?' · Examen civique':''}</span><strong>{q.prompt}</strong><small>{q.explanation}</small></div><button className="btn btn-gold" onClick={()=>validate(q.id)}><CheckCircle2 size={16}/> Valider</button></article>)}{!pending.length&&<div className="empty-state">Aucune question en attente.</div>}</div></section>}
  </div>
}
