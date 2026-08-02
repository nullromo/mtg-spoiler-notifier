# mtg-spoiler-notifier

Detects new cards uploaded to scryfall.com and sends e-mail and Discord updates.

## How it Works

The `.github/workflows/main-runner.yml` file in this repo sets up a
[GitHub Action](https://github.com/features/actions) to be run every so often.
When this job runs, it performs the following steps:

1. Get a list of every card from Scryfall.
1. Compare it against the ledger to find card names that have never been seen.
   Each new name is recorded as known and becomes owed to every destination —
   every address in the [recipients list](./recipients.json), and every
   subscribed Discord channel.
1. Work through what is owed, one card at a time: fetch its details and images
   from Scryfall, then send it to each destination that is still owed it.
1. Record each delivery the instant that destination confirms it, and save the
   ledger for the next run.

### The Ledger

The ledger is what the notifier carries from one run to the next. It lives in
`previous-results.json`, which is not in the repo — it only ever arrives as the
previous run's uploaded artifact. It records two separate things:

- **`known`** — every card name the pipeline has ever seen. This says nothing
  about whether anybody was notified.
- **`outstanding`** — for each destination, the cards it is still owed, in the
  order they should go out.

Keeping those apart is the whole point. A card leaves a destination's
outstanding list only when that destination confirms delivery, so one broken
Discord webhook cannot make a card look reported to everybody, and one failing
e-mail address cannot cause the card to be re-sent to everybody who already got
it. See [ADR 0001](./docs/adr/0001-per-destination-delivery-tracking.md) for
why it is shaped this way, and [CONTEXT.md](./CONTEXT.md) for the vocabulary.

Adding a destination never backfills it: somebody new is treated as caught up,
not owed the entire back catalogue.

The notifier bails out rather than guess whenever it cannot trust the ledger. It
refuses to send or record anything, exits non-zero, and writes no results file,
which leaves the last known-good artifact in place for the next run to pick up.
Two things trigger it:

- `previous-results.json` is missing, unreadable or malformed — a failed
  artifact download looks exactly like a first run, and guessing "first run"
  would mark the whole catalog as known and owed to nobody.
- The ledger loaded, but more than 10,000 cards have never been seen. Scryfall
  does not add ten thousand cards in half an hour, so the ledger is stale or
  truncated.

The one exception is a ledger that is present and deliberately empty, which is
how a baseline gets established: everything currently in Scryfall is recorded as
known and owed to nobody. That is the only case where a card is recorded without
a notification going out, and it only happens because somebody asked for it.

### When a Run Fails

An individual delivery failing does not fail the run. It is ordinary, recorded
state — the card stays owed and the next run retries it. Failing the build every
time a webhook returns a 500, every half hour, would just make the red X
meaningless.

What does fail the run is accumulation:

- more cards than ordinary catalog churn explains cannot be fetched at all;
- a destination is badly backed up and delivered nothing at all this run;
- a destination is owed something and has not managed a delivery in 72 hours.

Everything outstanding stays outstanding, so a failed run loses nothing.

### Starting From Scratch

Run the workflow manually from the Actions tab with the **bootstrap** input
checked. That writes an empty `previous-results.json` before the main script
runs, so the current catalog becomes the baseline and no notifications go out.

This is needed for the very first run, and to recover if the remembered list is
gone for good — artifacts expire, so a workflow left disabled long enough will
come back with nothing to download. Until it is bootstrapped, every run will
fail loudly rather than quietly skip the cards it lost.

### Translation Notes

Sometimes cards are spoiled with non-English images. When this happens, Scryfall
will take one of two approaches.

1. They upload the card image under a fake/joke name. The name has quotation
   marks around it. Once they get the official card image and English text, they
   replace it.
1. They upload the card image under a translated name. This name may or may not
   be the official name. Once they get the official card image and English text,
   they replace it.

In either case, the card's name and text, including reminder text, will usually
be an unofficial translation. Fortunately, these unofficial translations are
usually pretty good.

If the card name changes between the initial upload and the official release,
MTG Spoiler Notifier will re-send that card since it has a new name. MTG Spoiler
Notifier will not know it's the same card because it has a new name.

## E-mail Credentials

I created a dedicated Gmail account to send e-mails. I personally saved the
account password privately. This repo accesses the account via an "app
password," which is set up in the Google account. The password is saved in the
repo as a secret that can be accessed in the GitHub CI via an environment
variable. The account is not linked to my personal information. If a malicious
actor takes control of the account, I am not liable or responsible, and I have
no way to reclaim the account. Any users of this application shall understand
the risks associated.

The account name is `mtgspoilernotifier@gmail.com`.

## Discord Credentials

To get updates in Discord, a Discord webhook needs to be set up for a channel.
mtg-spoiler-notifier will POST to the webhook to send a message in that Discord
channel. The webhooks are stored as secrets in this repo.

### Discord Emoji Note

In order to send messages with custom emoji on Discord, the full emoji IDs need
to be used. Check `src/discordData.ts` for examples. These IDs can be obtained
by sending a message like `\:emojiName:` in Discord.

## How To Get on the List

To get added to the list, you can submit a pull request that adds your e-mail
address to the [recipients list](./recipients.json). If you don't know how to do
that, you can send me a message and I will teach you how :)

NOTE: the list uses `***AT***` instead of `@` to make the addresses less
scrapable. The ledger keys destinations by that same obfuscated form, for the
same reason — it is uploaded as a workflow artifact, and artifacts on public
repos can be downloaded by anyone.

If you want your Discord channel to be subscribed, please let me know. The
current setup requires me to manually add Discord channels.

## Help!

If you come across any kind of issue, please submit an issue on GitHub about it.
If you don't know how to do that, you can send me a message and I will show you
how :-)
