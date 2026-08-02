export class Util {
    // returns a promise that resolves an amount of milliseconds in the future
    public static readonly delay = async (amount: number) => {
        return new Promise((resolve) => {
            setTimeout(resolve, amount);
        });
    };

    // removes a random element from an array in place and also returns the array
    public static readonly removeRandom = <T>(list: T[]) => {
        return list.splice(Math.floor(Math.random() * list.length), 1);
    };

    // convert a card name to an appropriate content ID for html purposes
    // Note: there may be edge cases to handle here
    public static nameToCID = (name: string, index: number) => {
        return `${name.replaceAll(/[\s/]/g, '')}${
            index > 0 ? `_face${index + 1}` : ''
        }`;
    };

    // A one-line description of a failure, for the many failures here that are
    // routine and expected.
    //
    // console.error(error) on an axios rejection prints the entire request,
    // response, socket and agent — 353 lines of a 632-line run log for a single
    // 404 on "Wargling", which is a card name the catalog lists and Scryfall
    // has no card for. That is ordinary. Anything genuinely unexpected still
    // gets its stack, because that is when a stack is worth reading
    public static describeError = (error: unknown) => {
        const axiosError = error as {
            config?: { method?: string; url?: string };
            isAxiosError?: boolean;
            message?: string;
            response?: { data?: { details?: string }; status?: number };
        };
        if (axiosError.isAxiosError === true) {
            const method = axiosError.config?.method?.toUpperCase() ?? '?';
            const url = axiosError.config?.url ?? '?';
            const status = axiosError.response?.status ?? 'no response';
            const details = axiosError.response?.data?.details;
            return `HTTP ${status} on ${method} ${url}${
                details === undefined ? '' : ` — ${details}`
            }`;
        }
        if (error instanceof Error) {
            return error.stack ?? `${error.name}: ${error.message}`;
        }
        return String(error);
    };

    // "Alpha, Bravo, Charlie and 17 more". Card-name lists are unbounded — a
    // set release detects hundreds at once — and printing every one of them
    // buries everything else in the log
    public static summarizeList = (items: string[], limit = 8) => {
        if (items.length === 0) {
            return 'none';
        }
        if (items.length <= limit) {
            return items.join(', ');
        }
        return `${items.slice(0, limit).join(', ')} and ${
            items.length - limit
        } more`;
    };

    public static flattenArray = <T>(array: Array<T | T[]>) => {
        return array.reduce<T[]>((result, item) => {
            if (Array.isArray(item)) {
                return [...result, ...item];
            }
            return [...result, item];
        }, []);
    };
}
