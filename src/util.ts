import util from 'util';

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
    public static nameToCID = (name: string) => {
        return name.replaceAll(/\s/g, '');
    };

    public static fullObject = (x: unknown) => {
        return util.inspect(x, { depth: Infinity });
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
