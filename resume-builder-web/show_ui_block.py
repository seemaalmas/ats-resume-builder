from pathlib import Path
lines = Path('app/admin/settings/page.tsx').read_text(encoding='utf-8').splitlines()
start = None
end = None
for idx, line in enumerate(lines):
    if "!loading && hasAccess ? (" in line:
        start = idx
    if start is not None and lines[idx].strip() == '        ) : null}':
        end = idx
        break
if start is None or end is None:
    raise SystemExit('block not found')
for i in range(start, end+1):
    print(lines[i])
