from pathlib import Path
path = Path('src/resume/resume.service.ts')
data = path.read_text(encoding='utf-8')
old_experience = "  experience.forEach((entry, index) => mapEntry('experience', entry, index));\n"
new_experience = "  experience.forEach((entry: any, index: number) => mapEntry('experience', entry, index));\n"
old_projects = "  projects.forEach((entry, index) => mapEntry('projects', entry, index));\n"
new_projects = "  projects.forEach((entry: any, index: number) => mapEntry('projects', entry, index));\n"
if old_experience not in data or old_projects not in data:
    raise SystemExit('forEach lines not found')
data = data.replace(old_experience, new_experience, 1)
data = data.replace(old_projects, new_projects, 1)
path.write_text(data, encoding='utf-8')
print('typed forEach callbacks')
