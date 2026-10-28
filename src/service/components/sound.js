// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export default class Player {
    constructor() { this._playing = new Set(); }
    async playSound(name, cancellable = new Gio.Cancellable()) {
        const roots = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];
        for (const root of roots) {
            const path = `${root}/sounds/freedesktop/stereo/${name}.oga`;
            if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) continue;
            const process = Gio.Subprocess.new(['pw-play', path], Gio.SubprocessFlags.NONE);
            this._playing.add(process);
            const id = cancellable.connect(() => process.force_exit());
            try { await process.wait_check_async(cancellable); } catch (error) {
                if (!cancellable.is_cancelled()) debug(error);
            } finally {
                cancellable.disconnect(id);
                this._playing.delete(process);
            }
            return;
        }
    }
    async loopSound(name, cancellable = new Gio.Cancellable()) {
        while (!cancellable.is_cancelled()) {
            await this.playSound(name, cancellable);
            await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                resolve(); return GLib.SOURCE_REMOVE;
            }));
        }
    }
    destroy() { for (const process of this._playing) process.force_exit(); }
}
