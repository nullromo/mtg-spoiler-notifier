import fs from 'fs';

export class FileTools {
    // get results from previous run
    public static getPreviousResults = () => {
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
