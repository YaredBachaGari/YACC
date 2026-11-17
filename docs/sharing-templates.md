# Sharing templates

A template is a team you can start again: its roles and instructions, the people, the stages, toolkits, skills, schedules and the brief. Share one as a single file, a link, or through a gallery.

## Save your team as a template

**Settings → Project → Save as a template.** Choose where it's kept:

- **On this machine** (`~/.yacc/templates/<name>/`): offered in every project you start.
- **In this project** (`.yacc/templates/<name>/` in the repo): commit it and everyone who clones the repo gets it.

No secrets, sandboxes, tasks or temporary hires are saved.

## Export and send it

**Settings → Templates**, then **Export** next to any template. You get `<name>.yacc-template.json`: one file with the template and its skills. Send it however you like.

## Install one

**Settings → Templates → Install** (or **Install a template** on the welcome screen), then:

- **Gallery:** templates published for everyone.
- **From a file:** a `.yacc-template.json` someone sent you.
- **From a link:** an `https://` address of one (GitHub page links work too).

You always see a preview first: the roles and what each may do, the stages, the skills it adds, the MCP servers it needs, and notes such as "the lead can hire and dismiss" or "schedules come switched off". Nothing runs on install: schedules are always switched off, and an installed template never replaces one you have (a second copy gets a new name).

A bundle can only contain the template and text files under `skills/`; anything else is refused, as is anything over 1 MB.

## Publish to a gallery

A gallery is a JSON index of template files at an `https://` address:

```json
{
  "format": "yacc-gallery",
  "version": 1,
  "templates": [
    { "id": "newsletter-desk", "name": "Newsletter desk", "description": "…", "url": "newsletter-desk.yacc-template.json", "tags": ["writing"] }
  ]
}
```

Relative `url`s are read from the index's folder. HQ reads the gallery in this repo's [`templates/`](../templates) folder by default; point it at your own with `YACC_GALLERY=https://…/index.json yacc-hq` (a team's private gallery, say).

### Add a template to this repo's gallery

1. Put the template in `templates/<id>/`: a `template.yml` (the same format HQ saves) and any `skills/<name>/SKILL.md`.
2. Run `npx tsx scripts/build-gallery.ts`. It checks every template and writes `templates/<id>.yacc-template.json` and `templates/index.json`.
3. Add a guide in `docs/templates/<id>.md` and open a pull request. CI runs `build-gallery.ts --check`, so the files must be up to date.
