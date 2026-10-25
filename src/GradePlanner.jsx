import React, { useEffect, useMemo, useState } from 'react';

const GRADES = ['Initial Grade', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8'];
const ABRSM_URL = 'https://www.abrsm.org/en-gb/piano';
const TRINITY_URL = 'https://www.trinitycollege.com/resource/?id=9079';
const TRINITY_REPERTOIRE_URL = 'https://support.trinitycollege.com/support/solutions/articles/202000097694-piano-and-other-keyboard-instruments-syllabus-and-repertoire-lists';
const DEFAULT = {
  board: 'ABRSM',
  route: 'Practical Grades',
  syllabus: '2025 & 2026',
  current: 'Grade 2',
  target: 'Grade 3',
  targetDate: '',
  weeklyHours: 5,
  manualHours: 0,
  pieces: [],
  checks: {},
  feedback: '',
  createdAt: new Date().toISOString()
};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const gradeNumber = value => value === 'Initial Grade' ? 0 : Math.max(0, Number(String(value).replace('Grade ', '')) || 0);
const clean = value => String(value || '').trim().toLocaleLowerCase();

function requirementsFor(plan) {
  const g = gradeNumber(plan.target);
  if (plan.board === 'ABRSM' && plan.route === 'Performance Grades') {
    return [
      { id: 'set-pieces', title: 'Three set pieces', detail: 'Choose three pieces from the same ABRSM syllabus; for the grade, check the syllabus lists and any list-selection rules.' },
      { id: 'own-choice', title: 'One own-choice piece', detail: 'Prepare a fourth piece of your own choice at an appropriate standard.' },
      { id: 'recording', title: 'Recorded performance', detail: 'Check the current Performance Grades guidance for camera framing, audio, submission and performance requirements.' },
      { id: 'syllabus-version', title: 'One consistent syllabus edition', detail: 'Keep all three set pieces within the same syllabus year; the own-choice piece is separate.' }
    ];
  }
  if (plan.board === 'ABRSM') {
    const items = [
      { id: 'pieces', title: 'Three set pieces: Lists A, B and C', detail: 'Select one piece from each of the three lists in your chosen syllabus. Do not mix syllabus editions.' },
      { id: 'scales', title: 'Scales and arpeggios', detail: 'Use the exact grade-specific key, hand, motion, articulation and tempo requirements in the official specification.' },
      { id: 'sight-reading', title: 'Sight-reading', detail: 'Practise unfamiliar short pieces using the current grade-specific preparation time and assessment criteria.' },
      { id: 'aural', title: 'Aural tests', detail: 'Practise the grade-specific listening, singing/playing-back, pulse/rhythm and musical-feature tasks.' }
    ];
    if (g >= 6) items.push({ id: 'entry', title: 'Higher-grade entry prerequisite', detail: 'Before booking Practical Grades 6–8, confirm you have an accepted Grade 5-or-above prerequisite under ABRSM’s current entry rules.' });
    return items;
  }
  if (plan.route === 'Trinity Digital — Repertoire-only') {
    return [
      { id: 'pieces', title: 'Four repertoire pieces', detail: 'Prepare four complete pieces from the current Trinity piano repertoire options for the selected grade.' },
      { id: 'variety', title: 'Programme contrast', detail: 'Choose a balanced programme that shows stylistic variety, fluency, accuracy, communication and musical interpretation.' },
      { id: 'own-composition', title: 'Own composition option', detail: 'Trinity permits an own composition in place of one listed piece; check the current grade rules and submission guidance.' },
      { id: 'recording', title: 'Digital submission', detail: 'Check current requirements for video, audio, framing, file submission and the order on the programme form.' }
    ];
  }
  if (plan.route === 'Trinity Digital — Technical work') {
    const piecesDetail = g >= 6
      ? 'Prepare three repertoire pieces. At Grades 6–8, choose at least one from Group A and one from Group B; check the current list for the third piece.'
      : 'Prepare three repertoire pieces from the current Trinity piano repertoire list. Check the grade-specific rules for duet and own-composition options.';
    return [
      { id: 'pieces', title: 'Three repertoire pieces', detail: piecesDetail },
      { id: 'technical', title: 'Technical work', detail: 'Use the exact grade page: scales/arpeggios or the permitted alternative set, and the required technical exercises. Do not rely on a generic scale count.' },
      { id: 'performance', title: 'Overall performance criteria', detail: 'Prepare secure pulse, rhythm, note accuracy, stylistic understanding, communication and confident presentation.' },
      { id: 'recording', title: 'Digital submission', detail: 'Check current requirements for video, audio, framing, programme order and submission.' }
    ];
  }
  if (plan.route === 'Trinity Face-to-face') {
    return [
      { id: 'pieces', title: 'Three repertoire pieces', detail: g >= 6 ? 'Choose three current-listed pieces, including at least one from each required group (A and B) at Grades 6–8.' : 'Choose three pieces from the current Trinity Piano repertoire list for this grade.' },
      { id: 'technical', title: 'Technical work', detail: 'Prepare the grade-specific scales/arpeggios or permitted technical exercises exactly as stated in the current Trinity syllabus.' },
      { id: 'supporting', title: 'Two supporting tests', detail: g >= 6 ? 'Sight-reading is compulsory at Grades 6–8; choose either aural or improvisation as the second supporting test.' : 'At Initial–Grade 5, choose any two of sight-reading, aural, improvisation or musical knowledge, as allowed for this grade.' }
    ];
  }
  return [
    { id: 'pieces', title: 'Three repertoire pieces', detail: g >= 6 ? 'Select three current-listed pieces, including at least one from each required group (A and B) at Grades 6–8.' : 'Choose three pieces from the current Trinity Piano repertoire list for this grade.' },
    { id: 'technical', title: 'Technical work', detail: 'Use the exact grade-specific technical-work options in the current Trinity digital syllabus.' },
    { id: 'performance', title: 'Overall Performance criteria', detail: 'The Digital Technical Work pathway also assesses overall performance: fluency, accuracy, pulse, style and musical communication across the complete programme.' }
  ];
}

function repertoireCategories(plan) {
  const g = gradeNumber(plan.target);
  if (plan.board === 'ABRSM') {
    if (plan.route === 'Performance Grades') return [
      { value: 'List A', label: 'List A' }, { value: 'List B', label: 'List B' }, { value: 'List C', label: 'List C' }, { value: 'Own choice', label: 'Own-choice piece' }
    ];
    return [{ value: 'List A', label: 'List A' }, { value: 'List B', label: 'List B' }, { value: 'List C', label: 'List C' }];
  }
  if (g >= 6) return [{ value: 'Group A', label: 'Group A' }, { value: 'Group B', label: 'Group B' }, { value: 'Other', label: 'Other / third choice' }, ...(plan.route === 'Trinity Digital — Repertoire-only' ? [{ value: 'Own choice', label: 'Own composition / other' }] : [])];
  return [{ value: 'Repertoire list', label: 'Repertoire list' }, { value: 'Own choice', label: 'Own composition / other' }];
}

function loadPlan() {
  try {
    const stored = JSON.parse(localStorage.getItem('pc_grade_plan') || '{}');
    return { ...DEFAULT, ...stored, pieces: Array.isArray(stored.pieces) ? stored.pieces : [], checks: stored.checks && typeof stored.checks === 'object' ? stored.checks : {} };
  } catch {
    return { ...DEFAULT };
  }
}

export default function GradePlanner({ onPracticePiece = () => {}, sessions = [] }) {
  const [plan, setPlan] = useState(loadPlan);
  const [pieceTitle, setPieceTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [category, setCategory] = useState('List A');
  const [scoreFileError, setScoreFileError] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [mockPiece, setMockPiece] = useState('');
  const [mockScore, setMockScore] = useState('75');
  const [mockNotes, setMockNotes] = useState('');

  useEffect(() => {
    try { localStorage.setItem('pc_grade_plan', JSON.stringify(plan)); } catch { /* Keep the current session usable if browser storage is full. */ }
  }, [plan]);

  const update = (key, value) => setPlan(previous => ({ ...previous, [key]: value }));
  const requirements = useMemo(() => requirementsFor(plan), [plan.board, plan.route, plan.target]);
  const categories = useMemo(() => repertoireCategories(plan), [plan.board, plan.route, plan.target]);
  const piecesTarget = plan.board === 'ABRSM' && plan.route === 'Performance Grades' ? 4 : (plan.board === 'Trinity' && plan.route === 'Trinity Digital — Repertoire-only' ? 4 : 3);
  const deadlineDays = plan.targetDate ? Math.max(0, Math.ceil((new Date(plan.targetDate + 'T23:59:59').getTime() - Date.now()) / 86400000)) : null;
  const weeksRemaining = deadlineDays === null ? 12 : Math.max(1, Math.ceil(deadlineDays / 7));
  const expectedHours = Math.max(0, number(plan.weeklyHours) * weeksRemaining);
  const linkedSessions = sessions.filter(session => plan.pieces.some(piece => clean(piece.title) === clean(session.song)));
  const linkedHours = linkedSessions.reduce((sum, session) => sum + Math.max(0, number(session.practiceSeconds ?? (number(session.minutes) * 60))) / 3600, 0);
  const manualHours = Math.max(0, number(plan.manualHours));
  const totalHours = linkedHours + manualHours;
  const progress = expectedHours > 0 ? Math.min(100, Math.round(totalHours / expectedHours * 100)) : 0;
  const mocks = Array.isArray(plan.mockScores) ? plan.mockScores : [];
  const averageMock = mocks.length ? Math.round(mocks.reduce((sum, item) => sum + number(item.score), 0) / mocks.length) : null;
  const requirementChecks = requirements.filter(item => plan.checks[item.id]).length;
  const readyScore = Math.round((requirementChecks / Math.max(1, requirements.length)) * 50 + (plan.pieces.length >= piecesTarget ? 25 : plan.pieces.length / piecesTarget * 25) + Math.min(25, totalHours / Math.max(1, expectedHours) * 25));
  const hoursByPiece = piece => sessions.filter(session => clean(piece.title) === clean(session.song)).reduce((sum, session) => sum + Math.max(0, number(session.practiceSeconds ?? (number(session.minutes) * 60))) / 3600, 0);

  function addPiece() {
    const title = pieceTitle.trim();
    if (!title) return;
    if (plan.pieces.some(piece => clean(piece.title) === clean(title))) {
      alert('That piece is already in this grade plan.');
      return;
    }
    setPlan(previous => ({ ...previous, pieces: [...previous.pieces, { id: 'piece-' + Date.now(), title, composer: composer.trim(), category, scoreData: '', scoreName: '', scoreType: '', addedAt: new Date().toISOString() }] }));
    setPieceTitle('');
    setComposer('');
    setScoreFileError('');
  }

  function removePiece(id) {
    setPlan(previous => ({ ...previous, pieces: previous.pieces.filter(piece => piece.id !== id) }));
  }

  function attachScore(id, file) {
    setScoreFileError('');
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setScoreFileError('Please choose a PDF, PNG, JPEG or WebP score.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setScoreFileError('For reliability, grade-plan attachments are limited to 8 MB. Larger files can be imported in Sheet Music.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setScoreFileError('The score could not be read. Please try another file.');
    reader.onload = () => setPlan(previous => ({
      ...previous,
      pieces: previous.pieces.map(piece => piece.id === id ? { ...piece, scoreData: String(reader.result || ''), scoreName: file.name, scoreType: file.type || 'application/pdf' } : piece)
    }));
    reader.readAsDataURL(file);
  }

  function addMock() {
    const score = Math.min(100, Math.max(0, number(mockScore)));
    setPlan(previous => ({ ...previous, mockScores: [...(previous.mockScores || []), { id: 'mock-' + Date.now(), piece: mockPiece || 'Full mock exam', score, notes: mockNotes.trim(), date: new Date().toISOString() }] }));
    setMockNotes('');
  }

  const officialLinks = plan.board === 'ABRSM'
    ? [{ label: 'Official ABRSM piano syllabus and repertoire', url: ABRSM_URL }, { label: 'ABRSM piano exam guidance', url: 'https://www.abrsm.org/en-gb/exam-support' }]
    : [{ label: 'Official Trinity piano syllabus (PDF)', url: TRINITY_URL }, { label: 'Trinity syllabus and repertoire page', url: TRINITY_REPERTOIRE_URL }];

  return (
    <div className="grade-planner">
      <section className="panel gp-hero">
        <div>
          <div className="eyebrow">EXAM PREPARATION</div>
          <h2>Build a grade plan that matches your exam</h2>
          <p className="muted">Choose your board, route and syllabus. The checklist changes to match the selected assessment; verify the full grade-specific technical requirements in the official source before your exam.</p>
          <div className="gp-source-links">{officialLinks.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</div>
        </div>
        <div className="gp-ring" aria-label={'Readiness checklist ' + readyScore + ' percent'}><strong>{readyScore}%</strong><span>plan readiness</span></div>
      </section>

      <section className="panel">
        <h3>1. Set your exam goal</h3>
        <div className="gp-grid">
          <label>Exam board
            <select value={plan.board} onChange={event => {
              const board = event.target.value;
              const route = board === 'ABRSM' ? 'Practical Grades' : 'Trinity Digital — Technical work';
              update('board', board); update('route', route); update('checks', {}); setCategory('List A');
            }}>
              <option value="ABRSM">ABRSM</option><option value="Trinity">Trinity College London</option>
            </select>
          </label>
          <label>Exam format
            <select value={plan.route} onChange={event => { update('route', event.target.value); update('checks', {}); }}>
              {plan.board === 'ABRSM' ? <>
                <option>Practical Grades</option><option>Performance Grades</option>
              </> : <>
                <option>Trinity Digital — Technical work</option><option>Trinity Digital — Repertoire-only</option><option>Trinity Face-to-face</option>
              </>}
            </select>
          </label>
          <label>Current level
            <select value={plan.current} onChange={event => update('current', event.target.value)}>{GRADES.map(grade => <option key={grade}>{grade}</option>)}</select>
          </label>
          <label>Target grade
            <select value={plan.target} onChange={event => { update('target', event.target.value); update('checks', {}); }}>{GRADES.map(grade => <option key={grade}>{grade}</option>)}</select>
          </label>
          <label>Target exam date
            <input type="date" min={new Date().toISOString().slice(0, 10)} value={plan.targetDate} onChange={event => update('targetDate', event.target.value)} />
          </label>
          <label>Practice target per week (hours)
            <input type="number" min="0.5" max="40" step="0.5" value={plan.weeklyHours} onChange={event => update('weeklyHours', Math.min(40, Math.max(0.5, number(event.target.value))))} />
          </label>
        </div>
        <p className="muted"> {deadlineDays === null ? 'Set a target date to calculate the remaining practice window.' : deadlineDays === 0 ? 'Target date is today.' : weeksRemaining + ' week' + (weeksRemaining === 1 ? '' : 's') + ' remaining.'} This is a personal practice target, not an official number of hours required by the board.</p>
        {plan.board === 'ABRSM' && plan.route === 'Practical Grades' && plan.syllabus === '2025 & 2026' && <p className="gp-notice">ABRSM’s 2025 & 2026 piano syllabus remains usable through 31 December 2027. The 2027 & 2028 repertoire is valid from 1 January 2027; keep all three set pieces in the same syllabus edition.</p>}
        {plan.board === 'ABRSM' && <label className="gp-syllabus-select">ABRSM repertoire syllabus
          <select value={plan.syllabus} onChange={event => update('syllabus', event.target.value)}><option>2025 &amp; 2026</option><option>2027 &amp; 2028</option></select>
        </label>}
        {plan.board === 'ABRSM' && gradeNumber(plan.target) >= 6 && <p className="gp-notice">ABRSM Practical and Performance Grades 6–8 have an entry prerequisite. Confirm the accepted Grade 5-or-above qualification with ABRSM before booking.</p>}
      </section>

      <section className="panel">
        <h3>2. Official requirements checklist</h3>
        <p className="muted">Check these off as you prepare. The board’s full syllabus is the authority for keys, rhythms, exercises, scoring and allowed alternatives.</p>
        <div className="gp-requirements-list">
          {requirements.map(item => <label className={'gp-requirement ' + (plan.checks[item.id] ? 'is-checked' : '')} key={item.id}>
            <input type="checkbox" checked={!!plan.checks[item.id]} onChange={event => update('checks', { ...plan.checks, [item.id]: event.target.checked })} />
            <span><strong>{item.title}</strong><small>{item.detail}</small></span>
          </label>)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><h3>3. Your chosen repertoire</h3><p className="muted">Add actual pieces from the official list; this planner intentionally does not invent repertoire titles or treat stylistic suggestions as syllabus-approved pieces.</p></div>
          <span className="tag">{plan.pieces.length} / {piecesTarget} pieces</span>
        </div>
        <div className="gp-grid">
          <label>Piece title<input value={pieceTitle} onChange={event => setPieceTitle(event.target.value)} placeholder="Exact title from the repertoire list" /></label>
          <label>Composer / arranger<input value={composer} onChange={event => setComposer(event.target.value)} placeholder="Composer or arranger" /></label>
          <label>List / category
            <select value={categories.some(option => option.value === category) ? category : categories[0].value} onChange={event => setCategory(event.target.value)}>{categories.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          </label>
          <div className="gp-add-piece"><button className="btn btn-dark" type="button" disabled={!pieceTitle.trim()} onClick={addPiece}>＋ Add selected piece</button></div>
        </div>
        {plan.pieces.length === 0 ? <div className="empty-state"><strong>No repertoire added yet</strong><p>Use the official repertoire link above to choose eligible pieces, then add their exact titles here.</p></div> : <div className="gp-piece-list">
          {plan.pieces.map(piece => <article className="gp-piece-row" key={piece.id}>
            <div className="gp-piece-main"><div className="eyebrow">{piece.category}</div><strong>{piece.title}</strong><small>{piece.composer || 'Composer not entered'}</small>
              <div className="gp-piece-stats"><span>{hoursByPiece(piece).toFixed(1)} h practised</span><span>{sessions.filter(session => clean(piece.title) === clean(session.song)).length} linked sessions</span>{piece.scoreName && <span>Score attached: {piece.scoreName}</span>}</div>
              <label className="gp-attach-score">Attach score (PDF / PNG / JPEG / WebP)<input type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp" onChange={event => { attachScore(piece.id, event.target.files && event.target.files[0]); event.target.value = ''; }} /></label>
            </div>
            <div className="gp-piece-actions"><button className="btn btn-dark" onClick={() => onPracticePiece(piece)}>Practise this piece</button><button className="btn" onClick={() => removePiece(piece.id)}>Remove</button></div>
          </article>)}
        </div>}
        {scoreFileError && <p className="gp-error" role="alert">{scoreFileError}</p>}
        {plan.board === 'Trinity' && gradeNumber(plan.target) >= 6 && <p className="gp-notice">For Trinity Grades 6–8, check the Group A / Group B selection rule for your chosen exam format. Verify each piece’s current category on Trinity’s list.</p>}
      </section>

      <section className="panel">
        <h3>4. Practice linked to your grade plan</h3>
        <p className="muted">Practice sessions are matched to a chosen piece by its exact title. Use “Practise this piece” above to carry the title into Practice; saved sessions then appear in this plan automatically.</p>
        <div className="gp-practice-summary">
          <div><strong>{linkedSessions.length}</strong><span>sessions linked to repertoire</span></div>
          <div><strong>{linkedHours.toFixed(1)} h</strong><span>time from linked sessions</span></div>
          <div><strong>{manualHours.toFixed(1)} h</strong><span>manual hours logged</span></div>
        </div>
        <div className="gp-progress-track"><div style={{ width: progress + '%' }} /></div>
        <div className="gp-practice-meta"><span>{totalHours.toFixed(1)} hours logged</span><span>{expectedHours.toFixed(1)} hour target for remaining window</span></div>
        <div className="gp-manual-hours"><label>Add independent practice hours<input type="number" min="0.25" max="100" step="0.25" value={manualInput} onChange={event => setManualInput(event.target.value)} placeholder="e.g. 1.5" /></label><button className="btn btn-dark" disabled={!manualInput || number(manualInput) <= 0} onClick={() => { update('manualHours', manualHours + number(manualInput)); setManualInput(''); }}>Log hours</button></div>
        <p className="muted small">Hours are a planning aid only. Exam readiness also depends on secure performance and the official assessment criteria.</p>
        {linkedSessions.length > 0 && <div className="gp-session-list">{linkedSessions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).map(session => <div key={session.id} className="gp-session-row"><span><strong>{session.song}</strong><small>{new Date(session.date).toLocaleDateString()}</small></span><span>{(Math.max(0, number(session.practiceSeconds ?? (number(session.minutes) * 60))) / 3600).toFixed(2)} h</span></div>)}</div>}
      </section>

      <section className="panel">
        <h3>5. Mock performance log</h3>
        <p className="muted">Store your own feedback or teacher marks here. These are practice scores, not an official exam result.</p>
        <div className="gp-grid">
          <label>Piece / test<select value={mockPiece} onChange={event => setMockPiece(event.target.value)}><option value="">Full mock exam</option>{plan.pieces.map(piece => <option key={piece.id} value={piece.title}>{piece.title}</option>)}</select></label>
          <label>Practice score (0–100)<input type="number" min="0" max="100" value={mockScore} onChange={event => setMockScore(String(Math.min(100, Math.max(0, number(event.target.value)))))} /></label>
        </div>
        <label className="gp-notes">Feedback<textarea rows="2" value={mockNotes} onChange={event => setMockNotes(event.target.value)} placeholder="Accuracy, rhythm, memory, style, expression, nerves…" /></label>
        <button className="btn btn-dark" onClick={addMock}>Save mock score</button>
        {mocks.length > 0 && <div className="gp-mock-summary"><div><strong>{averageMock}/100</strong><span>Average logged score</span></div><div><strong>{mocks.length}</strong><span>Mocks logged</span></div><div><strong>{number(mocks[mocks.length - 1].score)}/100</strong><span>Latest score</span></div></div>}
        {mocks.slice().reverse().map(item => <div className="gp-session-row" key={item.id}><span><strong>{item.piece} · {item.score}/100</strong><small>{new Date(item.date).toLocaleDateString()} {item.notes ? '· ' + item.notes : ''}</small></span><button className="btn" onClick={() => update('mockScores', mocks.filter(old => old.id !== item.id))}>Remove</button></div>)}
      </section>
    </div>
  );
}
