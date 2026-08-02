import fs from 'fs';
import axios from 'axios';
import yargs from 'yargs';
import type { DestinationId, Ledger, RunStats } from './deliveryLedger';
import { DeliveryLedger } from './deliveryLedger';
import type { DiscordServer } from './discordData';
import { discordServers } from './discordData';
import type { AttachmentData, EmailRecipient } from './e-mail';
import { EMailer, emailRecipients } from './e-mail';
import { FileTools } from './fileTools';
import { ScryfallTools } from './scryfallTools';
import { Symbols } from './symbols';
import { Util } from './util';

// if this many cards in Scryfall have never been seen before, then something
// has gone wrong: Scryfall does not add ten thousand cards between two runs
// half an hour apart, so the ledger must be missing, stale or truncated.
// Recording that many cards without sending them would lose every one of those
// notifications for good, so the only case that adopts the catalog wholesale is
// a ledger that is deliberately empty — a bootstrap a human asked for. See
// issue #10
const CARD_LIST_ERROR_THRESHOLD = 10000;

// restrict how many cards can be delivered in one run. There are daily e-mail
// limits, meaning if the spoiler notifier gets too far behind, it will have too
// large of a batch to process and it will fail every single time. To prevent
// that, progress is written after every delivery so that results get "locked
// in" and the spoiler notifier won't get permanently stuck with a big batch of
// updates that can never complete successfully
const MAX_CARDS_PER_RUN = 20;

// Cards whose fetch fails do not count against MAX_CARDS_PER_RUN, because
// nothing was delivered — but they still cost a Scryfall request each, so
// something has to bound them. Combined with rotating a failed card to the back
// of the queue, this caps the wasted traffic without ever letting the same dead
// entries exhaust the budget two runs running. See issue #11
const MAX_FETCH_ATTEMPTS_PER_RUN = 100;

// After this many consecutive failures a destination is considered down for the
// rest of the run and skipped. This is not just politeness towards a broken
// webhook: because every newly detected card joins EVERY destination's queue, a
// broken destination's queue is a superset of the healthy ones', so without
// this the run would spend its whole fetch budget on old cards that only the
// broken destination still wants, and new cards would never reach anybody
const DESTINATION_FAILURE_LIMIT = 3;

// there is a deprecation warning that shows right now. This line of code can
// show you that it's coming from nodemailer. It's a compatibility issue
// between the newer Node.js version and the older nodemailer version. The
// solution is to wait for a new version of nodemailer to be released
//process.on('warning', (warning) => { console.log(warning.stack); });

// create an e-mailer
const emailer = new EMailer();

// everything needed to send one card's notifications, with that card's images
// already downloaded to disk
type CardToSend = {
    imagePaths: string[];
    imageWebURIs: string[];
    manaCost: string;
    name: string;
    oracleText: string;
    typeLine: string;
};

// one place a notification can be delivered to, and the only unit the ledger
// tracks. Unifying e-mail recipients and Discord servers behind one interface
// is what lets the run loop record each delivery independently
type Destination = {
    id: DestinationId;
    name: string;
    send: (card: CardToSend) => Promise<void>;
};

const makeSubject = (cardsToSend: Array<{ name: string }>) => {
    return `${
        cardsToSend.length === 1
            ? `New Card: [[${cardsToSend[0].name}]]`
            : `${cardsToSend.length} New Cards`
    }! MTG Spoiler Notification ${new Date().toLocaleString()}`;
};

const makeEmailHTML = (
    cardsToSend: Array<{
        imagePaths: string[];
        name: string;
        oracleText: string;
        manaCost: string;
        typeLine: string;
    }>,
) => {
    return `<html>
    <div>
        This is an automated e-mail from <a href="https://github.com/nullromo/mtg-spoiler-notifier/">MTG Spoiler Notifier</a>.
        <br />
        <br />
        The following ${
            cardsToSend.length === 1
                ? 'card has'
                : `${cardsToSend.length} cards have`
        } been added to Scryfall since the last notification was sent out.
        <br />
        <br />
        ${cardsToSend
            .map((card) => {
                return card.imagePaths
                    .map((_, index) => {
                        const imageSrc = Util.nameToCID(card.name, index);
                        return `<div>
            ${card.name}${index > 0 ? ` (face ${index + 1})` : ''}
            <br />
            <div>${card.typeLine} ${
                card.manaCost ? `${Symbols.dot} ${card.manaCost}` : ''
            }</div>
            <br />
            <div>${card.oracleText}</div>
            <br />
            <img src="cid:${imageSrc}" />
        </div>`;
                    })
                    .join('\n        <br />\n        ');
            })
            .join('\n        <br />\n        ')}
    </div>
</html>`;
};

