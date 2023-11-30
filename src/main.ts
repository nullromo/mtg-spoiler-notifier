import fs from 'fs';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';

const emailServer = new SMTPServer({
    authOptional: true,
    onAuth: (auth, session, callback) => {
        console.log('auth');
        callback(null);
    },
    onClose: () => {
        console.log('close');
    },
    onConnect: (session, callback) => {
        console.log('connect');
        callback();
    },
    onData: (stream, session, callback) => {
        console.log('data');
        stream.pipe(process.stdout);
        stream.on('end', callback);
    },
    onMailFrom: (addess, session, callback) => {
        console.log('mailfrom');
        callback();
    },
    onRcptTo: (address, session, callback) => {
        console.log('rcpt to');
        callback();
    },
    secure: false,
});
emailServer.listen(1234);

const transporter = nodemailer.createTransport({
    host: 'localhost',
    port: 1234,
    secure: false,
    tls: { rejectUnauthorized: false },
});

const sendEmail = async () => {
    return new Promise<void>((resolve, reject) => {
        transporter.sendMail(
            {
                from: 'kylerobertkovacs@gmail.com',
                subject: 'Test Subject',
                text: 'Test text',
                to: 'kylerobertkovacs@gmail.com',
            },
            (error, info) => {
                if (error) {
                    console.error(error);
                    reject(error);
                } else {
                    console.log(info);
                    resolve();
                }
            },
        );
    });
};

(async () => {
    console.log('Sending e-mail');
    await sendEmail();
})()
    .catch((error) => {
        console.log(error);
    })
    .finally(() => {
        console.log('Shutting down e-mail transport');
        transporter.close();
        console.log('Shutting down e-mail server');
        emailServer.close();
    });

/*

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
})().catch((error) => {
    console.error(error);
});

*/
