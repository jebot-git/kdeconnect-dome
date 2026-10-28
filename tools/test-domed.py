#!/usr/bin/env python3
"""Run upstream protocol and plugin tests against the toolkit-free fork."""
from pathlib import Path
import argparse,os,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('build',type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[1];build=a.build.resolve();tests=build/'tests';tests.mkdir(exist_ok=True)
for name in ('fixtures','data'):
 shutil.copytree(root/'installed-tests'/name,tests/name,dirs_exist_ok=True)
for name in ('minijasmine','jasmine.js'):shutil.copy2(root/'installed-tests'/name,tests/name)
for name in ('core','backends','plugins','unit'):
 shutil.copytree(root/'installed-tests/suites'/name,tests/name,dirs_exist_ok=True)
(tests/'config.js').write_text(f"export {{default}} from 'file://{build}/runtime/config.js';\n")
for file in tests.rglob('*.js'):
 s=file.read_text().replace("import 'gi://Gdk?version=3.0';\n",'').replace("import 'gi://Gtk?version=3.0';\n",'').replace('globalThis.HAVE_GNOME = true;','globalThis.HAVE_GNOME = false;').replace('org.gnome.Shell.Extensions.GSConnect','org.domed.Connect')
 file.write_text(s)
names=['core/testPacket.js','core/testDevice.js','core/testPlugin.js','backends/testLanBackend.js','plugins/testPingPlugin.js','plugins/testBatteryPlugin.js','plugins/testClipboardPlugin.js','plugins/testSharePlugin.js','plugins/testRuncommandPlugin.js','plugins/testMprisPlugin.js','plugins/testSmsPlugin.js','plugins/testContactsPlugin.js','plugins/testNotificationPlugin.js']
failed=[]
for name in names:
 with tempfile.TemporaryDirectory(prefix='connect-test-') as directory:
  env={**os.environ,'XDG_CONFIG_HOME':directory+'/config','XDG_CACHE_HOME':directory+'/cache','XDG_RUNTIME_DIR':directory,'GSETTINGS_BACKEND':'memory','GSCONNECT_MODE':'cli','GIO_USE_VFS':'local','NO_AT_BRIDGE':'1','GSCONNECT_TEST':'1','GJS_PATH':str(build/'runtime'),'GSETTINGS_SCHEMA_DIR':str(build/'runtime/schemas')}
  for key in ('DISPLAY','WAYLAND_DISPLAY','WAYLAND_SOCKET'):env.pop(key,None)
  try:r=subprocess.run(['dbus-run-session','--','gjs','-m',str(tests/'minijasmine'),str(tests/name)],env=env,capture_output=True,text=True,timeout=30)
  except subprocess.TimeoutExpired:failed.append(name);print('TIMEOUT',name,flush=True);continue
  (build/(Path(name).stem+'.log')).write_text(r.stdout+r.stderr)
  print(('PASS ' if r.returncode==0 else 'FAIL ')+name,flush=True)
  if r.returncode:failed.append(name);print((r.stdout+r.stderr)[-3500:],flush=True)
if failed:raise SystemExit('Failed suites: '+', '.join(failed))
