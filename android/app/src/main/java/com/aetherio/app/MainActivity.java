package com.aetherio.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The AetherIO web UI in a WebView (loaded from the published site, so web
 * updates reach the app without a new APK) plus a small bridge,
 * window.AetherAndroid: open links in the system browser, play videos in
 * PlayerActivity, and events back to the page (login result, progress).
 */
public class MainActivity extends Activity {

    private WebView web;
    private final List<String> pendingScripts = new ArrayList<>();
    private boolean pageReady = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        web.requestFocus();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setUserAgentString(s.getUserAgentString() + " AetherIOAndroid/" + BuildConfig.VERSION_NAME);

        web.addJavascriptInterface(new Bridge(), "AetherAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isOwnPage(uri)) return false;
                openExternal(uri.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                for (String js : pendingScripts) web.evaluateJavascript(js, null);
                pendingScripts.clear();
            }
        });
        // target="_blank" / window.open (addon configuration pages, etc.) → system browser.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView catcher = new WebView(MainActivity.this);
                catcher.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        openExternal(request.getUrl().toString());
                        v.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(catcher);
                resultMsg.sendToTarget();
                return true;
            }
        });

        PlayerEvents.listener = json -> dispatch("aether:player", json);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BuildConfig.WEB_URL);
        handleDeepLink(getIntent());
    }

    private boolean isOwnPage(Uri uri) {
        Uri base = Uri.parse(BuildConfig.WEB_URL);
        return base.getHost() != null && base.getHost().equals(uri.getHost());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleDeepLink(intent);
    }

    /** aetherio://auth/callback#token=… or #error=… (Google login from the browser). */
    private void handleDeepLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"aetherio".equals(data.getScheme())) return;
        Uri fragment = Uri.parse("x://x?" + (data.getFragment() == null ? "" : data.getFragment()));
        try {
            JSONObject payload = new JSONObject();
            payload.put("token", fragment.getQueryParameter("token") == null ? JSONObject.NULL : fragment.getQueryParameter("token"));
            payload.put("error", fragment.getQueryParameter("error") == null ? JSONObject.NULL : fragment.getQueryParameter("error"));
            dispatch("aether:auth", payload.toString());
        } catch (Exception ignored) {
        }
        intent.setData(null);
    }

    /** window.dispatchEvent(new CustomEvent(name, {detail})) in the page. */
    private void dispatch(String name, String detailJson) {
        String js = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(name) + ",{detail:" + detailJson + "}))";
        runOnUiThread(() -> {
            if (pageReady) web.evaluateJavascript(js, null);
            else pendingScripts.add(js);
        });
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay un navegador instalado para abrir el enlace", Toast.LENGTH_LONG).show();
        }
    }

    private boolean isTv() {
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
                || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }

    /** Remote's Back: the page closes an open menu/dialog first (lib/spatialNav.ts),
     * then the previous page, then leave the app. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__aetherBack ? window.__aetherBack() : false)", handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.resumeTimers();
    }

    @Override
    protected void onDestroy() {
        PlayerEvents.listener = null;
        web.destroy();
        super.onDestroy();
    }

    /** Exposed to the page as window.AetherAndroid (see frontend/src/lib/android.ts). */
    private class Bridge {
        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public boolean isTv() {
            return MainActivity.this.isTv();
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Subtitles come as WebVTT text; they go to files so the Intent stays small. */
        @JavascriptInterface
        public void play(String requestJson) {
            try {
                JSONObject req = new JSONObject(requestJson);
                JSONArray subs = req.optJSONArray("subtitles");
                JSONArray files = new JSONArray();
                File dir = new File(getCacheDir(), "subtitles");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                if (subs != null) {
                    for (int i = 0; i < subs.length(); i++) {
                        JSONObject sub = subs.getJSONObject(i);
                        File f = new File(dir, "sub" + i + ".vtt");
                        try (FileOutputStream out = new FileOutputStream(f)) {
                            out.write(sub.optString("vtt").getBytes(StandardCharsets.UTF_8));
                        }
                        JSONObject entry = new JSONObject();
                        entry.put("path", f.getAbsolutePath());
                        entry.put("label", sub.optString("label"));
                        entry.put("lang", sub.optString("lang"));
                        files.put(entry);
                    }
                }
                req.remove("subtitles");
                req.put("subtitleFiles", files);
                Intent intent = new Intent(MainActivity.this, PlayerActivity.class);
                intent.putExtra(PlayerActivity.EXTRA_REQUEST, req.toString());
                runOnUiThread(() -> startActivity(intent));
            } catch (Exception e) {
                PlayerEvents.send("error", 0, 0, String.valueOf(e.getMessage()));
            }
        }
    }
}
