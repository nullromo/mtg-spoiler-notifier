// Direct tests for the delivery ledger's rules.
//
// These exist because test/regression.sh can only reach this logic by running
// the whole notifier against fake services and grepping its output, which is
// the right tool for proving "across real runs, nothing is lost or duplicated"
// and the wrong one for "a card evicted while still owed also leaves `known`".
// The two suites are complements: this one covers the rules, that one covers
// the artifact hand-off those rules ride on.

import assert from 'assert';
import type { Ledger, RunStats } from '../src/deliveryLedger';
import {
    DeliveryLedger,
    MAX_TOLERATED_FETCH_FAILURES,
    STALLED_OUTSTANDING_THRESHOLD,
    STALL_TIMEOUT_MS,
} from '../src/deliveryLedger';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const EMAIL = 'email:someone***AT***example.com';
const QUOYLES = 'discord:quoyles-quarters';
const EAST_BAY = 'discord:east-bay-magic';
const ACTIVE = [EMAIL, QUOYLES, EAST_BAY];

let failures = 0;

const test = (name: string, body: () => void) => {
    try {
        body();
        console.log(`  [32mPASS[0m ${name}`);
    } catch (error) {
        failures += 1;
        console.log(`  [31mFAIL[0m ${name}`);
        console.log(
            String(error)
                .split('\n')
                .map((line) => {
                    return `        ${line}`;
                })
                .join('\n'),
        );
    }
};

const section = (name: string) => {
    console.log(`\n${name}`);
};

const loaded = (contents: string): Ledger => {
    const load = DeliveryLedger.parse(contents);
    assert.strictEqual(load.status, 'loaded', `expected ${contents} to load`);
    if (load.status !== 'loaded') {
        throw new Error('unreachable');
    }
    return load.ledger;
};

const unreadable = (contents: string) => {
    return DeliveryLedger.parse(contents).status;
};

const noStats = (): RunStats => {
    return { attempted: {}, delivered: {}, fetchFailures: 0 };
};

// ---------------------------------------------------------------------------
section('parse: reading the ledger off disk');

test('migrates the legacy flat card-name array', () => {
    const ledger = loaded('["Bravo", "Alpha"]');
    assert.deepStrictEqual(ledger.known, ['Alpha', 'Bravo']);
    // the flat list meant "reported to everybody", so nobody is owed anything
    assert.deepStrictEqual(ledger.outstanding, {});
});

test('an empty legacy array loads rather than being unreadable', () => {
    // the #10 distinction: deliberately empty is a real answer that authorises
    // a bootstrap, unreadable is not
    assert.deepStrictEqual(loaded('[]').known, []);
});

test('reads the ledger object', () => {
    const ledger = loaded(
        JSON.stringify({
            known: ['Alpha', 'Bravo'],
            lastDeliveredAt: { [EMAIL]: NOW.toISOString() },
            outstanding: { [EMAIL]: ['Bravo'] },
        }),
    );
    assert.deepStrictEqual(ledger.outstanding[EMAIL], ['Bravo']);
});

test('rejects invalid JSON', () => {
    assert.strictEqual(unreadable('{not json'), 'unreadable');
});

test('rejects a shape that is neither array nor object', () => {
    assert.strictEqual(unreadable('42'), 'unreadable');
});

test('rejects a missing or non-string known list', () => {
    assert.strictEqual(
        unreadable('{"lastDeliveredAt":{},"outstanding":{}}'),
        'unreadable',
    );
    assert.strictEqual(
        unreadable('{"known":[1],"lastDeliveredAt":{},"outstanding":{}}'),
        'unreadable',
    );
});

test('rejects an outstanding list that is not an array of names', () => {
    assert.strictEqual(
        unreadable(
            '{"known":["Alpha"],"lastDeliveredAt":{},"outstanding":{"email:a":"Alpha"}}',
        ),
        'unreadable',
    );
});

test('rejects a card owed but not known', () => {
    // salvaging `known` here and resetting `outstanding` would silently mark
    // every owed card as delivered, which is the failure this format prevents
    assert.strictEqual(
        unreadable(
            '{"known":["Alpha"],"lastDeliveredAt":{},"outstanding":{"email:a":["Bravo"]}}',
        ),
        'unreadable',
    );
});

