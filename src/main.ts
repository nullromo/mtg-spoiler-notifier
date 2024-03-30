import fs from 'fs';
import axios from 'axios';
import yargs from 'yargs';
import { EMailer } from './e-mail';
import { FileTools } from './fileTools';
import { ScryfallTools } from './scryfallTools';
import { Util } from './util';

// if there are more than this many cards in the new cards list, then something
// has gone wrong and the list of remembered cards should be reset
const CARD_LIST_ERROR_THRESHOLD = 2000;

// restrict the maximum number of cards that can be sent at one time
const MAX_CARDS = 5;

// there is a deprecation warning that shows right now. This line of code can
// show you that it's coming from nodemailer. It's a compatibility issue
// between the newer Node.js version and the older nodemailer version. The
// solution is to wait for a new version of nodemailer to be released
//process.on('warning', (warning) => { console.log(warning.stack); });

// create an e-mailer
const emailer = new EMailer();

const makeSubject = (cardsToSend: unknown[]) => {
    return `${
        cardsToSend.length === 1
            ? '1 New Card'
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
            <div>${card.typeLine} - ${card.manaCost}</div>
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

let discordWebhookURIQuoylesQuarters = '';
let discordWebhookURIEastBayMagic = '';

/* eslint-disable sort-keys */
/* eslint-disable sort-keys-fix/sort-keys-fix */
const emojiDictionary: Partial<Record<string, string>> = {
    W: ':manaw:',
    U: ':manau:',
    B: ':manab:',
    R: ':manar:',
    G: ':manag:',
};
/* eslint-enable sort-keys */
/* eslint-enable sort-keys-fix/sort-keys-fix */

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
        const content = `${makeSubject([cardToSend])}\n${cardToSend.name} - ${
            cardToSend.typeLine
        } - ${cardToSend.manaCost}\n${cardToSend.oracleText}`.replaceAll(
            /\{(?<match>.*?)\}/g,
            (text) => {
                console.log(`text is '${text}'`);
                return emojiDictionary[text] ?? text;
            },
        );
        const embeds = cardToSend.imageWebURIs.map((path) => {
            return { image: { url: path } };
        });
        const sendDiscordMessage = (serverName: string, serverURI: string) => {
            console.log(`Sending discord message to ${serverName}`);
            axios.post(serverURI, { content, embeds }).catch(console.error);
        };
        sendDiscordMessage(
            "Quoyle's Quarters",
            discordWebhookURIQuoylesQuarters,
        );
        //sendDiscordMessage('East Bay Magic', discordWebhookURIEastBayMagic);
    });
};

// main program
(async () => {
    // verify environment variables from GitHub
    discordWebhookURIQuoylesQuarters =
        process.env.SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK ?? '';
    if (discordWebhookURIQuoylesQuarters === '') {
        throw new Error("Unable to get webhook for Quoyle's Quarters.");
    }
    discordWebhookURIEastBayMagic =
        process.env.SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK ?? '';
    if (discordWebhookURIEastBayMagic === '') {
        throw new Error('Unable to get webhook for East Bay Magic.');
    }

    // parse command line arguments
    const args = await yargs
        .option('n', { alias: 'number-to-remove', default: 0, type: 'number' })
        .parse(process.argv);

    // load previous card list
    const previousResults = FileTools.getPreviousResults();
    console.log('There are', previousResults.length, 'known cards.');

    // get current card list
    const allCards = await ScryfallTools.getCardCatalog();
    console.log('There are', allCards.length, 'total cards in Scryfall.');
    console.log(
        'There are',
        allCards.length - previousResults.length,
        'new cards to report.',
    );

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

    // temporary ///////////////////////////////////////////
    newCardNames.push('Abzan Guide');
    // temporary ///////////////////////////////////////////

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
        FileTools.saveResults(allCards);

        // truncate the new card array so the rest of the code doesn't run
        newCardNames.splice(0, newCardNames.length);
    }

    // report new cards in chunks of MAX_CARDS at a time
    while (newCardNames.length > 0) {
        // get a list of cards to send out on this loop
        const cardNamesToSend = newCardNames.slice(0, MAX_CARDS);
        console.log('Will send out', cardNamesToSend.length, 'cards.');

        // get data and images for the new cards
        const cardInfoToSend = cardNamesToSend.map(async (name) => {
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
                manaCost: card.data.mana_cost,
                name,
                oracleText: card.data.oracle_text,
                typeLine: card.data.type_line,
            };
        });

        // wait for all the card images to be saved
        // eslint-disable-next-line no-await-in-loop
        const cardsToSend = await Promise.all(cardInfoToSend);
        console.log('Got information for', cardsToSend.length, 'cards.');

        // send out notifications over discord
        formatAndSendDiscordMessages(cardsToSend);

        // send out notifications over e-mail
        // eslint-disable-next-line no-await-in-loop
        await formatAndSendEmails(cardsToSend);

        // remove the chunk of cards that already got sent out
        newCardNames.splice(0, MAX_CARDS);

        // remove stored image files
        FileTools.removeImages();

        // wait a little to avoid any kind of rate-limiting issues with the
        // e-mail. We're not in a rush here
        // eslint-disable-next-line no-await-in-loop
        await Util.delay(2000);
    }

    // save card list after everything has been sent out
    FileTools.saveResults(allCards);

    console.log('No more new cards to report.');
})()
    .catch((error) => {
        console.log(error);
    })
    .finally(() => {
        // remove any remaining stored image files
        FileTools.removeImages();

        // close the e-mailer
        emailer.close();

        console.log('\nDone.');
    });
