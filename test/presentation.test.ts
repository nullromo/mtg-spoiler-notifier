// Direct tests for how a card is written out.
//
// These exist because test/regression.sh can only see a notification's first
// line — it greps subjects out of the delivery log — so everything below the
// subject has never had a test that could read it. The shapes that go wrong
// are the ones nobody spoils twice in a row: a planeswalker, a battle, a card
// Scryfall has no rarity for, a face with no name. Each is one object literal
// here and a fetch-and-send round trip anywhere else.
//
// The three suites are complements: this one covers what a notification says,
// test/ledger.test.ts covers the rules deciding who is owed it, and
// test/regression.sh covers the artifact hand-off those rules ride on.

import assert from 'assert';
import type { CardToSend } from '../src/cardPresentation';
import {
    faceHeading,
    finishDiscordContent,
    formatStats,
    makeAttachments,
    makeDiscordContent,
    makeEmailHTML,
    makeSubject,
} from '../src/cardPresentation';
import type { Face } from '../src/scryfallTools';

let failures = 0;

const test = (name: string, body: () => void) => {
    try {
        body();
        console.log(`  [32mPASS[0m ${name}`);
    } catch (error) {
        failures += 1;
        console.log(`  [31mFAIL[0m ${name}`);
        console.log(
            String(error)
                .split('\n')
                .map((line) => {
                    return `        ${line}`;
                })
                .join('\n'),
        );
    }
};

const section = (name: string) => {
    console.log(`\n${name}`);
};

const face = (overrides: Partial<Face>): Face => {
    return {
        oracleText: 'Oracle text.',
        typeLine: 'Creature — Test',
        ...overrides,
    };
};

const card = (overrides: Partial<CardToSend>): CardToSend => {
    return {
        faces: [face({})],
        imagePaths: ['images/Alpha.png'],
        imageWebURIs: ['https://cards.example/alpha.png'],
        name: 'Alpha',
        rarity: 'rare',
        scryfallURI: 'https://scryfall.example/alpha',
        ...overrides,
    };
};

// a two-faced card of the shape Scryfall returns for a transform card: each
// face has its own everything, and there is one image per face
const twoFaced = (): CardToSend => {
    return card({
        faces: [
            face({
                manaCost: '{U}',
                name: 'Delver of Secrets',
                oracleText: 'Front face text.',
                power: '1',
                toughness: '1',
                typeLine: 'Creature — Human Wizard',
            }),
            face({
                name: 'Insectile Aberration',
                oracleText: 'Flying',
                power: '3',
                toughness: '2',
                typeLine: 'Creature — Human Insect',
            }),
        ],
        imagePaths: ['images/Alpha.png', 'images/Alpha_face2.png'],
        imageWebURIs: ['https://cards.example/1.png', '.../2.png'],
        name: 'Delver of Secrets // Insectile Aberration',
        rarity: 'uncommon',
    });
};

// ---------------------------------------------------------------------------
section('formatStats: whatever the face prints in its stat box');

test('a creature prints power and toughness', () => {
    assert.strictEqual(
        formatStats(face({ power: '2', toughness: '1' })),
        '2/1',
    );
});

test('a planeswalker prints loyalty rather than power and toughness', () => {
    assert.strictEqual(formatStats(face({ loyalty: '3' })), '3 loyalty');
});

test('a battle prints defense', () => {
    assert.strictEqual(formatStats(face({ defense: '5' })), '5 defense');
});

test('an instant prints nothing at all', () => {
    assert.strictEqual(formatStats(face({ typeLine: 'Instant' })), undefined);
});

test('characteristic-defining power survives as written', () => {
    // Scryfall hands these over as strings, so "*" needs no special case —
    // this is here to keep anyone from "fixing" them into numbers
    assert.strictEqual(
        formatStats(face({ power: '*', toughness: '*' })),
        '*/*',
    );
    assert.strictEqual(
        formatStats(face({ power: '1+*', toughness: '3' })),
        '1+*/3',
    );
});

test('power without toughness is not half a stat line', () => {
    assert.strictEqual(formatStats(face({ power: '2' })), undefined);
});

// ---------------------------------------------------------------------------
section('faceHeading: naming the side the reader is looking at');

test('uses the name Scryfall gives the face', () => {
    assert.strictEqual(faceHeading(twoFaced(), 1), 'Insectile Aberration');
});

test('falls back to an ordinal when the face is unnamed', () => {
    const unnamed = card({
        faces: [face({}), face({})],
        name: 'Alpha // Beta',
    });
    assert.strictEqual(faceHeading(unnamed, 1), 'Alpha // Beta (face 2)');
});

// ---------------------------------------------------------------------------
section('makeSubject: the line the ledger and the tests both read');

test('one card names it, several count them', () => {
    assert.ok(
        makeSubject([{ name: 'Alpha' }]).startsWith('New Card: [[Alpha]]'),
    );
    assert.ok(
        makeSubject([{ name: 'Alpha' }, { name: 'Beta' }]).startsWith(
            '2 New Cards',
        ),
    );
});

// ---------------------------------------------------------------------------
section('makeEmailHTML: what a subscriber reads');

test('anchors the card name to its Scryfall page', () => {
    assert.ok(
        makeEmailHTML([card({})]).includes(
            '<a href="https://scryfall.example/alpha">Alpha</a>',
        ),
    );
});

test('gives the rarity, capitalised', () => {
    assert.ok(makeEmailHTML([card({})]).includes('Rare'));
});

