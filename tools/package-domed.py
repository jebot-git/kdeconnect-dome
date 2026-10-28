#!/usr/bin/env python3
"""Stage and package the native service without the legacy Qt daemon or libraries."""
from pathlib import Path
import argparse,os,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('build',type=Path);a=p.parse_args()
project=Path(__file__).resolve().parents[1];build=a.build.resolve();stage=build/'stage';rpm=build/'rpm'
if stage.exists():shutil.rmtree(stage)
subprocess.run(['python3',str(project/'tools/build-domed.py'),str(build)],check=True)
subprocess.run(['python3',str(project/'tools/stage-domed.py'),str(build)],check=True)
(rpm/'SPECS').mkdir(parents=True,exist_ok=True)
paths=['/'+str(p.relative_to(stage)) for p in stage.rglob('*') if not p.is_dir()]
(rpm/'files.list').write_text('\n'.join(sorted(paths))+'\n')
spec=f'''%global _build_id_links none
%global debug_package %{{nil}}
Name: domed-kdeconnect-backend
Version: 26.08.1
Release: 4.local
Summary: Toolkit-free KDE Connect protocol service with native FLTK controls
License: GPL-2.0-or-later
URL: https://github.com/GSConnect/gnome-shell-extension-gsconnect
Provides: kdeconnectd = %{{version}}
Provides: kde-connect = %{{version}}
Obsoletes: kdeconnectd < 27
Obsoletes: kde-connect-libs < 27
Requires: gjs
Requires: glib-networking
Requires: python3-gobject-base
Requires: openssl
Requires: wl-clipboard
Requires: pulseaudio-utils
Requires: pipewire-utils
Requires: openssh-clients
Requires: sshfs
Requires: ydotool
%description
Dome Connect uses a fork of the GSConnect KDE Connect protocol implementation.
LAN discovery, certificate-pinned TLS, explicit pairing, device plugins and
KDE-compatible D-Bus APIs operate without Qt, GTK or GNOME Shell. Interactive
prompts use a separate native FLTK helper and the existing DomeD device manager.
The old Qt daemon, command-line clients, and KDE Connect libraries are replaced.
%prep
%build
%install
mkdir -p %{{buildroot}}
cp -a {stage}/. %{{buildroot}}/
%files -f {rpm}/files.list
'''
(rpm/'SPECS/domed-kdeconnect-backend.spec').write_text(spec)
# The fixed /opt prefix is intentional: it is DomeD's patched native FLTK.
helper=stage/'usr/local/share/kdeconnect-dome/dome-connect-dialog'
elf=subprocess.check_output(['readelf','-d',str(helper)],text=True)
assert '/opt/fltk-vr/toolkit/lib' in elf
assert '/home/' not in '\n'.join(line for line in elf.splitlines() if 'PATH' in line)
subprocess.run(['rpmbuild','-bb','--define',f'_topdir {rpm}',str(rpm/'SPECS/domed-kdeconnect-backend.spec')],check=True,env={**os.environ,'QA_RPATHS':'0x0002'})
print('Packaged native backend in',rpm/'RPMS')
