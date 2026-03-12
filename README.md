# evload

## Install

Quick install script to install dependencies for the whole monorepo.

- Windows (PowerShell):

	Run `./install.ps1` from a PowerShell prompt in the repository root.

- Unix / macOS:

	Run `./install.sh` from the repository root.

After install, start both backend and frontend in development mode with:

```
npm run dev
```

Or run the two parts separately:

```
npm run dev --prefix backend
npm run dev --prefix frontend
```