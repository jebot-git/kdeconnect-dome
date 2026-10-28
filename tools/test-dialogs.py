#!/usr/bin/env python3
"""Exercise GJS-to-FLTK dialog response handling in an isolated X server."""
from pathlib import Path
import argparse,json,os,subprocess,tempfile,time
p=argparse.ArgumentParser(description=__doc__);p.add_argument('runtime',type=Path);a=p.parse_args();runtime=a.runtime.resolve()
read,write=os.pipe()
x=subprocess.Popen(['Xvfb','-displayfd',str(write),'-screen','0','1024x768x24','-nolisten','tcp'],pass_fds=(write,),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);os.close(write)
with os.fdopen(read) as stream:display=':'+stream.readline().strip()
try:
 with tempfile.TemporaryDirectory(prefix='connect-dialog-') as directory:
  env={**os.environ,'DISPLAY':display,'FLTK_BACKEND':'x11','GSCONNECT_MODE':'cli','LIBGL_ALWAYS_SOFTWARE':'1','XDG_CONFIG_HOME':directory+'/config','XDG_CACHE_HOME':directory+'/cache','XDG_RUNTIME_DIR':directory,'GSETTINGS_BACKEND':'memory'}
  for name in ('WAYLAND_DISPLAY','WAYLAND_SOCKET'):env.pop(name,None)
  runner=Path(directory)/'test.js'
  runner.write_text(f"import 'file://{runtime}/service/init.js';\nimport Gio from 'gi://Gio';\nimport {{dialog}} from 'file://{runtime}/service/native-ui.js';\nconst app = new Gio.Application({{application_id:'org.domed.Connect.DialogTest'}});\napp.connect('activate', async () => {{app.hold();try {{print('RESULT:'+JSON.stringify(await dialog({{kind:'input',title:'DOME-CONNECT-DIALOG-TEST',message:'Žluťoučký 日本語'}})));}} finally {{app.quit();}}}});\nawait app.runAsync([]);\n")
  for accept in (True,False):
   proc=subprocess.Popen(['dbus-run-session','--','gjs','-m',str(runner)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   try:
    for _ in range(150):
     result=subprocess.run(['xdotool','search','--name','^DOME-CONNECT-DIALOG-TEST$'],env=env,capture_output=True,text=True)
     if result.returncode==0:
      window=result.stdout.splitlines()[-1];time.sleep(.1)
      subprocess.run(['xdotool','mousemove','--window',window,'556' if accept else '444','395','click','1'],env=env,check=True,capture_output=True);break
     if proc.poll() is not None:break
     time.sleep(.02)
    out,err=proc.communicate(timeout=5)
    assert proc.returncode==0,(out,err)
    response=json.loads(next(line[7:] for line in out.splitlines() if line.startswith('RESULT:')))
    assert response.get('value','')==('Žluťoučký 日本語' if accept else ''),response
    print('PASS FLTK/GJS '+('accepted UTF-8 response' if accept else 'cancel response'),flush=True)
   finally:
    if proc.poll() is None:proc.kill();proc.wait()
finally:x.terminate();x.wait(timeout=5)