const makeAttachments = (cardsToSend: CardToSend[]): AttachmentData[] => {
    return Util.flattenArray(
        cardsToSend.map((card) => {
            return card.imagePaths.map((imagePath, index) => {
                return {
                    cid: Util.nameToCID(card.name, index),
                    filename: `${card.name}${
                        index > 0 ? `_face${index + 1}` : ''
                    }.png`,
                    path: imagePath,
                };
            });
        }),
    );
};

const sendEmail = async (recipient: EmailRecipient, card: CardToSend) => {
    // NOTE: the rendered HTML is deliberately not logged. It ran to nineteen
    // lines per card and said nothing the delivery line below does not
    await emailer.send(
        recipient,
        makeSubject([card]),
        makeEmailHTML([card]),
        makeAttachments([card]),
    );
};

// Post one card to one Discord server. This is awaited and allowed to reject:
// it used to be fire-and-forget with a .catch(console.error), so a webhook
// returning 500 was logged and then forgotten while the card was recorded as
// reported. Discord subscribers never saw it and it was never retried. See
// issue #11
const sendDiscordMessage = async (
    discordServer: DiscordServer,
    card: CardToSend,
) => {
    const content = `${makeSubject([card])}\n### ${card.name}\n${
        card.typeLine
    } ${card.manaCost ? `${Symbols.dot} ${card.manaCost}` : ''}\n${card.oracleText
        // italicize reminder text
        .replaceAll(/\(/g, '_(')
        .replaceAll(/\)/g, ')_')}`;
    const embeds = card.imageWebURIs.map((path) => {
        return { image: { url: path } };
    });
    await axios.post(discordServer.webhookURI, {
        // insert emoji
        content: content.replaceAll(
            /\{(?<match>.*?)\}/g,
            (text, group1: string) => {
                return discordServer.emojiDictionary[group1] ?? text;
            },
        ),
        embeds,
    });
};

// NOTE: e-mail recipients come first on purpose. Gmail has a daily sending
// limit, so the constrained channel gets its attempt before the unconstrained
// one. The old reason for this ordering — that a failed e-mail should stop
// Discord messages going out — no longer applies, because each destination's
// deliveries are now recorded separately and retried on their own
const destinations: Destination[] = [
    ...emailRecipients.map((recipient) => {
        return {
            id: recipient.id,
            name: recipient.id,
            send: async (card: CardToSend) => {
                await sendEmail(recipient, card);
            },
        };
    }),
    ...discordServers.map((discordServer) => {
        return {
            id: discordServer.destinationId(),
            name: discordServer.name,
            send: async (card: CardToSend) => {
                await sendDiscordMessage(discordServer, card);
            },
        };
    }),
];

const activeIds = destinations.map((destination) => {
    return destination.id;
});

// fetch a single card's data and images from Scryfall and save the images
const resolveCard = async (name: string): Promise<CardToSend> => {
    // get the card details and image
    const card = await ScryfallTools.getCard(name);

    // set up the image paths
    const imagePaths = card.images.map((_, index) => {
        return `images/${name.replaceAll(/\//g, 'SLASH')}${
            index > 0 ? `_face${index + 1}` : ''
        }.png`;
    });

    // save the images
    card.images.forEach((image, index) => {
        fs.writeFileSync(imagePaths[index], image);
    });

    return {
        imagePaths,
        imageWebURIs: card.data.image_uris
            ? [card.data.image_uris.png]
            : card.data.card_faces
              ? card.data.card_faces.map((face) => {
                    return face.image_uris.png;
                })
              : [],
        manaCost:
            card.data.mana_cost ??
            `${card.data.card_faces?.[0].mana_cost} // ${card.data.card_faces?.[1].mana_cost}`,
        name,
        oracleText:
            card.data.oracle_text ??
            `${card.data.card_faces?.[0].oracle_text} // ${card.data.card_faces?.[1].oracle_text}`,
        typeLine: card.data.type_line,
    };
};

// what the notifier has seen and what each destination is still owed
let ledger: Ledger = DeliveryLedger.empty();

// whether the ledger may be written at the end of the run. It starts out false
// because until the previous ledger has been read there is nothing meaningful
// to write: saving without knowing what was already delivered would record
// cards as delivered that never went out. Any bail-out sets it back to false,
// so CI uploads nothing and the last known-good artifact survives
let safeToSaveLedger = false;