test('rejects a lastDeliveredAt that is not a timestamp', () => {
    assert.strictEqual(
        unreadable(
            '{"known":[],"lastDeliveredAt":{"email:a":"whenever"},"outstanding":{}}',
        ),
        'unreadable',
    );
});

test('serialize round-trips and preserves queue order', () => {
    const before: Ledger = {
        known: ['Alpha', 'Bravo', 'Charlie'],
        lastDeliveredAt: {},
        // deliberately not alphabetical: this is a queue, not a set
        outstanding: { [EMAIL]: ['Charlie', 'Alpha', 'Bravo'] },
    };
    const after = loaded(DeliveryLedger.serialize(before));
    assert.deepStrictEqual(after.outstanding[EMAIL], [
        'Charlie',
        'Alpha',
        'Bravo',
    ]);
});

// ---------------------------------------------------------------------------
section('ensureDestinations: arrivals start caught up');

test('a destination the ledger has never seen is owed nothing', () => {
    const ledger = DeliveryLedger.ensureDestinations(
        { known: ['Alpha', 'Bravo'], lastDeliveredAt: {}, outstanding: {} },
        ACTIVE,
        NOW,
    );
    // adding a recipient must not owe them the entire back catalogue
    ACTIVE.forEach((id) => {
        assert.deepStrictEqual(ledger.outstanding[id], []);
    });
});

test('a new destination gets a stall clock so the 72h tripwire has a start', () => {
    const ledger = DeliveryLedger.ensureDestinations(
        DeliveryLedger.empty(),
        [EMAIL],
        NOW,
    );
    assert.strictEqual(ledger.lastDeliveredAt[EMAIL], NOW.toISOString());
});

test('an existing destination is left exactly as it was', () => {
    const before: Ledger = {
        known: ['Alpha'],
        lastDeliveredAt: { [EMAIL]: '2020-01-01T00:00:00.000Z' },
        outstanding: { [EMAIL]: ['Alpha'] },
    };
    const after = DeliveryLedger.ensureDestinations(before, [EMAIL], NOW);
    assert.deepStrictEqual(after.outstanding[EMAIL], ['Alpha']);
    assert.strictEqual(
        after.lastDeliveredAt[EMAIL],
        '2020-01-01T00:00:00.000Z',
    );
});

// ---------------------------------------------------------------------------
section('detect: new cards join every active queue');

test('a newly seen card is owed to every active destination', () => {
    const { detected, ledger } = DeliveryLedger.detect(
        DeliveryLedger.ensureDestinations(
            DeliveryLedger.empty(),
            ACTIVE,
            NOW,
        ),
        ['Alpha', 'Bravo'],
        ACTIVE,
    );
    assert.deepStrictEqual(detected, ['Alpha', 'Bravo']);
    assert.deepStrictEqual(ledger.known, ['Alpha', 'Bravo']);
    ACTIVE.forEach((id) => {
        assert.deepStrictEqual(ledger.outstanding[id], ['Alpha', 'Bravo']);
    });
});

test('an orphaned destination does not accrue new cards', () => {
    const orphan = 'email:departed***AT***example.com';
    const { ledger } = DeliveryLedger.detect(
        {
            known: ['Alpha'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: [], [orphan]: ['Alpha'] },
        },
        ['Alpha', 'Bravo'],
        [EMAIL],
    );
    // frozen at what they were owed when they left, so re-adding them delivers
    // that and nothing else
    assert.deepStrictEqual(ledger.outstanding[orphan], ['Alpha']);
    assert.deepStrictEqual(ledger.outstanding[EMAIL], ['Bravo']);
});

test('detection appends, so older cards keep their place in the queue', () => {
    const { ledger } = DeliveryLedger.detect(
        {
            known: ['Alpha'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: ['Alpha'] },
        },
        ['Alpha', 'Bravo'],
        [EMAIL],
    );
    assert.deepStrictEqual(ledger.outstanding[EMAIL], ['Alpha', 'Bravo']);
});

// ---------------------------------------------------------------------------
section('evictWithdrawn: cards that leave the catalog');

