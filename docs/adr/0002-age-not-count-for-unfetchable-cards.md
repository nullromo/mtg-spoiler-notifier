# Judge unfetchable cards by age as well as by count

A run used to fail when more than ten card names failed to fetch in that single
run. The intent was to catch "something has changed about the catalog itself",
but ten was low enough that the measure it actually tracked was the size of the
current preview wave, and a preview wave is ordinary: Scryfall lists names in
`catalog/card-names` before the card objects and images are live, and every
fetch of those names 404s until they land.

Because the same pending names are re-counted on every run, one wave failed the
run every thirty minutes until Scryfall caught up. Between 2026-09-11 and
2026-09-13 that was eleven consecutive failed runs, six of them reporting the
identical count of seventeen — one Scryfall event, eleven notifications. Over
the fortnight to 2026-09-17, sixteen of the seventeen failed runs were this
check, and the seventeenth was an unrelated 503 on the catalog endpoint.

A run now fails on either of two conditions, which answer different questions:

- **Any one card unfetchable for longer than `UNFETCHABLE_GRACE_MS`**, currently
  a week. The ledger records `unfetchableSince`, one timestamp per card name,
  set on the first failed fetch of a streak and cleared the moment one succeeds.
  A week-old 404 is not preview lag, so no count of them is ordinary and
  `MAX_TOLERATED_STUCK_CARDS` is zero.
- **More than `MAX_FETCH_FAILURES_PER_RUN` failures in a single run**, currently
  forty. Age cannot answer "is fetching working at all right now", and waiting
  out a week to report a wholesale breakage is too slow.

## Considered options

**Raise the per-run count and nothing else.** One line, and it would have
cleared every failure in that fortnight, where the worst run saw thirty-eight.
Rejected as the whole rule because it says nothing about a name Scryfall has
genuinely abandoned: one dead name is invisible to a count of forty, forever.
Kept as half of it, because a count is the only thing that catches a sudden
wholesale failure quickly.

**Age alone.** Rejected because a total Scryfall outage would then go unreported
for a week.

**Require that the run delivered nothing, as the stalled-destination check
does.** Rejected on the evidence: the 2026-09-12 cluster delivered nothing at
all on six runs, because during a quiet stretch a pending wave is the only work
there is. It would have suppressed ten of the sixteen, not all of them.

## What the shape implies

**The clock is not re-stamped.** Marking records the first failure of the
current streak and later failures leave it alone. Re-stamping every run would
reset the clock every thirty minutes and nothing could ever age past the grace
period.

**A successful fetch clears it, before any delivery is attempted.** This tracks
whether Scryfall can produce the card, which is a different question from
whether anybody received it; a delivery that fails says nothing about the first.

**A withdrawn name takes its clock with it.** It has left the queue and will
never be fetched again, so the clock would otherwise tick forever. Scryfall
restores withdrawn names, and a restored one is re-detected and starts fresh —
which is right, because the grace period is about the current absence.

**Only names owed to an active destination count.** A departed destination's
queue is frozen and never fetched again, so without this one former recipient
could hold names past the grace period indefinitely.

**A permanently dead catalog name fails every run until it is dealt with.** That
is the point of the age half of the rule rather than a flaw in it, but it does
mean the failure is sticky in a way the old one was not: the notifier cannot fix
it, and the name stays owed until Scryfall produces a card or withdraws it. The
levers are `UNFETCHABLE_GRACE_MS` and `MAX_TOLERATED_STUCK_CARDS`.

**The two thresholds are not independent.** A run attempts at most
`MAX_FETCH_ATTEMPTS_PER_RUN` fetches, currently a hundred, so
`MAX_FETCH_FAILURES_PER_RUN` has to stay well below that to mean anything. Forty
leaves real headroom over the worst wave observed to date, thirty-eight, but not
a great deal of it.
