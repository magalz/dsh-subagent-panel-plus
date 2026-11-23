# Security Policy

## Supported versions

The latest commit on `main` is supported, and the latest release once there is one. Please update before reporting a vulnerability.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** link on the **Security** tab of this repository (private vulnerability reporting). Do not open a public issue.

Include as much of the following as you can:

- Affected version or commit.
- Steps to reproduce, including any relevant configuration.
- Impact and severity as you assess them.
- Operating system and dsh version.
- Any logs or console output, with secrets removed.

You should receive an acknowledgement; we will keep you informed as we investigate and fix the issue.

## Scope

The plugin talks only to the local dsh server. Its Host half exposes authenticated `delete` and `exists` routes used by the browser panel to remove and synchronize subagent entries in the running session. It sends nothing to external services itself.
