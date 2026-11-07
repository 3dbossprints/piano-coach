export function getPracticeSeconds(session) {
  const explicit = Number(session?.practiceSeconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const minutes = Number(session?.minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 0;
}

export function isMeaningfulPracticeSession(session) {
  if (!session || getPracticeSeconds(session) <= 0 || session.completed !== true) return false;
  const eventCount = Array.isArray(session.events) ? session.events.length : 0;
  const noteCount = Number(session.notes) || 0;
  const progress = Number(session.learnProgressBeat) || 0;
  const hits = Array.isArray(session.keystoneResult?.hits)
    ? session.keystoneResult.hits.length
    : Number(session.keystoneResult?.hits) || 0;
  return eventCount > 0 || noteCount > 0 || progress > 0 || hits > 0;
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

export function getQualifyingPracticeDays(sessions) {
  const days = new Set();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!isMeaningfulPracticeSession(session)) continue;
    const key = localDayKey(session.lastPractisedAt || session.date);
    if (!key) continue;
    days.add(key);
  }
  return [...days].sort().reverse();
}

export function calculatePracticeStreak(sessions, now = new Date()) {
  const qualifyingDays = new Set(getQualifyingPracticeDays(sessions));
  const today = new Date(now);
  if (Number.isNaN(today.getTime())) return 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!qualifyingDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  if (!qualifyingDays.has(localDayKey(cursor))) return 0;

  let streak = 0;
  while (qualifyingDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
