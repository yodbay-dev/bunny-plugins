import { findByProps } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { id as pluginId, storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";

// Discords interne Audio-Klasse (spielt beliebige URLs ab, inkl. file:// und content://).
// Konstruktor-Signatur wie in nexpid/RevengePlugins (song-spotlight) verifiziert:
// new MobileAudioSound(url, soundUsageName, volume, "default")
function getMAS(): any {
    return findByProps("MobileAudioSound")?.MobileAudioSound;
}

/** Standard-Sound: leiser Zwei-Ton, wird neben dem Plugin auf GitHub Pages mitgehostet */
export function defaultSoundUrl(): string {
    // pluginId ist die Installations-URL des Plugins und endet mit "/"
    return `${pluginId}bell.wav`;
}

export async function playUrl(url: string, volume = 0.6): Promise<void> {
    const MAS = getMAS();
    if (!MAS) throw new Error("MobileAudioSound nicht gefunden");

    const sound = new MAS(url, "activity_launch", volume, "default");
    sound.volume = volume;

    let durationMs = 4000;
    try {
        const ensure = sound._ensureSound ?? sound.ensureSound;
        const meta = await ensure?.call(sound);
        const dur = meta?._duration;
        if (dur) durationMs = RN.Platform.OS === "ios" ? dur * 1000 : dur;
    } catch { /* Dauer unbekannt – Fallback-Timeout nutzen */ }

    await sound.play();
    setTimeout(() => {
        try { sound.stop?.(); } catch { /* egal */ }
    }, Math.min(durationMs + 250, 10_000));
}

/** Spielt den für einen Kontakt hinterlegten Sound, sonst den Standard-Zwei-Ton. */
export async function playBellSound(userId: string): Promise<void> {
    const custom = storage.sounds?.[userId];
    try {
        await playUrl(custom || defaultSoundUrl());
    } catch {
        if (custom) {
            // Eigener Sound kaputt (URL tot, Datei verschoben) -> Standard versuchen
            try {
                await playUrl(defaultSoundUrl());
            } catch { /* auch Standard nicht abspielbar */ }
        }
    }
}

export async function testBellSound(userId: string): Promise<void> {
    const custom = storage.sounds?.[userId];
    try {
        await playUrl(custom || defaultSoundUrl());
        showToast(custom ? "Eigener Sound wird abgespielt" : "Standard-Sound wird abgespielt");
    } catch {
        showToast("Sound konnte nicht abgespielt werden");
    }
}