test('a card with no rarity leaves no dangling separator', () => {
    const html = makeEmailHTML([card({ rarity: undefined })]);
    assert.ok(!html.includes('Alpha</a> •'), html);
});

test('a card with no Scryfall page still names itself', () => {
    const html = makeEmailHTML([card({ scryfallURI: undefined })]);
    assert.ok(!html.includes('<a href="undefined"'), html);
    assert.ok(html.includes('Alpha'));
});

test('each face carries its own power and toughness', () => {
    const html = makeEmailHTML([twoFaced()]);
    // the bug this replaces put "1/1 // 3/2" under both pictures, so the
    // front face's image sat above the back face's stats
    const front = html.indexOf('Creature — Human Wizard');
    const back = html.indexOf('Creature — Human Insect');
    assert.ok(front > -1 && back > front, html);
    assert.ok(html.slice(front, back).includes('1/1'), html.slice(front, back));
    assert.ok(
        !html.slice(front, back).includes('3/2'),
        html.slice(front, back),
    );
    assert.ok(html.slice(back).includes('3/2'), html.slice(back));
});

test('each face is named, and only when there is more than one', () => {
    const html = makeEmailHTML([twoFaced()]);
    assert.ok(html.includes('<b>Delver of Secrets</b>'), html);
    assert.ok(html.includes('<b>Insectile Aberration</b>'), html);
    // a single-faced card's one face is the card, so naming it again would
    // just repeat the heading directly above it
    assert.ok(!makeEmailHTML([card({})]).includes('<b>Alpha</b>'));
});

test('a face with no mana cost prints no empty separator', () => {
    const html = makeEmailHTML([twoFaced()]);
    assert.ok(html.includes('Creature — Human Insect • 3/2'), html);
});

test('every image is referenced by a content ID', () => {
    const html = makeEmailHTML([twoFaced()]);
    const attachments = makeAttachments([twoFaced()]);
    assert.strictEqual(attachments.length, 2);
    attachments.forEach((attachment) => {
        assert.ok(html.includes(`cid:${attachment.cid}`), attachment.cid);
    });
    assert.notStrictEqual(attachments[0].cid, attachments[1].cid);
});

test('a split card, which prints two faces on one image, still renders', () => {
    // Scryfall gives these a single top-level image and two faces, so the
    // counts do not line up and there is no face to hang the picture under
    const split = card({
        faces: [
            face({ name: 'Wear', typeLine: 'Instant' }),
            face({ name: 'Tear', typeLine: 'Instant' }),
        ],
        imagePaths: ['images/WearSLASHSLASHTear.png'],
        name: 'Wear // Tear',
    });
    const html = makeEmailHTML([split]);
    assert.ok(html.includes('<b>Wear</b>'), html);
    assert.ok(html.includes('<b>Tear</b>'), html);
    // exactly one image, and no reference to a second one that was never
    // downloaded and never attached
    assert.strictEqual(html.split('<img ').length - 1, 1, html);
    assert.strictEqual(makeAttachments([split]).length, 1);
});

// ---------------------------------------------------------------------------
section('makeDiscordContent: the same card, said the same way');

test('links the name and gives the rarity', () => {
    const content = makeDiscordContent(card({}));
    assert.ok(
        content.includes('### [Alpha](https://scryfall.example/alpha)'),
        content,
    );
    assert.ok(content.includes('Rare'), content);
});

test('each face carries its own stats here too', () => {
    const content = makeDiscordContent(twoFaced());
    assert.ok(content.includes('**Delver of Secrets**'), content);
    assert.ok(
        content.includes('Creature — Human Wizard • {U} • 1/1'),
        content,
    );
    assert.ok(content.includes('Creature — Human Insect • 3/2'), content);
});

test('reminder text is still italicised', () => {
    const content = makeDiscordContent(
        card({ faces: [face({ oracleText: 'Flying (It flies.)' })] }),
    );
    assert.ok(content.includes('_(It flies.)_'), content);
});

test('the first line is still the subject the delivery log reads', () => {
    assert.ok(
        makeDiscordContent(card({}))
            .split('\n')[0]
            .includes('New Card: [[Alpha]]'),
    );
});

// ---------------------------------------------------------------------------
section('finishDiscordContent: emoji, then the length Discord will accept');

test('substitutes mana symbols the server has emoji for', () => {
    assert.strictEqual(
        finishDiscordContent('cost {R} here', { R: '<:manar:1>' }),
        'cost <:manar:1> here',
    );
});

test('leaves a symbol the server has no emoji for alone', () => {
    assert.strictEqual(
        finishDiscordContent('cost {R} here', {}),
        'cost {R} here',
    );
});

test('an ordinary message is not touched', () => {
    const content = makeDiscordContent(twoFaced());
    assert.strictEqual(finishDiscordContent(content, {}), content);
});

test('a message past the limit is cut down to it', () => {
    const finished = finishDiscordContent('x'.repeat(2500), {});
    assert.strictEqual(finished.length, 2000);
    assert.ok(finished.endsWith('…'));
});

test('the limit is measured after substitution, not before', () => {
    // a mana symbol is three characters that become twenty-eight, so a
    // message well inside the limit beforehand can be well past it after.
    // Measuring first is how this would go out at 2,900 characters and be
    // rejected — and a rejected post is a card that stays owed for good
    const emoji = { R: '<:manar:1223433670896128043>' };
    const content = '{R}'.repeat(400);
    assert.ok(content.length < 2000);
    assert.strictEqual(finishDiscordContent(content, emoji).length, 2000);
});

console.log();
if (failures > 0) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
}
console.log('all presentation checks passed');
