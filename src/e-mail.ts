import nodemailer from 'nodemailer';

const RECIPIENTS = ['kylerobertkovacs@gmail.com'];

const CREDENTIALS = {
    //pass: 'mtg-spoiler-notifier69',
    pass: 'exft ainp ldri jvfc',
    user: 'mtgspoilernotifier@gmail.com',
};

export class EMailer {
    private readonly transporter: nodemailer.Transporter;

    public constructor() {
        console.log('Starting e-mail client');
        this.transporter = nodemailer.createTransport({
            auth: CREDENTIALS,
            service: 'gmail',
        });
    }

    private readonly sendEmail = async (recipient: string, text: string) => {
        return new Promise<void>((resolve, reject) => {
            this.transporter.sendMail(
                {
                    from: 'mtgspoilernotifier@gmail.com',
                    subject: `MTG Spoiler Notification ${new Date().toLocaleString()}`,
                    text,
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

    public readonly broadcast = async (text: string) => {
        return Promise.all(
            RECIPIENTS.map(async (recipient) => {
                return this.sendEmail(recipient, text);
            }),
        );
    };

    public readonly close = () => {
        console.log('Shutting down e-mail transport');
        this.transporter.close();
    };
}
