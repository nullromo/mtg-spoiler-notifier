# MTG Spoiler Notifier

Watches Scryfall for newly uploaded Magic cards and notifies subscribers over
e-mail and Discord.

Most of the language below exists to keep apart two ideas that used to share one
word: a card the pipeline has *noticed*, and a card somebody has actually
*received*. Confusing them is how notifications go missing.

## Language

**Card name**:
A card's identity throughout this project. Scryfall names are the only handle
the notifier has, so a card that is renamed is a different card.
_Avoid_: Card, title

**Catalog**:
Every card name currently in Scryfall.
_Avoid_: Card list, database, all cards

**Known**:
A card name the pipeline has seen in the catalog. Membership says nothing about
whether anybody was notified — a card can be known and delivered to nobody.
_Avoid_: Reported, sent, recorded, remembered

**Destination**:
One place a notification can be delivered: a single e-mail recipient, or a
single Discord server. Never e-mail or Discord as a whole.
_Avoid_: Subscriber, channel, recipient list

**Delivery**:
One confirmed send of one card to one destination. Confirmation is the only
thing that ends an obligation.
_Avoid_: Notification, broadcast, send

**Outstanding**:
A card a destination has been owed since it became known and has not yet had
delivered.
_Avoid_: Pending, queued, unsent, backlog

**Ledger**:
The record of what is known and what each destination is outstanding, carried
from one run to the next.
_Avoid_: Results, results file, remembered card list

**Bootstrap**:
Adopting the entire current catalog as known and owed to nobody. The one
sanctioned case of recording a card that was never delivered, and it only
happens when a human asks for it.
_Avoid_: Reset, initialise, start over

**Withdrawn**:
A card name that has left the catalog. Scryfall does this to temporary and joke
names, and sometimes restores them later.
_Avoid_: Deleted, removed, expired

**Unfetchable**:
A card name that is in the catalog but that Scryfall will not return a card for.
Ordinary and usually temporary; distinct from withdrawn.
_Avoid_: Broken, missing, invalid

**Card detail**:
What Scryfall says a card is — its faces, its rarity and its page. Fetched
fresh for each delivery and never stored: the ledger holds card names, not card
detail, so nothing here can go stale.
_Avoid_: Card data, card info, card to send

**Face**:
One printed side of a card. Type line, mana cost, oracle text and stats belong
to a face; rarity and the Scryfall page belong to the card. The distinction is
not pedantry — a double-faced card has different stats on each side, and
flattening them into one line put the back face's text under the front face's
picture. Faces do not correspond one-to-one with images: a split card prints
both of its faces on a single one.
_Avoid_: Side, half, mode
