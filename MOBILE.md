# Gameweb mobile app

The Android app is the existing website inside a Capacitor shell. It does not ship the Node server. Multiplayer and map saves use `https://cardb-2uys.onrender.com`.

Application id: `com.imhiamou.gameweb`. Keep this value stable.

The repository has no separate logo file. The Android project uses Capacitor's launcher icon and a dark startup background that matches the site (`#181c24`).

## Tools

- Node.js 22
- Java 21
- Android SDK with the compile SDK version required by the generated Gradle project
- Android Studio, if you want to open the project or run an emulator

Compiling the iOS app needs macOS with Xcode. This repository can generate the iOS project, but it cannot sign or compile it on Linux.

## Install and sync

From the repository root:

```bash
npm ci --prefix mobile
npm run mobile:sync
```

`mobile:sync` copies the current frontend into `mobile/www`, then runs `cap sync`. `mobile/www` is generated. Do not commit it.

The copy includes the same pages and `assets/` tree the website uses. It does not include `server/`, `desktop/`, Git metadata, or credentials.

## Run on a device or emulator

```bash
npm --prefix mobile run android
```

That syncs assets and opens the Android project. In Android Studio, choose a device and run the `app` configuration.

## Debug APK

```bash
cd mobile/android
./gradlew assembleDebug
```

The APK is written to:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions workflow `.github/workflows/android.yml` builds that same debug APK on pull requests and manual runs. It installs Android platform 36, build-tools 35.0.0, and platform-tools, then accepts the SDK licenses.

## Release from a version tag

Push a tag named `vMAJOR.MINOR.PATCH`, for example `v1.0.5`. Each number is an integer without leading zeros and must be below 1000. `v0.0.0` is rejected. The tag is the app version. Do not commit a version bump.

The Android workflow then:

1. Fails before any release is created if the tag is invalid.
2. Fails before building if the signing secrets below are missing.
3. Sets Android `versionName` to `1.0.5` and `versionCode` to `1000005` (`major * 1000000 + minor * 1000 + patch`).
4. Builds a release APK signed with the saved keystore.
5. Uploads these assets to the GitHub Release for that tag, replacing those three names if the job is run again:
   - `Gameweb-1.0.5.apk`
   - `Gameweb-1.0.5.apk.sha256`
   - `android-latest.json`

`android-latest.json` contains `version`, `versionCode`, `apk`, and `sha256`. It does not contain a download URL. The installed app builds `https://github.com/imhiamou/Card/releases/download/v1.0.5/Gameweb-1.0.5.apk` itself.

Creating that release also starts the existing Windows workflow, which attaches the Electron installer to the same release. Drafts and pre-releases are ignored.

### Signing secrets

Create one release keystore and reuse it for every version. Do not commit it.

```bash
keytool -genkeypair -v -keystore gameweb-release.keystore -alias gameweb -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 gameweb-release.keystore
```

In the GitHub repository settings, add Actions secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The base64 text of `gameweb-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | The key alias, for example `gameweb` |
| `ANDROID_KEY_PASSWORD` | The key password |

If a release keystore already exists, put that same keystore in `ANDROID_KEYSTORE_BASE64`. A new key makes Android install a second app instead of updating the installed one. The workflow never generates a keystore and does not upload the keystore or the passwords.

Until those secrets exist, a tag run fails with the missing secret names and does not publish a signed APK.

## Updates on an installed phone

On launch, the Android app reads `android-latest.json` from the latest published GitHub Release. If `versionCode` is newer than the installed app, it asks once whether to download that version. Cancel remembers that version and does not ask again. A later version asks again. A failed check leaves the app usable.

Download uses the fixed GitHub Release URL over HTTPS. The app hashes the file with SHA-256 and compares it to the published checksum. It refuses a package whose id is not `com.imhiamou.gameweb`, whose version does not match, or whose signing certificate differs from the installed app. It then opens Android's package installer. Android may ask for permission to install from Gameweb and always asks the user to confirm. The update replaces this application id and keeps app data. It does not install silently.

This repository has not installed an update on a physical device. A debug APK and a release APK are different signatures, so a debug install cannot take the release update in place.

A release build still loads the local frontend and talks to the same Render backend.

## Backend

Socket.IO is created in `index.js` with `io("https://cardb-2uys.onrender.com")`. Carts map requests use that same host. The server already allows cross-origin API and Socket.IO calls. The phone does not open a database connection.

While Render is waking up, the lobby shows `Connecting...` and then `Reconnecting...` if the socket drops. A lobby is created only after the server sends `lobbyCreated`.

## iOS later

On a Mac:

```bash
npm ci --prefix mobile
cd mobile
npx cap add ios
npm run ios
```

`cap add ios` is only needed the first time. `npm run ios` syncs the frontend and opens the Xcode project. Select a signing team and build. The Linux Android workflow does not produce an iOS binary.
