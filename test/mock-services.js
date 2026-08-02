// Preloaded with `ts-node -r` in front of src/main.ts so the notifier can be
// run end-to-end offline: Scryfall, Gmail and Discord are all replaced with
// deterministic local fakes.
//
// Configured entirely through environment variables so the shell script that
// drives it stays in charge of the scenario:
//   HARNESS_CATALOG           path to a JSON array of card names
//   HARNESS_BROKEN            JSON array of names that 404 on /cards/named
//   HARNESS_EMAIL_FAILS_ON    substring of a subject whose send should fail
//   HARNESS_EMAIL_FAILS_FOR   substring of a recipient whose sends should fail
//   HARNESS_DISCORD_FAILS_ON  substring of a webhook URI whose posts should fail
//   NOTIFY_LOG                file to append one line per notification sent
//
// Every delivery is logged as "<destination>|<subject>", one line each, so a
// scenario can assert not just that a card went out but exactly who received
// it — which is the whole point of tracking delivery per destination.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

// Resolve these EXACTLY the way src/*.ts does. Requiring the package
// directory by absolute path skips the "exports" map and hands back axios's
// ESM build, which on Node >= 22 is a frozen namespace object and a different
// module instance from the CommonJS one the app actually gets.
const fromSrc = (name) => {
    return require(require.resolve(name, { paths: [path.join(REPO, 'src')] }));
};
const axios = fromSrc('axios');
const nodemailer = fromSrc('nodemailer');

const CATALOG = JSON.parse(
    fs.readFileSync(process.env.HARNESS_CATALOG).toString(),
);
const BROKEN = new Set(JSON.parse(process.env.HARNESS_BROKEN || '[]'));
const EMAIL_FAILS_ON = process.env.HARNESS_EMAIL_FAILS_ON || '';
const EMAIL_FAILS_FOR = process.env.HARNESS_EMAIL_FAILS_FOR || '';
const DISCORD_FAILS_ON = process.env.HARNESS_DISCORD_FAILS_ON || '';
const NOTIFY_LOG = process.env.NOTIFY_LOG;

// this file is the assertion surface: one line per notification that actually
// went out, naming the destination that received it
const logDelivery = (destination, subject) => {
    fs.appendFileSync(NOTIFY_LOG, `${destination}|${subject}\n`);
};

// Collapse the polite API/rate-limit delays. Nothing here talks to a real
// network, so there is nothing to be polite to, and it keeps the suite fast.
const realSetTimeout = global.setTimeout;
global.setTimeout = (callback, ms, ...rest) => {
    return realSetTimeout(callback, Math.min(ms || 0, 1), ...rest);
};

// PNG magic bytes; main.ts only ever writes these straight to disk
const FAKE_PNG = Buffer.from('89504e470d0a1a0a', 'hex');

axios.get = async (url) => {
    if (url.includes('/catalog/card-names')) {
        return {
            data: {
                data: CATALOG,
                object: 'catalog',
                total_values: CATALOG.length,
                uri: url,
            },
        };
    }

    const named = /\/cards\/named\?exact=(?<name>.*)$/.exec(url);
    if (named) {
        const name = decodeURIComponent(named.groups.name);
        if (BROKEN.has(name)) {
            // exactly what Scryfall does for a catalog name with no card
            // behind it, e.g. "Wargling" on 2026-08-01.
            // NOTE: this has to carry `isAxiosError` and `config` as well as
            // `response`, because that is what a real axios rejection looks
            // like and what Util.describeError keys off to decide between a
            // one-line summary and a full stack
            const error = new Error('Request failed with status code 404');
            error.isAxiosError = true;
            error.code = 'ERR_BAD_REQUEST';
            error.config = { method: 'get', url };
            error.response = {
                data: {
                    code: 'not_found',
                    details: `No cards found matching “${name}”`,
                    object: 'error',
                    status: 404,
                },
                status: 404,
            };
            throw error;
        }
        return {
            data: {
                image_uris: {
                    png: `https://cards.example/${encodeURIComponent(name)}.png`,
                },
                mana_cost: '{1}{G}',
                oracle_text: 'Test card text.',
                type_line: 'Creature — Test',
            },
        };
    }

    if (url.endsWith('.png')) {
        return { data: FAKE_PNG };
    }

    throw new Error(`Unexpected GET in test harness: ${url}`);
};

// discord webhook
axios.post = async (url, body) => {
    if (DISCORD_FAILS_ON && url.includes(DISCORD_FAILS_ON)) {
        // what a webhook looks like when the server is having a bad day. The
        // post used to be fire-and-forget, so this was logged and forgotten
        // while the card was recorded as reported
        const error = new Error('Request failed with status code 500');
        error.isAxiosError = true;
        error.code = 'ERR_BAD_RESPONSE';
        error.config = { method: 'post', url };
        error.response = { data: {}, status: 500 };
        throw error;
    }
    // the first line of a Discord message is the same subject the e-mail uses
    logDelivery(`discord:${url}`, String(body.content).split('\n')[0]);
    return { data: {} };
};

nodemailer.createTransport = () => {
    return {
        close: () => {},
        sendMail: (options, callback) => {
            // simulate hitting the Gmail daily sending limit
            const failed =
                (EMAIL_FAILS_ON && options.subject.includes(EMAIL_FAILS_ON)) ||
                (EMAIL_FAILS_FOR && options.to.includes(EMAIL_FAILS_FOR));
            if (failed) {
                realSetTimeout(() => {
                    return callback(
                        new Error('Daily user sending limit exceeded'),
                    );
                }, 0);
                return;
            }
            logDelivery(`email:${options.to}`, options.subject);
            realSetTimeout(() => {
                return callback(null, { messageId: 'test-harness' });
            }, 0);
        },
    };
};
