import React, { useState } from 'react';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { recordLocalAnswer } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';

export default function QuestionCard({ question, onComplete, compact = false, courseId = null, attemptSource = 'learning' }) {
  const { user, refreshAccess } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');

  async function validate() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    setErrorCode('');
    try {
      const data = await api(`/questions/${question.id}/answer`, { method: 'POST', body: JSON.stringify({ answerId: selected, source: attemptSource, ...(courseId ? { courseId } : {}) }) });
      setResult(data);
      const progress = await recordLocalAnswer(question, data.correct);
      if (user) {
        const progressRequest = api('/progress/answer', {
          method: 'POST',
          body: JSON.stringify({ questionId: question.id, answerId: selected, ...(courseId ? { courseId } : {}) })
        });
        // Inside an assigned course, wait for the server-side attempt/progress write
        // before enabling Next/Finish. This prevents a fast click from racing the
        // completion endpoint and makes the course workflow deterministic.
        if (courseId) await progressRequest;
        else progressRequest.catch(() => {});
        refreshAccess?.().catch(() => {});
      }
      onComplete?.({ ...data, progress, selectedAnswerId: selected });
    } catch (e) {
      setError(e.message);
      setErrorCode(e.code || '');
      if (user) refreshAccess?.().catch(() => {});
    } finally { setBusy(false); }
  }

  return (
    <div className={`question-card ${compact ? 'compact' : ''}`}>
      <div className="question-meta"><span>{question.category}</span><span>{question.difficulty}</span></div>
      <h2>{question.prompt}</h2>
      <div className="answer-list">
        {question.answers.map((answer, idx) => {
          let cls = selected === answer.id ? 'selected' : '';
          if (result) {
            if (answer.id === result.correctAnswerId) cls = 'correct';
            else if (answer.id === selected) cls = 'wrong';
          }
          return <button type="button" key={answer.id} disabled={Boolean(result)} className={`answer-option ${cls}`} onClick={() => setSelected(answer.id)}><span className="answer-letter">{String.fromCharCode(65+idx)}</span><span>{answer.text}</span></button>;
        })}
      </div>
      {error && <div className="alert error question-access-error"><span>{error}</span>{['FREE_DAILY_LIMIT','PREMIUM_FEATURE_REQUIRED'].includes(errorCode)&&<button type="button" className="btn btn-ghost" onClick={()=>navigate('/app/pricing')}><Sparkles size={15}/> Voir les offres</button>}</div>}
      {!result ? (
        <button type="button" className="btn btn-primary question-submit" disabled={!selected || busy} onClick={validate}>Valider <ChevronRight size={18}/></button>
      ) : (
        <div className={`explanation ${result.correct ? 'success' : 'error'}`} aria-live="polite">
          <div className="explanation-title">{result.correct ? <><Check size={19}/> Bonne réponse</> : <><X size={19}/> À revoir</>}</div>
          {!result.correct && <p><strong>Bonne réponse :</strong> {result.correctAnswerText}</p>}
          <p>{result.explanation}</p>
        </div>
      )}
    </div>
  );
}
