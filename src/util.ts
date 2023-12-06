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
}
