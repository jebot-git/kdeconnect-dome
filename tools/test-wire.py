#!/usr/bin/env python3
"""Exercise the service over real TLS using an independent KDE Connect peer."""
import argparse,getpass,hashlib,json,os,socket,ssl,subprocess,tempfile,time,uuid
from pathlib import Path
import gi
gi.require_version('Gio','2.0')
from gi.repository import Gio,GLib
p=argparse.ArgumentParser(description=__doc__);p.add_argument('runtime',type=Path);p.add_argument('--log',type=Path);a=p.parse_args()
runtime=a.runtime.resolve();project=Path(__file__).resolve().parents[1]
if os.environ.get('DOME_CONNECT_TEST_BUS')!='1':
 os.execvpe('dbus-run-session',['dbus-run-session','--',os.sys.executable,__file__,str(runtime),*(['--log',str(a.log)] if a.log else [])],{**os.environ,'DOME_CONNECT_TEST_BUS':'1'})
bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
def call(path,iface,method,signature='',*values):
 params=GLib.Variant('('+signature+')',values) if signature else None
 return bus.call_sync('org.kde.kdeconnect',path,iface,method,params,None,Gio.DBusCallFlags.NO_AUTO_START,3000,None).unpack()
def wait(predicate):
 end=time.monotonic()+10
 while time.monotonic()<end:
  if daemon.poll() is not None:raise AssertionError('Native daemon exited')
  try:
   result=predicate()
   if result:return result
  except (GLib.Error,OSError,KeyError):pass
  time.sleep(.03)
 raise AssertionError('Timed out waiting for device state')
def check(value,label):
 assert value,label
 print('PASS '+label,flush=True)
