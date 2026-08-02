# Track delivery per destination

The notifier used to keep one flat list of card names meaning "reported". That
modelled delivery as a property of a card when it is really a relation between a
card and a destination, so "delivered to A but not B" was inexpressible: a
Discord webhook could fail and the card would still be recorded, lost forever,
while a partial e-mail failure recorded nothing and re-sent the card to everyone
who had already received it. The ledger now stores what has been **known** and,
separately, what each **destination** is still **outstanding**, and a card
leaves a destination's list only when that destination confirms delivery.

## Considered options

**Full delivery history per destination.** Rejected on size: that is N copies of
a ~28,000-name list, about 2 MB today and growing with every subscriber,
uploaded as an artifact every thirty minutes. Storing only what is outstanding
costs roughly what the old flat list cost, because in ordinary operation almost
nothing is outstanding.

**All-or-nothing recording** — keep the flat list, but only record a card once
every destination confirms. Cheap, and it cannot lose a notification. Rejected
because a durably broken destination then blocks everything: the card never
becomes known, so it is re-sent to the healthy destinations every thirty minutes
forever, and it permanently occupies a slot in the run's budget. Head-of-line
blocking, not merely noise.

## What the shape implies

**`known` means seen, not delivered.** A name is added the moment it is detected
in the catalog, before anything is attempted. `outstanding` is then the single
work queue, and fetching is just another step that can fail — one queue to
reason about rather than two. The cost is that `outstanding` is not empty in
ordinary operation, so its size is not a health signal; the run's exit code is.

**Withdrawn cards are evicted, and if still owed they also leave `known`.**
A name absent from the catalog can never be fetched, so it stops being owed. But
Scryfall restores withdrawn names, and a restored card that was still in `known`
would never be re-detected — a permanent, invisible loss for whoever had not
received it. Dropping it from `known` too means a restored card is re-detected
and re-queued: destinations that already had it get a duplicate. A duplicate is
always the better failure. Only *active* destinations count here, or one
departed recipient could trigger duplicates for everybody else.

**A destination the ledger has never seen is caught up, never backfilled.**
Otherwise adding a recipient would owe them 28,000 cards. This is also what
makes migration from the legacy flat list correct: every destination is new
against a migrated ledger, and the flat list did mean everybody had received
those cards.

**A departed destination's list freezes rather than being pruned.** It stops
accruing, so it holds whatever was owed at the moment they left — typically
nothing. Re-adding them delivers exactly that, and an accidental edit to the
recipient list loses nothing.

**E-mail destinations are keyed by the obfuscated address.** The ledger is
uploaded as a GitHub Actions artifact and artifacts on public repositories are
publicly downloadable. `recipients.json` already obfuscates addresses to keep
them from scrapers, and keying by the real address would undo that. Hashing was
rejected: `recipients.json` is checked into a public repository, so a hash costs
debuggability and buys privacy that does not exist.

**Discord destinations are keyed by a stable id, not their display name.** A key
change looks like a new destination, which is treated as caught up — so renaming
a server would silently discard everything it was owed.

**A malformed ledger is unreadable in whole, never in part.** Salvaging a valid
`known` from a corrupt `outstanding` would mean treating every destination as
caught up, silently discarding every card still owed. Refusing to run leaves the
last good artifact in place and makes the problem visible, which is the rule
already established for a missing ledger.

**The ledger is written after every confirmed delivery.** A cancelled or killed
runner then loses at most the delivery in flight, rather than every delivery the
run had made.

## Consequences

Individual delivery failures no longer fail the run — they are ordinary tracked
state that the next run retries, and paging on them at a thirty-minute cadence
would teach everyone to ignore the alert. Only accumulation fails the run: more
unfetchable names than catalog churn explains, a destination badly backed up
while delivering nothing, or a destination owed something that has not delivered
in seventy-two hours. The last of these exists because a dead webhook during a
quiet stretch never accumulates enough backlog to trip the other two.

Because every newly detected card joins every destination's queue, a broken
destination's queue is a superset of the healthy ones'. A destination is
therefore marked down after three consecutive failures and skipped for the rest
of the run; without that, the run would spend its whole fetch budget on cards
only the broken destination still wants.
