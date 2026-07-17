import { findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showConfirmationAlert, showInputAlert } from "@vendetta/ui/alerts";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import { defaultSoundUrl, testBellSound } from "./sound";
import { resetData } from "./tracker";
import { displayName, icons } from "./util";

const { FormSection, FormRow, FormSwitchRow, FormRadioRow, FormText, FormDivider } = Forms;

async function pickSoundFile(userId: string) {
    try {
        const DocumentPicker = findByProps("pickSingle", "isCancel");
        if (!DocumentPicker?.pickSingle) {
            showToast("Datei-Auswahl auf dieser Version nicht verfügbar – bitte URL verwenden");
            return;
        }
        const res = await DocumentPicker.pickSingle({
            type: DocumentPicker.types?.audio ?? "audio/*",
            copyTo: "documentDirectory",
        });
        const uri = res?.fileCopyUri ?? res?.uri;
        if (!uri) return;
        storage.sounds[userId] = uri;
        showToast("Sound-Datei gespeichert", icons.bell());
    } catch (e) {
        const DocumentPicker = findByProps("pickSingle", "isCancel");
        if (!DocumentPicker?.isCancel?.(e)) showToast("Datei-Auswahl fehlgeschlagen");
    }
}

function setSoundUrl(userId: string) {
    showInputAlert({
        title: "Benachrichtigungs-Sound (URL)",
        placeholder: "https://example.com/sound.mp3",
        initialValue: storage.sounds[userId]?.startsWith("http") ? storage.sounds[userId] : "",
        confirmText: "Speichern",
        cancelText: "Abbrechen",
        onConfirm: (value: string) => {
            const v = value.trim();
            if (!v) {
                delete storage.sounds[userId];
                showToast("Eigener Sound entfernt – Standard-Sound wird verwendet");
                return;
            }
            // Wirft bei ungültiger Eingabe -> Alert bleibt offen und zeigt den Fehler an
            if (!/^https?:\/\/.+/.test(v)) {
                throw new Error("Ungültige URL (muss mit http:// oder https:// beginnen)");
            }
            storage.sounds[userId] = v;
            showToast("Sound-URL gespeichert", icons.bell());
        },
    });
}

function soundLabel(userId: string): string {
    const s = storage.sounds[userId];
    if (!s) return "Standard-Sound (Zwei-Ton)";
    if (s.startsWith("http")) return `URL: ${s.length > 40 ? s.slice(0, 40) + "…" : s}`;
    return "Eigene Datei";
}

function BellContact({ userId }: { userId: string; }) {
    useProxy(storage);
    return (
        <>
            <FormRow
                label={displayName(userId)}
                subLabel={soundLabel(userId)}
                icon={<FormRow.Icon source={icons.bell()} />}
            />
            <FormRow
                label="    Sound-URL setzen/ändern"
                icon={<FormRow.Icon source={icons.link()} />}
                onPress={() => setSoundUrl(userId)}
            />
            <FormRow
                label="    Sound-Datei wählen"
                icon={<FormRow.Icon source={icons.file()} />}
                onPress={() => void pickSoundFile(userId)}
            />
            <FormRow
                label="    Test abspielen"
                icon={<FormRow.Icon source={icons.play()} />}
                onPress={() => void testBellSound(userId)}
            />
            <FormRow
                label="    Glocke entfernen"
                icon={<FormRow.Icon source={icons.trash()} />}
                onPress={() => {
                    delete storage.bells[userId];
                    showToast(`Statusglocke für ${displayName(userId)} entfernt`);
                }}
            />
            <FormDivider />
        </>
    );
}

export default function Settings() {
    useProxy(storage);
    const s = storage.settings;
    const bellIds = Object.keys(storage.bells);

    return (
        <RN.ScrollView style={{ flex: 1 }}>
            <FormSection title="Anzeige">
                <FormRadioRow
                    label='Zeitformat: Relativ ("vor 2 Std.")'
                    selected={s.timeFormat !== "absolute"}
                    onPress={() => { s.timeFormat = "relative"; }}
                />
                <FormRadioRow
                    label='Zeitformat: Absolut ("heute 14:30")'
                    selected={s.timeFormat === "absolute"}
                    onPress={() => { s.timeFormat = "absolute"; }}
                />
                <FormSwitchRow
                    label='"Online seit" anzeigen'
                    subLabel="Nur wenn der Übergang live beobachtet wurde – niemals geschätzt"
                    value={s.showOnlineSince}
                    onValueChange={(v: boolean) => { s.showOnlineSince = v; }}
                />
                <FormSwitchRow
                    label="Status beim Öffnen einer DM anzeigen"
                    subLabel="Kurzer Toast mit der Zuletzt-online-Info"
                    value={s.showToastOnOpen}
                    onValueChange={(v: boolean) => { s.showToastOnOpen = v; }}
                />
            </FormSection>

            <FormSection title="Benachrichtigungen">
                <FormSwitchRow
                    label="Status-Benachrichtigungen"
                    subLabel="Globaler Schalter – ohne ihn sind alle Glocken stumm"
                    value={s.notifyEnabled}
                    onValueChange={(v: boolean) => { s.notifyEnabled = v; }}
                />
                <FormSwitchRow
                    label="Tipp-Sound"
                    subLabel="Nur Sound (kein Popup), wenn ein Glocken-Kontakt in der DM zu tippen beginnt"
                    value={s.typingSound}
                    onValueChange={(v: boolean) => { s.typingSound = v; }}
                />
            </FormSection>

            <FormSection title={`Kontakte mit Glocke (${bellIds.length})`}>
                {bellIds.length === 0 ? (
                    <FormText style={{ padding: 12 }}>
                        Noch keine Glocken aktiv. Halte eine DM in der Nachrichtenliste gedrückt
                        und tippe auf „Statusglocke", um Benachrichtigungen für diesen Kontakt zu aktivieren.
                    </FormText>
                ) : (
                    bellIds.map(id => <BellContact userId={id} key={id} />)
                )}
            </FormSection>

            <FormSection title="Daten">
                <FormRow
                    label="Alle Verlaufsdaten zurücksetzen"
                    subLabel="Löscht aufgezeichnete Onlinezeiten. Glocken und Sounds bleiben erhalten."
                    icon={<FormRow.Icon source={icons.trash()} />}
                    onPress={() =>
                        showConfirmationAlert({
                            title: "Verlaufsdaten löschen?",
                            content: "Alle aufgezeichneten Zuletzt-online-Zeiten werden gelöscht. Glocken-Einstellungen und Sounds bleiben erhalten.",
                            confirmText: "Löschen",
                            cancelText: "Abbrechen",
                            confirmColor: "red" as any,
                            onConfirm: () => {
                                resetData();
                                showToast("Verlaufsdaten gelöscht");
                            },
                        })
                    }
                />
            </FormSection>

            <FormText style={{ padding: 12, paddingBottom: 24 }}>
                Hinweis: Discord liefert keine historischen Präsenzdaten. Erfasst wird nur, was
                dieses Gerät live beobachtet, während die App mit aktivem Plugin läuft. Vor dem
                ersten Start bzw. während die App geschlossen war, ist der Status unbekannt –
                dann wird „Unbekannt" angezeigt statt eines erfundenen Werts. Unsichtbare Nutzer
                sind von offline nicht unterscheidbar. Standard-Sound: {defaultSoundUrl()}
            </FormText>
        </RN.ScrollView>
    );
}
