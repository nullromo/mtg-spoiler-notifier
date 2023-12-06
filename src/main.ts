import fs from 'fs';
import axios from 'axios';
import { EMailer } from './e-mail';

// create an e-mailer
const emailer = new EMailer();

// get results from previous run
const getPreviousResults = () => {
    try {
        return JSON.parse(
            fs.readFileSync('previous-results.txt').toString(),
        ) as string[];
    } catch (error) {
        console.error(error);
        return [];
    }
};

// save results for this run
const saveResults = (results: string[]) => {
    fs.writeFileSync('results.txt', JSON.stringify(results));
};

// get a list of all cards from Scryfall
const getCardCatalog = async () => {
    return axios
        .get('https://api.scryfall.com/catalog/card-names')
        .then((result) => {
            return (
                result.data as {
                    object: string;
                    uri: string;
                    total_values: number;
                    data: string[];
                }
            ).data;
        });
};

const nameToCID = (name: string) => {
    return name.replaceAll(/\s/g, '');
};

(async () => {
    // load previous card list
    const previousResults = getPreviousResults();

    // get current card list and save it
    const allCards = await getCardCatalog();
    // remove two cards at random for testing purposes
    allCards.splice(Math.floor(Math.random() * allCards.length), 1);
    allCards.splice(Math.floor(Math.random() * allCards.length), 1);
    saveResults(allCards);

    // find new cards
    const newCardNames = allCards
        .filter((card) => {
            return !previousResults.includes(card);
        })
        .map(async (name) => {
            const cardData: { data: { image_uris: { png: string } } } =
                await axios.get(
                    `https://api.scryfall.com/cards/named?exact=${name}`,
                );
            const cardImage: { data: string } = await axios.get(
                cardData.data.image_uris.png,
                { responseType: 'arraybuffer' },
            );
            const imagePath = `images/${name}.png`;
            fs.writeFileSync(imagePath, cardImage.data);
            return { imagePath, name };
        });

    const newCards = await Promise.all(newCardNames);

    // report new cards
    if (newCards.length > 0) {
        const html = `<html>
    <div>
        This is an automated e-mail from <a href="https://github.com/nullromo/mtg-spoiler-notifier/">MTG Spoiler Notifier</a>.
        <br />
        The following cards have been added to Scryfall since the last notification was sent out.
        ${newCards
            .map((card) => {
                const imageSrc = nameToCID(card.name);
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