// main program
(async () => {
    // parse command line arguments
    const args = await yargs
        .option('n', { alias: 'number-to-remove', default: 0, type: 'number' })
        .parse(process.argv);

    // Load the previous ledger. If it could not be read then there is no way to
    // tell a new card from an old one, nor who is owed what, so give up
    // immediately — before fetching, sending or writing anything. Exiting
    // non-zero here leaves the last good artifact in place for the next run to
    // download, and makes the failed hand-off visible instead of silently
    // absorbing it. See issue #10
    const load = FileTools.getPreviousLedger();
    if (load.status === 'unreadable') {
        throw new Error(
            `${load.reason} Refusing to run: without the ledger, every card looks new and nobody's outstanding deliveries are known. The results file has been left untouched.`,
        );
    }
    ledger = load.ledger;
    safeToSaveLedger = true;
    console.log('The ledger knows about', ledger.known.length, 'cards.');
    console.log('Destinations:', activeIds.join(', '));

    // get current card list
    const catalog = await ScryfallTools.getCardCatalog();
    console.log('There are', catalog.length, 'total cards in Scryfall.');

    // remove n cards at random for testing purposes. They fall out of `known`,
    // so the detection step below picks them up again as if they were new
    if (args.n > 0) {
        console.log('Removing', args.n, 'random cards for testing purposes.');
        const known = [...ledger.known];
        for (let n = 0; n < args.n; n += 1) {
            Util.removeRandom(known);
        }
        ledger = { ...ledger, known };
    }

    // if far too much of the catalog is unseen, then the ledger is not merely
    // out of date
    const knownNames = new Set(ledger.known);
    const unseenCount = catalog.filter((cardName) => {
        return !knownNames.has(cardName);
    }).length;
    if (unseenCount > CARD_LIST_ERROR_THRESHOLD) {
        // a ledger that already knew about some cards cannot legitimately fall
        // this far behind, so it is stale or truncated rather than merely out
        // of date — the artifact hand-off can hand back an old artifact just as
        // easily as no artifact at all. Adopting the catalog here would mark
        // every one of these cards as seen and owed to nobody, losing the lot,
        // so bail out with the results file untouched and let the next run try
        // again with the older, better artifact. See issue #10
        if (ledger.known.length > 0) {
            safeToSaveLedger = false;
            throw new Error(
                `Found ${unseenCount} unseen cards against a ledger of ${ledger.known.length}, which is way too many to be real. Refusing to run: the ledger looks stale, and recording these without sending them would lose all of them. The results file has been left untouched.`,
            );
        }

        // the ledger is deliberately empty, which is how a first run says
        // "adopt whatever Scryfall has right now as the baseline". Nobody wants
        // tens of thousands of e-mails, so the catalog is recorded as seen and
        // owed to nobody — the one case where that is the intended outcome
        console.log(
            'The ledger is empty, so this is a bootstrap:',
            catalog.length,
            'cards will be recorded as already seen without being sent.',
        );
        ledger = DeliveryLedger.adoptCatalog(catalog, activeIds, new Date());
        return;
    }

    // a destination the ledger has never heard of starts caught up. Adding a
    // recipient must not owe them the entire back catalogue
    ledger = DeliveryLedger.ensureDestinations(ledger, activeIds, new Date());

    // cards that have left the catalog can never be fetched again, so stop
    // owing them to anybody
    const eviction = DeliveryLedger.evictWithdrawn(ledger, catalog, activeIds);
    ledger = eviction.ledger;
    if (eviction.evicted.length > 0) {
        console.log(
            'Evicted',
            eviction.evicted.length,
            'cards that are no longer in the catalog:',
            Util.summarizeList(eviction.evicted),
        );
    }

    // everything in the catalog that has never been seen is now owed to every
    // active destination
    const detection = DeliveryLedger.detect(ledger, catalog, activeIds);
    ledger = detection.ledger;
    console.log(
        'Detected',
        detection.detected.length,
        'new card names:',
        Util.summarizeList(detection.detected),
    );

    // work the queue. Each card is fetched once and then delivered to every
    // active destination that is still owed it, and each confirmed delivery is
    // written to disk on its own
    const work = DeliveryLedger.queue(ledger, activeIds);
    console.log(work.length, 'cards are outstanding somewhere.');

    const stats: RunStats = { attempted: {}, delivered: {}, fetchFailures: 0 };
    const consecutiveFailures: Partial<Record<DestinationId, number>> = {};
    const downThisRun = new Set<DestinationId>();
    let cardsDelivered = 0;
    let fetchAttempts = 0;

    for (const cardName of work) {
        if (cardsDelivered >= MAX_CARDS_PER_RUN) {
            console.log('Reached the per-run delivery limit.');
            break;
        }
        if (fetchAttempts >= MAX_FETCH_ATTEMPTS_PER_RUN) {
            console.log('Reached the per-run fetch limit.');
            break;
        }

        const owed = DeliveryLedger.destinationsOwed(
            ledger,
            cardName,
            activeIds,
        ).filter((destinationId) => {
            return !downThisRun.has(destinationId);
        });
        // only destinations that are down still want this card, so there is
        // nothing to do with it and no reason to spend a fetch on it
        if (owed.length === 0) {
            continue;
        }

        fetchAttempts += 1;
        let card: CardToSend;
        try {
            // eslint-disable-next-line no-await-in-loop
            card = await resolveCard(cardName);
        } catch (error) {
            // A card that cannot be fetched is neither sent nor recorded as
            // sent. It goes to the back of every queue that holds it so it
            // cannot block anything, and gets retried on a later run. A catalog
            // entry with no card behind it — "Wargling" — used to throw partway
            // through sending and abort the whole run. See issue #8
            console.error(
                `Could not fetch card "${cardName}", so it keeps its place in the queue:`,
                Util.describeError(error),
            );
            stats.fetchFailures += 1;
            ledger = DeliveryLedger.rotateToBack(ledger, cardName);
            continue;
        }

        let anyDelivered = false;
        for (const destinationId of owed) {
            const destination = destinations.find((candidate) => {
                return candidate.id === destinationId;
            });
            if (destination === undefined) {
                continue;
            }

            stats.attempted[destinationId] =
                (stats.attempted[destinationId] ?? 0) + 1;
            try {
                // eslint-disable-next-line no-await-in-loop
                await destination.send(card);
            } catch (error) {
                console.error(
                    `Could not deliver "${cardName}" to ${destination.name}, so it stays owed:`,
                    Util.describeError(error),
                );
                const failures = (consecutiveFailures[destinationId] ?? 0) + 1;
                consecutiveFailures[destinationId] = failures;
                if (failures >= DESTINATION_FAILURE_LIMIT) {
                    console.error(
                        `${destination.name} has failed ${failures} times in a row. Skipping it for the rest of this run; it keeps everything it is owed.`,
                    );
                    downThisRun.add(destinationId);
                }
                continue;
            }

            // the delivery is confirmed, so this is the moment — and the only
            // moment — the card stops being owed to this destination
            console.log(`Delivered "${cardName}" to ${destination.name}.`);
            consecutiveFailures[destinationId] = 0;
            stats.delivered[destinationId] =
                (stats.delivered[destinationId] ?? 0) + 1;
            ledger = DeliveryLedger.markDelivered(
                ledger,
                cardName,
                destinationId,
                new Date(),
            );
            FileTools.saveLedger(ledger);
            anyDelivered = true;
        }

        // this card's images are no longer needed by anybody
        FileTools.removeFiles(card.imagePaths);

        if (anyDelivered) {
            cardsDelivered += 1;
            // wait a little to avoid any kind of rate-limiting issues with the
            // e-mail. We're not in a rush here
            // eslint-disable-next-line no-await-in-loop
            await Util.delay(2000);
        }
    }

    console.log(
        'Delivered',
        cardsDelivered,
        'cards;',
        stats.fetchFailures,
        'could not be fetched.',
    );

    // Individual delivery failures do not fail the run — they are ordinary
    // tracked state and the next run retries them. Only accumulation does: a
    // pile of unfetchable names, or a destination that has stopped delivering
    // altogether. See issue #11
    const health = DeliveryLedger.health(ledger, activeIds, stats, new Date());
    if (!health.healthy) {
        health.problems.forEach((problem) => {
            console.error(problem);
        });
        throw new Error(
            'The run finished but the notifier is not healthy. Everything outstanding is still recorded as outstanding and will be retried.',
        );
    }

    console.log('No more new cards to report.');
})()
    .catch((error) => {
        // only this file's own deliberate bail-outs reach here — a failed fetch
        // or delivery is handled in the loop — so the message is the point and
        // the stack that node prints on the way out is enough
        console.error(Util.describeError(error));
        throw error;
    })
    .finally(() => {
        if (!safeToSaveLedger) {
            // the run bailed out without a ledger it could trust, so there is
            // nothing meaningful to write. Leaving the file alone means CI
            // uploads no new artifact and the last known-good one survives for
            // the next run to pick up
            console.log(
                'Leaving the results file untouched, so the last known-good ledger survives.',
            );
        } else {
            // deliveries are already on disk, but eviction, detection and
            // rotation are not until now — and a run that delivered nothing at
            // all still needs to record them
            FileTools.saveLedger(ledger);

            // printed every run, successful or not, because it is the one
            // statement of who is behind and by how much
            console.log('Outstanding by destination:');
            DeliveryLedger.summarize(ledger, activeIds).forEach((line) => {
                console.log(`  ${line}`);
            });
        }

        // remove any remaining stored image files
        FileTools.removeImages();

        // close the e-mailer
        emailer.close();

        console.log('\nDone.');
    });
