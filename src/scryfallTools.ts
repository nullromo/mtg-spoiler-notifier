import axios from 'axios';
import { Util } from './util';

// Scryfall asks users to delay 100ms between requests
const SCRYFALL_API_DELAY = 100;

// incomplete type for one printed side of a Scryfall card. A single-faced
// card carries all of this at the top level and has no card_faces at all, so
// the card type below is this same shape plus the card-wide fields
type ScryfallFace = {
    defense?: string;
    image_uris?: { png: string };
    loyalty?: string;
    mana_cost?: string;
    name?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    type_line?: string;
};

// incomplete type for Scryfall card data. Everything a face can have moves
// inside card_faces on a double-faced card; rarity and scryfall_uri describe
// the card as a whole and only ever appear at the top level
type ScryfallCard = ScryfallFace & {
    card_faces?: ScryfallFace[];
    rarity?: string;
    scryfall_uri?: string;
};

// One printed side of a card. Type line, mana cost, oracle text and stats
// belong to a face rather than to the card, which is the whole reason this
// type exists: flattening two faces into "A // B" put the back face's text
// under the front face's picture
export type Face = {
    defense?: string;
    loyalty?: string;
    manaCost?: string;
    name?: string;
    oracleText: string;
    power?: string;
    toughness?: string;
    typeLine: string;
};

// What Scryfall says a card is. Fetched fresh for every delivery and never
// stored — the ledger holds card names, not card detail
export type CardDetail = {
    faces: Face[];
    imageWebURIs: string[];
    name: string;
    rarity?: string;
    scryfallURI?: string;
};

// Scryfall's face shape in this project's terms. Absent text is normalised to
// an empty string because every renderer wants to know "is there anything to
// print" rather than "which of undefined and empty am I holding"
const readFace = (face: ScryfallFace): Face => {
    return {
        defense: face.defense,
        loyalty: face.loyalty,
        manaCost: face.mana_cost,
        name: face.name,
        oracleText: face.oracle_text ?? '',
        power: face.power,
        toughness: face.toughness,
        typeLine: face.type_line ?? '',
    };
};

// A card's printed sides. The top level is the fallback rather than the norm:
// it is where a single-faced card keeps its type line, stats and text, and a
// double-faced card leaves it empty
const readFaces = (card: ScryfallCard): Face[] => {
    if (card.card_faces === undefined || card.card_faces.length === 0) {
        return [readFace(card)];
    }
    return card.card_faces.map(readFace);
};

// The card's images. These deliberately do not promise to line up one-to-one
// with the faces: a transform card carries one image per face, but a split
// card prints both of its faces on a single top-level image
const readImageWebURIs = (card: ScryfallCard): string[] => {
    if (card.image_uris !== undefined) {
        return [card.image_uris.png];
    }
    return (card.card_faces ?? []).flatMap((face) => {
        return face.image_uris === undefined ? [] : [face.image_uris.png];
    });
};

// tools for getting data from Scryfall
class ScryfallToolsClass {
    // singleton instance
    public static readonly instance = new ScryfallToolsClass();

    // private constructor for singleton class
    private constructor() {
        //
    }

    // get a list of all card names in the database
    public readonly getCardCatalog = async () => {
        await Util.delay(SCRYFALL_API_DELAY);
        return axios
            .get('https://api.scryfall.com/catalog/card-names')
            .then((result) => {
                return (
                    result.data as {
                        object: string;
                        uri: string;
                        total_values: number;
                        data: string[];
                    }
                ).data;
            });
    };

    // Gets the detail and images for a single card by name. Scryfall's own
    // shape stops here: callers get faces, rarity and a page link, and never
    // have to know which of those the API hides inside card_faces
    public readonly getCard = async (
        name: string,
    ): Promise<{ card: CardDetail; images: string[] }> => {
        await Util.delay(SCRYFALL_API_DELAY);
        const response: { data: ScryfallCard } = await axios.get(
            `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
                name,
            )}`,
        );
        // the catalog name is the card's identity everywhere else in this
        // project, so it stays the name here too rather than whatever the
        // response happens to call it
        const card: CardDetail = {
            faces: readFaces(response.data),
            imageWebURIs: readImageWebURIs(response.data),
            name,
            rarity: response.data.rarity,
            scryfallURI: response.data.scryfall_uri,
        };
        await Util.delay(SCRYFALL_API_DELAY);
        const images = await Promise.all(
            card.imageWebURIs.map(async (uri) => {
                return axios.get<string>(uri, { responseType: 'arraybuffer' });
            }),
        );
        return {
            card,
            images: images.map((image) => {
                return image.data;
            }),
        };
    };
}

export const ScryfallTools = ScryfallToolsClass.instance;
