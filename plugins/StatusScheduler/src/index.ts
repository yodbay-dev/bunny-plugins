import { storage } from "@vendetta/plugin";

import { start, stop } from "./scheduler";
import Settings from "./Settings";

export default {
    onLoad() {
        storage.enabled ??= false;  // Standard: AUS
        storage.notify ??= true;
        storage.enforce ??= false;  // "Zeitplan durchsetzen": Standard AUS
        storage.rules ??= [
            { id: "default-night", time: "23:00", status: "invisible" },
            { id: "default-morning", time: "08:00", status: "online" },
        ];

        // Aufhol-Logik: Beim App-Start sofort die zuletzt fällige Regel anwenden
        // (start() ruft tick() direkt auf), danach minütlicher Check.
        if (storage.enabled) start();
    },
    onUnload() {
        // Hintergrund-Timer sauber beenden
        stop();
    },
    settings: Settings,
};
