# Rerunner - Re-install Runner

Rerunner is an interactive tool for automating a particular Electron development workflow:

1. Build/rebuild the Electron app
1. Kill the app's process if it is currently running
1. Install/reinstall the app using the installer that was built in step 1
1. Run the app from the fresh installation

This is the build-kill-install-run workflow.

## Why?

Because if you're troubleshooting something that only happens in the built app then you may end up repeating the build-kill-install-run steps... a lot.

The most obvious use case for rerunner is when you're developing the updater flow (e.g. [electron-updater](https://www.npmjs.com/package/electron-updater))

## Requirements

- macOS (Windows/Linux support planned)
- Electron project using electron-builder
- Node.js 14+
- Yarn (temporary, future versions won't be tied to any package manager)

## Installation

```bash
yarn add --dev rerunner
# or
npm install --save-dev rerunner
```

Add a script to your `package.json`:

```json
{
  "scripts": {
    "rr": "rerunner"
  }
}
```

## Usage

From your Electron project directory:

```bash
yarn rr
```

The app is interactive and should be self-explanatory. You can always press `q` to quit before it takes any action.

## Project Structure Requirements

Rerunner will be made more configurable in future versions, but currently it expects your project to have this file structure:

```
your-electron-app/
├── package.json
├── build/
│   └── electron-builder.json    # App name in extraMetadata.name
└── dist/                        # Build output directory
    └── YourApp-x.x.x.dmg        # Generated installer
```

## Configuration

Rerunner reads configuration from your `build/electron-builder.json` file, specifically:
- `extraMetadata.name` - Used to determine app name and installer filename

The installer path is automatically determined from:
- App name from electron-builder config
- Version from package.json
- Current architecture (adds `-arm64` suffix on Apple Silicon)

## Example Workflow

1. Make changes to your Electron app
2. Run `yarn rr`
3. Choose build options in the interactive interface
4. Press Enter
5. Rerunner builds, installs, and launches your app
6. Test your changes in the production build

## License

MIT