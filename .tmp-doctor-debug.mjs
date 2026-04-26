import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectDoctorConfig } from "./src/resources/extensions/gsd/doctor-config.ts";
import { _clearGsdRootCache } from "./src/resources/extensions/gsd/paths.ts";

const projectDir = mkdtempSync(join(tmpdir(), "gsd-doctor-debug-project-"));
const gsdHome = mkdtempSync(join(tmpdir(), "gsd-doctor-debug-home-"));
process.env.HOME = gsdHome;
process.env.GSD_HOME = gsdHome;
process.env.PI_CODING_AGENT_DIR = join(gsdHome, "agent");
mkdirSync(join(projectDir, ".pi"), { recursive: true });
mkdirSync(join(projectDir, ".gsd"), { recursive: true });
mkdirSync(join(gsdHome, "agent"), { recursive: true });
writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" }, null, 2));
writeFileSync(join(gsdHome, "agent", "models.json"), "{ invalid json\n", "utf-8");
_clearGsdRootCache();
process.chdir(projectDir);
console.log(JSON.stringify(inspectDoctorConfig(), null, 2));
