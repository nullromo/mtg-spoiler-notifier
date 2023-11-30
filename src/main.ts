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
    const previousResults = getPreviousResults();
    const allCards = await getCardCatalog();
    const newCards = allCards.filter((card) => {
        return !previousResults.includes(card);
    });
    saveResults(newCards);
    await emailer.broadcast('Test text');
})()
    .catch((error) => {
        console.log(error);
    })
    .finally(() => {
        emailer.close();
    });
