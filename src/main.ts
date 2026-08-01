import fs from 'fs';
import axios from 'axios';
import yargs from 'yargs';
import type { DiscordServer } from './discordData';
import { discordServers } from './discordData';
import { EMailer } from './e-mail';
import { FileTools } from './fileTools';
import { ScryfallTools } from './scryfallTools';
import { Symbols } from './symbols';
import { Util } from './util';

// if there are more than this many cards in the new cards list, then something
// has gone wrong and the list of remembered cards should be reset
const CARD_LIST_ERROR_THRESHOLD = 10000;

// restrict the maximum number of cards that can be sent at one time
const MAX_CARDS_PER_LOOP = 1;

// restruct the maximum number of cards that can be processed in one run. There
// are daily e-mail limits, meaning if the spoiler notifier gets too far
// behind, it will have too large of a batch to process and it will fail every
// single time. To prevent that, the progress should be "saved" every so often
// so that some results can be "locked in" and the spoiler notifier won't get
// permanently stuck with a big batch of updates that can never complete
// successfully
const MAX_CARDS_PER_RUN = 20;

// there is a deprecation warning that shows right now. This line of code can
// show you that it's coming from nodemailer. It's a compatibility issue
// between the newer Node.js version and the older nodemailer version. The
// solution is to wait for a new version of nodemailer to be released
//process.on('warning', (warning) => { console.log(warning.stack); });

// create an e-mailer
const emailer = new EMailer();

const makeSubject = (cardsToSend: Array<{ name: string }>) => {
    return `${
        cardsToSend.length === 1
            ? `New Card: [[${cardsToSend[0].name}]]`
            : `${cardsToSend.length} New Cards`
    }! MTG Spoiler Notification ${new Date().toLocaleString()}`;
};

