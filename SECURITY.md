# Security

Shufler is a 3D control room for developers who run many AI coding agent sessions at once. It runs on your
machine, binds to 127.0.0.1, and can type into your terminals, so security bugs matter.

## Reporting a vulnerability

Please report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (GitHub security advisories). Do not open a public issue.

Include what you found, how to reproduce it, and the version or commit. You will get a reply within a week.

## In scope

- Anything that lets a web page, another local user or a remote host reach the daemon or trigger an action.
- Ways around the never-do guard in `daemon/shufler/actions.py` or the confirm step for actions.
- Config or command values that end up run through a shell, or secrets leaking into the snapshot, logs or history.

## Supported versions

Only the latest commit on `main` is supported.
