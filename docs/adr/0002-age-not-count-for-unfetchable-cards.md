# Judge unfetchable cards by age, not by count

A run used to fail when more than ten card names failed to fetch in that single
run. The intent was to catch "something has changed about the catalog itself",
but the measure it used was the size of the current preview wave, and a preview
wave is ordinary no matter how big it is: Scryfall lists names in
`catalog/card-names` before the card objects and images are live, and every
fetch of those names 404s until they land.

Because the same pending names are re-counted on every run, one wave failed the
run every thirty minutes until Scryfall caught up. Between 2026-09-11 and
2026-09-13 that was eleven consecutive failed runs, six of them reporting the
identical count of seventeen — one Scryfall event, eleven notifications. Over
the fortnight to 2026-09-17, sixteen of the seventeen failed runs were this
check, and the seventeenth was an unrelated 503 on the catalog endpoint.

The ledger now records `unfetchableSince`, one timestamp per card name, set on
the first failed fetch of a streak and cleared the moment one succeeds. A run
fails when more than `MAX_TOLERATED_STUCK_CARDS` names have been unfetchable for
longer than `UNFETCHABLE_GRACE_MS`, currently a week.

## Considered options

**Raise the count.** One line, and it would have cleared every failure in that
fortnight, where the worst run saw thirty-eight. Rejected because the wave that
prompted it grew from seventeen to thirty-eight in five days and a full set
preview routinely dumps more names than that at once, so the threshold buys one
quiet season and then fails the same way. It also weakens the check permanently,
since a run attempts at most a hundred fetches.

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

**Per-run fetch failures no longer fail the run at all.** A total Scryfall
outage is therefore not reported for a week by this check. That is deliberate:
any per-run count reintroduces exactly the false alarm this removes, and
sustained breakage still surfaces through the 72-hour stall tripwire on each
destination, which fires whether the cause is Scryfall or a dead webhook.

**Permanently dead names accumulate.** "Wargling" has been unfetchable since
2026-08-01 and is not coming back, so the count threshold stays. If it ever
trips on a pile of long-known names the fix is to raise the count, not to
shorten the grace period.
