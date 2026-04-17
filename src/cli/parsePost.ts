import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

type ParsedCli = { configPath?: string; textArg?: string };

const parseArgv = (argv: string[]): ParsedCli => {
  const rest: string[] = [];
  let configPath: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--config') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --config');
      }
      configPath = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      throw new Error(`Unknown option: ${a}`);
    }
    rest.push(a);
  }
  if (rest.length > 1) {
    throw new Error('Expected at most one text argument');
  }
  return { configPath, textArg: rest[0] };
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

async function main(): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseArgv(process.argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  if (parsed.configPath) {
    process.env.CONFIG_PATH = path.resolve(parsed.configPath);
  }

  const { initJsonConfig } = await import('../config/jsonConfig');
  initJsonConfig();

  let text: string;
  if (parsed.textArg !== undefined) {
    text = parsed.textArg;
  } else {
    text = await readStdin();
  }
  text = text.trim();
  if (!text) {
    process.stderr.write('No input text (provide one argument or stdin)\n');
    process.exit(1);
  }

  try {
    const { parseTourWithTrace } = await import('../parser/index');
    const trace = await parseTourWithTrace(text);
    process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(2);
  }
}

void main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${msg}\n`);
  process.exit(2);
});
