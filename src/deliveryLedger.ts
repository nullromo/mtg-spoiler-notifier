// The delivery ledger records two different things, and keeping them apart is
// the entire point of this module.
//
// `known` is every card name the pipeline has SEEN. A name lands here the
// moment it is detected in Scryfall's catalog — before any notification is
// attempted, and whether or not one ever succeeds. It deliberately does NOT
// mean "a notification went out for this card". That was what the old flat
// results.json meant, and it is exactly what made it impossible to express
// "delivered to A but not B".
//
// `outstanding` is the work queue: per destination, the cards that destination
// is still owed, in the order they should go out. A card leaves a destination's
// queue only when that destination confirms delivery, so a card is never
// recorded as delivered to somebody who did not receive it — and never sent
// twice to somebody who did.
//
// See docs/adr/0001-per-destination-delivery-tracking.md and issue #11.

// a destination is either one e-mail recipient ("email:<obfuscated address>")
// or one Discord server ("discord:<stable id>"). The e-mail half is keyed by
// the obfuscated form from recipients.json rather than the real address: the
// ledger is uploaded as a public GitHub Actions artifact, and recipients.json
// already uses that form to keep addresses out of scrapers' reach
export type DestinationId = string;

export type Ledger = {
    // sorted, so the artifact diffs cleanly between runs
    known: string[];
    // ISO timestamps, one per destination, used to spot a destination that has
    // stopped delivering during a quiet stretch
    lastDeliveredAt: Partial<Record<DestinationId, string>>;
    // NOT sorted: array order is queue position, and sorting it would undo the
    // rotation that keeps unfetchable cards from blocking everything behind them
    outstanding: Partial<Record<DestinationId, string[]>>;
};

// the outcome of reading the ledger. An unreadable ledger and a genuinely empty
// one must stay distinguishable: empty means "nothing has ever been seen",
// unreadable means "we have no idea what has been seen", and acting on the
// latter mistakes the whole Scryfall catalog for new cards. See issue #10
export type LedgerLoad =
    | { ledger: Ledger; status: 'loaded' }
    | { reason: string; status: 'unreadable' };

// what one run did, per destination, so health() can tell a busy destination
// apart from a broken one
export type RunStats = {
    attempted: Partial<Record<DestinationId, number>>;
    delivered: Partial<Record<DestinationId, number>>;
    fetchFailures: number;
};

export type HealthReport = {
    healthy: boolean;
    problems: string[];
};

// A destination that is owed cards but has not managed a single delivery in
// this long is not busy, it is broken. This is the tripwire that catches a dead
// webhook during a quiet stretch, when too few cards are arriving for the
// backlog to ever reach STALLED_OUTSTANDING_THRESHOLD
export const STALL_TIMEOUT_MS = 72 * 60 * 60 * 1000;

// ...but three days is too slow to notice when cards are pouring in, so a
// destination this far behind is called broken right away. A set release
// legitimately pushes every destination past this mark, which is why health()
// also requires that the destination delivered nothing at all this run: a busy
// destination still gets cards out, a dead one does not
export const STALLED_OUTSTANDING_THRESHOLD = 50;

// one or two catalog names with no card behind them is ordinary — "Wargling"
// has been one since 2026-08-01, and issue #8 is about surviving them. This
// many at once means something has changed about the catalog itself
export const MAX_TOLERATED_FETCH_FAILURES = 10;