test('a withdrawn card stops being owed by anybody', () => {
    const { evicted, ledger } = DeliveryLedger.evictWithdrawn(
        {
            known: ['Alpha', 'Gone'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: ['Alpha', 'Gone'], [QUOYLES]: ['Gone'] },
        },
        ['Alpha'],
        ACTIVE,
    );
    assert.deepStrictEqual(evicted, ['Gone']);
    assert.deepStrictEqual(ledger.outstanding[EMAIL], ['Alpha']);
    assert.deepStrictEqual(ledger.outstanding[QUOYLES], []);
});

test('a card evicted while an active destination still owed it leaves known', () => {
    // Scryfall withdraws and restores temporary names. Without this the
    // restored card would never be re-detected and Quoyle's would never get it
    const { ledger } = DeliveryLedger.evictWithdrawn(
        {
            known: ['Gone'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: [], [QUOYLES]: ['Gone'] },
        },
        [],
        ACTIVE,
    );
    assert.deepStrictEqual(ledger.known, []);
});

test('a fully delivered card that leaves the catalog stays known', () => {
    // nobody is owed it, so a flicker back must not re-notify anybody
    const { evicted, ledger } = DeliveryLedger.evictWithdrawn(
        {
            known: ['Gone'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: [], [QUOYLES]: [] },
        },
        [],
        ACTIVE,
    );
    assert.deepStrictEqual(evicted, []);
    assert.deepStrictEqual(ledger.known, ['Gone']);
});

test('a card owed only by an orphan is evicted but stays known', () => {
    // dropping it from known for a departed recipient's sake would re-notify
    // everybody else on a flicker back
    const orphan = 'email:departed***AT***example.com';
    const { ledger } = DeliveryLedger.evictWithdrawn(
        {
            known: ['Gone'],
            lastDeliveredAt: {},
            outstanding: { [EMAIL]: [], [orphan]: ['Gone'] },
        },
        [],
        [EMAIL],
    );
    assert.deepStrictEqual(ledger.known, ['Gone']);
    assert.deepStrictEqual(ledger.outstanding[orphan], []);
});

// ---------------------------------------------------------------------------
section('queue, delivery and rotation');

test('the queue is every owed card once, in order', () => {
    const work = DeliveryLedger.queue(
        {
            known: ['Alpha', 'Bravo', 'Charlie'],
            lastDeliveredAt: {},
            outstanding: {
                [EMAIL]: ['Alpha', 'Bravo'],
                [QUOYLES]: ['Alpha', 'Charlie'],
            },
        },
        ACTIVE,
    );
    assert.deepStrictEqual(work, ['Alpha', 'Bravo', 'Charlie']);
});

test('delivery removes the card from that destination only', () => {
    const before: Ledger = {
        known: ['Alpha'],
        lastDeliveredAt: {},
        outstanding: { [EMAIL]: ['Alpha'], [QUOYLES]: ['Alpha'] },
    };
    const after = DeliveryLedger.markDelivered(before, 'Alpha', EMAIL, NOW);
    assert.deepStrictEqual(after.outstanding[EMAIL], []);
    // the whole point: delivered to A but not B is now expressible
    assert.deepStrictEqual(after.outstanding[QUOYLES], ['Alpha']);
    assert.strictEqual(after.lastDeliveredAt[EMAIL], NOW.toISOString());
});

test('delivery leaves the card known', () => {
    const after = DeliveryLedger.markDelivered(
        { known: ['Alpha'], lastDeliveredAt: {}, outstanding: {} },
        'Alpha',
        EMAIL,
        NOW,
    );
    assert.deepStrictEqual(after.known, ['Alpha']);
});

test('an unfetchable card rotates to the back of every queue holding it', () => {
    // "Wargling" is in the catalog but has no card behind it. Left at the head
    // of the queue it would be retried first every run, forever
    const after = DeliveryLedger.rotateToBack(
        {
            known: ['Wargling', 'Alpha'],
            lastDeliveredAt: {},
            outstanding: {
                [EMAIL]: ['Wargling', 'Alpha'],
                [QUOYLES]: ['Alpha'],
            },
        },
        'Wargling',
    );
    assert.deepStrictEqual(after.outstanding[EMAIL], ['Alpha', 'Wargling']);
    assert.deepStrictEqual(after.outstanding[QUOYLES], ['Alpha']);
});

