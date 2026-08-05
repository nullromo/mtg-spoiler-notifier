// Turning card detail into the text each channel sends.
//
// This lives apart from main.ts so it can be tested without a mail transport,
// a webhook or a network: every function here takes a card and returns a
// string. It is also the reason e-mail and Discord cannot drift apart — they
// describe a card through the same handful of helpers, so a change to how a
// planeswalker's loyalty is written reaches both or neither.

import type { EmojiDictionary } from './discordData';
import type { AttachmentData } from './e-mail';
import type { CardDetail, Face } from './scryfallTools';
import { Symbols } from './symbols';
import { Util } from './util';

// Discord rejects a message whose content runs past this. A rejected post is
// a delivery failure like any other, so the card would stay owed and be
// retried every run until that server hit the failure limit and the run
// started reporting unhealthy. Losing the tail of the text is much the
// smaller loss, and the Scryfall link in the heading still has all of it
const DISCORD_CONTENT_LIMIT = 2000;

// card detail with its images already downloaded to disk, which is everything
// the renderers need to describe one card
export type CardToSend = CardDetail & {
    imagePaths: string[];
};

// Join the parts of a line that are actually present. Filtering first is what
// keeps a back face with no mana cost from printing a dangling separator
const joinParts = (parts: Array<string | undefined>) => {
    return parts
        .filter((part): part is string => {
            return part !== undefined && part !== '';
        })
        .join(` ${Symbols.dot} `);
};

// Scryfall writes rarities in lower case; they read as labels here
const formatRarity = (rarity: string | undefined) => {
    return rarity === undefined || rarity === ''
        ? undefined
        : `${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}`;
};

// "2/1", "3 loyalty", "5 defense" — whatever this face prints in its stat
// box, and nothing at all for the many cards that print none. Power and
// toughness come as strings from Scryfall, so "*/*" and "1+*/3" need no help.
// A face prints at most one of these, so the first match wins
export const formatStats = (face: Face): string | undefined => {
    return face.power !== undefined && face.toughness !== undefined
        ? `${face.power}/${face.toughness}`
        : face.loyalty !== undefined
          ? `${face.loyalty} loyalty`
          : face.defense !== undefined
            ? `${face.defense} defense`
            : undefined;
};

// What to call one face. Scryfall names each side of a double-faced card, and
// that name is what is printed on the side the reader is looking at, so it
// beats an ordinal; the ordinal is the fallback for the odd layout that
// leaves the face unnamed
export const faceHeading = (card: CardToSend, index: number) => {
    const name = card.faces[index]?.name;
    return name === undefined || name === ''
        ? `${card.name} (face ${index + 1})`
        : name;
};

// A single-faced card's one face is the card, so naming it again above its
// own type line would just repeat the heading
const facesAreLabelled = (card: CardToSend) => {
    return card.faces.length > 1;
};

// Whether each image belongs under one particular face. A transform card
// downloads one image per face and they pair off; a split card prints both of
// its faces on a single image, so there is no face to attach it to and it
// follows the text instead
const imagesPairWithFaces = (card: CardToSend) => {
    return card.imagePaths.length === card.faces.length;
};

export const makeSubject = (cardsToSend: Array<{ name: string }>) => {
    return `${
        cardsToSend.length === 1
            ? `New Card: [[${cardsToSend[0].name}]]`
            : `${cardsToSend.length} New Cards`
    }! MTG Spoiler Notification ${new Date().toLocaleString()}`;
};

const emailImage = (card: CardToSend, index: number) => {
    return `<img src="cid:${Util.nameToCID(card.name, index)}" />`;
};

const emailFaceLines = (card: CardToSend, face: Face, index: number) => {
    const lines: string[] = [];
    if (facesAreLabelled(card)) {
        lines.push(`<div><b>${faceHeading(card, index)}</b></div>`);
    }
    const stats = joinParts([face.typeLine, face.manaCost, formatStats(face)]);
    if (stats !== '') {
        lines.push(`<div>${stats}</div>`);
    }
    if (face.oracleText !== '') {
        lines.push('<br />');
        lines.push(`<div>${face.oracleText}</div>`);
    }
    return lines;
};

const emailCardLines = (card: CardToSend) => {
    // the name doubles as the link to the card's Scryfall page, so there is no
    // second control doing the same job further down
    const heading =
        card.scryfallURI === undefined
            ? card.name
            : `<a href="${card.scryfallURI}">${card.name}</a>`;
    const lines = [joinParts([heading, formatRarity(card.rarity)]), '<br />'];
    const paired = imagesPairWithFaces(card);
    card.faces.forEach((face, index) => {
        lines.push(...emailFaceLines(card, face, index));
        lines.push('<br />');
        if (paired) {
            lines.push(emailImage(card, index));
        }
    });
    if (!paired) {
        card.imagePaths.forEach((_, index) => {
            lines.push(emailImage(card, index));
        });
    }
    return lines;
};

export const makeEmailHTML = (cardsToSend: CardToSend[]) => {
    return `<html>
    <div>
        This is an automated e-mail from <a href="https://github.com/nullromo/mtg-spoiler-notifier/">MTG Spoiler Notifier</a>.
        <br />
        <br />
        The following ${
            cardsToSend.length === 1
                ? 'card has'
                : `${cardsToSend.length} cards have`
        } been added to Scryfall since the last notification was sent out.
        <br />
        <br />
        ${cardsToSend
            .map((card) => {
                return `<div>
            ${emailCardLines(card).join('\n            ')}
        </div>`;
            })
            .join('\n        <br />\n        ')}
    </div>
</html>`;
};

export const makeAttachments = (
    cardsToSend: CardToSend[],
): AttachmentData[] => {
    return Util.flattenArray(
        cardsToSend.map((card) => {
            return card.imagePaths.map((imagePath, index) => {
                return {
                    cid: Util.nameToCID(card.name, index),
                    filename: `${card.name}${
                        index > 0 ? `_face${index + 1}` : ''
                    }.png`,
                    path: imagePath,
                };
            });
        }),
    );
};

export const makeDiscordContent = (card: CardToSend) => {
    const heading =
        card.scryfallURI === undefined
            ? card.name
            : `[${card.name}](${card.scryfallURI})`;
    const lines = [makeSubject([card]), `### ${heading}`];
    const rarity = formatRarity(card.rarity);
    if (rarity !== undefined) {
        lines.push(rarity);
    }
    card.faces.forEach((face, index) => {
        if (facesAreLabelled(card)) {
            lines.push(`**${faceHeading(card, index)}**`);
        }
        const stats = joinParts([
            face.typeLine,
            face.manaCost,
            formatStats(face),
        ]);
        if (stats !== '') {
            lines.push(stats);
        }
        if (face.oracleText !== '') {
            lines.push(
                face.oracleText
                    // italicize reminder text
                    .replaceAll(/\(/g, '_(')
                    .replaceAll(/\)/g, ')_'),
            );
        }
    });
    return lines.join('\n');
};

// The last thing that happens to a Discord message before it is posted.
//
// Substitution comes before the length check on purpose: a mana symbol goes
// from "{R}" to a twenty-eight character <:manar:...> reference, so a
// text-heavy card can grow by hundreds of characters here. Measuring the
// string beforehand would let it sail past the limit anyway
export const finishDiscordContent = (
    content: string,
    emojiDictionary: EmojiDictionary,
) => {
    const substituted = content.replaceAll(
        /\{(?<match>.*?)\}/g,
        (text, group1: string) => {
            return emojiDictionary[group1] ?? text;
        },
    );
    return substituted.length > DISCORD_CONTENT_LIMIT
        ? `${substituted.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`
        : substituted;
};
