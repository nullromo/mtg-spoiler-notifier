# mtg-spoiler-notifier

Detects new cards uploaded to scryfall.com and sends e-mail and Discord updates.

## How it Works

The `.github/workflows/main-runner.yml` file in this repo sets up a
[GitHub Action](https://github.com/features/actions) to be run every so often.
When this job runs, it performs the following steps:

1. Get a list of every card from Scryfall.
1. Compare the list against last run's list to find any new cards.
    1. If there are no new cards, exit.
    1. If there are new cards, generate an e-mail containing the names and
       images of the new cards and broadcast it out to all addresses in the
       [recipients list](./recipients.json).
    1. If there are new cards, generate a Discord message containing the names
       and images of the new cards and broadcast it out to the applicable
       Discord channels.
1. Save the list of all cards for the next run to look at.

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
scrapable.

If you want your Discord channel to be subscribed, please let me know. The
current setup requires me to manually add Discord channels.

## Help!

If you come across any kind of issue, please submit an issue on GitHub about it.
If you don't know how to do that, you can send me a message and I will show you
how :-)
