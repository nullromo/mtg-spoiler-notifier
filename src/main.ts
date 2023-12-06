import fs from 'fs';
import yargs from 'yargs';
import { EMailer } from './e-mail';
import { FileTools } from './fileTools';
import { ScryfallTools } from './scryfallTools';
import { Util } from './util';

// there is a deprecation warning that shows right now. This code can tell that
// it's coming from nodemailer. It's a compatibility issue between the newer
// Node.js version and the older nodemailer version. The solution is to wait
// for a new version of nodemailer to be released
//process.on('warning', (warning) => { console.log(warning.stack); });

// create an e-mailer
const emailer = new EMailer();

// main program
(async () => {
    // parse command line arguments
    const args = await yargs
        .option('n', { alias: 'number-to-remove', default: 0, type: 'number' })
        .parse(process.argv);

    // load previous card list
    const previousResults = FileTools.getPreviousResults();

    // get current card list
    const allCards = await ScryfallTools.getCardCatalog();

    // save card list
    FileTools.saveResults(allCards);

    // remove n cards at random for testing purposes
    for (let n = 0; n < args.n; n += 1) {
        Util.removeRandom(previousResults);
    }

    // find new cards
    const newCardNames = allCards
        .filter((card) => {
            // remove any card in the new card list that was already in the
            // previous card list
            return !previousResults.includes(card);
        })
        .map(async (name) => {
            // get the card details and image
            const card = await ScryfallTools.getCard(name);

            // save the image
            const imagePath = `images/${name}.png`;
            fs.writeFileSync(imagePath, card.image);

            return { imagePath, name };
        });

    // wait for all the card images to be saved
    const newCards = await Promise.all(newCardNames);

    // report new cards
    if (newCards.length > 0) {
        // prepare e-mail content
        const html = `<html>
    <div>
        This is an automated e-mail from <a href="https://github.com/nullromo/mtg-spoiler-notifier/">MTG Spoiler Notifier</a>.
        <br />
        The following cards have been added to Scryfall since the last notification was sent out.
        ${newCards
            .map((card) => {
                const imageSrc = Util.nameToCID(card.name);
                return `<div>
            ${card.name}
            <br />
            <img src="cid:${imageSrc}" />
        </div>`;
            })
            .join('\n        <br />\n        ')}
    </div>
</html>`;
        console.log('Sending e-mail html:', html);

        // send e-mail to all recipients
        await emailer.broadcast(
            html,
            newCards.map((card) => {
                return {
                    cid: Util.nameToCID(card.name),
                    filename: `${card.name}.png`,
                    path: card.imagePath,
                };
            }),
        );
    } else {
        console.log('No new cards to report.');
    }
})()
    .catch((error) => {
        console.log(error);
    })
    .finally(() => {
        // remove stored image files
        const files = fs.readdirSync('./images');
        files.forEach((file) => {
            if (file.startsWith('.')) {
                return;
            }
            const path = `./images/${file}`;
            console.log(`Removing ${path}`);
            fs.unlinkSync(path);
        });

        // close the e-mailer
        emailer.close();
    });
