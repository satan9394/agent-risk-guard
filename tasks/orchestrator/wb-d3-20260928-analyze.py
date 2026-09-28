import re

cmd = open('_repro_cmd.txt', encoding='utf-8').read()

# 复现 hook 的 $cmdTest / $cmdNaked 预处理（dangerous-commands.ps1 L300-304）
cmdTest = re.sub(r'(?is)\b(?:echo|printf)\b[^;&|\r\n]*(?=[;&|\r\n]|$)', '', cmd)
cmdTest = re.sub(r'''(?i)\bprint\s*\(['"][^'"]*['"]\)''', 'print()', cmdTest)
cmdNaked = re.sub(r'["\'`]', '', cmdTest)

re_path = r'(?i)\$recycle\.bin'
re_del = (r'(?i)\b(?:Remove-Item|ri|rm|rmdir|rd|del|erase|unlink|shred|rimraf)\b'
          r'|\bfs\.(?:promises\.)?(?:rm|unlink|rmdir)(?:Sync)?\s*\(|\.Delete\s*\('
          r'|\[System\.IO\.(?:File|Directory)\]::Delete')

for name, text in (('cmd', cmd), ('cmdTest', cmdTest), ('cmdNaked', cmdNaked)):
    p = [m.start() for m in re.finditer(re_path, text)]
    v = [(m.group(0), m.start()) for m in re.finditer(re_del, text)]
    print(f'--- {name}: len={len(text)}  PATH={p}')
    print(f'    VERB={v}')
    for g, s in v:
        print(f'      ctx: {text[max(0, s-40):s+30]!r}')

print()
print('=== 判定 ===')
for name, text in (('cmd', cmd), ('cmdTest', cmdTest), ('cmdNaked', cmdNaked)):
    hit_p = bool(re.search(re_path, text))
    hit_v = bool(re.search(re_del, text))
    if hit_p and hit_v:
        print(f'DENY 由 {name} 触发：path=真 verb=真')
