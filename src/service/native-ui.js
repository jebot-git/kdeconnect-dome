// SPDX-License-Identifier: GPL-2.0-or-later
// Native dialogs are separate FLTK processes; the service needs no GUI toolkit.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Config from '../config.js';

export async function dialog(request) {
    const helper = GLib.getenv('DOME_CONNECT_DIALOG') || `${Config.PACKAGE_DATADIR}/dome-connect-dialog`;
    const process = Gio.Subprocess.new([helper],
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
    const [output] = await process.communicate_utf8_async(JSON.stringify(request), null);
    if (!process.get_successful())
        throw new Error('The FLTK dialog could not be opened');
    return JSON.parse(output || '{}');
}

export async function message(title, text) {
    return dialog({kind: 'message', title, text});
}

export async function input(title, text) {
    return (await dialog({kind: 'input', title, text})).value || '';
}

export async function chooseFile(title) {
    return (await dialog({kind: 'file', title})).value || '';
}

export class SmsWindow {
    constructor(plugin) {
        this.plugin = plugin;
        this.message = '';
        this.pending = false;
    }

    setMessage(message) { this.message = message; }
    getConversationForMessage() { return null; }
    connect() { return 0; }
    destroy() {}

    async present() {
        if (this.pending) return;
        this.pending = true;
        try {
            const threads = Object.values(this.plugin.threads);
            const transcript = threads.flat().slice(-100).map(message =>
                `${message.addresses?.[0]?.address || ''}: ${message.body || ''}`).join('\n');
            const result = await dialog({kind: 'sms', title: this.plugin.device.name,
                text: transcript, message: this.message});
            if (result.number && result.message)
                this.plugin.sendSms(result.number, result.message);
        } catch (error) {
            logError(error);
        } finally {
            this.pending = false;
        }
    }
}
