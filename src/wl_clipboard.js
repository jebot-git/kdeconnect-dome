// SPDX-License-Identifier: GPL-2.0-or-later
// Native Wayland clipboard bridge; all text travels over stdin or D-Bus.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const NAME = 'org.domed.Connect.Clipboard';
const PATH = '/org/domed/Connect/Clipboard';
const XML = `<node><interface name="${NAME}">
<method name="GetMimetypes"><arg direction="out" type="as"/></method>
<method name="GetText"><arg direction="out" type="s"/></method>
<method name="SetText"><arg direction="in" type="s"/></method>
<method name="NotifyChanged"/><signal name="OwnerChange"/>
</interface></node>`;
async function run(args, input = null) {
    const p = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const [, output] = await p.communicate_utf8_async(input, null);
    if (!p.get_successful()) throw new Error('Wayland clipboard is unavailable');
    return output;
}
class Clipboard {
    constructor() {
        this.exported = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this.owner = Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
            connection => this.exported.export(connection, PATH),
            () => {
                this.watcher = Gio.Subprocess.new(['wl-paste', '--watch', 'gdbus', 'call', '--session',
                    '--dest', NAME, '--object-path', PATH, '--method', `${NAME}.NotifyChanged`],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            }, null);
    }
    async GetMimetypesAsync(params, invocation) {
        try {
            const text = await run(['wl-paste', '--list-types']);
            invocation.return_value(new GLib.Variant('(as)', [text.trim().split('\n').filter(Boolean)]));
        } catch { invocation.return_value(new GLib.Variant('(as)', [[]])); }
    }
    async GetTextAsync(params, invocation) {
        try {
            const text = await run(['wl-paste', '--no-newline']);
            invocation.return_value(new GLib.Variant('(s)', [text]));
        } catch (error) { invocation.return_dbus_error('org.domed.Connect.Clipboard.Unavailable', error.message); }
    }
    async SetTextAsync([text], invocation) {
        try {
            await run(['wl-copy', '--type', 'text/plain;charset=utf-8'], text);
            invocation.return_value(null);
        } catch (error) { invocation.return_dbus_error('org.domed.Connect.Clipboard.Unavailable', error.message); }
    }
    NotifyChanged() { this.exported.emit_signal('OwnerChange', null); }
    destroy() {
        this.watcher?.force_exit(); this.exported.unexport(); Gio.bus_unown_name(this.owner);
    }
}
let portal = null;
let watcher = 0;
export function watchService() {
    if (watcher || !GLib.getenv('WAYLAND_DISPLAY')) return;
    watcher = Gio.bus_watch_name(Gio.BusType.SESSION, 'org.domed.Connect', Gio.BusNameWatcherFlags.NONE,
        () => { if (!portal) portal = new Clipboard(); },
        () => { portal?.destroy(); portal = null; });
}
export function unwatchService() {
    if (watcher) Gio.bus_unwatch_name(watcher);
    watcher = 0; portal?.destroy(); portal = null;
}
