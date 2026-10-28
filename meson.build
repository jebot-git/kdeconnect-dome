# SPDX-License-Identifier: GPL-2.0-or-later
project('kdeconnect-dome', version: '74.domed1', meson_version: '>= 0.59.0')
python = find_program('python3')
# This project intentionally installs into the de-xr system integration paths.
if get_option('prefix') != '/usr/local'
  error('Use --prefix=/usr/local; use DESTDIR for a staged installation')
endif
native_build = meson.project_build_root() / 'domed'
native = custom_target('dome-connect-native',
  output: 'native-build.stamp',
  command: [python, files('tools/build-domed.py'), native_build, '--stage', '--stamp', '@OUTPUT@'],
  build_by_default: true,
  build_always_stale: true,
)
test('protocol-and-plugins', python,
  args: [files('tools/test-domed.py'), native_build], depends: native, timeout: 300, is_parallel: false)
test('independent-tls-and-sftp', python,
  args: [files('tools/test-wire.py'), native_build / 'runtime'], depends: native, timeout: 120, is_parallel: false)
test('native-dialog-responses', python,
  args: [files('tools/test-dialogs.py'), native_build / 'runtime'], depends: native, timeout: 30, is_parallel: false)
meson.add_install_script(python, files('tools/install-domed.py'), native_build)
