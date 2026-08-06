// Turning card detail into the text each channel sends.
//
// This lives apart from main.ts so it can be tested without a mail transport,
// a webhook or a network: every function here takes a card and returns a
// string. It is also the reason e-mail and Discord cannot drift apart — they
// describe a card through the same handful of helpers, so a change to how a
// planeswalker's loyalty is written reaches both or neither.

import path from 'path';
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

// The e-mail's palette and type, written out here as plain values because
// every one of them has to be repeated inline on the element that uses it.
// Mail clients are not browsers: a <style> block is discarded by enough of
// them to be untrustworthy, custom properties are not understood at all, and
// there is no cascade worth relying on. So the identity lives in these
// constants and is spent through the helpers below
const INK = '#171a21';
const MUTED = '#5b6371';
const RULE = '#d2d7e0';
const GOLD = '#8d6a29';
const GROUND = '#eceef2';
const SURFACE = '#ffffff';

// Magic prints its rarities in metal, and a reader picks the colour out
// faster than the word. Anything Scryfall invents later falls back to the
// body colour rather than going uncoloured or throwing
const RARITY_COLOURS: Partial<Record<string, string>> = {
    bonus: '#6f7d85',
    common: '#4d5563',
    mythic: '#b04a24',
    rare: '#8d6a29',
    special: '#b04a24',
    uncommon: '#6f7d85',
};

// Georgia for the card's name and a system stack for everything else. Both
// are faces that are already on the machine reading the mail — a webfont
// would have to be fetched, and a mail client will not fetch it
const DISPLAY_FONT = "Georgia, 'Times New Roman', serif";
const BODY_FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

// longhand rather than the `font` shorthand, which enough clients mangle
const type = (
    size: number,
    colour: string,
    weight: number,
    lineHeight: number,
    family = BODY_FONT,
) => {
    return `font-family:${family};font-size:${size}px;font-weight:${weight};line-height:${lineHeight};color:${colour};`;
};

const emailImage = (card: CardToSend, index: number) => {
    return `<img src="cid:${Util.nameToCID(
        card.name,
        index,
    )}" style="border:1px solid ${RULE};display:block;margin-top:14px;max-width:100%;width:280px;" />`;
};

const emailFaceLines = (card: CardToSend, face: Face, index: number) => {
    const lines: string[] = [];
    if (facesAreLabelled(card)) {
        lines.push(
            `<div style="${type(13, INK, 700, 1.4)}">${faceHeading(
                card,
                index,
            )}</div>`,
        );
    }
    const stats = joinParts([face.typeLine, face.manaCost, formatStats(face)]);
    if (stats !== '') {
        lines.push(
            `<div style="${type(13, MUTED, 400, 1.5)}margin-top:2px;">${stats}</div>`,
        );
    }
    if (face.oracleText !== '') {
        // Scryfall separates a card's abilities with newlines, and HTML does
        // not. Without this every one of Jace's four abilities ran together
        // into a single paragraph, which is exactly the card that most needs
        // them apart
        lines.push(
            `<div style="${type(14, INK, 400, 1.6)}margin-top:10px;">${face.oracleText.replaceAll(
                '\n',
                '<br />',
            )}</div>`,
        );
    }
    return lines;
};

// Scryfall's own colours, read off their app icon: the mark is a vertical
// gradient between these two
const SCRYFALL_PURPLE = '#6f3d75';
const SCRYFALL_TEAL = '#4e737f';

// The logo travels with the message rather than being linked to. A remote
// image is blocked by default in most clients, and hotlinking somebody
// else's asset on a schedule is rude; a content ID always renders, which is
// how the card images already work
export const SCRYFALL_LOGO_CID = 'scryfall-logo';

// Resolved against this file rather than the working directory, because the
// notifier is not always run from the repo root — the regression harness runs
// it from a sandbox
const SCRYFALL_LOGO_PATH = path.join(
    __dirname,
    '..',
    'assets',
    'scryfall-logo.png',
);