const formatAndSendEmails = async (
    cardsToSend: Array<{
        imagePaths: string[];
        name: string;
        oracleText: string;
        manaCost: string;
        typeLine: string;
    }>,
) => {
    // prepare e-mail content
    const html = `<html>
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
                            card.manaCost
                                ? `${Symbols.dot} ${card.manaCost}`
                                : ''
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
    console.log('Sending e-mail html:', html);

    // send e-mail to all recipients
    await emailer.broadcast(
        makeSubject(cardsToSend),
        html,
        Util.flattenArray(
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
        ),
    );
};

const formatAndSendDiscordMessages = (
    cardsToSend: Array<{
        imageWebURIs: string[];
        name: string;
        oracleText: string;
        manaCost: string;
        typeLine: string;
    }>,
) => {
    cardsToSend.forEach((cardToSend) => {
        const content = `${makeSubject([cardToSend])}\n### ${
            cardToSend.name
        }\n${cardToSend.typeLine} ${
            cardToSend.manaCost ? `${Symbols.dot} ${cardToSend.manaCost}` : ''
        }\n${cardToSend.oracleText
            // italicize reminder text
            .replaceAll(/\(/g, '_(')
            .replaceAll(/\)/g, ')_')}`;
        const embeds = cardToSend.imageWebURIs.map((path) => {
            return { image: { url: path } };
        });
        const sendDiscordMessage = (discordServer: DiscordServer) => {
            console.log(`Sending discord message to ${discordServer.name}`);
            axios
                .post(discordServer.webhookURI, {
                    // insert emoji
                    content: content.replaceAll(
                        /\{(?<match>.*?)\}/g,
                        (text, group1: string) => {
                            return (
                                discordServer.emojiDictionary[group1] ?? text
                            );
                        },
                    ),
                    embeds,
                })
                .catch(console.error);
        };

        discordServers.forEach((discordServer) => {
            sendDiscordMessage(discordServer);
        });
    });
};

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

// track cards that had been sent out during previous runs
const previousResults: string[] = [];
// track cards that were successfully sent out
const successfullySentCards: string[] = [];

// track whether results file has been saved
let savedResults = false;

// main program
(async () => {
    // parse command line arguments
    const args = await yargs
        .option('n', { alias: 'number-to-remove', default: 0, type: 'number' })
        .parse(process.argv);

    // load previous card list
    previousResults.push(...FileTools.getPreviousResults());
    console.log('There are', previousResults.length, 'known cards.');

    // get current card list
    const allCards = await ScryfallTools.getCardCatalog();
    console.log('There are', allCards.length, 'total cards in Scryfall.');
    // NOTE: sometimes cards are added under temporary names. These are later
    // removed. However, we keep them around in the results list because
    // sometimes they are not fixed quickly and we don't want to remove them
    // from the results because then they will keep on generating
    // notifications. For this reason, the length of previousResults can
    // be longer than the length of allCards
    console.log(previousResults.length, 'total cards have been reported.');

    // remove n cards at random for testing purposes
    if (args.n > 0) {
        console.log('Removing', args.n, 'random cards for testing purposes.');
        for (let n = 0; n < args.n; n += 1) {
            Util.removeRandom(previousResults);
        }
    }

    // find new cards
    const newCardNames = allCards.filter((card) => {
        // remove any card in the new card list that was already in the
        // previous card list
        return !previousResults.includes(card);
    });

    console.log('Detected', newCardNames.length, 'new card names.');
    console.log('New card names:', Util.fullObject(newCardNames));

    // if there are way too many new cards, then some error occurred while
    // trying to save the previous card list
    if (newCardNames.length > CARD_LIST_ERROR_THRESHOLD) {
        console.log(
            'There were',
            newCardNames.length,
            'new cards, which is way too many to be real. Saving the list for next time.',
        );

        // just save the card list and try again next time
        FileTools.saveResults(previousResults, allCards);
        savedResults = true;

        // truncate the new card array so the rest of the code doesn't run
        newCardNames.splice(0, newCardNames.length);
    }

    // PHASE 1: fetch the data and images for every card BEFORE sending
    // anything out. A card that cannot be fetched is skipped: it is neither
    // sent nor recorded as sent, so it gets retried on the next run.
    // Previously a single unfetchable name (a catalog entry with no card
    // behind it, like "Wargling") threw partway through sending, which
    // aborted the whole run. That made the process exit non-zero, which meant
    // CI never uploaded the results file, which meant every card already sent
    // that run got sent again on the next run, forever. See issue #8.
    const cardNamesThisRun = newCardNames.slice(0, MAX_CARDS_PER_RUN);
    console.log('Will look up', cardNamesThisRun.length, 'cards.');

    const cardsToSend: CardToSend[] = [];
    const unfetchableCardNames: string[] = [];
    for (const name of cardNamesThisRun) {
        try {
            // eslint-disable-next-line no-await-in-loop
            cardsToSend.push(await resolveCard(name));
        } catch (error) {
            console.error(`Could not fetch card "${name}". Skipping it.`);
            console.error(error);
            unfetchableCardNames.push(name);
        }
    }

    if (unfetchableCardNames.length > 0) {
        console.log(
            'Could not fetch',
            unfetchableCardNames.length,
            'cards. They will be retried next run:',
            Util.fullObject(unfetchableCardNames),
        );
    }
    console.log('Got information for', cardsToSend.length, 'cards.');

    // PHASE 2: all of the data is in hand, so start sending notifications.
    // NOTE: the images are not cleaned up between chunks any more, because
    // every card's images are already on disk by this point and removeImages
    // would delete the ones that have not been sent yet. The finally block at
    // the bottom of this file removes them all once the run is over
    for (
        let index = 0;
        index < cardsToSend.length;
        index += MAX_CARDS_PER_LOOP
    ) {
        const chunk = cardsToSend.slice(index, index + MAX_CARDS_PER_LOOP);
        console.log('Will send out', chunk.length, 'cards.');

        // send out notifications over e-mail.
        // NOTE: Do this BEFORE sending discord messages because the e-mailer
        // has a daily limit. If we attempt the e-mail first and it fails, then
        // it will fail before the discord messages are sent and we won't keep
        // on sending extra discord messgaes all the time
        // eslint-disable-next-line no-await-in-loop
        await formatAndSendEmails(chunk);

        // send out notifications over discord
        formatAndSendDiscordMessages(chunk);

        // record what went out immediately, so that if a later chunk fails
        // these cards are still remembered and never sent a second time
        successfullySentCards.push(
            ...chunk.map((card) => {
                return card.name;
            }),
        );

        // wait a little to avoid any kind of rate-limiting issues with the
        // e-mail. We're not in a rush here
        // eslint-disable-next-line no-await-in-loop
        await Util.delay(2000);
    }

    console.log('No more new cards to report.');
})()
    .catch((error) => {
        console.log(error);
        throw error;
    })
    .finally(() => {
        if (!savedResults) {
            // save card list after everything has been sent out. The saved
            // list is the previous list plus everything that was successfully
            // sent out this run. If the results were already saved earlier,
            // this is skipped
            FileTools.saveResults(previousResults, successfullySentCards);
        }

        // remove any remaining stored image files
        FileTools.removeImages();

        // close the e-mailer
        emailer.close();

        console.log('\nDone.');
    });
