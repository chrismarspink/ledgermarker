#!/usr/bin/env python3
# pptxgenjs 는 라틴 서체(<a:latin>)만 쓰므로 한글(East Asian 스크립트)은 테마 기본 ea 서체로 렌더된다.
# 모든 <a:latin typeface="X"/> 옆에 <a:ea typeface="X"/> 를 넣고 테마의 ea 서체도 X 로 맞춘다.
# 사용: fixea.py in.pptx "폰트명" out.pptx
import re, sys, zipfile

src, font, dst = sys.argv[1], sys.argv[2], sys.argv[3]
zin = zipfile.ZipFile(src)
zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename.startswith('ppt/slides/slide') and item.filename.endswith('.xml'):
        s = data.decode('utf-8')
        s = re.sub(r'<a:latin typeface="([^"]+)"([^/]*)/>(?!<a:ea)', lambda m: f'<a:latin typeface="{m.group(1)}"{m.group(2)}/><a:ea typeface="{font}"/>', s)
        data = s.encode('utf-8')
    elif item.filename.startswith('ppt/theme/') and item.filename.endswith('.xml'):
        s = data.decode('utf-8')
        s = re.sub(r'<a:ea typeface="[^"]*"/>', f'<a:ea typeface="{font}"/>', s)
        data = s.encode('utf-8')
    zout.writestr(item, data)
zout.close()
print('ok', dst)
