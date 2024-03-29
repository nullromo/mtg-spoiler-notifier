import axios from 'axios';
import { Util } from './util';

// Scryfall asks users to delay 100ms between requests
const SCRYFALL_API_DELAY = 100;

// incomplete type for Scryfall card data
type ScryfallCard = {
    card_faces?: Array<{ image_uris: { png: string } }>;
    image_uris?: { png: string };
    oracle_text: string;
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

    // gets the data and image for a single card by name
    public readonly getCard = async (name: string) => {
        await Util.delay(SCRYFALL_API_DELAY);
        const data: { data: ScryfallCard } = await axios.get(
            `https://api.scryfall.com/cards/named?exact=${name}`,
        );
        await Util.delay(SCRYFALL_API_DELAY);
        const imagePromises: Array<Promise<{ data: string }>> = data.data
            .image_uris
            ? [
                  axios.get(data.data.image_uris.png, {
                      responseType: 'arraybuffer',
                  }),
              ]
            : data.data.card_faces
            ? data.data.card_faces.map(async (face) => {
                  return axios.get(face.image_uris.png, {
                      responseType: 'arraybuffer',
                  });
              })
            : [];
        const images = await Promise.all(imagePromises);
        return {
            data: data.data,
            images: images.map((image) => {
                return image.data;
            }),
        };
    };
}

export const ScryfallTools = ScryfallToolsClass.instance;
