import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");
const outputRoot = path.join(rootDir, ".release", "github-packages");
const repositoryUrl = "git+https://github.com/cmwen/min-kb-app.git";

const packageDefinitions = [
  {
    sourceDirectory: "packages/shared",
    sourceName: "@min-kb-app/shared",
    publishName: "@cmwen/min-kb-app-shared",
    description: "Shared contracts and schemas for min-kb-app.",
  },
  {
    sourceDirectory: "packages/min-kb-store",
    sourceName: "@min-kb-app/min-kb-store",
    publishName: "@cmwen/min-kb-app-min-kb-store",
    description:
      "Filesystem adapter for the Markdown-backed min-kb-store layout.",
  },
  {
    sourceDirectory: "packages/copilot-runtime",
    sourceName: "@min-kb-app/copilot-runtime",
    publishName: "@cmwen/min-kb-app-copilot-runtime",
    description: "GitHub Copilot SDK runtime wrapper for min-kb-app.",
  },
];

const publishNameBySourceName = Object.fromEntries(
  packageDefinitions.map((definition) => [
    definition.sourceName,
    definition.publishName,
  ])
);
const versionBySourceName = Object.fromEntries(
  await Promise.all(
    packageDefinitions.map(async (definition) => {
      const manifest = await readManifest(definition.sourceDirectory);
      return [definition.sourceName, manifest.version];
    })
  )
);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const definition of packageDefinitions) {
  const sourceDirectory = path.join(rootDir, definition.sourceDirectory);
  const distDirectory = path.join(sourceDirectory, "dist");
  const destinationDirectory = path.join(
    outputRoot,
    definition.publishName.split("/")[1]
  );
  const manifest = await readManifest(definition.sourceDirectory);

  if (!(await pathExists(distDirectory))) {
    throw new Error(
      `Expected a built dist directory for ${definition.sourceName} at ${distDirectory}. Run "pnpm build:packages" first.`
    );
  }

  await mkdir(destinationDirectory, { recursive: true });
  await cp(distDirectory, path.join(destinationDirectory, "dist"), {
    recursive: true,
  });

  const publishManifest = createPublishManifest(definition, manifest);
  await writeFile(
    path.join(destinationDirectory, "package.json"),
    `${JSON.stringify(publishManifest, null, 2)}\n`
  );
  await writeFile(
    path.join(destinationDirectory, "README.md"),
    buildPackageReadme(definition)
  );

  await rewriteInternalSpecifiers(
    path.join(destinationDirectory, "dist"),
    publishNameBySourceName
  );
}

console.log(`Prepared GitHub Packages artifacts in ${outputRoot}`);

function createPublishManifest(definition, manifest) {
  const publishManifest = {
    ...manifest,
    name: definition.publishName,
    repository: {
      type: "git",
      url: repositoryUrl,
      directory: definition.sourceDirectory,
    },
    publishConfig: {
      registry: "https://npm.pkg.github.com",
      access: "restricted",
    },
    files: ["dist", "README.md"],
  };

  delete publishManifest.private;

  for (const dependencyField of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = publishManifest[dependencyField];
    if (!dependencies) {
      continue;
    }

    publishManifest[dependencyField] = Object.fromEntries(
      Object.entries(dependencies).map(([dependencyName, dependencyRange]) => {
        const publishName = publishNameBySourceName[dependencyName];
        if (!publishName) {
          return [dependencyName, dependencyRange];
        }

        return [publishName, `^${versionBySourceName[dependencyName]}`];
      })
    );
  }

  return publishManifest;
}

function buildPackageReadme(definition) {
  return `# ${definition.publishName}

${definition.description}

This package is published automatically from the \`${definition.sourceDirectory}\` workspace package in the \`cmwen/min-kb-app\` repository.

- Repository: https://github.com/cmwen/min-kb-app
- Source directory: \`${definition.sourceDirectory}\`
`;
}

async function readManifest(sourceDirectory) {
  const manifestPath = path.join(rootDir, sourceDirectory, "package.json");
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function rewriteInternalSpecifiers(directory, replacements) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteInternalSpecifiers(entryPath, replacements);
      continue;
    }

    if (!/\.(?:d\.ts|js|mjs|cjs)$/.test(entry.name)) {
      continue;
    }

    let content = await readFile(entryPath, "utf8");
    for (const [sourceName, publishName] of Object.entries(replacements)) {
      content = content.split(sourceName).join(publishName);
    }
    await writeFile(entryPath, content);
  }
}

async function pathExists(targetPath) {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isDirectory() || targetStat.isFile();
  } catch {
    return false;
  }
}
