import React, { useEffect, useMemo, useState } from 'react';

const GRADES = ['Initial', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8'];
const OLD_GENERIC_PIECES = new Set([
  'Classical sonatina movement', 'Baroque dance or invention', 'Romantic lyrical character piece',
  'Contemporary rhythmic study', 'Film or game music arrangement', 'Jazz-inspired syncopated piece',
  'Classical sonata movement', 'Impressionist colour study', 'Modern virtuoso character piece',
  'Baroque prelude and fugue'
]);
const INITIAL = {
  version: 2, board: 'ABRSM', pathway: 'abrsm-practical', syllabus: '2025-2026',
  current: 'Grade 2', target: 'Grade 3', date: '', weeklyHours: 5, manualHours: 0,
  pieces: [], checks: {}, mockScores: [], createdAt: new Date().toISOString()
};
const ABRSM_URL = 'https://www.abrsm.org/en-gb/piano';
const TRINITY_URL = 'https://www.trinitycollege.com/qualifications/music/grade-exams/piano';
const TRINITY_FORMAT_URL = 'https://www.trinitycollege.com/qualifications/music/grade-exams/about';
const TRINITY_WORK_URL = 'https://support.trinitycollege.com/support/solutions/articles/202000096563-choosing-technical-work-supporting-tests-session-skills';
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round1 = value => Math.round((num(value) + Number.EPSILON) * 10) / 10;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const normaliseTitle = value => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const localDate = value => {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
};
const dayDiff = (later, earlier) => Math.ceil((later.getTime() - earlier.getTime()) / 86400000);

function pathwayOptions(board) {
  return board === 'ABRSM'
    ? [{ value: 'abrsm-practical', label: 'Practical Grade' }, { value: 'abrsm-performance', label: 'Performance Grade' }]
    : [
        { value: 'trinity-face', label: 'Face-to-face' },
        { value: 'trinity-digital-technical', label: 'Digital · Technical Work' },
        { value: 'trinity-digital-repertoire', label: 'Digital · Repertoire-only' }
      ];
}

function examRequirements(board, pathway, grade, syllabus) {
  const items = [];
  let pieceCount = 3;
  let pieceDetail = '';
  let officialUrl = board === 'ABRSM' ? ABRSM_URL : TRINITY_URL;
  let officialLabel = board === 'ABRSM' ? 'ABRSM piano specifications and repertoire' : 'Trinity piano syllabus and repertoire lists';
  let examSummary = '';

  if (board === 'ABRSM' && pathway === 'abrsm-practical') {
    pieceCount = 3;
    pieceDetail = 'Choose all three pieces from the same ABRSM Piano syllabus version and follow its list-selection rules.';
    examSummary = 'Three repertoire pieces, scales and arpeggios, sight-reading, and aural tests.';
    items.push(
      { id: 'technical', title: 'Scales and arpeggios', detail: 'Practise the exact grade-specific patterns, keys and articulation in the selected official specification.' },
      { id: 'sight-reading', title: 'Sight-reading', detail: 'Practise unseen extracts at the level and in the format specified for this grade.' },
      { id: 'aural', title: 'Aural tests', detail: 'Practise the listening skills and question types listed for this grade.' }
    );
  } else if (board === 'ABRSM' && pathway === 'abrsm-performance') {
    pieceCount = 4;
    pieceDetail = 'Prepare three set pieces from the selected ABRSM Piano syllabus and one own-choice piece; the own-choice piece follows separate rules.';
    examSummary = 'Four pieces: three syllabus pieces plus one own-choice piece. Supporting tests are not part of the Performance Grade.';
    items.push({ id: 'programme', title: 'Performance programme', detail: 'Plan contrast, order, continuity and the overall shape of the four-piece performance.' });
    items.push({ id: 'run-through', title: 'Complete performance run-through', detail: 'Record full run-throughs and review continuity, communication, accuracy and interpretation.' });
  } else if (board === 'Trinity' && pathway === 'trinity-face') {
    pieceCount = 3;
    pieceDetail = 'Choose three pieces from the current Trinity Classical piano repertoire lists, following the grade-specific selection rules.';
    examSummary = 'Three repertoire pieces, technical work, and two supporting tests selected from the options allowed for the grade.';
    officialUrl = TRINITY_FORMAT_URL;
    items.push(
      { id: 'technical', title: 'Technical work', detail: 'Prepare the grade-specific scales/arpeggios or permitted technical option, plus the required exercises, exactly as set out in the current piano syllabus.' },
      { id: 'supporting-tests', title: 'Two supporting tests', detail: 'Choose two tests permitted for this grade (for example sight-reading, aural, improvisation or musical knowledge where offered).' },
      { id: 'mock', title: 'Mock face-to-face exam', detail: 'Practise presenting the full programme and responding to examiner-selected technical work and supporting tests.' }
    );
  } else if (board === 'Trinity' && pathway === 'trinity-digital-technical') {
    pieceCount = 3;
    pieceDetail = 'Choose three pieces from the current Trinity Classical piano repertoire lists and follow the grade-specific selection rules.';
    examSummary = 'Three repertoire pieces, the Digital Technical Work requirements, and assessment of overall performance.';
    officialUrl = TRINITY_FORMAT_URL;
    items.push(
      { id: 'technical', title: 'Digital technical work', detail: 'Prepare the syllabus-prescribed Set A or Set B technical material and the required exercises for this grade.' },
      { id: 'overall-performance', title: 'Overall performance', detail: 'Record a full run-through and review focus, continuity, communication and awareness throughout the performance.' }
    );
  } else {
    pieceCount = 4;
    pieceDetail = 'Choose four pieces from the current Trinity Classical piano repertoire lists, following the grade-specific selection rules.';
    examSummary = 'Four repertoire pieces. The Repertoire-only pathway does not include the Technical Work pathway or supporting tests.';
    officialUrl = TRINITY_FORMAT_URL;
    items.push(
      { id: 'programme', title: 'Four-piece programme', detail: 'Plan a varied, coherent programme and check every choice against the current grade-specific repertoire rules.' },
      { id: 'run-through', title: 'Complete performance run-through', detail: 'Record the whole programme and review accuracy, continuity, expression and transitions.' }
    );
  }

  if (board === 'ABRSM' && ['Grade 6', 'Grade 7', 'Grade 8'].includes(grade)) {
    items.push({ id: 'entry-requirement', title: 'Confirm Grade 5 prerequisite', detail: 'Before booking Grades 6–8, check the accepted Grade 5 (or higher) theory/musicianship qualification requirements on the official ABRSM page.' });
  }

  const syllabusLabel = board === 'ABRSM'
    ? (syllabus === '2027-2028' ? 'ABRSM Piano 2027 & 2028' : 'ABRSM Piano 2025 & 2026')
    : 'Trinity Piano syllabus (2023) · repertoire list updated January 2025';
  return { items, pieceCount, pieceDetail, examSummary, officialUrl, officialLabel, syllabusLabel };
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(num(seconds)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) return hours + 'h ' + minutes + 'm';
  return minutes + ' min';
}

export default function GradePlanner({ onPracticePiece = () => {}, sessions = [], libraryFiles = [], storageEnabled = true }) {
  const [p, setP] = useState(() => {
    let stored = {};
    try {
      if (storageEnabled) stored = JSON.parse(localStorage.getItem('pc_grade_plan') || '{}');
    } catch {}
    const pieces = Array.isArray(stored.pieces) ? stored.pieces.filter(x => !OLD_GENERIC_PIECES.has(x.title)) : [];
    const current = GRADES.includes(stored.current) ? stored.current : INITIAL.current;
    const target = GRADES.includes(stored.target) && GRADES.indexOf(stored.target) > GRADES.indexOf(current)
      ? stored.target : (GRADES[Math.min(GRADES.length - 1, GRADES.indexOf(current) + 1)]);
    return {
      ...INITIAL, ...stored, current, target, pieces,
      board: stored.board === 'Trinity' ? 'Trinity' : 'ABRSM',
      pathway: stored.pathway || 'abrsm-practical',
      syllabus: stored.syllabus || '2025-2026',
      manualHours: num(stored.manualHours ?? Math.max(0, num(stored.actualHours) - (Array.isArray(sessions) ? sessions.reduce((sum, session) => sum + Math.max(0, num(session.practiceSeconds ?? num(session.minutes) * 60)) / 3600, 0) : 0))),
      checks: stored.checks && typeof stored.checks === 'object' ? stored.checks : {},
      mockScores: Array.isArray(stored.mockScores) ? stored.mockScores : []
    };
  });
  const [pieceName, setPieceName] = useState('');
  const [pieceStyle, setPieceStyle] = useState('Classical');
  const [pieceSource, setPieceSource] = useState('');
  const [hoursInput, setHoursInput] = useState('');
  const [mockName, setMockName] = useState('');
  const [mockScore, setMockScore] = useState('75');
  const [mockNotes, setMockNotes] = useState('');

  useEffect(() => {
    if (!storageEnabled) return;
    try { localStorage.setItem('pc_grade_plan', JSON.stringify(p)); } catch {}
  }, [p, storageEnabled]);

  const set = (key, value) => setP(old => ({ ...old, [key]: value }));
  const pathways = pathwayOptions(p.board);
  const selectedPathway = pathways.some(x => x.value === p.pathway) ? p.pathway : pathways[0].value;
  const effectivePathway = selectedPathway;
  const syllabusOptions = p.board === 'ABRSM'
    ? [{ value: '2025-2026', label: '2025 & 2026 syllabus' }, { value: '2027-2028', label: '2027 & 2028 syllabus' }]
    : [{ value: 'trinity-current', label: 'Current syllabus / repertoire list' }];
  const effectiveSyllabus = syllabusOptions.some(x => x.value === p.syllabus) ? p.syllabus : syllabusOptions[0].value;
  const requirements = useMemo(() => examRequirements(p.board, effectivePathway, p.target, effectiveSyllabus), [p.board, effectivePathway, p.target, effectiveSyllabus]);
  const today = new Date();
  const targetDate = localDate(p.date);
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const planStart = localDate(p.planStartDate) || localDate(new Date().toISOString().slice(0, 10));
  const planDurationDays = targetDate ? Math.max(1, dayDiff(targetDate, planStart)) : 84;
  const daysRemaining = targetDate ? Math.max(0, dayDiff(targetDate, todayNoon)) : 84;
  const weeksRemaining = Math.max(1, Math.ceil(daysRemaining / 7));
  const totalPlanWeeks = Math.max(1, Math.ceil(planDurationDays / 7));
  const monthsRemaining = Math.max(1, Math.min(12, Math.ceil(totalPlanWeeks / 4.345)));
  const weeklyHours = clamp(num(p.weeklyHours) || 5, 0.5, 40);
  const targetHours = weeklyHours * totalPlanWeeks;
  const sessionSeconds = sessions.reduce((sum, session) => {
    const value = session.practiceSeconds != null ? num(session.practiceSeconds) : num(session.minutes) * 60;
    return sum + Math.max(0, value);
  }, 0);
  const sessionHours = sessionSeconds / 3600;
  const manualHours = Math.max(0, num(p.manualHours));
  const actualHours = round1(sessionHours + manualHours);
  const elapsedDays = clamp(dayDiff(todayNoon, planStart), 0, planDurationDays);
  const elapsedFraction = targetDate ? clamp(elapsedDays / planDurationDays, 0, 1) : 0;
  const expectedHours = round1(targetHours * elapsedFraction);
  const hoursProgress = clamp(Math.round(actualHours / Math.max(1, targetHours) * 100), 0, 100);
  const checkKey = id => [p.board, effectivePathway, effectiveSyllabus, p.target, id].join(':');
  const checklistDone = requirements.items.filter(item => !!p.checks[checkKey(item.id)]).length;
  const checklistTotal = requirements.items.length + 1;
  const repertoireDone = p.pieces.length >= requirements.pieceCount;
  const requirementsProgress = Math.round((checklistDone + (repertoireDone ? 1 : 0)) / Math.max(1, checklistTotal) * 100);
  const overallProgress = Math.round(requirementsProgress * 0.7 + hoursProgress * 0.3);
  const targetSyllabusUnavailable = p.board === 'ABRSM' && p.date && p.date < '2027-01-01' && effectiveSyllabus === '2027-2028';
  const targetSyllabusOverlap = p.board === 'ABRSM' && p.date && p.date > '2027-12-31' && effectiveSyllabus === '2025-2026';
  const savedScores = libraryFiles.filter(file => file && (file.kind === 'score' || file.kind === 'practice-score' || /\.(musiccoach|musicxml|xml|mid|midi|pdf)$/i.test(file.name || '')));
  const selectedSavedScore = savedScores.find(file => String(file.id) === pieceSource);

  const findPieceSessions = piece => sessions.filter(session => normaliseTitle(session.song) === normaliseTitle(piece.title));
  const addPiece = () => {
    const title = pieceName.trim();
    if (!title) return;
    if (p.pieces.some(piece => normaliseTitle(piece.title) === normaliseTitle(title))) return;
    set('pieces', [...p.pieces, { id: 'piece-' + Date.now(), title, style: pieceStyle, minutes: 25, addedAt: new Date().toISOString() }]);
    setPieceName('');
  };
  const addSavedScore = () => {
    if (!selectedSavedScore) return;
    if (p.pieces.some(piece => normaliseTitle(piece.title) === normaliseTitle(selectedSavedScore.name.replace(/\.(musiccoach|musicxml|xml|mid|midi|pdf)$/i, '')))) return;
    const title = selectedSavedScore.name.replace(/\.(musiccoach|musicxml|xml|mid|midi|pdf)$/i, '');
    set('pieces', [...p.pieces, {
      id: 'library-' + selectedSavedScore.id, title, style: 'From Library', minutes: 25,
      scoreData: selectedSavedScore.data, scoreName: selectedSavedScore.name, scoreType: selectedSavedScore.type,
      scoreId: selectedSavedScore.id, addedAt: new Date().toISOString()
    }]);
    setPieceSource('');
  };
  const removePiece = id => set('pieces', p.pieces.filter(piece => piece.id !== id));
  const toggleCheck = id => {
    const key = checkKey(id);
    set('checks', { ...p.checks, [key]: !p.checks[key] });
  };
  const addManualHours = () => {
    if (!hoursInput || num(hoursInput) <= 0) return;
    set('manualHours', round1(manualHours + num(hoursInput)));
    setHoursInput('');
  };
  const saveMock = () => {
    if (mockScore === '' || !Number.isFinite(Number(mockScore))) return;
    set('mockScores', [...p.mockScores, {
      id: Date.now(), piece: mockName.trim() || 'Full mock exam',
      score: clamp(num(mockScore), 0, 100), notes: mockNotes.trim(), date: new Date().toISOString()
    }]);
    setMockName('');
    setMockNotes('');
  };
  const avgScore = p.mockScores.length ? round1(p.mockScores.reduce((sum, mock) => sum + num(mock.score), 0) / p.mockScores.length) : null;
  const linkForPiece = title => 'https://www.google.com/search?q=' + encodeURIComponent(title + ' piano sheet music ' + p.board + ' ' + p.target);
  const timeline = Array.from({ length: monthsRemaining }, (_, index) => ({
    month: index + 1,
    hours: round1(targetHours / monthsRemaining),
    goal: index === 0 ? 'Choose syllabus-compliant repertoire and record a baseline' :
      index === monthsRemaining - 1 ? 'Full programme run-through and review' : 'Build accuracy, fluency and secure musical interpretation'
  }));

  return <div className="grade-planner">
    <section className="panel gp-hero">
      <div>
        <div className="eyebrow">GRADE JOURNEY</div>
        <h2>Plan your next level</h2>
        <p className="muted">A practice-linked plan based on your selected exam board and pathway. Repertoire and technical details must be checked against the official grade-specific syllabus.</p>
        <div className="gp-official-links">
          <a href={requirements.officialUrl} target="_blank" rel="noreferrer">{requirements.officialLabel} ↗</a>
          {p.board === 'Trinity' && <a href={TRINITY_WORK_URL} target="_blank" rel="noreferrer">Trinity technical work and supporting tests ↗</a>}
        </div>
      </div>
      <div className="gp-ring"><strong>{overallProgress}%</strong><span>plan progress</span></div>
    </section>

    <section className="panel">
      <h3>1. Exam goal</h3>
      <div className="gp-grid">
        <label>Exam board
          <select value={p.board} onChange={event => {
            const board = event.target.value;
            setP(old => ({ ...old, board, pathway: board === 'ABRSM' ? 'abrsm-practical' : 'trinity-face', syllabus: board === 'ABRSM' ? '2025-2026' : 'trinity-current' }));
          }}><option value="ABRSM">ABRSM</option><option value="Trinity">Trinity College London</option></select>
        </label>
        <label>Exam pathway
          <select value={effectivePathway} onChange={event => set('pathway', event.target.value)}>
            {pathways.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Current grade
          <select value={p.current} onChange={event => {
            const current = event.target.value;
            const currentIndex = GRADES.indexOf(current);
            const nextTarget = GRADES.indexOf(p.target) > currentIndex ? p.target : GRADES[Math.min(GRADES.length - 1, currentIndex + 1)];
            setP(old => ({ ...old, current, target: nextTarget }));
          }}>{GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>
        </label>
        <label>Target grade
          <select value={p.target} onChange={event => set('target', event.target.value)}>
            {GRADES.filter(grade => GRADES.indexOf(grade) > GRADES.indexOf(p.current)).concat(p.current === 'Grade 8' ? ['Grade 8'] : []).map(grade => <option key={grade} value={grade}>{grade}</option>)}
          </select>
        </label>
        {p.board === 'ABRSM' && <label>Syllabus version
          <select value={effectiveSyllabus} onChange={event => set('syllabus', event.target.value)}>
            {syllabusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
        <label>Target exam date
          <input type="date" min={new Date().toISOString().slice(0, 10)} value={p.date} onChange={event => setP(old => ({ ...old, date: event.target.value, planStartDate: new Date().toISOString().slice(0, 10) }))} />
        </label>
        <label>Practice target per week (hours)
          <input type="number" min="0.5" max="40" step="0.5" value={p.weeklyHours} onChange={event => set('weeklyHours', clamp(num(event.target.value) || 0.5, 0.5, 40))} />
        </label>
      </div>
      <div className="gp-notice"><strong>{requirements.syllabusLabel}</strong><p>{requirements.examSummary}</p><p>{p.date ? daysRemaining + ' days · ' + weeksRemaining + ' weeks remaining.' : 'No date set: the plan uses a 12-week planning window until you choose an exam date.'} Suggested practice target: <strong>{weeklyHours} h/week</strong>.</p></div>
      {targetSyllabusUnavailable && <p className="gp-warning">The ABRSM 2027 &amp; 2028 repertoire can be used from 1 January 2027. For an exam before that date, select the 2025 &amp; 2026 syllabus.</p>}
      {targetSyllabusOverlap && <p className="gp-warning">The ABRSM 2025 &amp; 2026 syllabus is valid through 31 December 2027. For a later exam, select the 2027 &amp; 2028 syllabus and keep all set pieces within that syllabus version.</p>}
      {p.board === 'ABRSM' && p.target === 'Grade 6' || p.board === 'ABRSM' && p.target === 'Grade 7' || p.board === 'ABRSM' && p.target === 'Grade 8'
        ? <p className="muted small">ABRSM Grades 6–8 have a prior-qualification requirement. Check the accepted qualifications and current booking rules on the official ABRSM site linked above.</p> : null}
    </section>

    <section className="panel">
      <h3>2. Official exam components</h3>
      <div className="gp-requirements">
        <div><strong>{p.pieces.length}/{requirements.pieceCount} pieces added</strong><span>{requirements.pieceDetail}</span></div>
        {requirements.items.map(item => <div key={item.id} className={p.checks[checkKey(item.id)] ? 'gp-requirement-done' : ''}>
          <strong>{p.checks[checkKey(item.id)] ? 'Completed · ' : ''}{item.title}</strong><span>{item.detail}</span>
          <label className="gp-check"><input type="checkbox" checked={!!p.checks[checkKey(item.id)]} onChange={() => toggleCheck(item.id)} /> Mark ready</label>
        </div>)}
      </div>
      <p className="muted small">This checklist reflects the broad exam format for the chosen pathway. It does not replace the grade-specific PDF: exact keys, rhythms, exercises, lists, choices and eligibility must be verified in the current official syllabus.</p>
    </section>

    <section className="panel">
      <h3>3. Your repertoire</h3>
      <p className="muted">There are no invented “grade-appropriate” pieces here. Add the real title you have selected from the official list, or bring in a score saved in your Library. Piano Coach does not automatically certify that a title is on the exam board's list.</p>
      <div className="gp-custom">
        <input value={pieceName} onChange={event => setPieceName(event.target.value)} placeholder="Exact piece title and composer" aria-label="Exact piece title and composer" />
        <select value={pieceStyle} onChange={event => setPieceStyle(event.target.value)} aria-label="Piece style">
          {['Classical','Baroque','Romantic','Impressionist','Contemporary','Jazz','Film & game','Other'].map(style => <option key={style} value={style}>{style}</option>)}
        </select>
        <button className="btn btn-dark" onClick={addPiece} disabled={!pieceName.trim()}>Add piece</button>
      </div>
      <div className="gp-custom">
        <select value={pieceSource} onChange={event => setPieceSource(event.target.value)} aria-label="Add a saved Library score">
          <option value="">Add a saved score from Library…</option>
          {savedScores.map(file => <option key={file.id} value={String(file.id)}>{file.name}</option>)}
        </select>
        <button className="btn" onClick={addSavedScore} disabled={!selectedSavedScore}>Add saved score</button>
      </div>
      <div className="gp-repertoire-count">{p.pieces.length} piece{p.pieces.length === 1 ? '' : 's'} in this plan · requirement: {requirements.pieceCount}
        {p.pieces.length >= requirements.pieceCount ? <span className="gp-good"> Repertoire count reached</span> : <span> · add {requirements.pieceCount - p.pieces.length} more</span>}
      </div>
      {p.pieces.length > 0 ? p.pieces.map(piece => {
        const related = findPieceSessions(piece);
        const seconds = related.reduce((sum, session) => sum + Math.max(0, num(session.practiceSeconds ?? num(session.minutes) * 60)), 0);
        const latest = related.reduce((latestDate, session) => !latestDate || new Date(session.lastPractisedAt || session.date) > new Date(latestDate) ? (session.lastPractisedAt || session.date) : latestDate, null);
        const hasScore = !!piece.scoreData;
        return <article className="gp-saved gp-repertoire-item" key={piece.id}>
          <div className="gp-repertoire-main">
            <strong>{piece.title}</strong>
            <small>{piece.style || 'Repertoire'}{piece.scoreName ? ' · ' + piece.scoreName : ''}</small>
            <div className="gp-piece-progress"><span>{related.length} practice session{related.length === 1 ? '' : 's'} · {formatDuration(seconds)} logged{latest ? ' · last ' + new Date(latest).toLocaleDateString() : ''}</span></div>
            {hasScore && <label className="gp-file-change">Replace attached score<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.musiccoach,.musicxml,.xml,.mid,.midi,application/pdf,image/png,image/jpeg,image/webp,application/xml,text/xml" onChange={event => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) { window.alert('Please choose a score smaller than 5 MB so it can be stored safely with this local plan.'); return; }
              const reader = new FileReader();
              reader.onload = () => set('pieces', p.pieces.map(old => old.id === piece.id ? { ...old, scoreData: reader.result, scoreName: file.name, scoreType: file.type || file.name } : old));
              reader.readAsDataURL(file);
            }} /></label>}
            {!hasScore && <label className="gp-file-change">Attach score<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.musiccoach,.musicxml,.xml,.mid,.midi,application/pdf,image/png,image/jpeg,image/webp,application/xml,text/xml" onChange={event => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) { window.alert('Please choose a score smaller than 5 MB so it can be stored safely with this local plan.'); return; }
              const reader = new FileReader();
              reader.onload = () => set('pieces', p.pieces.map(old => old.id === piece.id ? { ...old, scoreData: reader.result, scoreName: file.name, scoreType: file.type || file.name } : old));
              reader.readAsDataURL(file);
            }} /></label>}
          </div>
          <div className="toolbar gp-repertoire-actions">
            <a className="btn" href={linkForPiece(piece.title)} target="_blank" rel="noreferrer">Find / verify piece ↗</a>
            <button className="btn btn-dark" onClick={() => onPracticePiece(piece)}>Practise piece</button>
            <button className="btn btn-quiet" onClick={() => removePiece(piece.id)}>Remove</button>
          </div>
        </article>;
      }) : <div className="empty-state"><strong>No repertoire selected yet</strong><p>Add the exact pieces you have chosen from your board's current list. You can then launch practice for each piece and track its sessions here.</p></div>}
      {p.pieces.length > requirements.pieceCount && <p className="gp-warning">You have more pieces than the pathway minimum. Check the official list-selection rules before deciding which pieces to present.</p>}
    </section>

    <section className="panel">
      <h3>4. Practice-linked progress</h3>
      <p className="muted">Practice sessions saved in Piano Coach count automatically. Matching a session to a selected repertoire piece uses its saved song title. Manual hours are kept separately so adding them does not double-count recorded practice.</p>
      <div className="gp-stat"><span>Practice sessions</span><strong>{sessions.length}</strong></div>
      <div className="gp-stat"><span>Recorded practice</span><strong>{round1(sessionHours)} h</strong></div>
      <div className="gp-stat"><span>Additional manual hours</span><strong>{round1(manualHours)} h</strong></div>
      <div className="gp-stat"><span>Total logged</span><strong>{actualHours.toFixed(1)} / {round1(targetHours).toFixed(1)} h</strong></div>
      <div className="gp-track"><div style={{ width: hoursProgress + '%' }} /></div>
      <div className="gp-stat"><span>Expected by now</span><strong>{expectedHours.toFixed(1)} h</strong></div>
      <div className="gp-track expected"><div style={{ width: clamp(expectedHours / Math.max(1, targetHours) * 100, 0, 100) + '%' }} /></div>
      <div className="gp-custom">
        <label>Log additional time (hours)<input type="number" min="0.25" step="0.25" value={hoursInput} onChange={event => setHoursInput(event.target.value)} placeholder="e.g. 0.5" /></label>
        <button className="btn btn-dark" disabled={!hoursInput || num(hoursInput) <= 0} onClick={addManualHours}>Add manual hours</button>
      </div>
      {actualHours + 0.05 < expectedHours
        ? <div className="gp-advice"><strong>Practice target adjustment</strong><p>You are below your planned hours so far. Current average: {round1(actualHours / Math.max(1, weeksRemaining === 0 ? 1 : weeksRemaining))} h/week remaining is a rough guide only; adapt it to your time, quality and teacher's advice.</p></div>
        : <div className="gp-advice on-track"><strong>Practice logged against plan</strong><p>Hours are a tracking aid, not a readiness prediction. Use piece feedback, technical-work checks and complete run-throughs alongside this total.</p></div>}
      <div className="gp-calendar">
        <div><h4>Suggested weekly split <span className="muted small">(editable plan guidance, not exam-board rules)</span></h4>
          {[['Repertoire and difficult passages',0.45],['Technical work',0.25],['Supporting skills / musicianship',0.15],['Run-through and reflection',0.15]].map(([label, share]) => <div className="gp-week" key={label}><strong>{Math.round(share * 100)}%</strong><span>{label}</span><small>{round1(weeklyHours * share)} h</small></div>)}
        </div>
        <div><h4>Milestones</h4>
          {timeline.map(item => <div className="gp-week" key={item.month}><strong>Month {item.month}</strong><span>{item.goal}</span><small>{item.hours} h</small></div>)}
        </div>
      </div>
    </section>

    <section className="panel">
      <h3>5. Mock performances and feedback</h3>
      <p className="muted">Save your own assessment notes and scores. These are personal tracking records—not official exam marks or an automated pass prediction.</p>
      <div className="gp-grid">
        <label>Piece or test
          <select value={mockName} onChange={event => setMockName(event.target.value)}>
            <option value="">Full mock exam / programme</option>
            {p.pieces.map(piece => <option key={piece.id} value={piece.title}>{piece.title}</option>)}
            {requirements.items.map(item => <option key={item.id} value={item.title}>{item.title}</option>)}
          </select>
        </label>
        <label>Personal score (0–100)<input type="number" min="0" max="100" value={mockScore} onChange={event => setMockScore(event.target.value)} /></label>
      </div>
      <label className="gp-notes">Feedback<textarea rows="2" value={mockNotes} onChange={event => setMockNotes(event.target.value)} placeholder="Accuracy, rhythm, memory, expression, confidence, next step…" /></label>
      <button className="btn btn-dark" onClick={saveMock} disabled={mockScore === '' || !Number.isFinite(Number(mockScore))}>Save assessment</button>
      {avgScore !== null && <div className="gp-requirements">
        <div><strong>{avgScore}/100</strong><span>Average personal score</span></div>
        <div><strong>{p.mockScores.length}</strong><span>Assessments saved</span></div>
        <div><strong>{p.mockScores[p.mockScores.length - 1].score}/100</strong><span>Latest personal score</span></div>
      </div>}
      {p.mockScores.slice().reverse().map(mock => <div className="gp-saved" key={mock.id}>
        <span><strong>{mock.piece} · {mock.score}/100</strong><small>{new Date(mock.date).toLocaleDateString()}{mock.notes ? ' · ' + mock.notes : ''}</small></span>
        <button className="btn btn-quiet" onClick={() => set('mockScores', p.mockScores.filter(item => item.id !== mock.id))}>Remove</button>
      </div>)}
    </section>
  </div>;
}
