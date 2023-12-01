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

(async () => {
    // load previous card list
    const previousResults = getPreviousResults();

    // get current card list and save it
    const allCards = await getCardCatalog();
    // remove one card at random for testing purposes
    allCards.splice(Math.floor(Math.random() * allCards.length), 1);
    saveResults(allCards);

    // find new cards
    const newCardNames = allCards
        .filter((card) => {
            return !previousResults.includes(card);
        })
        .map(async (name) => {
            const cardData = (await axios.get(
                `https://api.scryfall.com/cards/named?exact=${name}`,
            )) as { data: { image_uris: { png: string } } };
            const cardImage = await axios.get(cardData.data.image_uris.png, {
                responseType: 'arraybuffer',
            });
            const imagePath = `images/${name}.png`;
            fs.writeFileSync(imagePath, cardImage.data);
            return { name, imagePath };
        });

    const newCards = await Promise.all(newCardNames);

    // report new cards
    if (newCards.length > 0) {
        const html = `
<html>
    <div>
        The following cards have been added to Scryfall: ${newCards
            .map((card) => {
                return `<div>${card.name}<br /><img src="cid:${card.name}" /></div>`;
            })
            .join('<br />')}
    </div>
</html>
`;
        console.log('Sending e-mail html:', html);
        await emailer.broadcast(
            html,
            newCards.map((card) => {
                return {
                    filename: `${card.name}.png`,
                    path: card.imagePath,
                    cid: card.name,
                };
            }),
        );
    }
})()
    .catch((error) => {
        console.log(error);
    })
    .finally(() => {
        emailer.close();
    });
