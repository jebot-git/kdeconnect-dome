// SPDX-License-Identifier: GPL-2.0-or-later
// Import identity and pinned certificates without modifying the Qt backend's data.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Config from '../config.js';
import Device from './device.js';

function ini(path) {
    if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return {};
    const result = {};
    let section = 'General';
    for (const line of new TextDecoder().decode(GLib.file_get_contents(path)[1]).split('\n')) {
        if (/^\[.+\]$/.test(line.trim())) { section = line.trim().slice(1, -1); continue; }
        const equal = line.indexOf('=');
        if (equal < 0 || line.trim().startsWith('#')) continue;
        const key = line.slice(0, equal).trim();
        let value = line.slice(equal + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        value = value.replace(/\\([nrt"\\])/g, (match, c) => ({n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\'}[c]));
        (result[section] ||= {})[key] = value;
    }
    return result;
}

export default function migrate(settings) {
    const marker = `${Config.CONFIGDIR}/legacy-imported`;
    if (GLib.file_test(marker, GLib.FileTest.EXISTS)) return;
    const legacy = `${GLib.get_user_config_dir()}/kdeconnect`;
    const cert = `${legacy}/certificate.pem`;
    const key = `${legacy}/privateKey.pem`;
    if (!GLib.file_test(cert, GLib.FileTest.IS_REGULAR) || !GLib.file_test(key, GLib.FileTest.IS_REGULAR)) return;
    const certificate = Gio.TlsCertificate.new_from_files(cert, key);
    if (!Device.validateId(certificate.common_name)) throw new Error('The legacy identity has an invalid device ID');
    for (const [source, name] of [[cert, 'certificate.pem'], [key, 'private.pem']]) {
        const target = Gio.File.new_for_path(`${Config.CONFIGDIR}/${name}`);
        // Never overwrite a different native identity or existing trust store.
        if (target.query_exists(null)) throw new Error('Native identity already exists; refusing automatic migration');
        Gio.File.new_for_path(source).copy(target, Gio.FileCopyFlags.NONE, null, null);
        target.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
    }
    const name = ini(`${legacy}/config`).General?.name;
    if (name) settings.set_string('name', Device.sanitizeName(name));
    const ids = [];
    let addresses = {};
    const hints = `${Config.CONFIGDIR}/legacy-addresses.json`;
    if (GLib.file_test(hints, GLib.FileTest.IS_REGULAR))
        addresses = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(hints)[1]));
    for (const [id, data] of Object.entries(ini(`${legacy}/trusted_devices`))) {
        if (!Device.validateId(id) || !data.certificate) continue;
        const peer = Gio.TlsCertificate.new_from_pem(data.certificate, -1);
        if (peer.common_name !== id) throw new Error('A legacy certificate does not match its device ID');
        const device = new Gio.Settings({settings_schema: Config.GSCHEMA.lookup('org.domed.Connect.Device', true),
            path: `/org/domed/connect/device/${id}/`});
        device.set_string('name', data.name || id);
        device.set_string('type', data.type === 'phone' ? 'smartphone' : data.type || 'smartphone');
        device.set_string('certificate-pem', data.certificate);
        device.set_boolean('paired', true);
        const disabled = Object.entries(ini(`${legacy}/${id}/config`).Plugins || {})
            .filter(([key, value]) => key.endsWith('Enabled') && value.toLowerCase() === 'false')
            .map(([key]) => key.replace(/^kdeconnect_/, '').replace(/Enabled$/, ''))
            .map(key => ({notifications: 'notification', sendnotifications: 'notification', remoteinput: 'mousepad'}[key] || key));
        device.set_strv('disabled-plugins', [...new Set(disabled)]);
        const address = addresses[id]?.[0];
        if (address) device.set_string('last-connection', `lan://${address.replace(/^[a-z]+:\/\//i, '')}`);
        ids.push(id);
    }
    settings.set_strv('devices', ids);
    GLib.file_set_contents(marker, 'Imported identity and existing certificate pins; original files are unchanged.\n');
    Gio.Settings.sync();
    console.log(`Imported ${ids.length} pinned device(s) from the legacy backend.`);
}
