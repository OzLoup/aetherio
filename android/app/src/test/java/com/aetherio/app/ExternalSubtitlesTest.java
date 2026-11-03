package com.aetherio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

public class ExternalSubtitlesTest {

    private static final String VTT = "WEBVTT\n\n"
            + "NOTE made by the page\n\n"
            + "1\n00:00:01.000 --> 00:00:03.500\n<i>Hola</i>\n\n"
            + "00:00:05.250 --> 00:00:07.000 line:90%\n{\\an8}Arriba\ndos líneas\n\n"
            + "01:00:00,000 --> 01:00:02,000\nUna hora\n\n"
            + "00:00:06.000 --> 00:00:08.000\nSe cruza\n";

    @Test
    public void parsesCuesInOrderAndCleansThem() {
        List<ExternalSubtitles.Cue> cues = ExternalSubtitles.parse(VTT);
        assertEquals(4, cues.size());
        assertEquals(1000, cues.get(0).startMs);
        assertEquals(3500, cues.get(0).endMs);
        assertEquals(5250, cues.get(1).startMs);
        assertEquals(6000, cues.get(2).startMs); // sorted by start
        assertEquals(3_600_000, cues.get(3).startMs); // SRT-style comma too
    }

    @Test
    public void parsesShortAndLongTimes() {
        assertEquals(62_345, ExternalSubtitles.parseTime("01:02.345"));
        assertEquals(3_723_400, ExternalSubtitles.parseTime("1:02:03.4"));
    }

    @Test
    public void appliesOffset() {
        List<ExternalSubtitles.Cue> cues = ExternalSubtitles.parse(VTT);
        assertEquals(1, ExternalSubtitles.activeAt(cues, 2000, 0, 1).size());
        // 1.5 s later: the first cue isn't up yet at 2.0 s, it is at 2.6 s.
        assertTrue(ExternalSubtitles.activeAt(cues, 2000, 1500, 1).isEmpty());
        assertEquals(1, ExternalSubtitles.activeAt(cues, 2600, 1500, 1).size());
        // 0.75 s earlier: gone by 3.0 s.
        assertTrue(ExternalSubtitles.activeAt(cues, 3000, -750, 1).isEmpty());
        // Two cues on screen at once.
        assertEquals(2, ExternalSubtitles.activeAt(cues, 6500, 0, 1).size());
    }

    @Test
    public void appliesFrameRateScale() {
        List<ExternalSubtitles.Cue> cues = ExternalSubtitles.parse(VTT);
        double scale = 25 / 23.976; // the 1 h cue moves to ~1 h 2.5 min
        assertTrue(ExternalSubtitles.activeAt(cues, 3_600_500, 0, scale).isEmpty());
        assertEquals(1, ExternalSubtitles.activeAt(cues, 3_754_000, 0, scale).size());
    }
}
