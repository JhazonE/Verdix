import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression para sa review finding C2: ang 10-segundo nga idle clear dili
 * gyud mo-fire sa tinuod nga tindahan.
 *
 * Ang mekanismo: ang `useProducts` adunay `refetchInterval: 30s` UG
 * nag-subscribe sa `useLiveRefresh`, nga mo-refetch sa KADA sale sa tibuok
 * tindahan. Ang `queryFn` niini mo-`map(mapApiProduct)`, mao nga bag-o ang
 * object identity kada refetch kung nausab ang payload (ug ang `stock`
 * mausab sa kada sale). Kung ang idle-timer effect nag-depend sa `result`
 * object, ang kada refetch mo-`clearTimeout` sa naghulat nga timer ug
 * mo-arm ug bag-o — mao nga ang presyo sa nilabay nga kustomer magpabilin
 * sa screen hangtod unsa.
 *
 * Ang timer kinahanglan mag-key sa KANUS-A gi-set ang resulta, dili sa
 * identity sa `result`. Gi-test ni isip source assertion kay ang timer naa sa
 * usa ka `'use client'` React component nga dili ma-import sa bare tsx.
 *
 * Gi-scope ang regex sa effect block lang (hangtod sa `}, [...]);` niini) para
 * dili mo-truncate sa nested braces — tan-awa ang
 * source-assertion-tests-regex-brittleness nga leksyon.
 */
const screenPath = path.join(__dirname, '../..', 'app/(app)/price-check/PriceCheckScreen.tsx');
const src = fs.readFileSync(screenPath, 'utf-8');

// Ang idle-timer effect: gikan sa IDLE_CLEAR_MS setTimeout paingon sa dep array.
const timerEffectMatch = src.match(/useEffect\(\(\) => \{[\s\S]*?IDLE_CLEAR_MS\);[\s\S]*?\}, \[([^\]]*)\]\);/);
assert.ok(timerEffectMatch, 'found the idle-timer effect with its dependency array');

const deps = timerEffectMatch![1];

// Ang `result` object mismo DILI pwede nga dependency: ang identity niini
// mo-churn sa kada background refetch.
assert.ok(
  !/\bresult\b(?!\s*[?.])/.test(deps),
  `idle-timer deps must not include the result object itself (identity churns on every refetch); got: [${deps}]`,
);

// Kinahanglan adunay stable nga token kung kanus-a gi-set ang resulta.
assert.ok(
  /resultToken|resultKey|resultAt|scanSeq|shownAt/.test(deps),
  `idle-timer deps must key on WHEN the result was set, not on its identity; got: [${deps}]`,
);

// Ug ang pick-list/loading state kinahanglan sab ma-clear (finding I4): ang
// timer dili pwede mo-early-return kung naa pay gi-type nga search term.
assert.ok(
  /searchTerm/.test(deps),
  `idle-timer must also clear a pick-list left on screen; deps: [${deps}]`,
);

console.log('✓ price-check-idle-timer tests passed');
