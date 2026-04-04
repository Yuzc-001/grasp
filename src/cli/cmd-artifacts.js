import { getDefaultArtifactDir, listArtifactFiles } from '../server/share-artifacts.js';

export async function runArtifacts(args = []) {
  let limit = 20;

  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '--limit' || args[index] === '-n') && args[index + 1]) {
      limit = parseInt(args[index + 1], 10) || 20;
      index += 1;
    }
  }

  const artifacts = await listArtifactFiles({ limit });
  if (artifacts.length === 0) {
    console.log(`No artifacts found in ${getDefaultArtifactDir()}`);
    return;
  }

  console.log('');
  console.log(`  Artifact Directory  ${getDefaultArtifactDir()}`);
  console.log(`  Showing ${artifacts.length} recent file(s)`);
  console.log('');

  for (const artifact of artifacts) {
    console.log(`  ${artifact.name}`);
    console.log(`    ${artifact.path}`);
    console.log(`    ${artifact.bytes} bytes  updated ${new Date(artifact.updated_at).toLocaleString()}`);
  }

  console.log('');
}
