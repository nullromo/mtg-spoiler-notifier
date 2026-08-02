import fs from 'fs';
import nodemailer from 'nodemailer';
import type { DestinationId } from './deliveryLedger';

export type EmailRecipient = {
    // the real address, only ever used to actually send
    address: string;
    // the ledger key. It uses the obfuscated form straight out of
    // recipients.json, because the ledger is uploaded as a GitHub Actions
    // artifact and artifacts on public repos are publicly downloadable —
    // writing the real address there would undo the point of the obfuscation
    id: DestinationId;
};

const OBFUSCATED_RECIPIENTS = JSON.parse(
    fs.readFileSync('./recipients.json').toString(),
) as string[];

export const emailRecipients: EmailRecipient[] = OBFUSCATED_RECIPIENTS.map(
    (obfuscated) => {
        return {
            address: obfuscated.replace('***AT***', '@'),
            id: `email:${obfuscated}`,
        };
    },
);

// Per-destination tracking means an empty recipient list can no longer be
// mistaken for a successful broadcast — a card only stops being owed to a
// destination that exists and confirmed it. But recipients.json is checked in
// with subscribers in it, so finding it empty means somebody broke the file
// rather than that nobody is subscribed, and running on would quietly stop
// e-mailing everyone. See issue #10
if (emailRecipients.length === 0) {
    throw new Error(
        'recipients.json contains no recipients. Refusing to run: the file is checked in with subscribers in it, so an empty list means it has been damaged rather than that nobody is subscribed.',
    );
}

const CREDENTIALS = {
    pass: process.env.SECRET_GMAIL_APP_PASSWORD,
    user: 'mtgspoilernotifier@gmail.com',
};

export interface AttachmentData {
    filename: string;
    path: string;
    cid: string;
}

export class EMailer {
    private readonly transporter: nodemailer.Transporter;

    public constructor() {
        console.log('Starting e-mail client');
        this.transporter = nodemailer.createTransport({
            auth: CREDENTIALS,
            service: 'gmail',
        });
    }

    // Send to exactly one recipient. This used to be a broadcast wrapped in
    // Promise.all, which meant one failing recipient rejected the whole thing
    // and nobody was recorded — so everyone who had actually received the card
    // got it again on the next run. One recipient at a time is what lets the
    // caller record each delivery on its own. See issue #11
    public readonly send = async (
        recipient: EmailRecipient,
        subject: string,
        html: string,
        attachments: AttachmentData[],
    ) => {
        return new Promise<void>((resolve, reject) => {
            this.transporter.sendMail(
                {
                    attachments,
                    from: 'mtgspoilernotifier@gmail.com',
                    html,
                    subject,
                    textEncoding: 'base64',
                    to: recipient.address,
                },
                (error, info) => {
                    if (error) {
                        console.error(error);
                        reject(error);
                    } else {
                        console.log('Sent e-mail:', info);
                        resolve();
                    }
                },
            );
        });
    };

    public readonly close = () => {
        console.log('Shutting down e-mail transport');
        this.transporter.close();
    };
}
