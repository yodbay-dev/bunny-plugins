import { findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { showInputAlert } from "@vendetta/ui/alerts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

import {
    normalizeTime, parseTime, Rule, ScheduledStatus,
    setEnabled, STATUS_LABELS, tick,
} from "./scheduler";

const { FormSection, FormRow, FormSwitchRow, FormRadioRow, FormText, FormDivider } = Forms;
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");

const STATUS_ORDER: ScheduledStatus[] = ["online", "idle", "dnd", "invisible"];

function findRule(id: string): Rule | undefined {
    return (storage.rules as Rule[]).find(r => r.id === id);
}

function editRuleTime(ruleId: string) {
    const rule = findRule(ruleId);
    if (!rule) return;
    showInputAlert({
        title: "Uhrzeit (24h-Format, HH:MM)",
        placeholder: "z. B. 23:00",
        initialValue: rule.time,
        confirmText: "Speichern",
        cancelText: "Abbrechen",
        onConfirm: (value: string) => {
            // Wirft bei ungültiger Eingabe -> Alert bleibt offen und zeigt den Fehler an, nichts wird gespeichert
            if (parseTime(value) === null) {
                throw new Error("Ungültige Uhrzeit – bitte HH:MM im 24h-Format (z. B. 08:30)");
            }
            rule.time = normalizeTime(value);
            delete storage.lastApplied;
            if (storage.enabled) tick();
            showToast(`Uhrzeit auf ${rule.time} geändert`);
        },
    });
}

/** Bearbeitungs-Sheet für eine Regel (öffnet per Long-Press-üblichem ActionSheet) */
function RuleSheet({ ruleId }: { ruleId: string; }) {
    useProxy(storage);
    const rule = findRule(ruleId);
    if (!rule) return null;

    return (
        <RN.View style={{ paddingBottom: 24 }}>
            <FormSection title={`Regel bearbeiten – ${rule.time}`}>
                <FormRow
                    label={`Uhrzeit: ${rule.time}`}
                    subLabel="Tippen zum Ändern (24h-Format)"
                    icon={<FormRow.Icon source={getAssetIDByName("ic_clock")} />}
                    onPress={() => editRuleTime(ruleId)}
                />
                <FormDivider />
                {STATUS_ORDER.map(st => (
                    <FormRadioRow
                        key={st}
                        label={STATUS_LABELS[st]}
                        selected={rule.status === st}
                        onPress={() => {
                            rule.status = st;
                            delete storage.lastApplied;
                            if (storage.enabled) tick();
                        }}
                    />
                ))}
                <FormDivider />
                <FormRow
                    label="Regel löschen"
                    icon={<FormRow.Icon source={getAssetIDByName("TrashIcon") ?? getAssetIDByName("ic_trash_24px")} />}
                    onPress={() => {
                        if ((storage.rules as Rule[]).length <= 2) {
                            showToast("Mindestens 2 Regeln erforderlich (z. B. abends und morgens)");
                            return;
                        }
                        storage.rules = (storage.rules as Rule[]).filter(r => r.id !== ruleId);
                        delete storage.lastApplied;
                        LazyActionSheet.hideActionSheet();
                        showToast("Regel gelöscht");
                    }}
                />
            </FormSection>
        </RN.View>
    );
}

function openRuleSheet(ruleId: string) {
    LazyActionSheet.openLazy(
        Promise.resolve({ default: () => <RuleSheet ruleId={ruleId} /> }),
        "StatusSchedulerRuleSheet",
        {}
    );
}

export default function Settings() {
    useProxy(storage);
    const rules = [...(storage.rules as Rule[])].sort(
        (a, b) => (parseTime(a.time) ?? 0) - (parseTime(b.time) ?? 0)
    );

    return (
        <RN.ScrollView style={{ flex: 1 }}>
            <FormSection title="Allgemein">
                <FormSwitchRow
                    label="Automatische Statusänderungen"
                    subLabel="Ohne diesen Schalter passiert nichts und es läuft kein Hintergrund-Check"
                    value={!!storage.enabled}
                    onValueChange={(v: boolean) => setEnabled(v)}
                />
                <FormSwitchRow
                    label="Benachrichtigung bei automatischem Wechsel"
                    value={!!storage.notify}
                    onValueChange={(v: boolean) => { storage.notify = v; }}
                />
                <FormSwitchRow
                    label="Zeitplan durchsetzen"
                    subLabel="Der laut Zeitplan zuletzt festgelegte Status wird bei jedem Check erneut angewendet, auch wenn er zwischendurch manuell geändert wurde – bis die nächste Regel fällig wird"
                    value={!!storage.enforce}
                    onValueChange={(v: boolean) => {
                        storage.enforce = v;
                        if (v && storage.enabled) tick();
                    }}
                />
            </FormSection>

            <FormSection title={`Zeitplan (täglich, lokale Gerätezeit) – ${rules.length} Regeln`}>
                {rules.map(r => (
                    <FormRow
                        key={r.id}
                        label={`${r.time} → ${STATUS_LABELS[r.status] ?? r.status}`}
                        subLabel="Tippen zum Bearbeiten"
                        icon={<FormRow.Icon source={getAssetIDByName("ic_clock")} />}
                        trailing={FormRow.Arrow ? <FormRow.Arrow /> : undefined}
                        onPress={() => openRuleSheet(r.id)}
                    />
                ))}
                <FormRow
                    label="Regel hinzufügen"
                    icon={<FormRow.Icon source={getAssetIDByName("PlusSmallIcon") ?? getAssetIDByName("ic_add_24px")} />}
                    onPress={() => {
                        const rule: Rule = {
                            id: String(Date.now()),
                            time: "12:00",
                            status: "online",
                        };
                        (storage.rules as Rule[]).push(rule);
                        openRuleSheet(rule.id);
                    }}
                />
            </FormSection>

            <FormText style={{ padding: 12, paddingBottom: 24 }}>
                Hinweis: Der Zeitplan wiederholt sich täglich und gilt in der lokalen Systemzeit
                des Geräts. Das Plugin funktioniert nur, solange die App läuft – verpasste
                Zeitpunkte werden beim nächsten App-Start bzw. beim Einschalten des Schalters
                sofort nachgeholt (inkl. Tages-Wrap-around, z. B. greift um 02:00 nachts noch die
                23:00-Regel von gestern). Ein manuell geänderter Status wird nicht sofort
                überschrieben, sondern erst wieder zum nächsten Regel-Zeitpunkt. Es sind
                mindestens 2 Regeln erforderlich (Standard: 23:00 Unsichtbar, 08:00 Online).
            </FormText>
        </RN.ScrollView>
    );
}
