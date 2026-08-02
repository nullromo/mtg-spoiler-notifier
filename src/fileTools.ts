import fs from 'fs';
import type { Ledger, LedgerLoad } from './deliveryLedger';
import { DeliveryLedger } from './deliveryLedger';

export class FileTools {
    // read the ledger the previous run left behind
    public static getPreviousLedger = (): LedgerLoad => {
        let contents: string;
        try {
            contents = fs.readFileSync('previous-results.json').toString();
        } catch (error) {
            // NOTE: the file is never in the repo (it is gitignored); it only
            // ever arrives as the previous run's artifact. So it being absent
            // means the hand-off failed, not that this is a first run
            return {
                reason: `Could not read previous-results.json: ${String(error)}`,
                status: 'unreadable',
            };
        }

        return DeliveryLedger.parse(contents);
    };

    // Write the ledger out. This is called after every single confirmed
    // delivery, not just once at the end of the run, so that a cancelled or
    // killed runner loses at most the one delivery that was in flight rather
    // than every delivery the run had made. See issue #11
    public static saveLedger = (ledger: Ledger) => {
        // now that CI uploads the results file even when the run fails, an
        // early crash (before the previous ledger was loaded) could otherwise
        // overwrite the remembered card list with an empty one and wipe out
        // everything the notifier knows
        if (ledger.known.length === 0) {
            console.log('Refusing to save an empty ledger.');
            return;
        }

        // NOTE: deliberately not logging the contents. This runs up to twenty
        // times per run and the file is the better part of a megabyte
        fs.writeFileSync('results.json', DeliveryLedger.serialize(ledger));
    };

    public static removeFiles = (paths: string[]) => {
        paths.forEach((path) => {
            try {
                fs.unlinkSync(path);
            } catch (error) {
                console.error(`Could not remove ${path}:`, error);
            }
        });
    };

    public static removeImages = () => {
        const files = fs.readdirSync('./images');
        files.forEach((file) => {
            if (file.startsWith('.')) {
                return;
            }
            const path = `./images/${file}`;
            console.log(`Removing ${path}`);
            fs.unlinkSync(path);
        });
    };
}
