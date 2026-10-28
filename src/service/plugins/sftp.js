// SPDX-License-Identifier: GPL-2.0-or-later
// SSHFS uses the paired TLS identity for both host verification and client auth.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Config from '../../config.js';
import Plugin from '../plugin.js';

export const Metadata = {
    label: _('SFTP'),
    id: 'org.domed.Connect.Plugin.SFTP',
    description: _('Browse the paired device filesystem'),
    incomingCapabilities: ['kdeconnect.sftp'],
    outgoingCapabilities: ['kdeconnect.sftp.request'],
    actions: {
        mount: {
            label: _('Mount'),
            icon_name: 'folder-remote-symbolic',

            parameter_type: null,
            incoming: ['kdeconnect.sftp'],
            outgoing: ['kdeconnect.sftp.request'],
        },
        unmount: {
            label: _('Unmount'),
            icon_name: 'media-eject-symbolic',

            parameter_type: null,
            incoming: ['kdeconnect.sftp'],
            outgoing: ['kdeconnect.sftp.request'],
        },
    },
};

async function capture(args, input = null) {
    const process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDIN_PIPE |
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [output, error] = await process.communicate_utf8_async(input, null);
    if (!process.get_successful()) throw new Error(`${args[0]} failed: ${error.trim()}`);
    return output.trim();
}

export async function sshHostKey(certificate) {
    const publicKey = await capture([Config.OPENSSL_PATH, 'x509', '-pubkey', '-noout'], certificate);
    return capture([Config.SSHKEYGEN_PATH, '-i', '-m', 'PKCS8', '-f', '/dev/stdin'], publicKey + '\n');
}

function isMounted(path) {
    try {
        const data = new TextDecoder().decode(GLib.file_get_contents('/proc/self/mountinfo')[1]);
        return data.split('\n').some(line => {
            const mount = line.split(' ')[4]?.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8)));
            return mount === path;
        });
    } catch { return false; }
}

const SFTPPlugin = GObject.registerClass({GTypeName: 'DomeConnectSFTPPlugin'}, class SFTPPlugin extends Plugin {
    _init(device) {
        super._init(device, 'sftp');
        this._point = `${Config.RUNTIMEDIR}/${device.id}/files`;
        this._mounting = false;
        this._mounted = false;
        this._directories = {};
        this._error = '';
    }
    get mounted() { return this._mounted && isMounted(this._point); }
    get mount_point() { return this._point; }
    get directories() { return this._directories; }
    get mount_error() { return this._error; }
    connected() {
        super.connected();
        if (this.device.connection_type === 'lan' && this.settings.get_boolean('automount')) this.mount();
    }
    disconnected() { this.unmount(); super.disconnected(); }
    handlePacket(packet) {
        if (packet.type !== 'kdeconnect.sftp') return;
        if (packet.body.errorMessage) {
            this._error = packet.body.errorMessage;
            this.device.showNotification({title: this.device.name, body: this._error});
        } else this._handleMount(packet).catch(error => { this._error = error.message; logError(error); });
    }
    async _handleMount(packet) {
        if (this.mounted || this._mounting) return;
        this._mounting = true;
        this._error = '';
        try {
            if (!this.device.paired || !this.device.connected) throw new Error('The SFTP device is not paired and connected');
            const port = Number(packet.body.port);
            if (!Number.isInteger(port) || port < 1739 || port > 1764) throw new Error('Invalid KDE Connect SFTP port');
            const user = packet.body.user || 'kdeconnect';
            if (!/^[a-zA-Z0-9_.-]+$/.test(user)) throw new Error('Invalid SFTP username');
            const host = this.device.channel.host;
            const server = host.includes(':') ? `[${host}]` : host;
            const certificate = this.device.settings.get_string('certificate-pem');
            if (!certificate) throw new Error('SFTP requires an existing certificate pin');
            // Android's SSH server deliberately reuses its TLS keypair. Pin that
            // same public key instead of accepting or deleting global SSH pins.
            const key = await sshHostKey(certificate);
            if (!this.device.paired || !this.device.connected ||
                this.device.settings.get_string('certificate-pem') !== certificate)
                throw new Error('The SFTP pairing changed while preparing the mount');
            const pinDirectory = `${Config.CONFIGDIR}/sftp`;
            GLib.mkdir_with_parents(pinDirectory, 0o700);
            const pins = `${pinDirectory}/${this.device.id}.known_hosts`;
            GLib.file_set_contents(pins, `[${host}]:${port} ${key}\n`);
            Gio.File.new_for_path(pins).set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
            GLib.mkdir_with_parents(this._point, 0o700);
            const remotePath = packet.body.multiPaths ? '/' : packet.body.path || '/';
            if (!remotePath.startsWith('/')) throw new Error('Invalid SFTP root path');
            const args = ['sshfs', `${user}@${server}:${remotePath}`, this._point, '-p', String(port), '-s', '-f', '-F', '/dev/null',
                '-o', `IdentityFile=${Config.CONFIGDIR}/private.pem`, '-o', 'IdentitiesOnly=yes',
                '-o', 'IdentityAgent=none', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', `UserKnownHostsFile=${pins}`, '-o', 'GlobalKnownHostsFile=/dev/null',
                '-o', 'PasswordAuthentication=no', '-o', 'ConnectTimeout=5',
                '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
            const process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
            this._process = process;
            let finished = false;
            process.communicate_utf8_async(null, null).then(([, error]) => {
                finished = true;
                if (this._process === process) { this._process = null; this._mounted = false; }
                if (!process.get_successful()) this._error = error.trim().slice(0, 2048) || 'The SFTP mount failed';
            }).catch(error => { finished = true; this._error = error.message; });
            for (let attempts = 0; attempts < 200 && !isMounted(this._point); attempts++) {
                if (finished) throw new Error(this._error || 'SSHFS exited before the mount was ready');
                await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { resolve(); return GLib.SOURCE_REMOVE; }));
            }
            if (!isMounted(this._point)) throw new Error('Timed out mounting the paired device');
            this._mounted = true;
            const names = packet.body.pathNames || [this.device.name];
            const paths = packet.body.multiPaths || ['/'];
            this._directories = {};
            const menu = new Gio.Menu();
            for (let i = 0; i < paths.length; i++) {
                const parts = paths[i].split('/').filter(Boolean);
                if (parts.includes('..')) continue;
                const local = this._point + '/' + parts.join('/');
                const name = names[i] || paths[i];
                this._directories[name] = local;
                menu.append(name, `device.openPath::${Gio.File.new_for_path(local).get_uri()}`);
            }
            menu.append(_('Unmount'), 'device.unmount');
            const item = new Gio.MenuItem();item.set_label(_('Files'));item.set_submenu(menu);
            const index = this.device.removeMenuAction('device.mount');this.device.addMenuItem(item, index);
        } catch (error) {
            if (!isMounted(this._point)) { this._process?.force_exit(); this._process = null; }
            throw error;
        } finally { this._mounting = false; }
    }
    mount() {
        if (this.mounted || this._mounting) return;
        this._error = '';
        this.device.sendPacket({type: 'kdeconnect.sftp.request', body: {startBrowsing: true}});
    }
    unmount() {
        if (isMounted(this._point)) {
            const process = Gio.Subprocess.new(['fusermount3', '-u', this._point], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            process.wait(null);
            if (!process.get_successful()) { this._error = 'The device filesystem is still in use'; return; }
        }
        this._process?.force_exit();this._process = null;this._mounted = false;this._directories = {};
    }
    destroy() { this.unmount(); super.destroy(); }
});
export default SFTPPlugin;