const emailScryfallLink = (card: CardToSend) => {
    if (card.scryfallURI === undefined) {
        return '';
    }
    // background-color first and background-image second: a client that has
    // never heard of linear-gradient keeps the flat purple, which is the
    // gradient's top end, so it degrades rather than falling back to nothing
    return `<a href="${card.scryfallURI}" style="background:${SCRYFALL_PURPLE};background-image:linear-gradient(${SCRYFALL_PURPLE},${SCRYFALL_TEAL});border-radius:4px;${type(
        12,
        '#ffffff',
        600,
        1,
    )}display:inline-block;padding:6px 12px;text-decoration:none;"><img src="cid:${SCRYFALL_LOGO_CID}" width="14" height="14" alt="" style="border:0;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:middle;" /><span style="vertical-align:middle;">Scryfall</span></a>`;
};

const emailRarityChip = (rarity: string | undefined) => {
    const label = formatRarity(rarity);
    if (label === undefined) {
        return '';
    }
    const colour = RARITY_COLOURS[rarity ?? ''] ?? MUTED;
    return `<span style="border:1px solid ${colour};${type(
        10,
        colour,
        600,
        1.4,
    )}letter-spacing:1.2px;margin-right:12px;padding:2px 6px;text-transform:uppercase;">${label}</span>`;
};

const emailCardLines = (card: CardToSend) => {
    // Deliberately plain text rather than a link. On a phone, long-pressing a
    // link opens the link menu instead of selecting the text under it, so
    // making the name the link made the name the one thing on the card that
    // could not be copied out. The Scryfall link lives on its own below
    const lines = [
        `<div style="${type(23, INK, 400, 1.25, DISPLAY_FONT)}">${
            card.name
        }</div>`,
    ];
    // the rarity and the link that leaves, on one line
    lines.push(
        `<div style="margin-top:8px;">${emailRarityChip(
            card.rarity,
        )}${emailScryfallLink(card)}</div>`,
    );
    const paired = imagesPairWithFaces(card);
    card.faces.forEach((face, index) => {
        lines.push('<div style="margin-top:18px;">');
        lines.push(...emailFaceLines(card, face, index));
        if (paired) {
            lines.push(emailImage(card, index));
        }
        lines.push('</div>');
    });
    if (!paired) {
        card.imagePaths.forEach((_, index) => {
            lines.push(emailImage(card, index));
        });
    }
    return lines;
};

export const makeEmailHTML = (cardsToSend: CardToSend[]) => {
    const intro = `The following ${
        cardsToSend.length === 1
            ? 'card has'
            : `${cardsToSend.length} cards have`
    } been added to Scryfall since the last notification was sent out.`;
    return `<html>
<head>
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
</head>
<body style="background:${GROUND};margin:0;padding:24px 12px;">
    <div style="background:${SURFACE};border:1px solid ${RULE};margin:0 auto;max-width:640px;padding:28px;">
        <div style="${type(
            11,
            GOLD,
            600,
            1.4,
        )}letter-spacing:1.4px;text-transform:uppercase;">MTG Spoiler Notifier</div>
        <div style="${type(
            13,
            MUTED,
            400,
            1.6,
        )}border-bottom:1px solid ${RULE};padding:6px 0 18px;">${intro}</div>
        ${cardsToSend
            .map((card) => {
                return `<div style="padding-top:24px;">
            ${emailCardLines(card).join('\n            ')}
        </div>`;
            })
            .join(
                `\n        <div style="border-top:1px solid ${RULE};margin-top:28px;"></div>\n        `,
            )}
        <div style="${type(
            11,
            MUTED,
            400,
            1.5,
        )}border-top:1px solid ${RULE};margin-top:28px;padding-top:14px;">Sent automatically by <a href="https://github.com/nullromo/mtg-spoiler-notifier/" style="color:${MUTED};">MTG Spoiler Notifier</a>.</div>
    </div>
</body>
</html>`;
};

export const makeAttachments = (
    cardsToSend: CardToSend[],
): AttachmentData[] => {
    const cardImages = Util.flattenArray(
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

    // only worth carrying if something in this message actually shows it
    const anyLinked = cardsToSend.some((card) => {
        return card.scryfallURI !== undefined;
    });
    if (!anyLinked) {
        return cardImages;
    }

    return [
        ...cardImages,
        {
            cid: SCRYFALL_LOGO_CID,
            filename: 'scryfall.png',
            path: SCRYFALL_LOGO_PATH,
        },
    ];
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
