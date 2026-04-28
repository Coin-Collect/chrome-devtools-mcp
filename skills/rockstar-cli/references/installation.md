# Installation

The `rockstar` command is made available globally during the project build process. Run the following from the project root:

```sh
npm run build
```

This will:
1. Build the project
2. Copy it to `~/rockstarx/`
3. Create `whitelist.json` with allowed domains
4. Prompt for `SUPABASE_URL` and `SUPABASE_KEY` if `.env` doesn't exist
5. Run `npm link` to register the `rockstar` command globally

After that, `rockstar` is available system-wide.

## Troubleshooting

- **Command not found:** If `rockstar` is not recognized, ensure your global npm `bin` directory is in your system's `PATH`. Restart your terminal or source your shell configuration file (e.g., `.bashrc`, `.zshrc`). You can find the npm global bin path with `npm config get prefix`.
- **Permission errors:** If you encounter `EACCES` or permission errors, avoid using `sudo`. Instead, use a node version manager like `nvm`, or configure npm to use a different global directory.
- **Rebuilding:** After code changes, run `npm run build` again. The copy and global link will be refreshed automatically.
- **Daemon stuck:** Run `rockstar stop` to force-stop the daemon, then retry your command.
