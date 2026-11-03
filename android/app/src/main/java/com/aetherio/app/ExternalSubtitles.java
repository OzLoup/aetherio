package com.aetherio.app;

import android.text.Html;
import android.text.SpannableStringBuilder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Subtitles the page downloaded (WebVTT files), drawn by the player itself
 * instead of ExoPlayer, so their timing can be moved while the video plays
 * (ExoPlayer has no subtitle delay). Subtitles inside the file stay with
 * ExoPlayer.
 */
final class ExternalSubtitles {

    static final class Cue {
        final long startMs;
        final long endMs;
        private final String raw;
        private CharSequence text;

        Cue(long startMs, long endMs, String raw) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.raw = raw;
        }

        /** <i>, <b>, <u> and entities as styled text (converted once, when first shown). */
        CharSequence text() {
            if (text == null) {
                SpannableStringBuilder s = new SpannableStringBuilder(
                        Html.fromHtml(raw.replace("\n", "<br>"), Html.FROM_HTML_MODE_LEGACY));
                while (s.length() > 0 && Character.isWhitespace(s.charAt(s.length() - 1))) s.delete(s.length() - 1, s.length());
                text = s;
            }
            return text;
        }
    }

    private static final Pattern TIMING = Pattern.compile(
            "((?:\\d+:)?\\d{1,2}:\\d{2}[.,]\\d{1,3})\\s*-->\\s*((?:\\d+:)?\\d{1,2}:\\d{2}[.,]\\d{1,3})");
    // SSA/ASS overrides some SRT files carry, like {\an8}.
    private static final Pattern ASS_TAGS = Pattern.compile("\\{\\\\[^}]*\\}");

    private ExternalSubtitles() {
    }

    static List<Cue> read(File file) throws IOException {
        // (java.nio.file needs Android 8; the app runs on 7.)
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
            return parse(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    /** WebVTT (as the page writes it) → cues sorted by start. */
    static List<Cue> parse(String vtt) {
        String text = vtt.replace("\r\n", "\n").replace('\r', '\n');
        List<Cue> cues = new ArrayList<>();
        for (String block : text.split("\n\\s*\n")) {
            String[] lines = block.split("\n");
            int i = 0;
            while (i < lines.length && !lines[i].contains("-->")) i++;
            if (i >= lines.length) continue; // header, NOTE, STYLE
            Matcher m = TIMING.matcher(lines[i]);
            if (!m.find()) continue;
            long start = parseTime(m.group(1));
            long end = parseTime(m.group(2));
            StringBuilder body = new StringBuilder();
            for (int j = i + 1; j < lines.length; j++) {
                if (body.length() > 0) body.append('\n');
                body.append(lines[j]);
            }
            String raw = ASS_TAGS.matcher(body).replaceAll("").trim();
            if (raw.isEmpty() || end <= start) continue;
            cues.add(new Cue(start, end, raw));
        }
        Collections.sort(cues, (a, b) -> Long.compare(a.startMs, b.startMs));
        return cues;
    }

    static long parseTime(String t) {
        String[] parts = t.replace(',', '.').split(":");
        double seconds = Double.parseDouble(parts[parts.length - 1]);
        long minutes = Long.parseLong(parts[parts.length - 2]);
        long hours = parts.length > 2 ? Long.parseLong(parts[0]) : 0;
        return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
    }

    /** Cues on screen at `positionMs`, each shown at time × scale + offset
     * (the same rule as the web player's retimeVtt). */
    static List<Cue> activeAt(List<Cue> cues, long positionMs, long offsetMs, double scale) {
        List<Cue> out = new ArrayList<>(2);
        for (Cue c : cues) {
            long start = Math.round(c.startMs * scale) + offsetMs;
            if (start > positionMs) break; // sorted by start
            if (Math.round(c.endMs * scale) + offsetMs > positionMs) out.add(c);
        }
        return out;
    }

    /** One block of text for the cues on screen (stacked, oldest on top). */
    static CharSequence join(List<Cue> active) {
        if (active.size() == 1) return active.get(0).text();
        SpannableStringBuilder s = new SpannableStringBuilder();
        for (Cue c : active) {
            if (s.length() > 0) s.append('\n');
            s.append(c.text());
        }
        return s;
    }
}
