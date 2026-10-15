package com.imhiamou.gameweb;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "GamewebUpdate")
public class GamewebUpdatePlugin extends Plugin {
    private static final String TAG = "GamewebUpdate";
    private static final Pattern VERSION = Pattern.compile("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$");
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_BYTES = 180 * 1024 * 1024;
    private static final String PACKAGE_NAME = "com.imhiamou.gameweb";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    @PluginMethod
    public void getInstalled(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(PACKAGE_NAME, signingFlags());
            boolean canInstall = true;
            if (Build.VERSION.SDK_INT >= 26) {
                canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            }
            String versionName = info.versionName == null ? "" : info.versionName;
            try {
                cleanupDownloads(versionCodeOf(info));
            } catch (Exception ignored) {
                log("cleanup", "skipped");
            }
            JSObject result = new JSObject();
            result.put("versionName", versionName);
            result.put("versionCode", versionCodeOf(info));
            result.put("canRequestPackageInstalls", canInstall);
            log("installed", "version=" + versionName);
            call.resolve(result);
        } catch (Exception err) {
            log("installed", "unreadable");
            call.reject("The installed Gameweb version could not be read.");
        }
    }

    @PluginMethod
    public void fetchReleaseText(PluginCall call) {
        String kind = call.getString("kind", "");
        String version = call.getString("version", "");
        String prefix = call.getString("prefix", "v");
        final String url;
        final int maxBytes;
        final String subject;
        if ("releases".equals(kind)) {
            url = "https://api.github.com/repos/imhiamou/Card/releases?per_page=100";
            maxBytes = 2 * 1024 * 1024;
            subject = "update list";
        } else if ("manifest".equals(kind)) {
            if (!VERSION.matcher(version).matches() || versionCodeOfName(version) < 1) {
                call.reject("The update version is not a supported Gameweb release.");
                return;
            }
            if (!"v".equals(prefix) && !"V".equals(prefix)) {
                call.reject("The update version is not a supported Gameweb release.");
                return;
            }
            url = "https://github.com/imhiamou/Card/releases/download/" + prefix + version + "/android-latest.json";
            maxBytes = 64 * 1024;
            subject = "update metadata";
        } else {
            call.reject("The update request is not recognized.");
            return;
        }
        executor.execute(() -> {
            try {
                log(subject, "request");
                String body = readText(url, maxBytes, subject);
                JSObject result = new JSObject();
                result.put("body", body);
                log(subject, "received");
                call.resolve(result);
            } catch (UpdateException err) {
                log(subject, err.getMessage());
                call.reject(err.getMessage());
            } catch (Exception err) {
                log(subject, "unreachable");
                call.reject("GitHub could not be reached. Check the connection and try again.");
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String version = call.getString("version", "");
        String sha256 = call.getString("sha256", "");
        String prefix = call.getString("prefix", "v");
        if (!validRelease(version, prefix, sha256, call)) return;
        if (busy) {
            call.reject("An update download is already in progress.");
            return;
        }
        busy = true;
        executor.execute(() -> {
            File apk = null;
            try {
                log("download", "version=" + version);
                apk = download(version, prefix, sha256, call);
                log("verify", "version=" + version);
                verifyPackage(apk, version);
                handOff(apk, call);
            } catch (UpdateException err) {
                deleteQuietly(apk);
                busy = false;
                log("download", err.getMessage());
                call.reject(err.getMessage());
            } catch (Exception err) {
                deleteQuietly(apk);
                busy = false;
                log("download", "failed");
                call.reject("The update could not be downloaded.");
            }
        });
    }

    @PluginMethod
    public void resumeInstall(PluginCall call) {
        String version = call.getString("version", "");
        String sha256 = call.getString("sha256", "");
        String prefix = call.getString("prefix", "v");
        if (!validRelease(version, prefix, sha256, call)) return;
        if (busy) {
            call.reject("An update download is already in progress.");
            return;
        }
        busy = true;
        executor.execute(() -> {
            File apk = new File(new File(getContext().getCacheDir(), "updates"), "Gameweb-" + version + ".apk");
            try {
                if (!apk.isFile()) {
                    throw new UpdateException("The downloaded update is no longer on this device. Start the download again.");
                }
                log("resume", "version=" + version);
                byte[] actual = sha256Of(apk);
                if (!MessageDigest.isEqual(actual, hexToBytes(sha256))) {
                    deleteQuietly(apk);
                    throw new UpdateException("The downloaded update did not match the published checksum.");
                }
                verifyPackage(apk, version);
                handOff(apk, call);
            } catch (UpdateException err) {
                busy = false;
                log("resume", err.getMessage());
                call.reject(err.getMessage());
            } catch (Exception err) {
                busy = false;
                log("resume", "failed");
                call.reject("The update could not be opened.");
            }
        });
    }

    private boolean validRelease(String version, String prefix, String sha256, PluginCall call) {
        if (!VERSION.matcher(version).matches() || versionCodeOfName(version) < 1) {
            call.reject("The update version is not a supported Gameweb release.");
            return false;
        }
        if (!"v".equals(prefix) && !"V".equals(prefix)) {
            call.reject("The update version is not a supported Gameweb release.");
            return false;
        }
        if (!sha256.matches("^[a-f0-9]{64}$")) {
            call.reject("The update checksum is invalid.");
            return false;
        }
        return true;
    }

    private String readText(String url, int maxBytes, String subject) throws Exception {
        URL current = new URL(url);
        HttpURLConnection connection = null;
        try {
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
                if (!"https".equals(current.getProtocol()) || !allowedHost(current.getHost())) {
                    throw new UpdateException("The update download left GitHub. It was not saved.");
                }
                connection = (HttpURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("User-Agent", "Gameweb-Android");
                connection.setRequestProperty("Accept", "application/vnd.github+json, application/json");
                int status = connection.getResponseCode();
                if (status == 429 || status == 403) {
                    throw statusError(connection, status, subject);
                }
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (location == null || redirect == MAX_REDIRECTS) {
                        throw new UpdateException("The update download was redirected too many times.");
                    }
                    current = new URL(current, location);
                    continue;
                }
                if (status == 404) {
                    throw new UpdateException("The published release does not include Android update metadata.");
                }
                if (status != 200) {
                    throw new UpdateException("The update could not be read (" + status + ").");
                }
                InputStream input = connection.getInputStream();
                try {
                    byte[] buffer = new byte[4096];
                    int read;
                    int received = 0;
                    ByteArrayOutputStream collected = new ByteArrayOutputStream();
                    while ((read = input.read(buffer)) >= 0) {
                        received += read;
                        if (received > maxBytes) {
                            throw new UpdateException("The update metadata is too large.");
                        }
                        collected.write(buffer, 0, read);
                    }
                    if (received == 0) {
                        throw new UpdateException("The update metadata was empty.");
                    }
                    return new String(collected.toByteArray(), StandardCharsets.UTF_8);
                } finally {
                    try { input.close(); } catch (Exception ignored) { /* closed */ }
                }
            }
            throw new UpdateException("The update could not be read.");
        } catch (UpdateException err) {
            throw err;
        } catch (SocketTimeoutException err) {
            throw new UpdateException("The update timed out. Check the connection and try again.");
        } catch (IOException err) {
            throw new UpdateException("GitHub could not be reached. Check the connection and try again.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private File download(String version, String prefix, String expectedSha, PluginCall call) throws Exception {
        URL current = new URL(apkUrl(version, prefix));
        HttpURLConnection connection = null;
        File partial = null;
        try {
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
                if (!"https".equals(current.getProtocol()) || !allowedHost(current.getHost())) {
                    throw new UpdateException("The update download left GitHub. It was not saved.");
                }
                connection = (HttpURLConnection) current.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("User-Agent", "Gameweb-Android");
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
                int status = connection.getResponseCode();
                if (status == 429 || status == 403) {
                    throw statusError(connection, status, "update package");
                }
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (location == null || redirect == MAX_REDIRECTS) {
                        throw new UpdateException("The update download was redirected too many times.");
                    }
                    current = new URL(current, location);
                    continue;
                }
                if (status != 200) {
                    throw new UpdateException("The update package was not on the GitHub Release (" + status + ").");
                }
                long advertised = connection.getContentLengthLong();
                if (advertised > MAX_BYTES) {
                    throw new UpdateException("The update package is too large.");
                }
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.isDirectory() && !dir.mkdirs()) {
                    throw new UpdateException("The update could not be stored on this device.");
                }
                partial = new File(dir, "Gameweb-" + version + ".apk.partial");
                File apk = new File(dir, "Gameweb-" + version + ".apk");
                deleteQuietly(partial);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(partial);
                try {
                    byte[] buffer = new byte[8192];
                    long received = 0;
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        received += read;
                        if (received > MAX_BYTES) {
                            throw new UpdateException("The update package is too large.");
                        }
                        output.write(buffer, 0, read);
                        digest.update(buffer, 0, read);
                        if ((received & 0x3ffff) == 0) notifyProgress(call, received, advertised);
                    }
                    notifyProgress(call, received, advertised > 0 ? advertised : received);
                } finally {
                    try { output.close(); } catch (Exception ignored) { /* closed */ }
                    try { input.close(); } catch (Exception ignored) { /* closed */ }
                }
                if (!MessageDigest.isEqual(digest.digest(), hexToBytes(expectedSha))) {
                    throw new UpdateException("The downloaded update did not match the published checksum.");
                }
                if (apk.exists() && !apk.delete()) {
                    throw new UpdateException("The update could not be stored on this device.");
                }
                if (!partial.renameTo(apk)) {
                    throw new UpdateException("The update could not be stored on this device.");
                }
                partial = null;
                log("download", "complete version=" + version);
                return apk;
            }
            throw new UpdateException("The update package was not on the GitHub Release.");
        } catch (UpdateException err) {
            deleteQuietly(partial);
            throw err;
        } catch (SocketTimeoutException err) {
            deleteQuietly(partial);
            throw new UpdateException("The update timed out. Check the connection and try again.");
        } catch (IOException err) {
            deleteQuietly(partial);
            throw new UpdateException("GitHub could not be reached. Check the connection and try again.");
        } catch (Exception err) {
            deleteQuietly(partial);
            throw err;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void verifyPackage(File apk, String version) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        PackageInfo incoming = manager.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlags());
        if (incoming == null) {
            throw new UpdateException("The downloaded file is not an Android package.");
        }
        if (incoming.applicationInfo != null) {
            incoming.applicationInfo.sourceDir = apk.getAbsolutePath();
            incoming.applicationInfo.publicSourceDir = apk.getAbsolutePath();
        }
        if (!PACKAGE_NAME.equals(incoming.packageName)) {
            throw new UpdateException("The update is for a different application and was not installed.");
        }
        if (incoming.versionName == null || !incoming.versionName.equals(version)) {
            throw new UpdateException("The downloaded package version does not match the release.");
        }
        long incomingCode = versionCodeOf(incoming);
        PackageInfo installed = manager.getPackageInfo(PACKAGE_NAME, signingFlags());
        if (incomingCode <= versionCodeOf(installed)) {
            throw new UpdateException("The downloaded package is not a newer version of Gameweb.");
        }
        Signature[] installedSignatures = signaturesOf(installed);
        Signature[] incomingSignatures = signaturesOf(incoming);
        if (installedSignatures == null || incomingSignatures == null || installedSignatures.length == 0 || incomingSignatures.length == 0) {
            throw new UpdateException("The update signing certificate could not be read. It was not installed.");
        }
        if (!sameSigners(installedSignatures, incomingSignatures)) {
            throw new UpdateException("The update is signed with a different certificate than this installation. Android will not replace Gameweb with it, and this updater will not uninstall the app.");
        }
    }

    private void handOff(File apk, PluginCall call) {
        if (getActivity() == null) {
            busy = false;
            log("install", "no activity");
            call.reject("Android did not open the package installer.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                presentInstaller(apk, call);
            } catch (Exception err) {
                log("install", "failed");
                call.reject("Android did not open the package installer.");
            } finally {
                busy = false;
            }
        });
    }

    private void presentInstaller(File apk, PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + PACKAGE_NAME)
            );
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(settings);
            log("permission", "settings");
            JSObject result = new JSObject();
            result.put("installerOpened", false);
            result.put("permissionRequired", true);
            result.put("installed", false);
            result.put("result", "permission");
            call.resolve(result);
            return;
        }
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            PACKAGE_NAME + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setClipData(ClipData.newRawUri("", uri));
        getActivity().startActivity(intent);
        log("install", "installer opened");
        JSObject result = new JSObject();
        result.put("installerOpened", true);
        result.put("permissionRequired", false);
        result.put("installed", false);
        result.put("result", "unknown");
        call.resolve(result);
    }

    private void cleanupDownloads(long installedCode) {
        if (busy) return;
        File dir = new File(getContext().getCacheDir(), "updates");
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            String name = file.getName();
            if (name.endsWith(".partial")) {
                deleteQuietly(file);
                log("cleanup", "partial");
                continue;
            }
            if (name.startsWith("Gameweb-") && name.endsWith(".apk")) {
                String version = name.substring("Gameweb-".length(), name.length() - ".apk".length());
                int code = versionCodeOfName(version);
                if (code >= 1 && code <= installedCode) {
                    deleteQuietly(file);
                    log("cleanup", "old version=" + version);
                }
            }
        }
    }

    private static UpdateException statusError(HttpURLConnection connection, int status, String subject) {
        if (status == 429 || rateLimited(connection)) {
            return new UpdateException("GitHub rate limit. Try the update again later.");
        }
        return new UpdateException("GitHub refused the " + subject + " (403).");
    }

    private static boolean rateLimited(HttpURLConnection connection) {
        String remaining = connection.getHeaderField("X-RateLimit-Remaining");
        if (remaining != null && remaining.trim().equals("0")) return true;
        return errorSnippet(connection).toLowerCase(Locale.US).contains("rate limit");
    }

    private static String errorSnippet(HttpURLConnection connection) {
        InputStream error = connection.getErrorStream();
        if (error == null) return "";
        try {
            byte[] buffer = new byte[512];
            int read = error.read(buffer);
            if (read <= 0) return "";
            return new String(buffer, 0, read, StandardCharsets.UTF_8);
        } catch (Exception err) {
            return "";
        } finally {
            try { error.close(); } catch (Exception ignored) { /* closed */ }
        }
    }

    private void notifyProgress(PluginCall call, long received, long total) {
        JSObject event = new JSObject();
        event.put("received", received);
        event.put("total", total);
        notifyListeners("progress", event);
    }

    private static String apkUrl(String version, String prefix) {
        String lead = "V".equals(prefix) ? "V" : "v";
        return "https://github.com/imhiamou/Card/releases/download/" + lead + version + "/Gameweb-" + version + ".apk";
    }

    private static boolean allowedHost(String host) {
        if (host == null) return false;
        String name = host.toLowerCase(Locale.US);
        return name.equals("github.com")
            || name.equals("api.github.com")
            || name.equals("objects.githubusercontent.com")
            || name.equals("release-assets.githubusercontent.com")
            || name.equals("github-releases.githubusercontent.com");
    }

    private static int versionCodeOfName(String version) {
        String[] parts = version.split("\\.");
        if (parts.length != 3) return 0;
        try {
            int major = Integer.parseInt(parts[0]);
            int minor = Integer.parseInt(parts[1]);
            int patch = Integer.parseInt(parts[2]);
            if (major >= 1000 || minor >= 1000 || patch >= 1000) return 0;
            int code = major * 1000000 + minor * 1000 + patch;
            return code >= 1 ? code : 0;
        } catch (NumberFormatException err) {
            return 0;
        }
    }

    private static long versionCodeOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28) return info.getLongVersionCode();
        return info.versionCode;
    }

    private static int signingFlags() {
        if (Build.VERSION.SDK_INT >= 28) return PackageManager.GET_SIGNING_CERTIFICATES;
        return PackageManager.GET_SIGNATURES;
    }

    private static Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            return info.signingInfo.getApkContentsSigners();
        }
        return info.signatures;
    }

    private static boolean sameSigners(Signature[] left, Signature[] right) {
        if (left == null || right == null || left.length == 0 || left.length != right.length) return false;
        boolean[] used = new boolean[right.length];
        for (Signature signature : left) {
            boolean found = false;
            for (int i = 0; i < right.length; i++) {
                if (used[i]) continue;
                if (signature.equals(right[i])) {
                    used[i] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    private static byte[] sha256Of(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = new FileInputStream(file);
        try {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        } finally {
            try { input.close(); } catch (Exception ignored) { /* closed */ }
        }
        return digest.digest();
    }

    private static byte[] hexToBytes(String hex) {
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < hex.length(); i += 2) {
            out[i / 2] = (byte) Integer.parseInt(hex.substring(i, i + 2), 16);
        }
        return out;
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) {
            file.deleteOnExit();
        }
    }

    private static void log(String stage, String detail) {
        if (detail == null || detail.isEmpty()) Log.i(TAG, "stage=" + stage);
        else Log.i(TAG, "stage=" + stage + " " + detail);
    }

    private static final class UpdateException extends Exception {
        UpdateException(String message) {
            super(message);
        }
    }
}
