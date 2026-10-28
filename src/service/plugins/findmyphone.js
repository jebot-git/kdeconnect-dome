// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as NativeUI from '../native-ui.js';

import * as Components from '../components/index.js';
import Plugin from '../plugin.js';


export const Metadata = {
    label: _('Find My Phone'),
    description: _('Ring your paired device'),
    id: 'org.domed.Connect.Plugin.FindMyPhone',
    incomingCapabilities: ['kdeconnect.findmyphone.request'],
    outgoingCapabilities: ['kdeconnect.findmyphone.request'],
    actions: {
        ring: {
            label: _('Ring'),
            icon_name: 'phonelink-ring-symbolic',

            parameter_type: null,
            incoming: [],
            outgoing: ['kdeconnect.findmyphone.request'],
        },
    },
};


/**
 * FindMyPhone Plugin
 * https://github.com/KDE/kdeconnect-kde/tree/master/plugins/findmyphone
 */
const FindMyPhonePlugin = GObject.registerClass({
    GTypeName: 'GSConnectFindMyPhonePlugin',
}, class FindMyPhonePlugin extends Plugin {
    _init(device) {
        super._init(device, 'findmyphone');
        this._player = Components.acquire('sound');
        this._ring = null;
    }
    handlePacket(packet) {
        if (packet.type !== 'kdeconnect.findmyphone.request') return;
        if (this._ring) { this._ring.cancel(); this._ring = null; return; }
        const cancel = new Gio.Cancellable();
        this._ring = cancel;
        this._player.loopSound('phone-incoming-call', cancel).catch(logError);
        NativeUI.message(this.device.name, _('Device location requested')).finally(() => {
            cancel.cancel();
            if (this._ring === cancel) this._ring = null;
        }).catch(logError);
    }
    ring() {
        this.device.sendPacket({type: 'kdeconnect.findmyphone.request', body: {}});
    }
    destroy() {
        this._ring?.cancel();
        this._player = Components.release('sound');
        super.destroy();
    }
});
export default FindMyPhonePlugin;
