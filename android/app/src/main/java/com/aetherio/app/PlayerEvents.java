package com.aetherio.app;

import org.json.JSONObject;

/** Player → page messages ("aether:player" events, see NativePlayer.tsx). */
final class PlayerEvents {
    interface Listener {
        void onEvent(String json);
    }

    static volatile Listener listener;

    private PlayerEvents() {
    }

    static void send(String type, long positionMs, long durationMs, String message) {
        Listener l = listener;
        if (l == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            o.put("positionMs", Math.max(0, positionMs));
            o.put("durationMs", Math.max(0, durationMs));
            if (message != null) o.put("message", message);
            l.onEvent(o.toString());
        } catch (Exception ignored) {
        }
    }
}
