package com.slavedrop.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.OutputStream;

public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 100;
    private static final int SAVE_DOC_REQUEST = 101;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    // pending save — set from the JS-bridge call, consumed in onActivityResult
    private String pendingSeq;
    private String pendingName;
    private byte[] pendingBytes;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setLoadsImagesAutomatically(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // safety net for raw anchors: never load http(s) inside the app —
                // hand it to the system browser chooser instead
                return openChooser(req.getUrl().toString());
            }
        });

        // File chooser: without this, <input type="file"> (icon picker, custom
        // background, restore-from-file) silently does nothing in a plain WebView.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Save-as bridge: JS asks, user picks a location with ACTION_CREATE_DOCUMENT
        // (Storage Access Framework — no storage permission required), bytes are
        // written to the chosen Uri, result is reported back to JS.
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.loadUrl("file:///android_asset/www/index.html");
        setContentView(webView);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            Uri[] result = (resultCode == RESULT_OK && data != null && data.getData() != null)
                    ? new Uri[]{data.getData()} : null;
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        } else if (requestCode == SAVE_DOC_REQUEST) {
            final String seq = pendingSeq;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                final Uri uri = data.getData();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        boolean ok = false;
                        try {
                            OutputStream os = getContentResolver().openOutputStream(uri);
                            if (os != null) {
                                os.write(pendingBytes);
                                os.close();
                                ok = true;
                            }
                        } catch (Exception ignored) {
                        }
                        final boolean success = ok;
                        final String name = uri.getLastPathSegment() != null
                                ? uri.getLastPathSegment() : pendingName;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                notifySave(seq, success, name);
                            }
                        });
                    }
                }).start();
                return;
            }
            // user cancelled the location picker (or the intent failed)
            notifySave(seq, false, pendingName);
        }
    }

    private void notifySave(String seq, boolean ok, String name) {
        if (seq == null || webView == null) return;
        String js = "window.__slavedropSaveResult && window.__slavedropSaveResult('" + seq + "', "
                + ok + ", " + JSONObject.quote(name == null ? "" : name) + ")";
        webView.evaluateJavascript(js, null);
    }

    /** Opens a URL via ACTION_VIEW wrapped in createChooser, so Android shows
     *  the "open with" browser picker every time (no silent default). Only
     *  http/https are allowed. Returns true if a chooser was launched. */
    private boolean openChooser(final String url) {
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (scheme == null
                    || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                return false;
            }
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(Intent.createChooser(view, "Open with"));
            return true;
        } catch (Exception e) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, "Cannot open link", Toast.LENGTH_SHORT).show();
                }
            });
            return false;
        }
    }

    public class AndroidBridge {
        /** Called by the web app when the user taps a link / X account / task URL. */
        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    openChooser(url);
                }
            });
        }

        @JavascriptInterface
        public void saveDocument(final String seq, final String name, final String mime, final String b64) {
            // JavascriptInterface methods arrive on a non-UI thread
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        pendingSeq = seq;
                        pendingName = name;
                        pendingBytes = Base64.decode(b64, Base64.DEFAULT);
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(mime != null && !mime.isEmpty() ? mime : "application/octet-stream");
                        intent.putExtra(Intent.EXTRA_TITLE,
                                name != null && !name.isEmpty() ? name : "backup.json");
                        startActivityForResult(intent, SAVE_DOC_REQUEST);
                    } catch (Exception e) {
                        pendingSeq = null;
                        notifySave(seq, false, name);
                    }
                }
            });
        }
    }
}
