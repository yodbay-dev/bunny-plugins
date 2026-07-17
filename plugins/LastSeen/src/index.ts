import { storage } from "@vendetta/plugin";

import Settings from "./Settings";
import patchSheet from "./sheet";
import { startTracking, stopTracking } from "./tracker";

let unpatchSheet: (() => void) | undefined;

export default {
    onLoad() {
        // Persistente Struktur initialisieren (überlebt App-Neustarts, MMKV)
        storage.settings ??= {};
        storage.settings.timeFormat ??= "relative";   // "relative" | "absolute"
        storage.settings.showOnlineSince ??= true;
        storage.settings.notifyEnabled ??= false;
        storage.settings.typingSound ??= false;
        storage.settings.showToastOnOpen ??= true;
        storage.seen ??= {};    // pro Nutzer: lastSeenActive, lastChange, from, to
        storage.bells ??= {};   // pro Nutzer: true = Glocke aktiv
        storage.sounds ??= {};  // pro Nutzer: Sound-URL oder Datei-URI

        startTracking();
        unpatchSheet = patchSheet();
    },
    onUnload() {
        stopTracking();
        unpatchSheet?.();
        unpatchSheet = undefined;
    },
    settings: Settings,
};
