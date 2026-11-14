// Windows PATH refresh: a tool installed while HQ runs must be found by "Check again".
//
//   npx tsx scripts/path-test.ts

import { mergeWindowsPath, refreshWindowsPath } from "../server/lib/exec";

let passed = 0;
function ok(label: string, cond: unknown, detail?: unknown) {
  if (!cond) throw new Error(`FAILED: ${label}${detail !== undefined ? `\n  got: ${JSON.stringify(detail)}` : ""}`);
  passed += 1;
}

const env = { USERPROFILE: "C:\\Users\\abuti", LocalAppData: "C:\\Users\\abuti\\AppData\\Local", SystemRoot: "C:\\Windows" };
const machine = `
HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment
    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\GitHub CLI;C:\\Program Files\\nodejs\\
`;
const user = `
HKEY_CURRENT_USER\\Environment
    Path    REG_SZ    %LOCALAPPDATA%\\Microsoft\\WinGet\\Links;%USERPROFILE%\\.local\\bin;%NOT_SET%\\bin;
`;
const current = "C:\\WINDOWS\\System32;C:\\Program Files\\nodejs;C:\\my tools";

const merged = mergeWindowsPath(current, [machine, user], env).split(";");
ok("keeps what the process had, in order", merged.slice(0, 3).join(";") === current, merged);
ok("adds a machine entry installed since (GitHub CLI)", merged.includes("C:\\Program Files\\GitHub CLI"), merged);
ok("adds user entries, with %VARIABLES% filled in whatever their case", merged.includes("C:\\Users\\abuti\\AppData\\Local\\Microsoft\\WinGet\\Links") && merged.includes("C:\\Users\\abuti\\.local\\bin"), merged);
ok("no duplicates: case and trailing slash don't count", merged.filter((e) => /system32$/i.test(e)).length === 1 && merged.filter((e) => /nodejs\\?$/i.test(e)).length === 1, merged);
ok("drops an entry whose variable isn't set", !merged.some((e) => e.includes("%")), merged);
ok("machine entries come before user entries", merged.indexOf("C:\\Program Files\\GitHub CLI") < merged.indexOf("C:\\Users\\abuti\\.local\\bin"));
ok("nothing new: unchanged", mergeWindowsPath(current, ["", ""], env) === current);
ok("unreadable registry output: unchanged", mergeWindowsPath(current, ["ERROR: The system was unable to find the specified registry key or value.", ""], env) === current);

// The real thing: never loses an entry, never throws; a no-op off Windows.
const before = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
const added = await refreshWindowsPath();
const after = process.env.PATH ?? "";
ok("refresh keeps every entry the process had", before.every((e) => after.includes(e)), { missing: before.filter((e) => !after.includes(e)) });
if (process.platform !== "win32") ok("refresh does nothing off Windows", added.length === 0 && after.split(":").filter(Boolean).length === before.length);
else console.log(`  refresh on this Windows machine added ${added.length} entr${added.length === 1 ? "y" : "ies"}`);

console.log(`path-test: ${passed} checks passed`);