// ---------------------------------------------------------------------------
section('health: what fails the run');

test('a handful of unfetchable cards is healthy', () => {
    const report = DeliveryLedger.health(
        DeliveryLedger.empty(),
        ACTIVE,
        { ...noStats(), fetchFailures: MAX_TOLERATED_FETCH_FAILURES },
        NOW,
    );
    assert.strictEqual(report.healthy, true);
});

test('a pile of unfetchable cards fails the run', () => {
    const report = DeliveryLedger.health(
        DeliveryLedger.empty(),
        ACTIVE,
        { ...noStats(), fetchFailures: MAX_TOLERATED_FETCH_FAILURES + 1 },
        NOW,
    );
    assert.strictEqual(report.healthy, false);
});

test('a set release with deliveries succeeding is healthy', () => {
    // a big backlog on its own must not page anybody: this is exactly what a
    // few hundred cards arriving at once looks like
    const backlog = Array.from({ length: 300 }, (_, index) => {
        return `Card ${index}`;
    });
    const report = DeliveryLedger.health(
        {
            known: backlog,
            lastDeliveredAt: { [EMAIL]: NOW.toISOString() },
            outstanding: { [EMAIL]: backlog },
        },
        [EMAIL],
        { attempted: { [EMAIL]: 20 }, delivered: { [EMAIL]: 20 }, fetchFailures: 0 },
        NOW,
    );
    assert.strictEqual(report.healthy, true);
});

test('a badly backed-up destination delivering nothing fails the run', () => {
    const backlog = Array.from(
        { length: STALLED_OUTSTANDING_THRESHOLD + 1 },
        (_, index) => {
            return `Card ${index}`;
        },
    );
    const report = DeliveryLedger.health(
        {
            known: backlog,
            lastDeliveredAt: { [EMAIL]: NOW.toISOString() },
            outstanding: { [EMAIL]: backlog },
        },
        [EMAIL],
        { attempted: { [EMAIL]: 5 }, delivered: {}, fetchFailures: 0 },
        NOW,
    );
    assert.strictEqual(report.healthy, false);
});

test('a destination silent for over 72 hours fails the run even with a tiny backlog', () => {
    // the quiet-stretch case: too few cards arriving for the size rule to fire
    const report = DeliveryLedger.health(
        {
            known: ['Alpha'],
            lastDeliveredAt: {
                [QUOYLES]: new Date(
                    NOW.getTime() - STALL_TIMEOUT_MS - 1000,
                ).toISOString(),
            },
            outstanding: { [QUOYLES]: ['Alpha'] },
        },
        [QUOYLES],
        noStats(),
        NOW,
    );
    assert.strictEqual(report.healthy, false);
});

test('a destination silent for over 72 hours but owed nothing is healthy', () => {
    // nothing to deliver is not the same as failing to deliver
    const report = DeliveryLedger.health(
        {
            known: ['Alpha'],
            lastDeliveredAt: {
                [QUOYLES]: new Date(
                    NOW.getTime() - STALL_TIMEOUT_MS - 1000,
                ).toISOString(),
            },
            outstanding: { [QUOYLES]: [] },
        },
        [QUOYLES],
        noStats(),
        NOW,
    );
    assert.strictEqual(report.healthy, true);
});

test('a single failed delivery does not fail the run', () => {
    // ordinary, tracked, self-healing state. Paging on it at a 30-minute
    // cadence teaches everyone to ignore the alert
    const report = DeliveryLedger.health(
        {
            known: ['Alpha'],
            lastDeliveredAt: { [QUOYLES]: NOW.toISOString() },
            outstanding: { [QUOYLES]: ['Alpha'] },
        },
        [QUOYLES],
        { attempted: { [QUOYLES]: 1 }, delivered: {}, fetchFailures: 0 },
        NOW,
    );
    assert.strictEqual(report.healthy, true);
});

console.log();
if (failures > 0) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
}
console.log('all ledger checks passed');
