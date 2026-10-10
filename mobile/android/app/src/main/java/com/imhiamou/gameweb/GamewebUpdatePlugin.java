package com.imhiamou.gameweb;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "GamewebUpdate")
public class GamewebUpdatePlugin extends Plugin {
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
            JSObject result = new JSObject();
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("versionCode", versionCodeOf(info));
            call.resolve(result);
        } catch (Exception err) {
            call.reject("The installed Gameweb version could not be read.");
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String version = call.getString("version", "");
        String sha256 = call.getString("sha256", "");
        if (!VERSION.matcher(version).matches() || versionCodeOfName(version) < 1) {
            call.reject("The update version is not a supported Gameweb release.");
            return;
        }
        if (!sha256.matches("^[a-f0-9]{64}$")) {
            call.reject("The update checksum is invalid.");
            return;
        }
        if (busy) {
            call.reject("An update download is already in progress.");
            return;
        }
        busy = true;
        executor.execute(() -> {
            File apk = null;
            try {
                apk = download(version, sha256, call);
                verifyPackage(apk, version);
                install(apk, call);
            } catch (UpdateException err) {
                deleteQuietly(apk);
                call.reject(err.getMessage());
            } catch (Exception err) {
                deleteQuietly(apk);
                call.reject("The update could not be downloaded.");
            } finally {
                busy = false;
            }
        });
    }

    private File download(String version, String expectedSha, PluginCall call) throws Exception {
        URL current = new URL(apkUrl(version));
        HttpURLConnection connection = null;
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
                    throw new UpdateException("GitHub rate limit. Try the update again later.");
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
                File apk = new File(dir, "Gameweb-" + version + ".apk");
                deleteQuietly(apk);
                try {
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    InputStream input = connection.getInputStream();
                    FileOutputStream output = new FileOutputStream(apk);
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
                    byte[] actual = digest.digest();
                    byte[] expected = hexToBytes(expectedSha);
                    if (!MessageDigest.isEqual(actual, expected)) {
                        throw new UpdateException("The downloaded update did not match the published checksum.");
                    }
                    return apk;
                } catch (Exception err) {
                    deleteQuietly(apk);
                    throw err;
                }
            }
            throw new UpdateException("The update package was not on the GitHub Release.");
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

    private void install(File apk, PluginCall call) {
        if (getActivity() == null) {
            call.reject("Android did not open the package installer.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + PACKAGE_NAME)
                    );
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(settings);
                    call.reject("Allow Gameweb to install updates, then start the update again. Android still asks you to confirm the installation.");
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
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (Exception err) {
                call.reject("Android did not open the package installer.");
            }
        });
    }

    private void notifyProgress(PluginCall call, long received, long total) {
        JSObject event = new JSObject();
        event.put("received", received);
        event.put("total", total);
        notifyListeners("progress", event);
    }

    private static String apkUrl(String version) {
        return "https://github.com/imhiamou/Card/releases/download/v" + version + "/Gameweb-" + version + ".apk";
    }

    private static boolean allowedHost(String host) {
        if (host == null) return false;
        String name = host.toLowerCase(Locale.US);
        return name.equals("github.com")
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

    private static final class UpdateException extends Exception {
        UpdateException(String message) {
            super(message);
        }
    }
}
