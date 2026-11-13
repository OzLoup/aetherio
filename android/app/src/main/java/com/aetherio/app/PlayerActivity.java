package com.aetherio.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.FrameLayout;
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
import androidx.media3.common.util.Util;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;
import androidx.media3.ui.TimeBar;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.Collections;
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
    /** "Siguiente episodio" pops up this long before the end (credits). */
    private static final long NEXT_BEFORE_END_MS = 60_000;

    private ExoPlayer player;
    private PlayerView view;
    private DefaultTrackSelector trackSelector;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean preferLatino;
    private boolean audioChecked = false;
    private boolean finishedSent = false;
    private boolean hasNext = false;
    private boolean backHidesControls = false;
    private Button nextOverlay;

    // --- Subtitles the page downloaded, drawn here with a timing fix -------
    /** One downloaded subtitle file (also listed in ExoPlayer's menu). */
    private static final class ExternalTrack {
        final String id;
        final String label;
        final File file;
        volatile List<ExternalSubtitles.Cue> cues; // null until read

        ExternalTrack(String id, String label, File file) {
            this.id = id;
            this.label = label;
            this.file = file;
        }
    }

    private static final String EXTERNAL_ID = "aether-ext-";
    private static final long SUBS_EVERY_MS = 100;
    private static final long SYNC_STEP_MS = 250;
    private static final long SYNC_FAST_STEP_MS = 1000;
    /** 25 fps (PAL) vs 23.976 fps (film), as in the web player. */
    private static final double[] SYNC_SCALES = {1, 25 / 23.976, 23.976 / 25};
    private final List<ExternalTrack> external = new ArrayList<>();
    private int externalActive = -1;
    private long subOffsetMs = 0;
    private double subScale = 1;
    private long lastNudge = 0;
    private boolean syncPending = false;
    private SubtitleView ownSubtitles;
    private List<ExternalSubtitles.Cue> shownCues;
    private View syncPanel;

    private final Runnable drawSubs = new Runnable() {
        @Override
        public void run() {
            drawSubtitles();
            handler.postDelayed(this, SUBS_EVERY_MS);
        }
    };

    /** The page saves the timing per video (like the web player). */
    private final Runnable sendSync = () -> {
        syncPending = false;
        if (player == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("offset", subOffsetMs / 1000.0);
            o.put("scale", subScale);
            long duration = player.getDuration();
            PlayerEvents.send("subsync", player.getCurrentPosition(), duration == C.TIME_UNSET ? 0 : duration, o.toString());
        } catch (Exception ignored) {
        }
    };

    /** Shows the big "Siguiente episodio" during the last minute. */
    private final Runnable endWatch = new Runnable() {
        @Override
        public void run() {
            if (player != null) {
                long duration = player.getDuration();
                boolean near = duration != C.TIME_UNSET && duration > NEXT_BEFORE_END_MS
                        && duration - player.getCurrentPosition() <= NEXT_BEFORE_END_MS;
                setOverlay(near || player.getPlaybackState() == Player.STATE_ENDED);
            }
            handler.postDelayed(this, 1000);
        }
    };

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
        // Series: the page picks the best source of the next episode.
        String next = req.optString("nextEpisode", "");
        hasNext = !next.isEmpty();
        nextOverlay = findViewById(R.id.next_overlay);
        if (hasNext) {
            String label = getString(R.string.next_episode, next);
            Button nextButton = findViewById(R.id.next_episode);
            nextButton.setText(label);
            nextButton.setVisibility(View.VISIBLE);
            nextButton.setOnClickListener(v -> goNext());
            nextOverlay.setText(label);
            nextOverlay.setOnClickListener(v -> goNext());
        }
        applyAccent(req.optString("accentColor", ""));
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
        // ExoPlayer lists them in its menu; when one is chosen, this activity
        // draws it (so its timing can be fixed on the fly).
        List<MediaItem.SubtitleConfiguration> subtitles = new ArrayList<>();
        JSONArray subs = req.optJSONArray("subtitleFiles");
        if (subs != null) {
            for (int i = 0; i < subs.length(); i++) {
                JSONObject s = subs.optJSONObject(i);
                if (s == null) continue;
                File file = new File(s.optString("path"));
                String id = EXTERNAL_ID + external.size();
                external.add(new ExternalTrack(id, s.optString("label"), file));
                subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(file))
                        .setId(id)
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLanguage(s.optString("lang"))
                        .setLabel(s.optString("label"))
                        .setSelectionFlags(subtitlesOn && i == 0 ? C.SELECTION_FLAG_DEFAULT : 0)
                        .build());
            }
        }
        // Timing saved for this video (web, Mac or here): seconds, + = later.
        JSONObject sync = req.optJSONObject("subtitleSync");
        if (sync != null) {
            subOffsetMs = Math.round(sync.optDouble("offset", 0) * 1000);
            double scale = sync.optDouble("scale", 1);
            subScale = scale > 0.5 && scale < 2 ? scale : 1;
        }
        setUpExternalSubtitles();

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
                updateActiveSubtitle(tracks);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (!isPlaying) report("progress");
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state != Player.STATE_ENDED) return;
                // Series: stay on the last frame with "Siguiente episodio" up.
                if (hasNext) setOverlay(true);
                else finish();
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                if (skipBadData(error)) return;
                fail(error.getErrorCodeName() + (error.getMessage() != null ? ": " + error.getMessage() : ""));
            }
        });

        view.setPlayer(player);
        showScrubTime();
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(4000);
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility ->
                topBar.setVisibility(visibility));

        player.setMediaItem(item.build(), Math.max(0, req.optLong("startMs")));
        player.prepare();
        player.setPlayWhenReady(true);
        handler.postDelayed(tick, PROGRESS_EVERY_MS);
        if (hasNext) handler.postDelayed(endWatch, 1000);
    }

    /** A damaged audio/video packet (common in old XviD/AC3 rips) makes the
     * decoder fail and, left alone, ends the playback: the spinner or the
     * error screen, and every seek works for a few seconds until the next bad
     * packet. Carry on a moment further instead, giving up only when it
     * keeps failing. */
    private static final int MAX_DECODE_SKIPS = 40;
    private static final long SKIP_PAST_BAD_DATA_MS = 1500;
    private int decodeSkips;
    private long lastDecodeSkipAt = -1;

    private boolean skipBadData(PlaybackException error) {
        if (player == null || error.errorCode != PlaybackException.ERROR_CODE_DECODING_FAILED) return false;
        long at = player.getCurrentPosition();
        // Well after the last one: it was a one-off, start counting again.
        if (lastDecodeSkipAt >= 0 && at - lastDecodeSkipAt > 60_000) decodeSkips = 0;
        if (decodeSkips >= MAX_DECODE_SKIPS) return false;
        decodeSkips++;
        lastDecodeSkipAt = at;
        player.seekTo(at + SKIP_PAST_BAD_DATA_MS);
        player.prepare();
        player.setPlayWhenReady(true);
        return true;
    }

    // --- Downloaded subtitles: drawing and timing ---------------------------

    /** Our subtitle layer (over the video, under the controls), the panel's
     * buttons, and the files read in the background. */
    private void setUpExternalSubtitles() {
        syncPanel = findViewById(R.id.sync_panel);
        if (external.isEmpty()) return;
        ownSubtitles = new SubtitleView(this);
        ownSubtitles.setUserDefaultStyle();
        ownSubtitles.setUserDefaultTextSize();
        ownSubtitles.setVisibility(View.GONE);
        FrameLayout overlay = view.getOverlayFrameLayout();
        if (overlay != null) {
            overlay.addView(ownSubtitles, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        Button open = findViewById(R.id.sync_subs);
        open.setVisibility(View.VISIBLE);
        open.setOnClickListener(v -> openSyncPanel());
        View.OnKeyListener hold = (v, keyCode, event) -> {
            // OK held on - / +: keeps moving, faster after a second.
            if (keyCode != KeyEvent.KEYCODE_DPAD_CENTER && keyCode != KeyEvent.KEYCODE_ENTER
                    && keyCode != KeyEvent.KEYCODE_NUMPAD_ENTER) return false;
            if (event.getAction() == KeyEvent.ACTION_DOWN) nudge(v.getId() == R.id.sync_later ? 1 : -1, event.getRepeatCount());
            return true;
        };
        for (int id : new int[] {R.id.sync_earlier, R.id.sync_later}) {
            View b = findViewById(id);
            b.setOnClickListener(v -> nudge(v.getId() == R.id.sync_later ? 1 : -1, 0));
            b.setOnKeyListener(hold);
        }
        findViewById(R.id.sync_track).setOnClickListener(v -> nextExternalTrack());
        findViewById(R.id.sync_speed).setOnClickListener(v -> {
            int i = 0;
            for (int k = 0; k < SYNC_SCALES.length; k++) if (Math.abs(SYNC_SCALES[k] - subScale) < 0.001) i = k;
            subScale = SYNC_SCALES[(i + 1) % SYNC_SCALES.length];
            onSyncChanged();
        });
        findViewById(R.id.sync_reset).setOnClickListener(v -> {
            subOffsetMs = 0;
            subScale = 1;
            onSyncChanged();
        });
        findViewById(R.id.sync_done).setOnClickListener(v -> closeSyncPanel());

        List<ExternalTrack> tracks = new ArrayList<>(external);
        new Thread(() -> {
            for (ExternalTrack t : tracks) {
                try {
                    t.cues = ExternalSubtitles.read(t.file);
                } catch (Exception e) {
                    t.cues = Collections.emptyList();
                }
            }
            handler.post(() -> {
                shownCues = null;
                drawSubtitles();
            });
        }, "subtitles").start();
    }

    /** Which downloaded subtitle a track is (-1 = inside the file, or none). */
    private int externalIndexOf(Format f) {
        for (int i = 0; i < external.size(); i++) {
            if (f.id != null && f.id.endsWith(external.get(i).id)) return i;
        }
        // Fallback: the labels the page gives are unique ("Español 1"...).
        for (int i = 0; i < external.size(); i++) {
            if (f.label != null && f.label.equals(external.get(i).label)) return i;
        }
        return -1;
    }

    /** Chosen in the subtitle menu: one of ours, we draw it; else ExoPlayer does. */
    private void updateActiveSubtitle(Tracks tracks) {
        if (external.isEmpty()) return;
        int found = -1;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                if (group.isTrackSelected(i)) found = externalIndexOf(group.getTrackFormat(i));
            }
        }
        if (found == externalActive) return;
        externalActive = found;
        boolean ours = found >= 0;
        SubtitleView playerSubs = view.getSubtitleView();
        if (playerSubs != null) playerSubs.setVisibility(ours ? View.GONE : View.VISIBLE);
        ownSubtitles.setVisibility(ours ? View.VISIBLE : View.GONE);
        shownCues = null;
        ownSubtitles.setCues(Collections.emptyList());
        handler.removeCallbacks(drawSubs);
        if (ours) handler.post(drawSubs);
        updateSyncPanel();
    }

    private void drawSubtitles() {
        if (player == null || externalActive < 0 || ownSubtitles == null) return;
        List<ExternalSubtitles.Cue> cues = external.get(externalActive).cues;
        if (cues == null) return; // still reading the file
        List<ExternalSubtitles.Cue> active = ExternalSubtitles.activeAt(cues, player.getCurrentPosition(), subOffsetMs, subScale);
        if (active.equals(shownCues)) return;
        shownCues = active;
        ownSubtitles.setCues(active.isEmpty()
                ? Collections.emptyList()
                : Collections.singletonList(new androidx.media3.common.text.Cue.Builder().setText(ExternalSubtitles.join(active)).build()));
    }

    private void openSyncPanel() {
        if (syncPanel == null || external.isEmpty()) return;
        view.hideController();
        view.setUseController(false);
        syncPanel.setVisibility(View.VISIBLE);
        updateSyncPanel();
        findViewById(externalActive >= 0 ? R.id.sync_later : R.id.sync_track).requestFocus();
    }

    private void closeSyncPanel() {
        syncPanel.setVisibility(View.GONE);
        view.setUseController(true);
        if (syncPending) {
            handler.removeCallbacks(sendSync);
            sendSync.run();
        }
    }

    private boolean syncPanelOpen() {
        return syncPanel != null && syncPanel.getVisibility() == View.VISIBLE;
    }

    /** - / + on the panel: 0.25 s a press; held, faster after a second. */
    private void nudge(int sign, int repeatCount) {
        if (externalActive < 0) return;
        long now = SystemClock.uptimeMillis();
        if (repeatCount > 0 && now - lastNudge < 150) return;
        lastNudge = now;
        subOffsetMs += sign * (repeatCount > 12 ? SYNC_FAST_STEP_MS : SYNC_STEP_MS);
        onSyncChanged();
    }

    private void onSyncChanged() {
        updateSyncPanel();
        shownCues = null;
        drawSubtitles();
        syncPending = true;
        handler.removeCallbacks(sendSync);
        handler.postDelayed(sendSync, 1000);
    }

    /** Next downloaded subtitle (another file often fits this video better). */
    private void nextExternalTrack() {
        if (player == null || external.isEmpty()) return;
        int want = (externalActive + 1) % external.size();
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                if (externalIndexOf(group.getTrackFormat(i)) != want) continue;
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                        .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), i))
                        .build());
                return;
            }
        }
    }

    private void updateSyncPanel() {
        if (syncPanel == null || external.isEmpty()) return;
        boolean ours = externalActive >= 0;
        TextView value = findViewById(R.id.sync_value);
        String seconds = new DecimalFormat("0.##").format(Math.abs(subOffsetMs) / 1000.0);
        value.setText(subOffsetMs == 0 ? getString(R.string.sync_none)
                : getString(subOffsetMs > 0 ? R.string.sync_later : R.string.sync_earlier, seconds));
        ((TextView) findViewById(R.id.sync_hint)).setText(ours ? R.string.sync_hint : R.string.sync_external_only);
        findViewById(R.id.sync_earlier).setEnabled(ours);
        findViewById(R.id.sync_later).setEnabled(ours);
        ((Button) findViewById(R.id.sync_track)).setText(ours
                ? getString(R.string.sync_track, external.get(externalActive).label)
                : getString(R.string.sync_track_off));
        int speed = R.string.sync_speed_normal;
        if (Math.abs(subScale - SYNC_SCALES[1]) < 0.001) speed = R.string.sync_speed_slower;
        else if (Math.abs(subScale - SYNC_SCALES[2]) < 0.001) speed = R.string.sync_speed_faster;
        ((Button) findViewById(R.id.sync_speed)).setText(speed);
    }

    private void goNext() {
        if (player == null || finishedSent) return;
        finishedSent = true;
        long duration = player.getDuration();
        PlayerEvents.send("next", player.getCurrentPosition(), duration == C.TIME_UNSET ? 0 : duration, null);
        finish();
    }

    private void setOverlay(boolean show) {
        if (!hasNext) return;
        int visibility = show ? View.VISIBLE : View.GONE;
        if (nextOverlay.getVisibility() == visibility) return;
        nextOverlay.setVisibility(visibility);
        if (show && !view.isControllerFullyVisible()) nextOverlay.requestFocus();
    }

    /** The profile's color (from the page) on the buttons, the time label
     * and the progress bar; the XML drawables keep the brand blue. */
    private void applyAccent(String hex) {
        int accent;
        try {
            accent = Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return;
        }
        float density = getResources().getDisplayMetrics().density;
        for (int id : new int[] {R.id.versions, R.id.sync_subs, R.id.next_episode, R.id.scrub_time,
                R.id.sync_earlier, R.id.sync_later, R.id.sync_track, R.id.sync_speed, R.id.sync_reset, R.id.sync_done}) {
            findViewById(id).setBackground(topButton(accent, density));
        }
        StateListDrawable overlay = new StateListDrawable();
        overlay.addState(new int[] {android.R.attr.state_focused}, rounded(0xFFFFFFFF, 8 * density, accent, (int) (3 * density)));
        overlay.addState(new int[] {}, rounded(0xEEFFFFFF, 8 * density, 0, 0));
        findViewById(R.id.next_overlay).setBackground(overlay);
        View bar = view.findViewById(androidx.media3.ui.R.id.exo_progress);
        if (bar instanceof DefaultTimeBar) {
            ((DefaultTimeBar) bar).setPlayedColor(accent);
            ((DefaultTimeBar) bar).setScrubberColor(accent);
        }
    }

    private static StateListDrawable topButton(int accent, float density) {
        StateListDrawable d = new StateListDrawable();
        d.addState(new int[] {android.R.attr.state_focused}, rounded(withAlpha(accent, 0x99), 20 * density, 0xFFFFFFFF, (int) (2 * density)));
        d.addState(new int[] {android.R.attr.state_pressed}, rounded(withAlpha(accent, 0xBB), 20 * density, 0, 0));
        d.addState(new int[] {}, rounded(0x33FFFFFF, 20 * density, 0, 0));
        return d;
    }

    private static GradientDrawable rounded(int fill, float radius, int stroke, int strokeWidth) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(radius);
        if (strokeWidth > 0) g.setStroke(strokeWidth, stroke);
        return g;
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    /** While the bar is moved (touch or remote), show the target time big,
     * "12:34 / 45:00": the bar's own small label is hard to read on a TV. */
    private void showScrubTime() {
        View bar = view.findViewById(androidx.media3.ui.R.id.exo_progress);
        if (!(bar instanceof TimeBar)) return;
        ((TimeBar) bar).addListener(new TimeBar.OnScrubListener() {
            private void show(long position) {
                handler.removeCallbacks(hideScrubTime);
                setScrubTime(position);
            }

            @Override
            public void onScrubStart(@NonNull TimeBar timeBar, long position) {
                show(position);
            }

            @Override
            public void onScrubMove(@NonNull TimeBar timeBar, long position) {
                show(position);
            }

            @Override
            public void onScrubStop(@NonNull TimeBar timeBar, long position, boolean canceled) {
                // Keep it a moment so the jump is seen, then hide.
                handler.postDelayed(hideScrubTime, 700);
            }
        });
    }

    private final StringBuilder timeText = new StringBuilder();
    private final java.util.Formatter timeFormat = new java.util.Formatter(timeText, Locale.getDefault());
    private final Runnable hideScrubTime = () -> findViewById(R.id.scrub_time).setVisibility(View.GONE);

    private void setScrubTime(long position) {
        TextView label = findViewById(R.id.scrub_time);
        long duration = player == null ? C.TIME_UNSET : player.getDuration();
        String text = Util.getStringForTime(timeText, timeFormat, Math.max(0, position));
        if (duration != C.TIME_UNSET) text += "  /  " + Util.getStringForTime(timeText, timeFormat, duration);
        label.setText(text);
        label.setVisibility(View.VISIBLE);
    }

    /** ±10 s from the remote: show where it lands for a moment. */
    private void flashScrubTime(long position) {
        handler.removeCallbacks(hideScrubTime);
        setScrubTime(position);
        handler.postDelayed(hideScrubTime, 1200);
    }

    /** Visible buttons of the top bar, left to right. */
    private View firstTopButton() {
        for (int id : new int[] {R.id.versions, R.id.sync_subs, R.id.next_episode}) {
            View b = findViewById(id);
            if (b.getVisibility() == View.VISIBLE) return b;
        }
        return null;
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
        // Subtitle timing panel open: the remote moves between its buttons;
        // Back closes it (the video keeps playing).
        if (syncPanelOpen()) {
            if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                if (event.getAction() == KeyEvent.ACTION_UP) closeSyncPanel();
                return true;
            }
            return super.dispatchKeyEvent(event);
        }
        // Back with the controls up (after changing subtitles, audio,
        // quality…): just hide them. Back again, with only the video on
        // screen, leaves the player. (Open settings menus close themselves.)
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                backHidesControls = view.isControllerFullyVisible();
                if (backHidesControls) return true;
            } else if (event.getAction() == KeyEvent.ACTION_UP && backHidesControls) {
                backHidesControls = false;
                view.hideController();
                return true;
            }
        }
        // OK on the remote with the big "Siguiente episodio" up: go.
        if (nextOverlay != null && nextOverlay.getVisibility() == View.VISIBLE && !view.isControllerFullyVisible()
                && event.getAction() == KeyEvent.ACTION_DOWN
                && (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_CENTER || event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
            nextOverlay.performClick();
            return true;
        }
        if (player != null && event.getAction() == KeyEvent.ACTION_DOWN && !view.isControllerFullyVisible()) {
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    player.seekBack();
                    flashScrubTime(player.getCurrentPosition());
                    view.showController();
                    return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    player.seekForward();
                    flashScrubTime(player.getCurrentPosition());
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
                case KeyEvent.KEYCODE_CAPTIONS:
                    // Remotes with a subtitles key: straight to the timing panel.
                    if (external.isEmpty()) break;
                    openSyncPanel();
                    return true;
                default:
                    break;
            }
        }
        View topBar = findViewById(R.id.top_bar);
        View firstTop = firstTopButton();
        boolean topShown = firstTop != null && view.isControllerFullyVisible();
        if (topShown && topBar.hasFocus()) {
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
        // Up from the top row of the controls: on to the top bar buttons.
        if (topShown && event.getAction() == KeyEvent.ACTION_DOWN
                && event.getKeyCode() == KeyEvent.KEYCODE_DPAD_UP && getCurrentFocus() == before) {
            firstTop.requestFocus();
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
        handler.removeCallbacks(endWatch);
        handler.removeCallbacks(hideScrubTime);
        handler.removeCallbacks(drawSubs);
        handler.removeCallbacks(sendSync);
        if (syncPending) sendSync.run();
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
