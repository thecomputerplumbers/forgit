import { shellQuote } from "@forgit/actions";

/** Drain output into a bounded file without limiting the command's own files. */
export function boundedLogCommand(command: string, path: string, limit: number): string {
  const sink = `const fs=require("node:fs");let remaining=${limit};process.stdin.on("data",chunk=>{const part=chunk.subarray(0,remaining);if(part.length)fs.writeSync(1,part);remaining-=part.length;if(chunk.length>part.length)process.exitCode=91;});`;
  return `bash --noprofile --norc -o pipefail -c ${shellQuote(`${command} 2>&1 | node -e ${shellQuote(sink)} > ${shellQuote(path)}`)}`;
}
