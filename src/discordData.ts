type EmojiDictionary = Partial<Record<string, string>>;

export class DiscordServer {
    public readonly name: string;

    public readonly emojiDictionary: EmojiDictionary;

    public readonly webhookURI: string;

    public constructor(
        name: string,
        emojiDictionary: EmojiDictionary,
        webhook: string,
    ) {
        // verify environment variable from GitHub
        if (webhook === '') {
            throw new Error(`Unable to get webhook for ${name}.`);
        }
        this.name = name;
        this.emojiDictionary = emojiDictionary;
        this.webhookURI = webhook;
    }
}

export const discordServers = [
    new DiscordServer(
        "Quoyle's Quarters",
        /* eslint-disable sort-keys */
        /* eslint-disable sort-keys-fix/sort-keys-fix */
        {
            // TODO: add the rest
            R: '<:manar:1223433670896128043>',
            3: '<:mana3:1223433640139165706>',
        },
        /* eslint-enable sort-keys */
        /* eslint-enable sort-keys-fix/sort-keys-fix */
        process.env.SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK ?? '',
    ),
    new DiscordServer(
        'East Bay Magic',
        /* eslint-disable sort-keys */
        /* eslint-disable sort-keys-fix/sort-keys-fix */
        {
            // TODO: add the rest
            W: '<:manaw:1223438189025562764>',
            U: '<:manau:1223438187654025408>',
            B: '<:manab:1223438059488678029>',
            R: '<:manar:1223438135367831653>',
            G: '<:manag:1223438138819477586>',
            0: '<:mana0:1223438190296174756>',
            1: '<:mana1:1223438185107951708>',
            2: '<:mana2:1223438186244477060>',
            3: '<:mana3:1223438012893892668>',
            4: '<:mana4:1223438015075188859>',
            5: '<:mana5:1223438016379621386>',
            6: '<:mana6:1223438017541439530>',
            7: '<:mana7:1223438019114303518>',
            8: '<:mana8:1223438021018259556>',
            9: '<:mana9:1223438011661029456>',
            T: '<:manat:1223438137729220773>',
            Q: '<:manaq:1223438364313784330>',
            X: '<:manax:1223437959488082051>',
            C: '<:manac:1223438058209280020>',
            S: '<:manas:1223438136529522761>',
            E: '<:manae:1223438307288027236>',
        },
        /* eslint-enable sort-keys */
        /* eslint-enable sort-keys-fix/sort-keys-fix */
        process.env.SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK ?? '',
    ),
];
