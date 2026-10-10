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

GitHub Actions workflow `.github/workflows/android.yml` builds that same debug APK. It does not use a release keystore.

## Release build

Create a release keystore outside the repository. Do not commit the keystore or its passwords. In Android Studio, use **Build > Generate Signed App Bundle / APK**, or configure Gradle signing with environment variables on a private build machine.

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
