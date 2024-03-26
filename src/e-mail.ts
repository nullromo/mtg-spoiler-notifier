import fs from 'fs';
import nodemailer from 'nodemailer';

const RECIPIENTS = (
    JSON.parse(fs.readFileSync('./recipients.json').toString()) as string[]
).map((recipient) => {
    return recipient.replace('***AT***', '@');
});

const CREDENTIALS = {
    // old account password: 'mtg-spoiler-notifier69',
    // old app password: 'exft ainp ldri jvfc',
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

    private readonly sendEmail = async (
        subject: string,
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
                    subject,
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
        subject: string,
        text: string,
        attachments: AttachmentData[],
    ) => {
        console.log(
            'Broadcasting attachments with CIDs:',
            attachments.map((attachment) => {
                return attachment.cid;
            }),
        );
        return Promise.all(
            RECIPIENTS.map(async (recipient) => {
                return this.sendEmail(subject, recipient, text, attachments);
            }),
        );
    };

    public readonly close = () => {
        console.log('Shutting down e-mail transport');
        this.transporter.close();
    };
}
