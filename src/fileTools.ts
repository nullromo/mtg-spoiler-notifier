import fs from 'fs';

// the outcome of trying to read the remembered card list. An unreadable list
// and a genuinely empty one used to both come back as [], which made them
// indistinguishable — and the difference matters enormously. An empty list
// means "nothing has ever been reported"; an unreadable one means "we have no
// idea what has been reported", and acting on that mistakes the entire Scryfall
// catalog for new cards. See issue #10
export type PreviousResultsLoad =
    | { status: 'loaded'; cardNames: string[] }
    | { status: 'unreadable'; reason: string };

export class FileTools {
    // get results from previous run
    public static getPreviousResults = (): PreviousResultsLoad => {
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

        let parsed: unknown;
        try {
            parsed = JSON.parse(contents);
        } catch (error) {
            return {
                reason: `previous-results.json is not valid JSON: ${String(
                    error,
                )}`,
                status: 'unreadable',
            };
        }

        if (
            !Array.isArray(parsed) ||
            parsed.some((cardName) => {
                return typeof cardName !== 'string';
            })
        ) {
            return {
                reason: 'previous-results.json is not an array of card names.',
                status: 'unreadable',
            };
        }

        // an empty array here is a real answer: the file was written on purpose
        // to say that no cards have been reported yet
        return { cardNames: parsed as string[], status: 'loaded' };
    };

    // save results for this run
    public static saveResults = (
        previousResults: string[],
        results: string[],
    ) => {
        const allResults = [...new Set([...previousResults, ...results])];

        // now that CI uploads the results file even when the run fails, an
        // early crash (before the previous results were loaded) could
        // otherwise overwrite the remembered card list with an empty one and
        // wipe out everything the notifier knows
        if (allResults.length === 0) {
            console.log('Refusing to save an empty results list.');
            return;
        }

        const resultsFileContents = JSON.stringify(allResults.sort(), null, 4);
        console.log('Writing results file contents:', resultsFileContents);
        fs.writeFileSync('results.json', resultsFileContents);
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