with tempfile.TemporaryDirectory(prefix='dome-wire-') as directory:
 root=Path(directory)
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env={**os.environ,'XDG_RUNTIME_DIR':directory,'XDG_CONFIG_HOME':directory+'/config','XDG_CACHE_HOME':directory+'/cache','XDG_STATE_HOME':directory+'/state','GSETTINGS_BACKEND':'memory','GIO_USE_VFS':'local','GSCONNECT_MODE':'cli','DOME_CONNECT_PORT':str(port),'DOME_CONNECT_DEBUG':'1'}
 for name in ('DISPLAY','WAYLAND_DISPLAY','WAYLAND_SOCKET'):env.pop(name,None)
 peerid=uuid.uuid4().hex
 def certificate(prefix,name):
  cert=root/(prefix+'.crt');key=root/(prefix+'.key')
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','2','-subj','/CN='+name],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  return cert,key
 cert,key=certificate('peer',peerid)
 class Peer:
  def __init__(self,cert,key,identity=peerid):
   self.buffer=b'';self.packets=[]
   self.identity={'id':int(time.time()*1000),'type':'kdeconnect.identity','body':{'deviceId':identity,'deviceName':'Independent test peer','deviceType':'phone','protocolVersion':8,'tcpPort':port+1,'incomingCapabilities':['kdeconnect.ping','kdeconnect.share.request','kdeconnect.findmyphone.request','kdeconnect.battery.request','kdeconnect.sms.request','kdeconnect.sftp.request'],'outgoingCapabilities':['kdeconnect.ping','kdeconnect.battery','kdeconnect.share.request','kdeconnect.sftp']}}
   raw=socket.create_connection(('127.0.0.1',port),timeout=8)
   raw.sendall((json.dumps(self.identity)+'\n').encode())
   context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key)
   context.verify_mode=ssl.CERT_REQUIRED;context.load_verify_locations(str(root/'config/kdeconnect-dome/certificate.pem'))
   self.socket=context.wrap_socket(raw,server_side=True)
   self.socket.settimeout(.1)
   self.read('kdeconnect.identity')
   self.socket.sendall((json.dumps(self.identity)+'\n').encode())
  def send(self,type,body):self.socket.sendall((json.dumps({'id':int(time.time()*1000),'type':type,'body':body})+'\n').encode())
  def read(self,type):
   end=time.monotonic()+6
   while time.monotonic()<end:
    for i,item in enumerate(self.packets):
     if item['type']==type:return self.packets.pop(i)
    try:
     data=self.socket.recv(65536)
     if not data:raise ConnectionError('Peer TLS connection closed')
     self.buffer+=data
     while b'\n' in self.buffer:
      line,self.buffer=self.buffer.split(b'\n',1)
      self.packets.append(json.loads(line))
    except socket.timeout:pass
   raise AssertionError('Missing wire packet '+type)
  def close(self):self.socket.close()
 log=(a.log or runtime.parent/'wire-test.log').open('w+')
 daemon=subprocess.Popen(['gjs','-m',str(runtime/'service/domed.js')],env=env,stdout=log,stderr=log)
 try:
  wait(lambda:call('/modules/kdeconnect','org.kde.kdeconnect.daemon','selfId')[0])
  peer=Peer(cert,key)
  path='/modules/kdeconnect/devices/'+peerid
  def prop(name):return call(path,'org.freedesktop.DBus.Properties','Get','ss','org.kde.kdeconnect.device',name)[0]
  wait(lambda:prop('isReachable'))
  check(not prop('isPaired'),'TLS identity exchange does not implicitly pair a device')
  try:call(path+'/ping','org.kde.kdeconnect.device.ping','sendPing','s','before-pair')
  except GLib.Error:pass
  else:raise AssertionError('Unpaired device could use a plugin')
  check(True,'Unpaired device actions are rejected')
  peer.send('kdeconnect.pair',{'pair':True,'timestamp':int(time.time())})
  wait(lambda:prop('isPairRequestedByPeer'))
  check(not prop('isPaired'),'Incoming pairing waits for explicit local acceptance')
  call(path,'org.kde.kdeconnect.device','acceptPairing')
  check(peer.read('kdeconnect.pair')['body']['pair'],'Explicit acceptance confirms pairing over TLS')
  wait(lambda:prop('isPaired'))
  peer.send('kdeconnect.battery',{'currentCharge':73,'isCharging':True,'thresholdEvent':0})
  wait(lambda:call(path+'/battery','org.freedesktop.DBus.Properties','Get','ss','org.kde.kdeconnect.device.battery','charge')[0]==73)
  check(True,'Battery packets reach the existing FLTK-compatible D-Bus interface')
  subprocess.run([str(project/'tools/kdeconnect-cli'),'-d',peerid,'--ping-msg','local-wire-test'],env=env,check=True)
  check(peer.read('kdeconnect.ping')['body']['message']=='local-wire-test','Native CLI ping interoperates with the independent TLS peer')
  call(path+'/share','org.kde.kdeconnect.device.share','shareText','s','Žluťoučký 日本語')
  check(peer.read('kdeconnect.share.request')['body']['text']=='Žluťoučký 日本語','Shared text preserves UTF-8 across the wire')
  call(path+'/findmyphone','org.kde.kdeconnect.device.findmyphone','ring')
  check(peer.read('kdeconnect.findmyphone.request')['body']=={},'Find-phone action retains its wire format')
  # A separate OpenSSH server exercises real SSHFS, not a mocked mount API.
  # Its host key must be the public key pinned during the TLS pairing above.
  sftp=path+'/sftp';sftpiface='org.kde.kdeconnect.device.sftp'
  known=Path.home()/'.ssh/known_hosts'
  knownhash=hashlib.sha256(known.read_bytes()).hexdigest() if known.exists() else None
  hostkey=root/'ssh-host-key'
  hostkey.write_bytes(key.read_bytes());hostkey.chmod(0o600)
  auth=root/'authorized_keys'
  auth.write_bytes(subprocess.check_output(['ssh-keygen','-y','-f',str(root/'config/kdeconnect-dome/private.pem')]))
  auth.chmod(0o600)
  for sftpport in range(1739,1765):
   try:
    with socket.socket() as probe:probe.bind(('127.0.0.1',sftpport))
    break
   except OSError:continue
  else:raise AssertionError('No free KDE Connect SFTP test port')
  conf=root/'sshd_config'
  conf.write_text(f"Port {sftpport}\nListenAddress 127.0.0.1\nHostKey {hostkey}\nPidFile {root}/sshd.pid\nAuthorizedKeysFile {auth}\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nAllowUsers {getpass.getuser()}\nSubsystem sftp internal-sftp\n")
  sshlog=(root/'sshd.log').open('w+')
  sshd=subprocess.Popen(['/usr/bin/sshd','-D','-e','-f',str(conf)],stdout=sshlog,stderr=sshlog)
  def serverReady():
   if sshd.poll() is not None:
    sshlog.seek(0);raise AssertionError(sshlog.read())
   with socket.create_connection(('127.0.0.1',sftpport),.1):return True
  try:
   wait(serverReady)
   files=root/'remote-files';files.mkdir();(files/'utf8.txt').write_text('Žluťoučký 日本語')
   call(sftp,sftpiface,'mount')
   check(peer.read('kdeconnect.sftp.request')['body']['startBrowsing'],'SFTP mount requests retain the KDE Connect wire format')
   peer.send('kdeconnect.sftp',{'port':sftpport,'user':getpass.getuser(),'path':str(files)})
   wait(lambda:call(sftp,sftpiface,'isMounted')[0])
   point=Path(call(sftp,sftpiface,'mountPoint')[0])
   check((point/'utf8.txt').read_text()=='Žluťoučký 日本語','Certificate-pinned SSHFS authenticates and reads the peer filesystem')
   call(sftp,sftpiface,'unmount')
   wait(lambda:not call(sftp,sftpiface,'isMounted')[0])
   # Different SSH host key on the same address must be rejected.
   sshd.terminate();sshd.wait(timeout=5)
   wrongcert,wrongkey=certificate('wrong-ssh',uuid.uuid4().hex)
   hostkey.write_bytes(wrongkey.read_bytes())
   sshd=subprocess.Popen(['/usr/bin/sshd','-D','-e','-f',str(conf)],stdout=sshlog,stderr=sshlog)
   wait(serverReady)
   peer.send('kdeconnect.sftp',{'port':sftpport,'user':getpass.getuser(),'path':str(files)})
   wait(lambda:call(sftp,sftpiface,'getMountError')[0])
   check(not call(sftp,sftpiface,'isMounted')[0],'SFTP rejects an SSH host key that differs from the paired TLS certificate')
   check((hashlib.sha256(known.read_bytes()).hexdigest() if known.exists() else None)==knownhash,'SFTP leaves the user SSH known_hosts unchanged')
  finally:
   try:call(sftp,sftpiface,'unmount')
   except GLib.Error:pass
   sshd.terminate() if sshd.poll() is None else None
   sshd.wait(timeout=5);sshlog.close()

  peer.close();wait(lambda:not prop('isReachable'))
  badcert,badkey=certificate('impostor',peerid)
  try:impostor=Peer(badcert,badkey);impostor.read('kdeconnect.pair')
  except (OSError,ssl.SSLError,ConnectionError,AssertionError):pass
  else:raise AssertionError('Changed certificate was accepted')
  check(prop('isPaired'),'A changed certificate is rejected without erasing the existing pair')
  peer=Peer(cert,key);wait(lambda:prop('isReachable'))
  check(prop('isPaired'),'Original pinned certificate reconnects without re-pairing')
  call(path,'org.kde.kdeconnect.device','unpair')
  check(peer.read('kdeconnect.pair')['body']['pair'] is False,'Explicit unpair revokes trust and informs the peer')
  wait(lambda:not prop('isPaired'))
  peer.close()
  maps=Path(f'/proc/{daemon.pid}/maps').read_text()
  check('libQt' not in maps and 'libgtk' not in maps,'Full pairing and device actions load neither GTK nor Qt')
 except Exception:
  log.flush();print((runtime.parent/'wire-test.log').read_text());raise
 finally:
  if daemon.poll() is None:daemon.terminate()
  daemon.wait(timeout=5);log.close()
