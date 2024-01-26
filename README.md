# mtg-spoiler-notifier

Detects new cards uploaded to scryfall.com and sends e-mail updates.

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
1. Save the list of all cards for the next run to look at.

## E-mail Credentials

I created a dedicated Gmail account to send e-mails. The password is in plain
text in the code, but the account is not linked to my personal information. If a
malicious actor takes control of the account, I am not liable or responsible,
and I have no way to reclaim the account. Any users of this application shall
understand the risks associated.

The account name is `mtgspoilernotifier@gmail.com`.

## How To Get on the List

To get added to the list, you can submit a pull request that adds your e-mail
address to the [recipients list](./recipients.json). If you don't know how to do
that, you can send me a message and I will teach you how :)

## Help!

If you come across any kind of issue, please submit an issue on GitHub about it.
If you don't know how to do that, you can send me a message and I will show you
how :)
