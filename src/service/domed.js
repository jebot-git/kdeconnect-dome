#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import GObject from 'gi://GObject';
import system from 'system';
import './init.js';
import Config from '../config.js';
import Manager from './manager.js';
import Compatibility from './kde-compat.js';
import migrate from './migrate.js';
import {unwatchService} from '../wl_clipboard.js';

const Service = GObject.registerClass({GTypeName: 'DomeConnectService'}, class Service extends Gio.Application {
    _init() {
        super._init({application_id: 'org.domed.Connect', flags: Gio.ApplicationFlags.FLAGS_NONE});
        GLib.set_prgname('dome-connect');
        GLib.set_application_name('Dome Connect');
    }
    get settings() {
        if (!this._settings) this._settings = new Gio.Settings({settings_schema: Config.GSCHEMA.lookup(Config.APP_ID, true)});
        return this._settings;
    }
    vfunc_dbus_register(connection, path) {
        if (!super.vfunc_dbus_register(connection, path)) return false;
        this.manager = new Manager({connection, object_path: path});
        this.compatibility = new Compatibility(this.manager, connection);
        return true;
    }
    vfunc_startup() {
        super.vfunc_startup();
        this.hold();
        const route = new Gio.SimpleAction({name: 'device', parameter_type: new GLib.VariantType('(ssbv)')});
        route.connect('activate', (action, parameter) => {
            const [id, name, hasParameter, value] = parameter.deepUnpack();
            this.manager.devices.get(id)?.activate_action(name, hasParameter ? value : null);
        });
        this.add_action(route);
        const quit = new Gio.SimpleAction({name: 'quit'});
        quit.connect('activate', () => this.quit());
        this.add_action(quit);
        migrate(this.settings);
        if (GLib.getenv('DOME_CONNECT_NO_NETWORK') === '1')
            this.manager._loadDevices();
        else
            this.manager.start();
        this.compatibility.start();
        for (const signal of [2, 15]) GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => {
            this.quit(); return GLib.SOURCE_REMOVE;
        });
        console.log('Dome Connect is ready (GIO/TLS, no Qt or GTK).');
    }
    vfunc_activate() {}
    notify_error(error) { logError(error); }
    vfunc_shutdown() {
        unwatchService();
        this.compatibility?.destroy();
        this.manager?.destroy();
        super.vfunc_shutdown();
    }
});
system.exit(await new Service().runAsync([system.programInvocationName, ...ARGV]));
