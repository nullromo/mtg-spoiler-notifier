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
    public static saveResults = (results: string[]) => {
        fs.writeFileSync('results.json', JSON.stringify(results));
    };
}
