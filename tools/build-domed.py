#!/usr/bin/env python3
"""Build the GTK/Qt-free service and its separate native FLTK dialog helper."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('build', type=Path)
parser.add_argument('--stage', action='store_true')
parser.add_argument('--stamp', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
build = args.build.resolve()
runtime = build / 'runtime'
runtime.mkdir(parents=True, exist_ok=True)
for name in ('service', 'utils'):
    shutil.copytree(root / 'src' / name, runtime / name, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('ui', 'daemon.js', 'nativeMessagingHost.js'))
shutil.copy2(root / 'src/wl_clipboard.js', runtime / 'wl_clipboard.js')
# Legacy GTK window-geometry code has no native callers and is not shipped.
(runtime / 'service/utils/ui.js').unlink(missing_ok=True)
for module in runtime.rglob('*.js'):
    text = module.read_text()
    import re
    if re.search(r"gi://(?:Gtk|Gdk)(?:['\"?])", text):
        raise SystemExit(f'Unexpected GUI toolkit import in {module}')

schema = runtime / 'schemas'
schema.mkdir(exist_ok=True)
shutil.copy2(root / 'data/org.gnome.Shell.Extensions.GSConnect.gschema.xml', schema / 'org.domed.Connect.gschema.xml')
subprocess.run(['glib-compile-schemas', '--strict', str(schema)], check=True)
config = {'PACKAGE_VERSION': '74.domed1', 'PACKAGE_URL': 'https://github.com/GSConnect/gnome-shell-extension-gsconnect',
          'APP_ID': 'org.domed.Connect', 'APP_PATH': '/org/domed/Connect', 'IS_USER': False,
          'GNOME_SHELL_LIBDIR': '/usr/lib64', 'PACKAGE_LOCALEDIR': '/usr/share/locale',
          'OPENSSL_PATH': '/usr/bin/openssl', 'SSHADD_PATH': '/usr/bin/ssh-add',
          'SSHKEYGEN_PATH': '/usr/bin/ssh-keygen', 'FFMPEG_PATH': '/usr/bin/ffmpeg'}
(runtime / 'config.js').write_text("import GLib from 'gi://GLib';\nconst root = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);\nconst config = " + json.dumps(config) + ";\nconfig.PACKAGE_DATADIR = root;\nconfig.GSETTINGS_SCHEMA_DIR = `${root}/schemas`;\nexport default config;\n")
resources = ET.Element('gresources')
section = ET.SubElement(resources, 'gresource', prefix='/org/domed/Connect')
ET.SubElement(section, 'file', alias='org.domed.Connect.xml').text = str(root / 'data/org.gnome.Shell.Extensions.GSConnect.xml')
ET.ElementTree(resources).write(build / 'service.gresource.xml')
subprocess.run(['glib-compile-resources', str(build / 'service.gresource.xml'),
                '--target', str(runtime / 'org.domed.Connect.gresource')], check=True)
subprocess.run(['cmake', '-S', str(root / 'native'), '-B', str(build / 'native'), '-G', 'Ninja',
                '-DCMAKE_BUILD_TYPE=Release'], check=True)
subprocess.run(['cmake', '--build', str(build / 'native'), '-j4'], check=True)
shutil.copy2(build / 'native/dome-connect-dialog', runtime / 'dome-connect-dialog')
print('Built native service:', runtime / 'service/domed.js')

if args.stage:
    subprocess.run(['python3', str(root / 'tools/stage-domed.py'), str(build)], check=True)
if args.stamp:
    args.stamp.write_text('native Release build complete\n')
