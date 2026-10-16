import Dexie from 'dexie';

export const localDb = new Dexie('CalamelleLocal');
localDb.version(1).stores({
  progress: 'questionId,nextReviewAt,category,lastReviewedAt',
  meta: 'key'
});

const intervals = [0, 1, 3, 7, 14, 30];
export async function recordLocalAnswer(question, correct) {
  const existing = await localDb.progress.get(question.id);
  let box = existing?.box || 1;
  const correctCount = (existing?.correctCount || 0) + (correct ? 1 : 0);
  const wrongCount = (existing?.wrongCount || 0) + (correct ? 0 : 1);
  box = correct ? Math.min(5, box + 1) : 1;
  const lastReviewedAt = new Date().toISOString();
  const next = new Date();
  next.setDate(next.getDate() + intervals[box]);
  const value = {
    questionId: question.id,
    category: question.category,
    box,
    correctCount,
    wrongCount,
    lastReviewedAt,
    nextReviewAt: next.toISOString()
  };
  await localDb.progress.put(value);
  return value;
}

export async function localStats() {
  const rows = await localDb.progress.toArray();
  const correct = rows.reduce((s, r) => s + (r.correctCount || 0), 0);
  const wrong = rows.reduce((s, r) => s + (r.wrongCount || 0), 0);
  const totalAnswers = correct + wrong;
  const byCategory = {};
  for (const r of rows) {
    byCategory[r.category] ||= { questions: 0, correct: 0, wrong: 0, boxes: 0 };
    byCategory[r.category].questions++;
    byCategory[r.category].correct += r.correctCount || 0;
    byCategory[r.category].wrong += r.wrongCount || 0;
    byCategory[r.category].boxes += r.box || 1;
  }
  const due = rows.filter(r => !r.nextReviewAt || new Date(r.nextReviewAt) <= new Date()).length;
  return { rows, correct, wrong, totalAnswers, accuracy: totalAnswers ? Math.round(correct / totalAnswers * 100) : 0, due, byCategory };
}

export async function exportLocalProgress() {
  return await localDb.progress.toArray();
}

export async function importLocalProgress(entries) {
  if (!Array.isArray(entries)) throw new Error('Format invalide.');
  await localDb.progress.bulkPut(entries.filter(e => e?.questionId));
}