const isStringArray = (value: unknown): value is string[] => {
    return (
        Array.isArray(value) &&
        value.every((item) => {
            return typeof item === 'string';
        })
    );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

// Object.entries over a Partial record hands back `V | undefined` values. Every
// caller here wants the destinations that actually have a queue, so drop the
// holes once rather than re-checking at each use
const outstandingEntries = (
    outstanding: Partial<Record<DestinationId, string[]>>,
): Array<[DestinationId, string[]]> => {
    const entries: Array<[DestinationId, string[]]> = [];
    Object.entries(outstanding).forEach(([destinationId, cardNames]) => {
        if (cardNames !== undefined) {
            entries.push([destinationId, cardNames]);
        }
    });
    return entries;
};

export class DeliveryLedger {
    public static readonly empty = (): Ledger => {
        return { known: [], lastDeliveredAt: {}, outstanding: {} };
    };

    // Read a ledger off disk. Three shapes are accepted: the legacy flat
    // string[], the current object, and nothing else.
    //
    // Validation is strict on purpose. Salvaging a valid `known` from a file
    // whose `outstanding` is corrupt would mean treating every destination as
    // caught up, which silently discards every card still owed — the exact
    // failure this format exists to prevent. Refusing to run instead leaves the
    // last good artifact in place and makes the problem visible. See issue #10
    public static readonly parse = (contents: string): LedgerLoad => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(contents);
        } catch (error) {
            return {
                reason: `The results file is not valid JSON: ${String(error)}`,
                status: 'unreadable',
            };
        }

        // the legacy flat list. Every name in it was reported to everybody, so
        // it migrates to `known` with nothing outstanding anywhere
        if (isStringArray(parsed)) {
            return {
                ledger: {
                    known: [...parsed].sort(),
                    lastDeliveredAt: {},
                    outstanding: {},
                },
                status: 'loaded',
            };
        }

        if (!isPlainObject(parsed)) {
            return {
                reason: 'The results file is neither a card-name array nor a ledger object.',
                status: 'unreadable',
            };
        }

        const { known, lastDeliveredAt, outstanding } = parsed;

        if (!isStringArray(known)) {
            return {
                reason: 'The results file has no `known` array of card names.',
                status: 'unreadable',
            };
        }
        if (!isPlainObject(outstanding)) {
            return {
                reason: 'The results file has no `outstanding` object.',
                status: 'unreadable',
            };
        }
        if (!isPlainObject(lastDeliveredAt)) {
            return {
                reason: 'The results file has no `lastDeliveredAt` object.',
                status: 'unreadable',
            };
        }

        const knownNames = new Set(known);
        for (const [destinationId, cardNames] of Object.entries(outstanding)) {
            if (!isStringArray(cardNames)) {
                return {
                    reason: `The results file's outstanding list for "${destinationId}" is not an array of card names.`,
                    status: 'unreadable',
                };
            }
            // a card can only be owed if it has been seen. If this fails the
            // file has been corrupted rather than merely written by an older
            // version, and guessing which half to trust risks losing cards
            const unknownName = cardNames.find((cardName) => {
                return !knownNames.has(cardName);
            });
            if (unknownName !== undefined) {
                return {
                    reason: `The results file owes "${unknownName}" to "${destinationId}" but does not list it as known.`,
                    status: 'unreadable',
                };
            }
        }

        for (const [destinationId, timestamp] of Object.entries(
            lastDeliveredAt,
        )) {
            if (
                typeof timestamp !== 'string' ||
                Number.isNaN(Date.parse(timestamp))
            ) {
                return {
                    reason: `The results file's lastDeliveredAt for "${destinationId}" is not a timestamp.`,
                    status: 'unreadable',
                };
            }
        }

        return {
            ledger: {
                known: [...known].sort(),
                lastDeliveredAt: lastDeliveredAt as Partial<
                    Record<DestinationId, string>
                >,
                outstanding: outstanding as Partial<
                    Record<DestinationId, string[]>
                >,
            },
            status: 'loaded',
        };
    };

    public static readonly serialize = (ledger: Ledger): string => {
        return JSON.stringify(
            {
                known: [...ledger.known].sort(),
                lastDeliveredAt: ledger.lastDeliveredAt,
                outstanding: ledger.outstanding,
            },
            null,
            4,
        );
    };

    // A destination the ledger has never heard of is treated as caught up, not
    // owed the whole back catalogue. Adding a recipient must not mail them
    // 28,000 cards. This is also what makes the legacy migration work: every
    // destination is new against a migrated ledger, and the flat list did mean
    // everybody had already received those cards
    public static readonly ensureDestinations = (
        ledger: Ledger,
        destinationIds: DestinationId[],
        now: Date,
    ): Ledger => {
        const outstanding = { ...ledger.outstanding };
        const lastDeliveredAt = { ...ledger.lastDeliveredAt };
        destinationIds.forEach((destinationId) => {
            if (outstanding[destinationId] === undefined) {
                outstanding[destinationId] = [];
            }
            // without a starting point the 72-hour stall tripwire would fire
            // the first time a brand-new destination is owed anything
            if (lastDeliveredAt[destinationId] === undefined) {
                lastDeliveredAt[destinationId] = now.toISOString();
            }
        });
        return { known: ledger.known, lastDeliveredAt, outstanding };
    };

    // Drop cards that have left Scryfall's catalog. They can never be fetched
    // again, so they would otherwise sit in the queue forever.
    //
    // A card evicted while an ACTIVE destination still owed it is also dropped
    // from `known`. Scryfall withdraws and restores temporary names (see the
    // note in main.ts), and without this an evicted card that came back would
    // never be re-detected — a permanent, invisible loss for whoever had not
    // received it. Dropping it means a restored card is re-detected and
    // re-queued: the destinations that already had it get a duplicate, which is
    // always the better failure. Orphaned destinations do not count, or one
    // departed recipient could trigger duplicates for everybody else.
    public static readonly evictWithdrawn = (
        ledger: Ledger,
        catalog: string[],
        activeIds: DestinationId[],
    ): { evicted: string[]; ledger: Ledger } => {
        const inCatalog = new Set(catalog);
        const active = new Set(activeIds);

        const withdrawn = new Set<string>();
        const stillOwedByActive = new Set<string>();
        outstandingEntries(ledger.outstanding).forEach(
            ([destinationId, cardNames]) => {
                cardNames.forEach((cardName) => {
                    if (inCatalog.has(cardName)) {
                        return;
                    }
                    withdrawn.add(cardName);
                    if (active.has(destinationId)) {
                        stillOwedByActive.add(cardName);
                    }
                });
            },
        );

        if (withdrawn.size === 0) {
            return { evicted: [], ledger };
        }

        const outstanding: Partial<Record<DestinationId, string[]>> = {};
        outstandingEntries(ledger.outstanding).forEach(
            ([destinationId, cardNames]) => {
                outstanding[destinationId] = cardNames.filter((cardName) => {
                    return !withdrawn.has(cardName);
                });
            },
        );

        return {
            evicted: [...withdrawn].sort(),
            ledger: {
                known: ledger.known.filter((cardName) => {
                    return !stillOwedByActive.has(cardName);
                }),
                lastDeliveredAt: ledger.lastDeliveredAt,
                outstanding,
            },
        };
    };

    // Everything in the catalog that has not been seen before becomes known,
    // and joins the back of every active destination's queue. Orphaned
    // destinations deliberately do not accrue: a departed recipient's queue
    // freezes at whatever they were owed when they left, so re-adding them
    // delivers that and nothing else
    public static readonly detect = (
        ledger: Ledger,
        catalog: string[],
        activeIds: DestinationId[],
    ): { detected: string[]; ledger: Ledger } => {
        const knownNames = new Set(ledger.known);
        const detected = catalog.filter((cardName) => {
            return !knownNames.has(cardName);
        });

        if (detected.length === 0) {
            return { detected: [], ledger };
        }

        const outstanding = { ...ledger.outstanding };
        activeIds.forEach((destinationId) => {
            outstanding[destinationId] = [
                ...(outstanding[destinationId] ?? []),
                ...detected,
            ];
        });

        return {
            detected,
            ledger: {
                known: [...ledger.known, ...detected].sort(),
                lastDeliveredAt: ledger.lastDeliveredAt,
                outstanding,
            },
        };
    };

    // Adopt the whole catalog as already seen without owing it to anybody. This
    // is the deliberate bootstrap, and the one case where a card is recorded
    // without a notification going out — because a human asked for it
    public static readonly adoptCatalog = (
        catalog: string[],
        activeIds: DestinationId[],
        now: Date,
    ): Ledger => {
        return DeliveryLedger.ensureDestinations(
            {
                known: [...catalog].sort(),
                lastDeliveredAt: {},
                outstanding: {},
            },
            activeIds,
            now,
        );
    };

    // The run's work list: every card owed to any active destination, in queue
    // order, each appearing once
    public static readonly queue = (
        ledger: Ledger,
        activeIds: DestinationId[],
    ): string[] => {
        const seen = new Set<string>();
        const work: string[] = [];
        activeIds.forEach((destinationId) => {
            (ledger.outstanding[destinationId] ?? []).forEach((cardName) => {
                if (seen.has(cardName)) {
                    return;
                }
                seen.add(cardName);
                work.push(cardName);
            });
        });
        return work;
    };

    public static readonly destinationsOwed = (
        ledger: Ledger,
        cardName: string,
        activeIds: DestinationId[],
    ): DestinationId[] => {
        return activeIds.filter((destinationId) => {
            return (ledger.outstanding[destinationId] ?? []).includes(cardName);
        });
    };

    // The only way a card stops being owed. Called once per confirmed delivery,
    // never in advance and never in bulk
    public static readonly markDelivered = (
        ledger: Ledger,
        cardName: string,
        destinationId: DestinationId,
        now: Date,
    ): Ledger => {
        return {
            known: ledger.known,
            lastDeliveredAt: {
                ...ledger.lastDeliveredAt,
                [destinationId]: now.toISOString(),
            },
            outstanding: {
                ...ledger.outstanding,
                [destinationId]: (
                    ledger.outstanding[destinationId] ?? []
                ).filter((owedName) => {
                    return owedName !== cardName;
                }),
            },
        };
    };

    // A card that could not be fetched goes to the back of every queue holding
    // it. Without this, a name that is in the catalog but has no card behind it
    // — "Wargling" — sits at the head of the queue and is retried first every
    // run, forever, and enough of them would exhaust the run's fetch budget
    // before any deliverable card was reached
    public static readonly rotateToBack = (
        ledger: Ledger,
        cardName: string,
    ): Ledger => {
        const outstanding: Partial<Record<DestinationId, string[]>> = {};
        outstandingEntries(ledger.outstanding).forEach(
            ([destinationId, cardNames]) => {
                outstanding[destinationId] = cardNames.includes(cardName)
                    ? [
                          ...cardNames.filter((owedName) => {
                              return owedName !== cardName;
                          }),
                          cardName,
                      ]
                    : cardNames;
            },
        );
        return {
            known: ledger.known,
            lastDeliveredAt: ledger.lastDeliveredAt,
            outstanding,
        };
    };

    // Whether this run should exit non-zero. Individual delivery failures are
    // ordinary, tracked, self-healing state and deliberately do NOT fail the
    // run — paging on every transient Discord 500 at a 30-minute cadence just
    // teaches everyone to ignore the alert. Only accumulation fails the run
    public static readonly health = (
        ledger: Ledger,
        activeIds: DestinationId[],
        stats: RunStats,
        now: Date,
    ): HealthReport => {
        const problems: string[] = [];

        if (stats.fetchFailures > MAX_TOLERATED_FETCH_FAILURES) {
            problems.push(
                `${stats.fetchFailures} cards could not be fetched from Scryfall, which is more than the ${MAX_TOLERATED_FETCH_FAILURES} that ordinary catalog churn explains.`,
            );
        }

        activeIds.forEach((destinationId) => {
            const owed = ledger.outstanding[destinationId] ?? [];
            if (owed.length === 0) {
                return;
            }

            const attempted = stats.attempted[destinationId] ?? 0;
            const delivered = stats.delivered[destinationId] ?? 0;
            if (
                owed.length > STALLED_OUTSTANDING_THRESHOLD &&
                attempted > 0 &&
                delivered === 0
            ) {
                problems.push(
                    `${destinationId} is owed ${owed.length} cards and delivered none of the ${attempted} attempted this run.`,
                );
                return;
            }

            const lastDelivered = ledger.lastDeliveredAt[destinationId];
            if (
                lastDelivered !== undefined &&
                now.getTime() - Date.parse(lastDelivered) > STALL_TIMEOUT_MS
            ) {
                problems.push(
                    `${destinationId} is owed ${
                        owed.length
                    } cards and has not had a successful delivery since ${lastDelivered}.`,
                );
            }
        });

        return { healthy: problems.length === 0, problems };
    };
}
