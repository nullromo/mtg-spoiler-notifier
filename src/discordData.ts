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
        {
            0: '<:mana0:1223688827370213518>',
            1: '<:mana1:1223433695499653160>',
            2: '<:mana2:1223688891538735168>',
            '2B': '<:mana2b:1223433699094429729>',
            '2G': '<:mana2g:1223433634401353771>',
            '2R': '<:mana2r:1223433635781283950>',
            '2U': '<:mana2u:1223433637425578005>',
            '2W': '<:mana2w:1223433638704840774>',
            3: '<:mana3:1223433640139165706>',
            4: '<:mana4:1223433641863155712>',
            5: '<:mana5:1223433643385552896>',
            6: '<:mana6:1223688142477983754>',
            7: '<:mana7:1223433646359445574>',
            8: '<:mana8:1223688168214368366>',
            9: '<:mana9:1223433649584865402>',
            B: '<:manab:1223688237470453762>',
            BG: '<:manabg:1223433653443498094>',
            BP: '<:manabp:1223688284547579994>',
            BR: '<:manabr:1223433656958451843>',
            C: '<:manac:1223688347629781053>',
            E: '<:manae:1223433660422688788>',
            G: '<:manag:1223688392898777170>',
            GP: '<:managp:1223433663983915159>',
            GU: '<:managu:1223688435248791695>',
            GW: '<:managw:1223433667402010706>',
            Q: '<:manaq:1223688486536740984>',
            R: '<:manar:1223433670896128043>',
            RG: '<:manarg:1223688555574988942>',
            RP: '<:manarp:1223433674364551199>',
            RW: '<:manarw:1223688614513217627>',
            S: '<:manas:1223433678571700316>',
            T: '<:manat:1223433680953937971>',
            U: '<:manau:1223688659145064639>',
            UB: '<:manaub:1223433684749647895>',
            UP: '<:manaup:1223688708365221991>',
            UR: '<:manaur:1223433688092643360>',
            W: '<:manaw:1223688761364320327>',
            WB: '<:manawb:1223433692127563807>',
            WP: '<:manawp:1223688037708464158>',
            WU: '<:manawu:1223433631863934977>',
            X: '<:manax:1223433633042403448>',
        },
        process.env.SECRET_QUOYLES_QUARTERS_DISCORD_WEBHOOK ?? '',
    ),
    new DiscordServer(
        'East Bay Magic',
        {
            0: '<:mana0:1223438190296174756>',
            1: '<:mana1:1223438185107951708>',
            2: '<:mana2:1223438186244477060>',
            '2B': '<:mana2b:1223686849491370016>',
            '2G': '<:mana2g:1223686529734672535>',
            '2R': '<:mana2r:1223686525498298438>',
            '2U': '<:mana2u:1223686526848991456>',
            '2W': '<:mana2w:1223686528153288785>',
            3: '<:mana3:1223438012893892668>',
            4: '<:mana4:1223438015075188859>',
            5: '<:mana5:1223438016379621386>',
            6: '<:mana6:1223438017541439530>',
            7: '<:mana7:1223438019114303518>',
            8: '<:mana8:1223438021018259556>',
            9: '<:mana9:1223438011661029456>',
            B: '<:manab:1223438059488678029>',
            BG: '<:manabg:1223686610474762323>',
            BP: '<:manabp:1223686612303610036>',
            BR: '<:manabr:1223686609652813904>',
            C: '<:manac:1223438058209280020>',
            E: '<:manae:1223438307288027236>',
            G: '<:manag:1223438138819477586>',
            GP: '<:managp:1223686663054561431>',
            GU: '<:managu:1223686664577351700>',
            GW: '<:managw:1223686661838340219>',
            Q: '<:manaq:1223438364313784330>',
            R: '<:manar:1223438135367831653>',
            RG: '<:manarg:1223686718100869160>',
            RP: '<:manarp:1223686719283396709>',
            RW: '<:manarw:1223686716745842898>',
            S: '<:manas:1223438136529522761>',
            T: '<:manat:1223438137729220773>',
            U: '<:manau:1223438187654025408>',
            UB: '<:manaub:1223686779903934505>',
            UP: '<:manaup:1223686781216493720>',
            UR: '<:manaur:1223686778762956901>',
            W: '<:manaw:1223438189025562764>',
            WB: '<:manawb:1223686823193084006>',
            WP: '<:manawp:1223686464286756885>',
            WU: '<:manawu:1223686483609780284>',
            X: '<:manax:1223437959488082051>',
        },
        process.env.SECRET_EAST_BAY_MAGIC_DISCORD_WEBHOOK ?? '',
    ),
];
