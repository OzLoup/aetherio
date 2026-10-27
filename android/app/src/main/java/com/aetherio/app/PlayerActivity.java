package com.aetherio.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Native video player: ExoPlayer with the platform decoders first and ffmpeg
 * as fallback, so MKV, HEVC, AC3/E-AC3/DTS/TrueHD play on almost any box.
 * The built-in controls have audio and subtitle menus (tracks inside the
 * file + the subtitles the page found). Reports progress to the page.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {

    static final String EXTRA_REQUEST = "request";
    private static final long PROGRESS_EVERY_MS = 15_000;
    private static final long SKIP_MS = 10_000;

    private ExoPlayer player;
    private PlayerView view;
    private DefaultTrackSelector trackSelector;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean preferLatino;
    private boolean audioChecked = false;
    private boolean finishedSent = false;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            report("progress");
            handler.postDelayed(this, PROGRESS_EVERY_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_player);
        view = findViewById(R.id.player_view);
        TextView title = findViewById(R.id.title);
        View topBar = findViewById(R.id.top_bar);
        Button versions = findViewById(R.id.versions);
        hideSystemBars();

        JSONObject req;
        try {
            req = new JSONObject(getIntent().getStringExtra(EXTRA_REQUEST));
        } catch (Exception e) {
            fail("Solicitud inválida");
            return;
        }
        title.setText(req.optString("title"));
        // Other files of the same title (another language or quality): the
        // page shows the list and comes back here at the same minute.
        if (req.optBoolean("hasVersions")) {
            versions.setVisibility(View.VISIBLE);
            versions.setOnClickListener(v -> {
                if (player == null) return;
                finishedSent = true;
                long duration = player.getDuration();
                PlayerEvents.send("versions", player.getCurrentPosition(), duration == C.TIME_UNSET ? 0 : duration, null);
                finish();
            });
        }
        preferLatino = req.optBoolean("preferLatino");
        boolean subtitlesOn = req.optBoolean("subtitlesOn");

        // HTTP with the addon's headers (behaviorHints.proxyHeaders).
        Map<String, String> headers = new HashMap<>();
        JSONObject h = req.optJSONObject("headers");
        if (h != null) {
            for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                String k = it.next();
                headers.put(k, h.optString(k));
            }
        }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(20_000)
                .setReadTimeoutMs(30_000)
                .setUserAgent("AetherIO/" + BuildConfig.VERSION_NAME + " (Android)")
                .setDefaultRequestProperties(headers);
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(this, http);

        // Platform decoders first; ffmpeg where the box has none (AC3/DTS…).
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);

        List<String> languages = new ArrayList<>();
        JSONArray langs = req.optJSONArray("audioLanguages");
        if (langs != null) for (int i = 0; i < langs.length(); i++) languages.add(langs.optString(i));
        String[] langArray = languages.toArray(new String[0]);

        trackSelector = new DefaultTrackSelector(this);
        TrackSelectionParameters.Builder params = trackSelector.buildUponParameters()
                .setPreferredAudioLanguages(langArray);
        if (subtitlesOn) params.setPreferredTextLanguages(langArray);
        trackSelector.setParameters(params.build());

        // Subtitles found by the page (already WebVTT, saved by MainActivity).
        List<MediaItem.SubtitleConfiguration> subtitles = new ArrayList<>();
        JSONArray subs = req.optJSONArray("subtitleFiles");
        if (subs != null) {
            for (int i = 0; i < subs.length(); i++) {
                JSONObject s = subs.optJSONObject(i);
                if (s == null) continue;
                subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(new File(s.optString("path"))))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLanguage(s.optString("lang"))
                        .setLabel(s.optString("label"))
                        .setSelectionFlags(subtitlesOn && i == 0 ? C.SELECTION_FLAG_DEFAULT : 0)
                        .build());
            }
        }

        String url = req.optString("url");
        MediaItem.Builder item = new MediaItem.Builder().setUri(url).setSubtitleConfigurations(subtitles);
        if (url.toLowerCase(Locale.ROOT).contains(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);

        player = new ExoPlayer.Builder(this, renderers)
                .setTrackSelector(trackSelector)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSource))
                .setAudioAttributes(AudioAttributes.DEFAULT, true)
                .setHandleAudioBecomingNoisy(true)
                .setSeekBackIncrementMs(SKIP_MS)
                .setSeekForwardIncrementMs(SKIP_MS)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onTracksChanged(@NonNull Tracks tracks) {
                pickLatino(tracks);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (!isPlaying) report("progress");
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) finish();
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                fail(error.getErrorCodeName() + (error.getMessage() != null ? ": " + error.getMessage() : ""));
            }
        });

        view.setPlayer(player);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(4000);
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility ->
                topBar.setVisibility(visibility));

        player.setMediaItem(item.build(), Math.max(0, req.optLong("startMs")));
        player.prepare();
        player.setPlayWhenReady(true);
        handler.postDelayed(tick, PROGRESS_EVERY_MS);
    }

    /** Spanish files often carry Latino and Castilian tracks, both tagged "spa":
     * for a Latino profile pick the one whose name says so. Once per file. */
    private void pickLatino(Tracks tracks) {
        if (audioChecked || !preferLatino) return;
        boolean any = false;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
            any = true;
            for (int i = 0; i < group.length; i++) {
                Format f = group.getTrackFormat(i);
                String text = ((f.label == null ? "" : f.label) + " " + (f.language == null ? "" : f.language)).toLowerCase(Locale.ROOT);
                if (text.contains("latino") || text.contains("latam") || text.contains("419") || text.contains("es-mx") || text.matches(".*\\blat\\b.*")) {
                    audioChecked = true;
                    if (!group.isTrackSelected(i)) {
                        trackSelector.setParameters(trackSelector.buildUponParameters()
                                .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), i)));
                    }
                    return;
                }
            }
        }
        if (any) audioChecked = true;
    }

    /** D-pad: with the controls hidden, left/right skip 10 s and OK shows them. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (player != null && event.getAction() == KeyEvent.ACTION_DOWN && !view.isControllerFullyVisible()) {
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    player.seekBack();
                    view.showController();
                    return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    player.seekForward();
                    view.showController();
                    return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    view.showController();
                    return true;
                case KeyEvent.KEYCODE_MENU:
                    View menuTarget = findViewById(R.id.versions);
                    if (menuTarget.getVisibility() == View.VISIBLE) menuTarget.performClick();
                    return true;
                default:
                    break;
            }
        }
        View versions = findViewById(R.id.versions);
        boolean versionsShown = versions.getVisibility() == View.VISIBLE && view.isControllerFullyVisible();
        if (versionsShown && versions.hasFocus()) {
            // Keep the controls (and this bar) up while the user is on the button.
            view.showController();
            if (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_DOWN && event.getAction() == KeyEvent.ACTION_DOWN) {
                View playPause = view.findViewById(androidx.media3.ui.R.id.exo_play_pause);
                if (playPause != null && playPause.requestFocus()) return true;
            }
            return super.dispatchKeyEvent(event);
        }
        View before = getCurrentFocus();
        boolean handled = view.dispatchKeyEvent(event);
        // Up from the top row of the controls: on to "Idioma y calidad".
        if (versionsShown && event.getAction() == KeyEvent.ACTION_DOWN
                && event.getKeyCode() == KeyEvent.KEYCODE_DPAD_UP && getCurrentFocus() == before) {
            versions.requestFocus();
            return true;
        }
        return handled || super.dispatchKeyEvent(event);
    }

    private void report(String type) {
        if (player == null) return;
        long duration = player.getDuration();
        PlayerEvents.send(type, player.getCurrentPosition(), duration == C.TIME_UNSET ? 0 : duration, null);
    }

    private void fail(String message) {
        if (!finishedSent) {
            finishedSent = true;
            PlayerEvents.send("error", player == null ? 0 : player.getCurrentPosition(), 0, message);
        }
        finish();
    }

    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            player.pause();
            report("progress");
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(tick);
        if (player != null) {
            if (!finishedSent) {
                finishedSent = true;
                report("closed");
            }
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
