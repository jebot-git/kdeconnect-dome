#!/usr/bin/env python3
"""Install only the tree staged by the regular-user build."""
from pathlib import Path
import os,shutil,sys
stage=Path(sys.argv[1]).resolve()/'stage'
if not (stage/'usr/bin/kdeconnectd').is_file():raise SystemExit('Build and stage as the regular user first.')
os.umask(0o022)
dest=Path(os.environ.get('DESTDIR') or '/')
shutil.copytree(stage,dest,dirs_exist_ok=True)
