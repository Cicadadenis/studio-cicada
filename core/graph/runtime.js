import { generateDSLFromFlow, validateFlow } from '../dslCodegen.js';
import { projectGraphToFlow } from './model.js';

export function generateDslFromProjectGraph(projectGraph, options = {}) {
  return generateDSLFromFlow(projectGraphToFlow(projectGraph), options.token);
}

export function validateProjectGraphRuntime(projectGraph) {
  return validateFlow(projectGraphToFlow(projectGraph));
}
import { generateDSLFromFlow, validateFlow } from '../dslCodegen.js';
import { projectGraphToFlow } from './model.js';

export function generateDslFromProjectGraph(projectGraph, options = {}) {
  return generateDSLFromFlow(projectGraphToFlow(projectGraph), options.token);
}

export function validateProjectGraphRuntime(projectGraph) {
  return validateFlow(projectGraphToFlow(projectGraph));
}
