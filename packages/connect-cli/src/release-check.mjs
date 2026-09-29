import { writeFile } from 'node:fs/promises';
import { readProjectConfig } from './config.mjs';
import { verifyProtection } from './protection-verify.mjs';
import { readCurrentDeployment, rollbackProtection } from './deployment-rollback.mjs';

// Run inside the same serialized deployment job as the provider deployment.
export async function checkRelease(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!options.deploymentId) throw new Error('--deployment-id must identify the just-deployed Cloudflare deployment.');
  if (!options.outputFile) throw new Error('--output-file is required to retain the release check result.');
  const current = await readCurrentDeployment(config,options);
  if (current.id !== options.deploymentId) throw new Error('The requested deployment is no longer serving.');
  const verification = await verifyProtection({...options,root,expectRuntime:'installed',fetchImpl:options.verificationFetchImpl || options.fetchImpl || fetch});
  const after = await readCurrentDeployment(config,options);
  if (after.id !== current.id) throw new Error('Deployment changed during verification; evidence discarded.');
  const report = {...verification,deploymentId:current.id};
  // Persist the failed observation before any mutation so a failed rollback remains diagnosable.
  await writeFile(options.outputFile,JSON.stringify(report,null,2)+'\n');
  if (report.ok || options.baseline) return report;
  const rollback = await rollbackProtection({...options,root,config,failedDeploymentId:current.id,failureReport:report});
  const result = {...rollback,ok:false,releaseAccepted:false,failedVerification:report};
  await writeFile(options.outputFile,JSON.stringify(result,null,2)+'\n');
  // A recovered deployment still fails the release job: the attempted release did not pass.
  return {...result,ok:false,releaseAccepted:false};
}
