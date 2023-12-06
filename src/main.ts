import fs from 'fs';
import yargs from 'yargs';
import { EMailer } from './e-mail';
import { ScryfallTools } from './scryfallTools';
import { Util } from './util';

//process.on('warning', (warning) => { console.log(warning.stack); });

// create an e-mailer
const emailer = new EMailer();

// get results from previous run
const getPreviousResults = () => {
    try {
        return JSON.parse(
            fs.readFileSync('previous-results.json').toString(),
        ) as string[];
    } catch (error) {
        console.error('Could not find previous results. Using empty list.');
        return [];
    }
};

// save results for this run
const saveResults = (results: string[]) => {
    fs.writeFileSync('results.json', JSON.stringify(results));
};

// main program
(async () => {
    // parse command line arguments
    const args = await yargs
        .option('n', { alias: 'number-to-remove', default: 0, type: 'number' })
        .parse(process.argv);

    // load previous card list
    const previousResults = getPreviousResults();

    // get current card list
    const allCards = await ScryfallTools.getCardCatalog();

    // save card list
    saveResults(allCards);

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
                    cid: nameToCID(card.name),
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
