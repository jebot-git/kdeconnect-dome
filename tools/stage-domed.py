#!/usr/bin/env python3
"""Stage an already-built native service; never compile as root."""
from pathlib import Path
import argparse,os,shutil,subprocess
p=argparse.ArgumentParser(description=__doc__);p.add_argument('build',type=Path);a=p.parse_args()
project=Path(__file__).resolve().parents[1];build=a.build.resolve();stage=build/'stage'
if stage.exists():shutil.rmtree(stage)
# Install the FLTK helper with its explicit private runtime path.
subprocess.run(['cmake','--install',str(build/'native'),'--prefix','/usr/local'],env={**os.environ,'DESTDIR':str(stage)},check=True)
source=build/'runtime';target=stage/'usr/local/share/kdeconnect-dome';target.mkdir(parents=True,exist_ok=True)
shutil.copytree(source,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('dome-connect-dialog'))
for directory in ('usr/bin','usr/share/dbus-1/services','etc/xdg/autostart','usr/share/applications','usr/share/licenses/domed-kdeconnect-backend'):
 (stage/directory).mkdir(parents=True,exist_ok=True)
(stage/'usr/bin/kdeconnectd').write_text('#!/bin/sh\nunset QT_QPA_PLATFORMTHEME QT_STYLE_OVERRIDE\nexec /usr/bin/gjs -m /usr/local/share/kdeconnect-dome/service/domed.js "$@"\n')
shutil.copy2(project/'tools/kdeconnect-cli',stage/'usr/bin/kdeconnect-cli')
(stage/'usr/bin/kdeconnect-handler').write_text('#!/bin/sh\nexec /usr/local/bin/dome-tray --devices\n')
for file in (stage/'usr/bin').iterdir():file.chmod(0o755)
(stage/'usr/share/dbus-1/services/org.kde.kdeconnect.service').write_text('[D-BUS Service]\nName=org.kde.kdeconnect\nExec=/usr/bin/kdeconnectd\n')
(stage/'etc/xdg/autostart/org.kde.kdeconnect.daemon.desktop').write_text('[Desktop Entry]\nType=Application\nName=Dome Connect\nComment=Native KDE Connect protocol service\nExec=/usr/bin/kdeconnectd\nIcon=kdeconnect\nNoDisplay=true\n')
(stage/'usr/share/applications/org.domed.Connect.desktop').write_text('[Desktop Entry]\nType=Application\nName=Dome Connect\nComment=Connected devices through native FLTK controls\nExec=/usr/local/bin/dome-tray --devices\nIcon=kdeconnect\nNoDisplay=true\n')
for name in ('LICENSES/GPL-2.0-or-later.txt','COPYING','LICENSE','LICENSE.md'):
 if (project/name).is_file():shutil.copy2(project/name,stage/'usr/share/licenses/domed-kdeconnect-backend/LICENSE');break
# Source checkouts may use a private umask; public installed code must be readable.
for file in stage.rglob('*'):
 if file.is_dir():file.chmod(0o755)
 elif file.is_file():file.chmod(0o755 if file.parent==stage/'usr/bin' or file.name=='dome-connect-dialog' else 0o644)
