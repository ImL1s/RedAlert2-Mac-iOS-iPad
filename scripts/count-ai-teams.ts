/**
 * Settles a documentation question: how many attack teams does the retail
 * AI database actually define?
 *
 * Reads aimd.ini straight out of the retail archives (the same way
 * prepare-gameres.ts reads everything else) and counts the real sections, so
 * the number in the README is something anyone can reproduce rather than
 * something we remembered.
 *
 *   bun scripts/count-ai-teams.ts /path/to/your/ra2/install
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MixFile } from "../redalert2/src/data/MixFile";
import { IniFile } from "../redalert2/src/data/IniFile";
import { VirtualFile } from "../redalert2/src/data/vfs/VirtualFile";

const RETAIL = process.argv[2] ?? process.env.RA2_RETAIL_DIR ?? "gameres-export";

function openMix(path: string): MixFile {
    const bytes = readFileSync(path);
    return new MixFile(VirtualFile.fromBytes(new Uint8Array(bytes), path).stream as any);
}

function findIni(name: string): IniFile | undefined {
    // aimd.ini ships inside the YR archives; ai.ini inside the RA2 ones.
    const archives = ["ra2md.mix", "expandmd01.mix", "ra2.mix"];
    for (const archive of archives) {
        const path = join(RETAIL, archive);
        if (!existsSync(path)) continue;
        const mix = openMix(path);
        // try the archive directly, then its nested local mix
        for (const container of [mix, tryNested(mix, "localmd.mix"), tryNested(mix, "local.mix")]) {
            if (!container) continue;
            try {
                const file = container.openFile(name);
                console.log(`  found ${name} in ${archive}${container === mix ? "" : " (nested)"}`);
                return new IniFile(file);
            } catch {
                /* not in this container */
            }
        }
    }
    return undefined;
}

function tryNested(mix: MixFile, inner: string): MixFile | undefined {
    try {
        return new MixFile(mix.openFile(inner).stream);
    } catch {
        return undefined;
    }
}

for (const iniName of ["aimd.ini", "ai.ini"]) {
    console.log(`\n== ${iniName}`);
    const ini = findIni(iniName);
    if (!ini) {
        console.log("  not found");
        continue;
    }
    const sections = [...(ini as any).sections.keys()] as string[];
    const listOf = (name: string) => {
        const s = (ini as any).sections.get(name);
        if (!s) return 0;
        const e = s.entries;
        return e?.size ?? (Array.isArray(e) ? e.length : Object.keys(e ?? {}).length);
    };
    console.log(`  total sections           : ${sections.length}`);
    console.log(`  [TaskForces] entries     : ${listOf("TaskForces")}`);
    console.log(`  [TeamTypes] entries      : ${listOf("TeamTypes")}`);
    console.log(`  [AITriggerTypes] entries : ${listOf("AITriggerTypes")}`);
    console.log(`  [ScriptTypes] entries    : ${listOf("ScriptTypes")}`);
}
