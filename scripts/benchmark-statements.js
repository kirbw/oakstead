// Experimental statement reuse only. This does not enable an application cache.
const assert = require('node:assert/strict');
const { createGradeFixture } = require('../tests/helpers/grade-fixture');
const { setupFixture } = require('../tests/helpers/setup-fixture');
const { loadGradeAverages } = require('../server/grades');
const { loadSetupCounts, loadSetupSection } = require('../server/setup-data');

function queryFor(db, reuse) {
  const cache = new Map();
  return (sql, parameters = []) => {
    let statement = reuse && cache.get(sql);
    if (statement) cache.delete(sql);
    else statement = db.prepare(sql);
    if (reuse) {
      cache.set(sql, statement);
      if (cache.size > 128) cache.delete(cache.keys().next().value);
    }
    return statement.all(...parameters);
  };
}

function measure(fn) {
  fn();
  const durations = [];
  for (let index = 0; index < 21; index++) {
    const start = performance.now();
    fn();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return { medianMs: +durations[10].toFixed(3), p95Ms: +durations[19].toFixed(3) };
}

const grades = createGradeFixture();
const setup = setupFixture({ familyCount: 400, studentCount: 1200 });
try {
  const workloads = {
    graph: { db: grades.db, run: query => loadGradeAverages(query, {
      yearId: 1, grade: '1', subjectIds: grades.subjectIds,
      studentIds: grades.studentIds, periods: grades.periods
    }).get(1, grades.periods[0]) },
    setup: { db: setup.db, run: query => ({ counts: loadSetupCounts(query, 1),
      families: loadSetupSection(query, 1, 'families', 1),
      network: loadSetupSection(query, 1, 'network') }) }
  };
  const rounds = [];
  for (let round = 0; round < 3; round++) {
    const results = {};
    for (const [name, { db, run }] of Object.entries(workloads)) {
      const fresh = () => run(queryFor(db, false));
      const cachedQuery = queryFor(db, true);
      const reused = () => run(cachedQuery);
      assert.deepEqual(reused(), fresh());
      // Alternate order to reduce the effect of warming and background load.
      results[name] = round % 2
        ? { reused: measure(reused), fresh: measure(fresh) }
        : { fresh: measure(fresh), reused: measure(reused) };
    }
    rounds.push(results);
  }
  console.log(JSON.stringify({ runtime: process.version, samplesPerRound: 21,
    fixtures: '30 students/6 subjects/1800 assignments; Setup 400 families/1200 students', rounds }, null, 2));
} finally { grades.db.close(); setup.db.close(); }
