// SPDX-License-Identifier: GPL-2.0-or-later
// PipeWire/PulseAudio control through pactl; no GNOME Shell or GUI libraries.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
function command(args) {
    const p = Gio.Subprocess.new(['pactl', ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const [, output] = p.communicate_utf8(null, null);
    if (!p.get_successful()) throw new Error(`pactl ${args[0]} failed`);
    return output.trim();
}
class Stream {
    constructor(raw) { this.update(raw); }
    update(raw) {
        this.raw = raw; this.name = raw.name; this.id = raw.index;
        this.display_name = raw.description || raw.name;
        this.is_muted = raw.mute;
        const values = Object.values(raw.volume || {});
        this.volume = values.length ? Math.round(values.reduce((sum, v) => sum + v.value, 0) / values.length) : 0;
    }
    change_is_muted(value) { command(['set-sink-mute', this.name, value ? '1' : '0']); }
    push_volume() { command(['set-sink-volume', this.name, String(Math.max(0, Math.round(this.volume)))]); }
}
const Mixer = GObject.registerClass({
    GTypeName: 'DomeConnectMixer',
    Signals: {'stream-changed': {param_types: [GObject.TYPE_UINT]},
        'output-added': {param_types: [GObject.TYPE_UINT]},
        'output-removed': {param_types: [GObject.TYPE_UINT]}},
}, class Mixer extends GObject.Object {
    _init() {
        super._init(); this._sinks = new Map(); this.fading = false;
        this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            try { this._refresh(); } catch (error) { debug(error); }
            return GLib.SOURCE_CONTINUE;
        });
    }
    _refresh() {
        const current = new Set();
        for (const raw of JSON.parse(command(['--format=json', 'list', 'sinks']))) {
            current.add(raw.index);
            const previous = this._sinks.get(raw.index);
            if (previous) {
                const changed = JSON.stringify(previous.raw) !== JSON.stringify(raw);
                previous.update(raw);
                if (changed) this.emit('stream-changed', raw.index);
            } else {
                this._sinks.set(raw.index, new Stream(raw)); this.emit('output-added', raw.index);
            }
        }
        for (const id of this._sinks.keys()) {
            if (!current.has(id)) { this._sinks.delete(id); this.emit('output-removed', id); }
        }
    }
    get_sinks() { return [...this._sinks.values()]; }
    lookup_stream_id(id) { return this._sinks.get(id); }
    get_vol_max_norm() { return 65536; }
    _remember() {
        if (!this._saved) this._saved = this.get_sinks().map(s => ({name: s.name, volume: s.volume, mute: s.is_muted}));
    }
    lowerVolume() { this._remember(); command(['set-sink-volume', '@DEFAULT_SINK@', '15%']); }
    muteVolume() { this._remember(); command(['set-sink-mute', '@DEFAULT_SINK@', '1']); }
    muteMicrophone() {
        if (this._sourceMute === undefined) this._sourceMute = command(['get-source-mute', '@DEFAULT_SOURCE@']).endsWith('yes');
        command(['set-source-mute', '@DEFAULT_SOURCE@', '1']);
    }
    restore() {
        for (const s of this._saved || []) {
            command(['set-sink-volume', s.name, String(s.volume)]);
            command(['set-sink-mute', s.name, s.mute ? '1' : '0']);
        }
        this._saved = undefined;
        if (this._sourceMute !== undefined) {
            command(['set-source-mute', '@DEFAULT_SOURCE@', this._sourceMute ? '1' : '0']);
            this._sourceMute = undefined;
        }
    }
    destroy() { if (this._timer) GLib.source_remove(this._timer); }
});
export default Mixer;
