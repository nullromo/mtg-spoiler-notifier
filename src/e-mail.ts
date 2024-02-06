import fs from 'fs';
import nodemailer from 'nodemailer';

const RECIPIENTS = (
    JSON.parse(fs.readFileSync('./recipients.json').toString()) as string[]
).map((recipient) => {
    return recipient.replace('***AT***', '@');
});

const CREDENTIALS = {
    //pass: 'mtg-spoiler-notifier69',
    pass: 'exft ainp ldri jvfc',
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

    private readonly sendEmail = async (
        recipient: string,
        html: string,
        attachments: AttachmentData[],
    ) => {
        return new Promise<void>((resolve, reject) => {
            this.transporter.sendMail(
                {
                    attachments,
                    from: 'mtgspoilernotifier@gmail.com',
                    html,
                    subject: `MTG Spoiler Notification ${new Date().toLocaleString()}`,
                    textEncoding: 'base64',
                    to: recipient,
                },
                (error, info) => {
                    if (error) {
                        console.error(error);
                        reject(error);
                    } else {
                        console.log('Sending e-mail:', info);
                        resolve();
                    }
                },
            );
        });
    };

    public readonly broadcast = async (
        text: string,
        attachments: AttachmentData[],
    ) => {
        return Promise.all(
            RECIPIENTS.map(async (recipient) => {
                return this.sendEmail(recipient, text, attachments);
            }),
        );
    };

    public readonly close = () => {
        console.log('Shutting down e-mail transport');
        this.transporter.close();
    };
}
