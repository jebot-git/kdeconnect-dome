// SPDX-License-Identifier: GPL-2.0-or-later
// The existing FLTK controls and command-line clients retain their KDE D-Bus API.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PATH = '/modules/kdeconnect';
const IFACE = 'org.kde.kdeconnect';
function method(name, input = [], output = []) {
    return `<method name="${name}">${input.map(type => `<arg direction="in" type="${type}"/>`).join('')}${output.map(type => `<arg direction="out" type="${type}"/>`).join('')}</method>`;
}
function property(name, type) { return `<property name="${name}" type="${type}" access="read"/>`; }
function exportObject(connection, path, name, contents, object) {
    const exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="${name}">${contents}</interface></node>`, object);
    exported.export(connection, path);
    return exported;
}
const daemonXml = method('devices', ['b', 'b'], ['as']) + method('deviceNames', ['b', 'b'], ['a{ss}']) +
    method('selfId', [], ['s']) + method('announcedName', [], ['s']) + method('setAnnouncedName', ['s']) +
    method('forceOnNetworkChange') + method('acquireDiscoveryMode', ['s']) + method('releaseDiscoveryMode', ['s']) +
    method('linkProviders', [], ['as']) + method('deviceIdByName', ['s'], ['s']) +
    property('pairingRequests', 'as') + '<signal name="deviceAdded"><arg type="s"/></signal>' +
    '<signal name="deviceRemoved"><arg type="s"/></signal><signal name="deviceListChanged"/>';
const deviceTypes = {name: 's', type: 's', iconName: 's', statusIconName: 's', verificationKey: 's',
    isReachable: 'b', isPaired: 'b', isPairRequested: 'b', isPairRequestedByPeer: 'b', pairState: 'i',
    supportedPlugins: 'as', reachableAddresses: 'as', activeProviderNames: 'as'};
const deviceXml = Object.entries(deviceTypes).map(([name, type]) => property(name, type)).join('') +
    ['requestPairing', 'acceptPairing', 'cancelPairing', 'unpair', 'reloadPlugins'].map(name => method(name)).join('') +
    method('loadedPlugins', [], ['as']) + method('hasPlugin', ['s'], ['b']) +
    method('setPluginEnabled', ['s', 'b']) + method('isPluginEnabled', ['s'], ['b']) +
    method('encryptionInfo', [], ['s']);
function pluginName(name) {
    name = name.replace(/^kdeconnect_/, '');
    return {notifications: 'notification', sendnotifications: 'notification', remoteinput: 'mousepad'}[name] || name;
}

export default class Compatibility {
    constructor(manager, connection) {
        this.manager = manager;
        this.connection = connection;
        this.exportedDevices = new Map();
        this.discovery = new Set();
        this.root = exportObject(connection, PATH, `${IFACE}.daemon`, daemonXml, this);
        this.owner = Gio.bus_own_name_on_connection(connection, IFACE, Gio.BusNameOwnerFlags.NONE, null,
            () => console.error('Could not acquire org.kde.kdeconnect; another backend is running'));
    }
    devicesList(reachable = false, paired = false) {
        return [...this.manager.devices.values()].filter(d => (!reachable || d.connected) && (!paired || d.paired));
    }
    devices(onlyReachable, onlyPaired) { return this.devicesList(onlyReachable, onlyPaired).map(d => d.id); }
    deviceNames(onlyReachable, onlyPaired) {
        return Object.fromEntries(this.devicesList(onlyReachable, onlyPaired).map(d => [d.id, d.name]));
    }
    selfId() { return this.manager.id; }
    announcedName() { return this.manager.name; }
    setAnnouncedName(name) {
        if (!name.trim() || name.length > 32) throw new Error('Device names must contain 1 to 32 characters');
        this.manager.name = name;
    }
    forceOnNetworkChange() {
        for (const backend of this.manager.backends.values()) backend.broadcast();
    }
    acquireDiscoveryMode(id) { this.discovery.add(id); this.manager.discoverable = true; this.forceOnNetworkChange(); }
    releaseDiscoveryMode(id) { this.discovery.delete(id); }
    linkProviders() { return ['LanLinkProvider|enabled']; }
    deviceIdByName(name) { return this.devicesList().find(d => d.name === name)?.id || ''; }
    get pairingRequests() { return this.devicesList().filter(d => d._incomingPairRequest).map(d => d.id); }
    start() {
        // Device discovery/connection notifications are exported in a stable batch.
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this.sync(); return GLib.SOURCE_CONTINUE;
        });
        this.sync();
    }
    sync() {
        for (const device of this.manager.devices.values()) {
            if (!this.exportedDevices.has(device.id)) this.addDevice(device);
            const record = this.exportedDevices.get(device.id);
            const values = this.properties(device);
            for (const [name, value] of Object.entries(values)) {
                if (JSON.stringify(value) === JSON.stringify(record.last[name])) continue;
                record.object.emit_property_changed(name, new GLib.Variant(deviceTypes[name], value));
                record.last[name] = value;
            }
        }
        for (const [id, record] of this.exportedDevices) {
            if (!this.manager.devices.has(id)) {
                record.exports.forEach(item => item.unexport()); this.exportedDevices.delete(id);
                this.root.emit_signal('deviceRemoved', new GLib.Variant('(s)', [id]));
                this.root.emit_signal('deviceListChanged', null);
            }
        }
    }
    properties(device) {
        const paired = device.paired;
        return {name: device.name || device.id, type: device.type || 'phone', iconName: device.icon_name,
            statusIconName: device.icon_name, verificationKey: device.encryption_info || '',
            isReachable: device.connected, isPaired: paired, isPairRequested: Boolean(device._outgoingPairRequest),
            isPairRequestedByPeer: Boolean(device._incomingPairRequest), pairState: paired ? 1 : 0,
            supportedPlugins: device.settings.get_strv('supported-plugins').map(name => `kdeconnect_${name}`),
            reachableAddresses: device.connected ? [device.settings.get_string('last-connection')] : [],
            activeProviderNames: device.connected ? ['LanLinkProvider'] : []};
    }
    addDevice(device) {
        const path = `${PATH}/devices/${device.id}`;
        const api = {
            requestPairing: () => device.pair(),
            acceptPairing: () => { if (device._incomingPairRequest) device.pair(); },
            cancelPairing: () => { if (!device.paired) device.unpair(); },
            unpair: () => device.unpair(), reloadPlugins: () => device._loadPlugins(),
            loadedPlugins: () => [...device._plugins.keys()].map(name => `kdeconnect_${name}`),
            hasPlugin: name => device._plugins.has(pluginName(name)),
            isPluginEnabled: name => !device.settings.get_strv('disabled-plugins').includes(pluginName(name)),
            setPluginEnabled: (name, enabled) => {
                name = pluginName(name);
                if (!device.settings.get_strv('supported-plugins').includes(name)) throw new Error('Unsupported device plugin');
                const disabled = new Set(device.settings.get_strv('disabled-plugins'));
                if (enabled) disabled.delete(name); else disabled.add(name);
                device.settings.set_strv('disabled-plugins', [...disabled]);
            },
            encryptionInfo: () => device.encryption_info || '',
        };
        for (const name of Object.keys(deviceTypes)) Object.defineProperty(api, name, {get: () => this.properties(device)[name]});
        const object = exportObject(this.connection, path, `${IFACE}.device`, deviceXml, api);
        const record = {object, exports: [object], last: {}};
        this.exportedDevices.set(device.id, record);
        const plugin = (name, xml, impl) => record.exports.push(exportObject(this.connection,
            `${path}/${name}`, `${IFACE}.device.${name}`, xml, impl));
        const requirePlugin = name => {
            const instance = device._plugins.get(name);
            if (!instance) throw new Error(`The ${name} plugin is unavailable or the device is not paired`);
            return instance;
        };
        plugin('ping', method('sendPing', ['s']), {sendPing: text => requirePlugin('ping').ping(text)});
        plugin('findmyphone', method('ring'), {ring: () => requirePlugin('findmyphone').ring()});
        plugin('share', method('shareText', ['s']) + method('shareUrl', ['s']) + method('shareFile', ['s']), {
            shareText: text => requirePlugin('share').shareText(text),
            shareUrl: url => requirePlugin('share').shareUri(url),
            shareFile: file => requirePlugin('share').shareFile(file),
        });
        plugin('battery', property('charge', 'i') + property('isCharging', 'b'), {
            get charge() { return device._plugins.get('battery')?.level ?? -1; },
            get isCharging() { return device._plugins.get('battery')?.charging || false; },
        });
        plugin('sms', method('sendSms', ['s', 's']), {sendSms: (number, text) => requirePlugin('sms').sendSms(number, text)});
        const waitForMount = async () => {
            const sftp = requirePlugin('sftp');
            sftp.mount();
            for (let i = 0; i < 200; i++) {
                if (sftp.mounted) return true;
                if (sftp.mount_error || !device.connected) return false;
                await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50,
                    () => { resolve(); return GLib.SOURCE_REMOVE; }));
            }
            return false;
        };
        const mountReply = async (invocation, browse) => {
            try {
                const success = await waitForMount();
                if (success && browse) requirePlugin('sftp').device.activate_action('openPath',
                    new GLib.Variant('s', Gio.File.new_for_path(requirePlugin('sftp').mount_point).get_uri()));
                invocation.return_value(new GLib.Variant('(b)', [success]));
            } catch (error) { invocation.return_dbus_error('org.kde.kdeconnect.Error', error.message); }
        };
        plugin('sftp', method('mount') + method('unmount') + method('startBrowsing', [], ['b']) +
            method('mountAndWait', [], ['b']) + method('isMounted', [], ['b']) + method('mountPoint', [], ['s']) +
            method('getMountError', [], ['s']) + method('getDirectories', [], ['a{sv}']), {
            mount: () => requirePlugin('sftp').mount(), unmount: () => requirePlugin('sftp').unmount(),
            startBrowsingAsync: (_params, invocation) => mountReply(invocation, true),
            mountAndWaitAsync: (_params, invocation) => mountReply(invocation, false),
            isMounted: () => requirePlugin('sftp').mounted,
            mountPoint: () => requirePlugin('sftp').mount_point,
            getMountError: () => requirePlugin('sftp').mount_error,
            getDirectories: () => Object.fromEntries(Object.entries(requirePlugin('sftp').directories)
                .map(([name, path]) => [name, new GLib.Variant('s', path)])),
        });
        this.root.emit_signal('deviceAdded', new GLib.Variant('(s)', [device.id]));
        this.root.emit_signal('deviceListChanged', null);
    }
    destroy() {
        if (this.timer) GLib.source_remove(this.timer);
        for (const record of this.exportedDevices.values()) record.exports.forEach(item => item.unexport());
        this.root.unexport(); Gio.bus_unown_name(this.owner);
    }
}
